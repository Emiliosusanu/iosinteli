import { test } from "node:test";
import assert from "node:assert/strict";

import { addDaysYmd, daysBetweenYmd, eachYmd, ymdInTz } from "../src/lib/kdp/dates.ts";
import {
  NIGHTLY_BACKFILL_DAYS,
  ONBOARDING_CHUNK_DAYS,
  ONBOARDING_DAYS,
  SYNC_EVERY_MS,
  countPlanDays,
  createInitialSyncState,
  planSync,
} from "../src/lib/kdp/planner.ts";

const TZ = "UTC";
// Fixed wall clock: 2026-09-02 14:00 UTC.
const AT = (ymd, hour = 14) => new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);

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

test("first enable: onboarding covers 90 days and chains via continueSoon", () => {
  let state = createInitialSyncState();
  const now = AT("2026-09-02", 14);
  const covered = new Set();
  let res;
  let guard = 0;
  do {
    res = planSync(now, state, { timeZone: TZ });
    state = res.nextState;
    for (const r of res.ranges) for (const d of eachYmd(r.from, r.to)) covered.add(d);
    guard += 1;
    assert.ok(guard < 20, "onboarding should finish in a bounded number of chunks");
  } while (res.continueSoon);

  // Every day in the last 90 (today-89 .. today) must be covered, none missed.
  const floor = addDaysYmd("2026-09-02", -(ONBOARDING_DAYS - 1));
  for (const d of eachYmd(floor, "2026-09-02")) {
    assert.ok(covered.has(d), `onboarding missed ${d}`);
  }
  assert.equal(state.onboardingDone, true);
});

test("onboarding uses 14-day chunks", () => {
  const state = createInitialSyncState();
  const res = planSync(AT("2026-09-02"), state, { timeZone: TZ });
  const onboarding = rangesByKind(res).onboarding || [];
  assert.equal(onboarding.length >= 1, true);
  // First chunk is at most ONBOARDING_CHUNK_DAYS wide.
  const first = onboarding[0];
  assert.ok(daysBetweenYmd(first.from, first.to) <= ONBOARDING_CHUNK_DAYS - 1);
});

function completedState(now, tz = TZ) {
  let state = createInitialSyncState();
  let res;
  let guard = 0;
  do {
    res = planSync(now, state, { timeZone: tz });
    state = res.nextState;
    guard += 1;
  } while (res.continueSoon && guard < 30);
  return state;
}

test("steady pull is today + yesterday, throttled to ~15 min", () => {
  const now = AT("2026-09-02", 14);
  let state = completedState(now);

  // Immediately after: not due within 15 min.
  const soon = new Date(now.getTime() + 5 * 60_000);
  const r1 = planSync(soon, state, { timeZone: TZ });
  assert.equal((rangesByKind(r1).steady || []).length, 0);

  // After 15 min: steady due, covering yesterday..today only.
  const later = new Date(now.getTime() + SYNC_EVERY_MS + 1000);
  const r2 = planSync(later, state, { timeZone: TZ });
  const steady = rangesByKind(r2).steady || [];
  assert.equal(steady.length, 1);
  assert.equal(steady[0].from, "2026-09-01");
  assert.equal(steady[0].to, "2026-09-02");
});

test("force pulls steady even inside the 15-min window", () => {
  const now = AT("2026-09-02", 14);
  const state = completedState(now);
  const soon = new Date(now.getTime() + 60_000);
  const r = planSync(soon, state, { timeZone: TZ, force: true });
  assert.equal((rangesByKind(r).steady || []).length, 1);
});

test("nightly correction runs once per day at/after 02:00 for last 30 days", () => {
  // Onboard the day before so onboarding is done.
  const setup = AT("2026-09-01", 14);
  let state = completedState(setup);

  // Next day at 03:00 → nightly due. (May merge with the steady pull.)
  const nightly = AT("2026-09-02", 3);
  const r1 = planSync(nightly, state, { timeZone: TZ });
  state = r1.nextState;
  const covered = new Set();
  for (const rr of r1.ranges) for (const d of eachYmd(rr.from, rr.to)) covered.add(d);
  // Every day in the last 30 (today-29 .. yesterday) is corrected.
  for (const d of eachYmd(addDaysYmd("2026-09-02", -(NIGHTLY_BACKFILL_DAYS - 1)), "2026-09-01")) {
    assert.ok(covered.has(d), `nightly missed ${d}`);
  }
  assert.equal(state.lastNightlyYmd, "2026-09-02");

  // Same day, later → nightly does NOT run again (no fresh 30-day span).
  const again = AT("2026-09-02", 6);
  const r2 = planSync(again, state, { timeZone: TZ });
  assert.equal((rangesByKind(r2).nightly || []).length, 0);
  assert.equal(r2.nextState.lastNightlyYmd, "2026-09-02");
});

test("nightly does not run before 02:00", () => {
  const setup = AT("2026-09-01", 14);
  const state = completedState(setup);
  const early = AT("2026-09-02", 1);
  const r = planSync(early, state, { timeZone: TZ });
  assert.equal((rangesByKind(r).nightly || []).length, 0);
});

test("gap fill: helper off for days re-pulls every missed day (bounded 90)", () => {
  const start = AT("2026-09-02", 14);
  let state = completedState(start);

  // Reopen 10 days later.
  const back = AT("2026-09-12", 14);
  const r = planSync(back, state, { timeZone: TZ });
  const gap = rangesByKind(r).gap || [];
  assert.equal(gap.length, 1);
  // Covers at least the 10 missed days up to today.
  assert.equal(gap[0].to, "2026-09-12");
  assert.ok(daysBetweenYmd(gap[0].from, gap[0].to) >= 10);

  // A very long absence stays bounded to <= 90 days.
  const wayLater = AT("2027-09-12", 14);
  const r2 = planSync(wayLater, completedState(start), { timeZone: TZ });
  const gap2 = rangesByKind(r2).gap || [];
  assert.ok(daysBetweenYmd(gap2[0].from, gap2[0].to) <= ONBOARDING_DAYS);
});

test("no duplicate work: overlapping ranges merge", () => {
  const now = AT("2026-09-02", 3); // onboarding + steady + nightly all fire on first ever run
  const state = createInitialSyncState();
  const res = planSync(now, state, { timeZone: TZ });
  // Ranges must not overlap after merge.
  const sorted = [...res.ranges].sort((a, b) => (a.from < b.from ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].from > sorted[i - 1].to, "ranges overlap after merge");
  }
  // First tick pulls at least one onboarding chunk (chunked, chained via continueSoon).
  assert.ok(countPlanDays(res.ranges) >= ONBOARDING_CHUNK_DAYS);
});

test("idle when nothing is due", () => {
  const now = AT("2026-09-02", 14);
  const state = completedState(now);
  const r = planSync(new Date(now.getTime() + 60_000), state, { timeZone: TZ });
  assert.equal(r.due, false);
  assert.equal(r.ranges.length, 0);
});
