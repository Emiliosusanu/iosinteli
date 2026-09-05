import { test } from "node:test";
import assert from "node:assert/strict";

import { addDaysYmd, daysBetweenYmd, eachYmd, ymdInTz } from "../src/lib/kdp/dates.ts";
import {
  acknowledgeDeferredDays,
  deferredDayLimitForWake,
  journalDeferredDays,
  takeDeferredDays,
} from "../src/lib/kdp/deferred.ts";
import {
  NIGHTLY_BACKFILL_DAYS,
  ONBOARDING_CHUNK_DAYS,
  ONBOARDING_DAYS,
  ONBOARDING_MILESTONE_30_DAYS,
  SYNC_EVERY_MS,
  countPlanDays,
  createInitialSyncState,
  nightlyWindow,
  planSync,
  resolveBackgroundKdpWakeMode,
  resolveWakeMode,
  sealNightlyIfClear,
} from "../src/lib/kdp/planner.ts";
import { missingDays, orderDaysForWake } from "../src/lib/kdp/coverage.ts";

const TZ = "UTC";
const AT = (ymd, hour = 14) => new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
const PROC = { timeZone: TZ, wakeMode: "processing" };

function rangesByKind(res) {
  const m = {};
  for (const r of res.ranges) (m[r.kind] ||= []).push(r);
  return m;
}

test("date math: addDays, eachYmd, daysBetween", () => {
  assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysYmd("2026-02-28", 1), "2026-03-01");
  assert.equal(eachYmd("2026-09-01", "2026-09-03").join(","), "2026-09-01,2026-09-02,2026-09-03");
  assert.equal(daysBetweenYmd("2026-09-01", "2026-09-30"), 29);
  assert.equal(ymdInTz(AT("2026-09-02"), TZ), "2026-09-02");
});

test("wake mode: push/interval are recent; enable/manual/foreground are processing", () => {
  assert.equal(resolveWakeMode("push"), "recent");
  assert.equal(resolveWakeMode("interval"), "recent");
  assert.equal(resolveWakeMode("background"), "recent");
  assert.equal(resolveWakeMode("enable"), "processing");
  assert.equal(resolveWakeMode("manual"), "processing");
  assert.equal(resolveWakeMode("foreground"), "processing");
  assert.equal(resolveWakeMode("push", { force: true }), "processing");
});

test("recent wake only schedules today+yesterday (no onboarding)", () => {
  const state = createInitialSyncState();
  const res = planSync(AT("2026-09-02"), state, { timeZone: TZ, wakeMode: "recent", force: true });
  assert.equal((rangesByKind(res).onboarding || []).length, 0);
  assert.equal((rangesByKind(res).steady || []).length, 1);
  assert.equal(res.continueSoon, false);
  assert.equal(res.nextState.onboardingDone, false);
});

test("processing onboarding: 30-day milestone then extends to 90", () => {
  let state = createInitialSyncState();
  const now = AT("2026-09-02", 14);
  const covered = new Set();
  let res;
  let guard = 0;
  let sawMilestone30 = false;
  do {
    res = planSync(now, state, PROC);
    state = res.nextState;
    if (state.milestone30Done) sawMilestone30 = true;
    for (const r of res.ranges) for (const d of eachYmd(r.from, r.to)) covered.add(d);
    guard += 1;
    assert.ok(guard < 30, "onboarding should finish in a bounded number of chunks");
  } while (res.continueSoon);

  assert.equal(sawMilestone30, true);
  assert.equal(state.onboardingDone, true);
  assert.equal(state.milestone30Done, true);
  const floor = addDaysYmd("2026-09-02", -(ONBOARDING_DAYS - 1));
  for (const d of eachYmd(floor, "2026-09-02")) {
    assert.ok(covered.has(d), `onboarding missed ${d}`);
  }
  // First milestone floor is 30 days.
  assert.equal(ONBOARDING_MILESTONE_30_DAYS, 30);
});

test("onboarding uses 14-day chunks", () => {
  const state = createInitialSyncState();
  const res = planSync(AT("2026-09-02"), state, PROC);
  const onboarding = rangesByKind(res).onboarding || [];
  assert.equal(onboarding.length >= 1, true);
  const first = onboarding[0];
  assert.ok(daysBetweenYmd(first.from, first.to) <= ONBOARDING_CHUNK_DAYS - 1);
});

function completedState(now, tz = TZ) {
  let state = createInitialSyncState();
  let res;
  let guard = 0;
  do {
    res = planSync(now, state, { timeZone: tz, wakeMode: "processing" });
    state = res.nextState;
    guard += 1;
  } while (res.continueSoon && guard < 40);
  return state;
}

test("steady pull is today + yesterday, throttled to ~15 min", () => {
  const now = AT("2026-09-02", 14);
  let state = completedState(now);

  const soon = new Date(now.getTime() + 5 * 60_000);
  const r1 = planSync(soon, state, PROC);
  assert.equal((rangesByKind(r1).steady || []).length, 0);

  const later = new Date(now.getTime() + SYNC_EVERY_MS + 1000);
  const r2 = planSync(later, state, PROC);
  const steady = rangesByKind(r2).steady || [];
  assert.equal(steady.length, 1);
  assert.equal(steady[0].from, "2026-09-01");
  assert.equal(steady[0].to, "2026-09-02");
});

test("force pulls steady even inside the 15-min window", () => {
  const now = AT("2026-09-02", 14);
  const state = completedState(now);
  const soon = new Date(now.getTime() + 60_000);
  const r = planSync(soon, state, { ...PROC, force: true });
  assert.equal((rangesByKind(r).steady || []).length, 1);
});

test("nightly correction opens last 30 days at/after 02:00 and does not seal itself", () => {
  const setup = AT("2026-09-01", 14);
  let state = completedState(setup);

  const nightly = AT("2026-09-02", 3);
  const r1 = planSync(nightly, state, PROC);
  state = r1.nextState;
  assert.equal(state.nightlyStartedYmd, "2026-09-02");
  assert.equal(state.lastNightlyYmd, null);
  const covered = new Set();
  for (const rr of r1.ranges) for (const d of eachYmd(rr.from, rr.to)) covered.add(d);
  const windowFrom = addDaysYmd("2026-09-02", -NIGHTLY_BACKFILL_DAYS);
  for (const d of eachYmd(windowFrom, "2026-09-01")) {
    assert.ok(covered.has(d), `nightly missed ${d}`);
  }

  const again = AT("2026-09-02", 6);
  const r2 = planSync(again, state, PROC);
  assert.equal((rangesByKind(r2).nightly || []).length, 0);
  assert.equal(r2.leftoverNightly, true);

  state = sealNightlyIfClear(state, "2026-09-02", []);
  assert.equal(state.lastNightlyYmd, "2026-09-02");
  const r3 = planSync(again, state, PROC);
  assert.equal((rangesByKind(r3).nightly || []).length, 0);
  assert.equal(r3.leftoverNightly, false);
});

test("nightly does not run before 02:00", () => {
  const setup = AT("2026-09-01", 14);
  const state = completedState(setup);
  const early = AT("2026-09-02", 1);
  const r = planSync(early, state, PROC);
  assert.equal((rangesByKind(r).nightly || []).length, 0);
});

test("gap fill: helper off for days re-pulls every missed day (bounded 90)", () => {
  const start = AT("2026-09-02", 14);
  let state = completedState(start);

  const back = AT("2026-09-12", 14);
  const r = planSync(back, state, PROC);
  const gap = rangesByKind(r).gap || [];
  assert.equal(gap.length, 1);
  assert.equal(gap[0].to, "2026-09-12");
  assert.ok(daysBetweenYmd(gap[0].from, gap[0].to) >= 10);

  const wayLater = AT("2027-09-12", 14);
  const r2 = planSync(wayLater, completedState(start), PROC);
  const gap2 = rangesByKind(r2).gap || [];
  assert.ok(daysBetweenYmd(gap2[0].from, gap2[0].to) <= ONBOARDING_DAYS);
});

test("no duplicate work: overlapping ranges merge", () => {
  const now = AT("2026-09-02", 3);
  const state = createInitialSyncState();
  const res = planSync(now, state, PROC);
  const sorted = [...res.ranges].sort((a, b) => (a.from < b.from ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].from > sorted[i - 1].to, "ranges overlap after merge");
  }
  assert.ok(countPlanDays(res.ranges) >= ONBOARDING_CHUNK_DAYS);
});

test("idle when nothing is due", () => {
  const now = AT("2026-09-02", 14);
  const state = completedState(now);
  const r = planSync(new Date(now.getTime() + 60_000), state, PROC);
  assert.equal(r.due, false);
  assert.equal(r.ranges.length, 0);
});

test("deferred journal: journal, take, acknowledge; recent wakes drain leftover", () => {
  assert.equal(deferredDayLimitForWake("recent"), 14);
  assert.equal(deferredDayLimitForWake("processing"), 30);
  let q = journalDeferredDays([], ["2026-09-01", "2026-09-02", "2026-09-01"]);
  assert.deepEqual(q, ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(takeDeferredDays(q, 1), ["2026-09-01"]);
  q = acknowledgeDeferredDays(q, ["2026-09-01"]);
  assert.deepEqual(q, ["2026-09-02"]);
  assert.deepEqual(takeDeferredDays(q, 0), []);
});

test("incomplete nightly is not sealed while deferred days remain", () => {
  const state = {
    ...createInitialSyncState(),
    onboardingDone: true,
    milestone30Done: true,
    nightlyStartedYmd: "2026-09-02",
    lastNightlyYmd: null,
  };
  const stillOpen = sealNightlyIfClear(state, "2026-09-02", ["2026-08-20"]);
  assert.equal(stillOpen.lastNightlyYmd, null);
  const sealed = sealNightlyIfClear(state, "2026-09-02", []);
  assert.equal(sealed.lastNightlyYmd, "2026-09-02");
});

test("recent wake still journals last-30 leftover after onboarding", () => {
  const now = AT("2026-09-02", 3);
  let state = completedState(AT("2026-09-01", 14));
  state = { ...state, lastNightlyYmd: null, nightlyStartedYmd: null };
  const r = planSync(now, state, { timeZone: TZ, wakeMode: "recent", force: true });
  assert.equal((rangesByKind(r).onboarding || []).length, 0);
  assert.equal((rangesByKind(r).nightly || []).length, 1);
  assert.equal(r.continueSoon, false);
  assert.equal(r.nextState.nightlyStartedYmd, "2026-09-02");
  assert.equal(r.nextState.lastNightlyYmd, null);
});

test("coverage math finds holes and prefers today/yesterday", () => {
  const from = "2026-09-01";
  const to = "2026-09-04";
  assert.deepEqual(missingDays(["2026-09-01", "2026-09-03"], from, to), ["2026-09-02", "2026-09-04"]);
  assert.deepEqual(orderDaysForWake(["2026-09-01", "2026-09-03", "2026-09-04"], "2026-09-04", "2026-09-03"), [
    "2026-09-04",
    "2026-09-03",
    "2026-09-01",
  ]);
  const window = nightlyWindow("2026-09-02");
  assert.equal(window.to, "2026-09-01");
  assert.equal(eachYmd(window.from, window.to).length, NIGHTLY_BACKFILL_DAYS);
});

test("locked-phone wake routing: refresh=recent, processing=backfill, Expo smart after 2am", () => {
  assert.equal(
    resolveBackgroundKdpWakeMode({
      pendingNativeKind: "recent",
      hour: 3,
      onboardingDone: true,
      incompleteNightly: true,
      deferredCount: 30,
    }),
    "recent",
  );
  assert.equal(
    resolveBackgroundKdpWakeMode({
      pendingNativeKind: "processing",
      hour: 14,
      onboardingDone: true,
      incompleteNightly: false,
      deferredCount: 0,
    }),
    "processing",
  );
  assert.equal(
    resolveBackgroundKdpWakeMode({
      pendingNativeKind: null,
      hour: 3,
      onboardingDone: true,
      incompleteNightly: true,
      deferredCount: 20,
    }),
    "processing",
  );
  assert.equal(
    resolveBackgroundKdpWakeMode({
      pendingNativeKind: null,
      hour: 14,
      onboardingDone: true,
      incompleteNightly: false,
      deferredCount: 2,
    }),
    "recent",
  );
  assert.equal(
    resolveBackgroundKdpWakeMode({
      pendingNativeKind: null,
      hour: 14,
      onboardingDone: false,
      incompleteNightly: false,
      deferredCount: 0,
    }),
    "processing",
  );
});
