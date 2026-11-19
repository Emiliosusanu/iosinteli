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

function deployedWakeHandler(claimError = null, delivery = null) {
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
      return { data: !!delivery, error: claimError };
    }, from: () => ({ update: value => ({
      in: async (_key, tokens) => { delivery.invalidations.push({value, tokens}); return {error: null}; },
      eq: async (_key, token) => { delivery.environmentUpdates.push({value, token}); return {error: null}; },
    }) }) }),
    crypto: webcrypto, TextEncoder, Uint8Array, Response, Request, atob, btoa,
    console: { warn() {} },
    fetch: async () => {
      counters.fetches += 1;
      if (!delivery) throw new Error("Unexpected APNs send");
      const result = delivery.responses.shift();
      assert.ok(result, "Unexpected additional APNs send");
      if (result.error) throw new Error(result.error);
      return new Response(JSON.stringify({reason: result.reason}), {status: result.status});
    },
  });
  const executable = ts.transpileModule(wake.replace(/^import .*;$/m, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(executable, context);
  if (delivery) vm.runInContext(`
    loadTokens = async () => ({ tokens: [{token: 'only-this-phone', environment: 'sandbox', platform: 'ios'}],
      scanned: 1, skippedDisabled: 0, skippedStale: 0, capped: false });
    apnsAuthToken = async () => 'qa-provider';
  `, context);
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

test("an alternate-environment token rejection cannot invalidate the registered environment", async () => {
  for (const secondary of [
    {status: 400, reason: 'BadDeviceToken'},
    {status: 410, reason: 'Unregistered'},
  ]) {
    const delivery = {responses: [{status: 403, reason: 'BadEnvironmentKeyInToken'}, secondary], invalidations: [], environmentUpdates: []};
    const {handler, counters} = deployedWakeHandler(null, delivery);
    const response = await handler(new Request('https://example.test/wake', {
      method: 'POST', headers: {Authorization: 'Bearer configured-service-key'},
    }));
    const body = await response.json();
    assert.equal(counters.fetches, 2);
    assert.equal(delivery.invalidations.length, 0, 'the primary environment never rejected the device token');
    assert.equal(body.pruned, 0);
    assert.equal(body.failed, 1);
    assert.equal(body.sent, 0);
  }
});

test("a primary-environment permanent rejection still retires that exact token", async () => {
  for (const primary of [{status: 400, reason: 'BadDeviceToken'}, {status: 410, reason: 'Unregistered'}]) {
    const delivery = {responses: [primary], invalidations: [], environmentUpdates: []};
    const {handler, counters} = deployedWakeHandler(null, delivery);
    const body = await (await handler(new Request('https://example.test/wake', {
      method: 'POST', headers: {Authorization: 'Bearer configured-service-key'},
    }))).json();
    assert.equal(counters.fetches, 1);
    assert.equal(body.pruned, 1);
    assert.equal(delivery.invalidations[0].tokens[0], 'only-this-phone');
  }
});

test("confirmed delivery in the alternate environment heals metadata without a second successful send", async () => {
  const delivery = {responses: [{status: 403, reason: 'BadEnvironmentKeyInToken'}, {status: 200}], invalidations: [], environmentUpdates: []};
  const {handler, counters} = deployedWakeHandler(null, delivery);
  const body = await (await handler(new Request('https://example.test/wake', {
    method: 'POST', headers: {Authorization: 'Bearer configured-service-key'},
  }))).json();
  assert.equal(body.sent, 1); assert.equal(body.pruned, 0);
  assert.equal(counters.fetches, 2); assert.equal(delivery.invalidations.length, 0);
  assert.equal(delivery.environmentUpdates[0].value.environment, 'production');
});

test("provider or transport failures count one failed device, not two failed attempts", async () => {
  for (const result of [{status: 403, reason: 'ExpiredProviderToken'}, {status: 429}, {status: 503}, {error: 'offline'}]) {
    const delivery = {responses: [result], invalidations: [], environmentUpdates: []};
    const {handler, counters} = deployedWakeHandler(null, delivery);
    const body = await (await handler(new Request('https://example.test/wake', {
      method: 'POST', headers: {Authorization: 'Bearer configured-service-key'},
    }))).json();
    assert.equal(body.failed, 1);
    assert.equal(body.pruned, 0);
    assert.equal(counters.fetches, 1);
    assert.equal(delivery.invalidations.length, 0);
  }
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
