/**
 * KDP iPhone-helper sync planner — "never skip, never miss".
 *
 * Pure scheduling math (no I/O) so it can be unit-tested exhaustively. Given a
 * clock and the persisted sync state, it decides which date ranges the in-app
 * WebView helper should pull on this tick, mirroring the Chrome extension:
 *
 *   - STEADY:     today + yesterday, at least every ~15 minutes.
 *   - ONBOARDING: on first enable, backfill the last 90 days once, in 14-day
 *                 chunks (chained back-to-back via `continueSoon`).
 *   - NIGHTLY:    a last-30-day correction pass once per local day at/after 02:00
 *                 (Amazon posts late royalties/KENP; this catches them).
 *   - GAP:        if the helper was off for a while, re-pull every missed day up
 *                 to 90 days so nothing is skipped when the app reopens.
 *
 * The orchestrator persists {@link KdpSyncState} and feeds it back each tick.
 */
import { addDaysYmd, daysBetweenYmd, eachYmd, hourInTz, isYmd, ymdInTz } from "./dates.ts";

export const SYNC_EVERY_MS = 15 * 60_000;
export const ONBOARDING_DAYS = 90;
export const NIGHTLY_BACKFILL_DAYS = 30;
export const ONBOARDING_CHUNK_DAYS = 14;
export const NIGHTLY_HOUR = 2;
/** Upper bound for a single gap catch-up so a long absence can't explode. */
export const MAX_GAP_DAYS = ONBOARDING_DAYS;
export const STATE_VERSION = 1;

export type KdpSyncRangeKind = "onboarding" | "steady" | "nightly" | "gap";

export interface KdpSyncRange {
  from: string;
  to: string;
  kind: KdpSyncRangeKind;
}

export interface KdpSyncState {
  version: number;
  /** True once the initial 90-day backfill has fully completed. */
  onboardingDone: boolean;
  /** Newest day of the next onboarding chunk still to pull (walks backward). */
  onboardingCursor: string | null;
  /** Oldest day the onboarding backfill must reach (today-89 at enable time). */
  onboardingFloor: string | null;
  /** Epoch ms of the last steady (today+yesterday) pull. */
  lastSteadyAtMs: number;
  /** Local YMD of the last nightly correction pass (once per day). */
  lastNightlyYmd: string | null;
  /** Local YMD of the last successful tick (for gap detection). */
  lastRunYmd: string | null;
  /** Epoch ms of the last tick. */
  lastRunAtMs: number;
}

export interface PlanOptions {
  timeZone?: string;
  /** Force a steady pull regardless of the 15-minute cadence (manual refresh). */
  force?: boolean;
}

export interface PlanResult {
  due: boolean;
  ranges: KdpSyncRange[];
  nextState: KdpSyncState;
  reason: string;
  /** True while onboarding still has chunks left → run again immediately. */
  continueSoon: boolean;
}

export function createInitialSyncState(): KdpSyncState {
  return {
    version: STATE_VERSION,
    onboardingDone: false,
    onboardingCursor: null,
    onboardingFloor: null,
    lastSteadyAtMs: 0,
    lastNightlyYmd: null,
    lastRunYmd: null,
    lastRunAtMs: 0,
  };
}

export function normalizeSyncState(raw: unknown): KdpSyncState {
  const base = createInitialSyncState();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<KdpSyncState>;
  return {
    version: STATE_VERSION,
    onboardingDone: Boolean(s.onboardingDone),
    onboardingCursor: isYmd(s.onboardingCursor) ? s.onboardingCursor : null,
    onboardingFloor: isYmd(s.onboardingFloor) ? s.onboardingFloor : null,
    lastSteadyAtMs: Number.isFinite(s.lastSteadyAtMs as number)
      ? Number(s.lastSteadyAtMs)
      : 0,
    lastNightlyYmd: isYmd(s.lastNightlyYmd) ? s.lastNightlyYmd : null,
    lastRunYmd: isYmd(s.lastRunYmd) ? s.lastRunYmd : null,
    lastRunAtMs: Number.isFinite(s.lastRunAtMs as number)
      ? Number(s.lastRunAtMs)
      : 0,
  };
}

/** Merge overlapping/adjacent same-kind-agnostic ranges into a minimal set. */
export function mergeRanges(ranges: KdpSyncRange[]): KdpSyncRange[] {
  const valid = ranges.filter((r) => isYmd(r.from) && isYmd(r.to) && r.from <= r.to);
  if (valid.length <= 1) return valid;
  // Priority so the merged span keeps the most descriptive kind.
  const rank: Record<KdpSyncRangeKind, number> = {
    onboarding: 3,
    gap: 2,
    nightly: 1,
    steady: 0,
  };
  const sorted = [...valid].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: KdpSyncRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= addDaysYmd(last.to, 1)) {
      if (r.to > last.to) last.to = r.to;
      if (rank[r.kind] > rank[last.kind]) last.kind = r.kind;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Total distinct days a plan will pull (for logging / progress). */
export function countPlanDays(ranges: KdpSyncRange[]): number {
  const days = new Set<string>();
  for (const r of ranges) for (const d of eachYmd(r.from, r.to)) days.add(d);
  return days.size;
}

export function planSync(
  now: Date,
  prev: KdpSyncState,
  opts: PlanOptions = {},
): PlanResult {
  const tz = opts.timeZone;
  const nowMs = now.getTime();
  const today = ymdInTz(now, tz);
  const yesterday = addDaysYmd(today, -1);
  const state = normalizeSyncState(prev);
  const ranges: KdpSyncRange[] = [];
  const reasons: string[] = [];
  let continueSoon = false;

  // ---- Initialize onboarding window on first ever tick ----
  if (!state.onboardingDone && !state.onboardingCursor && !state.onboardingFloor) {
    state.onboardingFloor = addDaysYmd(today, -(ONBOARDING_DAYS - 1));
    state.onboardingCursor = today; // newest → oldest
  }

  // ---- STEADY: today + yesterday every ~15 min (or forced) ----
  const steadyDue = opts.force || nowMs - state.lastSteadyAtMs >= SYNC_EVERY_MS;
  if (steadyDue) {
    ranges.push({ from: yesterday, to: today, kind: "steady" });
    state.lastSteadyAtMs = nowMs;
    reasons.push(opts.force ? "steady(forced)" : "steady");
  }

  // ---- ONBOARDING: one 14-day chunk per tick, chained via continueSoon ----
  if (!state.onboardingDone && isYmd(state.onboardingCursor) && isYmd(state.onboardingFloor)) {
    const cursor = state.onboardingCursor;
    const floor = state.onboardingFloor;
    const chunkFrom = (() => {
      const candidate = addDaysYmd(cursor, -(ONBOARDING_CHUNK_DAYS - 1));
      return candidate < floor ? floor : candidate;
    })();
    ranges.push({ from: chunkFrom, to: cursor, kind: "onboarding" });
    reasons.push(`onboarding(${chunkFrom}..${cursor})`);
    if (chunkFrom <= floor) {
      state.onboardingDone = true;
      state.onboardingCursor = null;
    } else {
      state.onboardingCursor = addDaysYmd(chunkFrom, -1);
      continueSoon = true; // more chunks remain → run again right away
    }
  }

  // ---- GAP: helper was off; re-pull every missed day (bounded to 90) ----
  if (state.onboardingDone && state.lastRunYmd && isYmd(state.lastRunYmd)) {
    const missed = daysBetweenYmd(state.lastRunYmd, today);
    if (missed >= 2) {
      const span = Math.min(MAX_GAP_DAYS - 1, missed);
      ranges.push({ from: addDaysYmd(today, -span), to: today, kind: "gap" });
      reasons.push(`gap(${missed}d)`);
    }
  }

  // ---- NIGHTLY: last-30-day correction, once per local day at/after 02:00 ----
  if (
    state.onboardingDone &&
    hourInTz(now, tz) >= NIGHTLY_HOUR &&
    state.lastNightlyYmd !== today
  ) {
    ranges.push({
      from: addDaysYmd(today, -(NIGHTLY_BACKFILL_DAYS - 1)),
      to: yesterday,
      kind: "nightly",
    });
    state.lastNightlyYmd = today;
    reasons.push("nightly");
  }

  // Advance run bookkeeping only when we actually scheduled work.
  const merged = mergeRanges(ranges);
  const due = merged.length > 0;
  if (due) {
    state.lastRunYmd = today;
    state.lastRunAtMs = nowMs;
  }

  return {
    due,
    ranges: merged,
    nextState: state,
    reason: reasons.join(" + ") || "idle",
    continueSoon,
  };
}
