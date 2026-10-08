import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  assert.match(uploader, /source: "ios_kdp_helper"/);
  assert.match(uploader, /extensionVersion: clientVersion\(\)/);
});
