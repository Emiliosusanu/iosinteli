import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import {
  classifyKdpDiagnosticEvent,
  levelForKdpDiagnostic,
  redactKdpDiagnosticText,
} from "../src/lib/kdp/remoteDiagnosticsContract.ts";

const uploader = readFileSync(
  new URL("../src/lib/kdp/remoteDiagnostics.ts", import.meta.url),
  "utf8",
);
const activity = readFileSync(new URL("../src/lib/kdp/activity.ts", import.meta.url), "utf8");

test("iOS KDP diagnostics redact credentials and JWTs", () => {
  const jwt = "eyJabcdefghijklmno.abcdefghijklmnop.abcdefghijk";
  const redacted = redactKdpDiagnosticText(
    `Bearer secret.value access_token=top-secret password=hunter2 ${jwt}`,
  );
  assert.doesNotMatch(redacted, /secret\.value|top-secret|hunter2|eyJabcdefgh/);
  assert.match(redacted, /REDACTED/);
});

test("iOS KDP diagnostics classify pricing, protection, backfill and failures", () => {
  assert.equal(classifyKdpDiagnosticEvent("Pricing retry pending", "info"), "ios.kdp.pricing.retry");
  assert.equal(classifyKdpDiagnosticEvent("Protected prior royalties", "info"), "ios.kdp.protection");
  assert.equal(classifyKdpDiagnosticEvent("Night backfill completed", "nightly"), "ios.kdp.backfill");
  assert.equal(classifyKdpDiagnosticEvent("Request failed", "error"), "ios.kdp.error");
  assert.equal(levelForKdpDiagnostic("error"), "error");
});

test("iOS KDP activity is queued offline and uploaded with exact account scope", () => {
  assert.match(activity, /enqueueKdpRemoteDiagnostic\(entry\)/);
  assert.match(uploader, /inteliads\.kdpHelper\.remoteDiagnosticsQueue/);
  assert.match(uploader, /MAX_QUEUED_ENTRIES = 200/);
  assert.match(uploader, /loadHelperAccountId\(\)/);
  assert.match(uploader, /accountId: string/);
  assert.match(uploader, /entry\.accountId === accountId/);
  assert.match(uploader, /\/extension-logs\/batch/);
  assert.match(uploader, /entries: batch\.map\(uploadEntry\)/);
  assert.match(uploader, /accountId is a batch field/);
  assert.match(uploader, /source: "ios_kdp_helper"/);
  assert.match(uploader, /extensionVersion: clientVersion\(\)/);
});

test("marketplace timings survive an offline queue and retain their original account", async () => {
  const values = new Map(), requests = [], exports = {};
  let online = false, account = "account-a";
  const storage = {
    getItem: async (key, fallback) => values.get(key) ?? fallback,
    setItem: async (key, value) => values.set(key, value),
  };
  const modules = {
    "expo-constants": { default: { expoConfig: { version: "1.0.1", ios: { buildNumber: "candidate" } } } },
    "react-native": { Platform: { Version: "26.0" } },
    "../rulesApi": { nestApiFetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: online, status: online ? 200 : 503, text: async () => "offline" };
    } },
    "@/src/utils/storage": { storage },
    "./persist.ts": { loadHelperAccountId: async () => account },
    "./remoteDiagnosticsContract.ts": {
      classifyKdpDiagnosticEvent, levelForKdpDiagnostic, redactKdpDiagnosticText,
    },
  };
  vm.runInNewContext(ts.transpileModule(uploader, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: name => modules[name], Date, Math, Set, Promise });
  const timing = { stage: "marketplaces", ymd: "2026-10-10", durationMs: 4200,
    concurrency: 3, stores: [{ marketplace: "CA", currency: "CAD", durationMs: 1100, ok: true }] };
  await exports.enqueueKdpRemoteDiagnostic({ id: "timing-1", atMs: Date.now(), kind: "info",
    message: "Marketplace capture", timing });
  await exports.flushKdpRemoteDiagnostics();
  account = "account-b";
  online = true;
  await exports.flushKdpRemoteDiagnostics();
  const last = requests.at(-1);
  assert.equal(last.url, "/extension-logs/batch");
  assert.equal(last.body.accountId, "account-a");
  assert.equal(last.body.entries[0].event, "ios.kdp.marketplace_timing");
  assert.deepEqual(last.body.entries[0].detail.timing, timing);
  assert.equal(last.body.entries[0].accountId, undefined);
  assert.deepEqual(JSON.parse(values.get("inteliads.kdpHelper.remoteDiagnosticsQueue")), []);
});
