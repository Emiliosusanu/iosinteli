import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addDaysYmd, eachYmd } from "../src/lib/kdp/dates.ts";
import { reopenOnboardingIfIncomplete, webHistorySealsOnboarding } from "../src/lib/kdp/coverage.ts";
import { createInitialSyncState, ONBOARDING_DAYS, planSync } from "../src/lib/kdp/planner.ts";

const accounts = readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/lib/kdp/history.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/lib/settingsContract.ts", import.meta.url), "utf8");
const planner = readFileSync(new URL("../src/lib/kdp/planner.ts", import.meta.url), "utf8");
const helper = readFileSync(new URL("../app/more/kdp-helper.tsx", import.meta.url), "utf8");
const wake = readFileSync(new URL("../src/lib/kdp/backgroundWake.ts", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");

test("Chrome 45-day history does not skip the remaining last-90 days", () => {
  const today = "2026-09-05";
  const floor = addDaysYmd(today, -(ONBOARDING_DAYS - 1));
  const fortyFive = eachYmd(addDaysYmd(today, -45), addDaysYmd(today, -1));
  const partial = webHistorySealsOnboarding({ haveDays: fortyFive, todayYmd: today });
  assert.equal(partial.sealed, false);
  assert.ok(partial.missingHistorical.length > 0);
  assert.ok(partial.missingHistorical.includes(floor));

  const full = eachYmd(floor, addDaysYmd(today, -1));
  const complete = webHistorySealsOnboarding({ haveDays: full, todayYmd: today });
  assert.equal(complete.sealed, true);
  assert.deepEqual(complete.missingHistorical, []);

  const empty = webHistorySealsOnboarding({ haveDays: [], todayYmd: today });
  assert.equal(empty.sealed, false);
});

test("importer seals onboarding from complete cloud history before planning", () => {
  assert.match(importer, /cloudHistorySealsOnboarding/);
  assert.match(importer, /reopenOnboardingIfIncomplete/);
  assert.match(importer, /skipping 30→90 backfill/);
  assert.match(importer, /missingHistorical/);
  assert.match(importer, /if \(!state\.onboardingDone\) wakeMode = "processing"/);
  assert.match(history, /webHistorySealsOnboarding/);
  assert.match(history, /missingHistorical/);
  assert.match(history, /unknown: true/);
  assert.match(history, /if \(!result\.ok\) return \[\]/);
});

test("persisted 45-day Chrome seal reopens leftover last-90 days", () => {
  const today = "2026-09-05";
  const floor = addDaysYmd(today, -(ONBOARDING_DAYS - 1));
  const fortyFive = eachYmd(addDaysYmd(today, -45), addDaysYmd(today, -1));
  const sealedTooSoon = {
    ...createInitialSyncState(),
    onboardingDone: true,
    milestone30Done: true,
  };
  const partial = webHistorySealsOnboarding({ haveDays: fortyFive, todayYmd: today });
  const reopened = reopenOnboardingIfIncomplete(sealedTooSoon, partial);
  assert.equal(reopened.onboardingDone, false);
  assert.equal(reopened.milestone30Done, true);
  assert.ok(partial.missingHistorical.includes(floor));

  const full = eachYmd(floor, addDaysYmd(today, -1));
  const complete = webHistorySealsOnboarding({ haveDays: full, todayYmd: today });
  const staysSealed = reopenOnboardingIfIncomplete(sealedTooSoon, complete);
  assert.equal(staysSealed.onboardingDone, true);

  const unknown = reopenOnboardingIfIncomplete(sealedTooSoon, {
    sealed: false,
    dayCount: 0,
    missingHistorical: fortyFive,
    unknown: true,
  });
  assert.equal(unknown.onboardingDone, true);

  const leftoverOnly = planSync(new Date("2026-09-05T15:00:00Z"), reopened, {
    timeZone: "UTC",
    wakeMode: "processing",
  });
  assert.equal((leftoverOnly.ranges || []).some((range) => range.kind === "onboarding"), false);
  assert.equal(leftoverOnly.nextState.onboardingDone, false);
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

test("closed-app wakes resume last-90 leftover instead of staying recent-only", () => {
  assert.match(planner, /90-day leftover always wins/);
  assert.match(helper, /startedAfterLogin/);
  assert.match(helper, /last 90 days/);
  assert.match(helper, /close the app/);
  assert.match(wake, /resolveBackgroundKdpWakeMode/);
  assert.doesNotMatch(wake, /Silent push is always a short recent wake/);
  assert.match(notifications, /resolveLockedPhoneKdpWakeMode\("push"\)/);
  assert.match(importer, /Last-90 leftover/);
});
