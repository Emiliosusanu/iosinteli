import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveApnsEnvironment } from "../src/lib/apnsEnvironment.ts";

const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const nativeModule = readFileSync(
  new URL("../modules/inteliads-native-sync/ios/InteliAdsNativeSyncModule.swift", import.meta.url),
  "utf8",
);

test("explicit APNs environment overrides the signed provisioning profile", () => {
  assert.equal(
    resolveApnsEnvironment({ configured: "production", signed: "sandbox", isDevelopment: true }),
    "production",
  );
  assert.equal(
    resolveApnsEnvironment({ configured: "sandbox", signed: "production", isDevelopment: false }),
    "sandbox",
  );
});

test("signed provisioning environment overrides the JavaScript development mode", () => {
  assert.equal(
    resolveApnsEnvironment({ configured: null, signed: "sandbox", isDevelopment: false }),
    "sandbox",
  );
  assert.equal(
    resolveApnsEnvironment({ configured: undefined, signed: "production", isDevelopment: true }),
    "production",
  );
});

test("safe fallback remains sandbox for debug and production for release", () => {
  assert.equal(
    resolveApnsEnvironment({ configured: "invalid", signed: null, isDevelopment: true }),
    "sandbox",
  );
  assert.equal(
    resolveApnsEnvironment({ configured: undefined, signed: "invalid", isDevelopment: false }),
    "production",
  );
});

test("push registration reads the signed environment and native code reads provisioning entitlements", () => {
  assert.match(notifications, /await getNativeApnsEnvironment\(\)/);
  assert.match(notifications, /resolveApnsEnvironment/);
  assert.match(nativeModule, /embedded.*mobileprovision/s);
  assert.match(nativeModule, /aps-environment/);
  assert.doesNotMatch(notifications, /configuredEnvironment === "sandbox"/);
});
