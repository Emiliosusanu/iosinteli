import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";

const repo = join(new URL("../..", import.meta.url).pathname);
const wake = readFileSync(join(repo, "supabase/functions/kdp-wake-push/index.ts"), "utf8");
const migration = join(repo, "supabase/migrations/20260905120000_device_push_tokens_sender_parity.sql");

test("kdp wake skips disabled/stale tokens and caps fan-out", () => {
  assert.match(wake, /KDP_WAKE_MAX_TOKENS_PER_TICK/);
  assert.match(wake, /KDP_WAKE_STALE_TOKEN_DAYS/);
  assert.match(wake, /disabled_at/);
  assert.match(wake, /invalidated_at/);
  assert.match(wake, /skippedStale/);
  assert.match(wake, /invalidated_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(wake, /\.delete\(\)\.in\("token"/);
});

test("send-push skips disabled tokens and soft-invalidates dead ones", () => {
  const send = readFileSync(join(repo, "supabase/functions/send-push/index.ts"), "utf8");
  assert.match(send, /disabled_at/);
  assert.match(send, /invalidated_at/);
  assert.match(send, /!t\.disabled_at/);
  assert.match(send, /invalidated_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(send, /\.delete\(\)\.in\("token"/);
});

test("sender-parity migration adds Nest columns", () => {
  assert.equal(existsSync(migration), true);
  const sql = readFileSync(migration, "utf8");
  assert.match(sql, /disabled_at/);
  assert.match(sql, /invalidated_at/);
  assert.match(sql, /last_seen_at/);
  assert.match(sql, /bundle_id/);
});

function deployedWakeHandler(claimError = null) {
  const counters = { claims: 0, fetches: 0 };
  let handler;
  const env = {
    APNS_KEY_ID: "test-key", APNS_TEAM_ID: "test-team", APNS_PRIVATE_KEY: "test-private",
    SUPABASE_SERVICE_ROLE_KEY: "configured-service-key", KDP_WAKE_SECRET: "configured-wake-secret",
    KDP_WAKE_CRON_SECRET: "configured-cron-secret",
  };
  const context = vm.createContext({
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
    createClient: () => ({ rpc: async () => {
      counters.claims += 1;
      return { data: false, error: claimError };
    } }),
    crypto: webcrypto, TextEncoder, Uint8Array, Response, Request, atob, btoa,
    console: { warn() {} },
    fetch: async () => { counters.fetches += 1; throw new Error("Unexpected APNs send"); },
  });
  const executable = ts.transpileModule(wake.replace(/^import .*;$/m, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(executable, context);
  return { handler, counters };
}

test("public wake endpoint rejects a forged service_role payload before claiming or sending", async () => {
  const { handler, counters } = deployedWakeHandler();
  const forged = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.fake`;
  const response = await handler(new Request("https://example.test/wake", {
    method: "POST", headers: { Authorization: `Bearer ${forged}` },
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(counters, { claims: 0, fetches: 0 });
});

test("configured service key and wake secret are accepted, while lease errors stop fleet sending", async () => {
  for (const headers of [
    { Authorization: "Bearer configured-service-key" },
    { "X-InteliAds-Wake-Secret": "configured-wake-secret" },
    { "X-InteliAds-Wake-Secret": "configured-cron-secret" },
  ]) {
    const limited = deployedWakeHandler();
    assert.equal((await limited.handler(new Request("https://example.test/wake", { method: "POST", headers }))).status, 202);
    assert.equal(limited.counters.claims, 1);
    assert.equal(limited.counters.fetches, 0);
    const unavailable = deployedWakeHandler({ message: "RPC unavailable" });
    const response = await unavailable.handler(new Request("https://example.test/wake", { method: "POST", headers }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "wake_lease_unavailable");
    assert.equal(unavailable.counters.fetches, 0);
  }
});
