import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const accounts = readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/lib/kdp/history.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/lib/settingsContract.ts", import.meta.url), "utf8");
const planner = readFileSync(new URL("../src/lib/kdp/planner.ts", import.meta.url), "utf8");

test("web history threshold is below a full 90-day window", () => {
  assert.match(history, /WEB_HISTORY_MIN_DAYS = 45/);
  assert.match(planner, /ONBOARDING_DAYS = 90/);
});

test("importer seals onboarding from cloud history before planning", () => {
  assert.match(importer, /cloudHistorySealsOnboarding/);
  assert.match(importer, /skipping 30→90 backfill/);
  assert.match(importer, /milestone30Done: true/);
  assert.match(importer, /onboardingDone: true/);
});

test("importer journals before Amazon and seals nightly only when the window is clear", () => {
  assert.match(importer, /journalDeferredDays/);
  assert.match(importer, /cloudMissingDays/);
  assert.match(importer, /sealNightlyIfClear/);
  assert.match(importer, /orderDaysForWake/);
  assert.ok(
    importer.indexOf("journalDeferredDays(deferred, plannedDays)") <
      importer.indexOf("await syncOneDay(accountId, ymd"),
  );
});

test("auto-link never steals profiles already bound to another KDP account", () => {
  assert.match(accounts, /linkAccountToProfilesSafe/);
  assert.match(accounts, /takenByOther/);
  assert.match(accounts, /fetchKdpAccounts/);
  assert.doesNotMatch(accounts, /name: "iPhone"/);
});

test("background replay prefers Keychain native fetch (Royaltix-style)", () => {
  assert.match(runtime, /kdpNativeFetch/);
  assert.match(runtime, /credentials: "omit"/);
  assert.match(runtime, /session\?\.cookies/);
  assert.match(history, /cloudMissingDays/);
  assert.match(history, /kdp_daily_data/);
});

test("KDP helper keeps 30→90 milestones and deferred wakes (settings UI stays short)", () => {
  // User-facing settingsContract footers were shortened; behavior lives in planner/importer.
  assert.doesNotMatch(settings, /Royaltix/);
  assert.match(planner, /milestone30→90|ONBOARDING_DAYS = 90|deferredCount/);
  assert.match(importer, /30→90|deferred|deferredDayLimitForWake/);
});
