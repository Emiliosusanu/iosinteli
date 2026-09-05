import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applySessionToHeaders } from "../src/lib/kdp/sessionContract.ts";

const sessionSrc = readFileSync(new URL("../src/lib/kdp/session.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");

test("applySessionToHeaders fills Cookie and User-Agent when missing", () => {
  const out = applySessionToHeaders(
    { Accept: "application/json" },
    {
      cookies: "session-id=abc",
      userAgent: "InteliAds-Test/1.0",
      extraHeaders: { "anti-csrftoken": "tok" },
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
  );
  assert.equal(out.Cookie, "session-id=abc");
  assert.equal(out["User-Agent"], "InteliAds-Test/1.0");
  assert.equal(out["anti-csrftoken"], "tok");
  assert.equal(out.Accept, "application/json");
});

test("applySessionToHeaders does not overwrite existing Cookie or User-Agent", () => {
  const out = applySessionToHeaders(
    { Cookie: "existing=1", "User-Agent": "page-ua" },
    {
      cookies: "keychain=2",
      userAgent: "keychain-ua",
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
  );
  assert.equal(out.Cookie, "existing=1");
  assert.equal(out["User-Agent"], "page-ua");
});

test("Keychain session uses AfterFirstUnlock and wires into capture/replay", () => {
  assert.match(sessionSrc, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/);
  assert.match(sessionSrc, /SecureStore/);
  assert.match(runtime, /mergeSessionFromCaptureHeaders/);
  assert.match(runtime, /applySessionToHeaders/);
  assert.match(runtime, /SESSION_META/);
  assert.match(notifications, /runKdpIosHelperTick\("push"/);
  assert.match(notifications, /resolveLockedPhoneKdpWakeMode/);
  assert.match(notifications, /wakeMode/);
  assert.match(notifications, /KDP silent wakes need it/);
  assert.match(notifications, /registerTaskAsync\(INTELIADS_NOTIFICATION_TASK\)/);
  assert.match(notifications, /registerNativeMetronome/);
  assert.match(importer, /ensureBackgroundRefreshRegistered/);
  assert.match(app, /ensureBackgroundRefreshRegistered/);
});
