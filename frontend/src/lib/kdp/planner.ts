/**
 * KDP iPhone-helper sync planner — Royaltix-aligned wake modes.
 *
 * Pure scheduling math (no I/O). Given a clock and persisted sync state:
 *
 *   - STEADY:     today + yesterday, at least every ~15 minutes.
 *   - ONBOARDING: 30-day milestone first, then extend to 90 days, in 14-day
 *                 chunks (chained via `continueSoon` on processing wakes).
 *                 Recent wakes still take one chunk so a closed app cannot
 *                 abandon leftover days. Skipped only when Chrome already
 *                 covered the last 90 historical days.
 *   - NIGHTLY:    last-30-day correction after 02:00. Not sealed until every
 *                 day in the window is imported (leftover resumes on any wake).
 *   - GAP:        missed days after onboarding (bounded to 90).
 *
 * Wake modes (Royaltix):
 *   - recent:     today+yesterday, plus leftover nightly/gap journaling.
 *                 Caller drains a short deferred slice.
 *   - processing: onboarding chunks + full leftover drain.
 */
import { addDaysYmd, daysBetweenYmd, eachYmd, hourInTz, isYmd, ymdInTz } from "./dates.ts";
import { DEFERRED_DAY_LIMIT_RECENT } from "./deferred.ts";

export const SYNC_EVERY_MS = 15 * 60_000;
export const ONBOARDING_DAYS = 90;
export const ONBOARDING_MILESTONE_30_DAYS = 30;
export const NIGHTLY_BACKFILL_DAYS = 30;
export const ONBOARDING_CHUNK_DAYS = 14;
export const NIGHTLY_HOUR = 2;
/** Upper bound for a single gap catch-up so a long absence can't explode. */
export const MAX_GAP_DAYS = ONBOARDING_DAYS;
export const STATE_VERSION = 3;

export type KdpSyncRangeKind = "onboarding" | "steady" | "nightly" | "gap";
export type KdpWakeMode = "recent" | "processing";

export interface KdpSyncRange {
  from: string;
  to: string;
  kind: KdpSyncRangeKind;
}

export interface KdpSyncState {
  version: number;
  /** True once the initial 90-day backfill has fully completed. */
  onboardingDone: boolean;
  /** True once the first 30-day onboarding milestone completed. */
  milestone30Done: boolean;
  /** Local YMD when onboarding started (anchors 30/90 floors). */
  onboardingAnchorYmd: string | null;
  /** Newest day of the next onboarding chunk still to pull (walks backward). */
  onboardingCursor: string | null;
  /** Oldest day the current onboarding milestone must reach. */
  onboardingFloor: string | null;
  /** Epoch ms of the last steady (today+yesterday) pull. */
  lastSteadyAtMs: number;
  /**
   * Local YMD of the last *completed* nightly window (Royaltix lastSuccessSlot).
   * Incomplete nights must not write this.
   */
  lastNightlyYmd: string | null;
  /** Local YMD when the current nightly 30-day queue was opened. */
  nightlyStartedYmd: string | null;
  /** Local YMD of the last successful tick (for gap detection). */
  lastRunYmd: string | null;
  /** Epoch ms of the last tick. */
  lastRunAtMs: number;
}

export interface PlanOptions {
  timeZone?: string;
  /** Force a steady pull regardless of the 15-minute cadence (manual refresh). */
  force?: boolean;
  /**
   * recent = today+yesterday + leftover nightly/gap journaling.
   * processing = onboarding / full leftover drain.
   */
  wakeMode?: KdpWakeMode;
}

export interface PlanResult {
  due: boolean;
  ranges: KdpSyncRange[];
  nextState: KdpSyncState;
  reason: string;
  /** True while onboarding still has chunks left → run again immediately. */
  continueSoon: boolean;
  /** True when a nightly 30-day slot is open but not sealed. */
  leftoverNightly: boolean;
}

export function createInitialSyncState(): KdpSyncState {
  return {
    version: STATE_VERSION,
    onboardingDone: false,
    milestone30Done: false,
    onboardingAnchorYmd: null,
    onboardingCursor: null,
    onboardingFloor: null,
    lastSteadyAtMs: 0,
    lastNightlyYmd: null,
    nightlyStartedYmd: null,
    lastRunYmd: null,
    lastRunAtMs: 0,
  };
}

export function normalizeSyncState(raw: unknown): KdpSyncState {
  const base = createInitialSyncState();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<KdpSyncState> & { onboardingDone?: boolean };
  const onboardingDone = Boolean(s.onboardingDone);
  return {
    version: STATE_VERSION,
    onboardingDone,
    // Legacy v1 states that already finished 90-day treat milestone30 as done.
    milestone30Done: Boolean(s.milestone30Done) || onboardingDone,
    onboardingAnchorYmd: isYmd(s.onboardingAnchorYmd) ? s.onboardingAnchorYmd : null,
    onboardingCursor: isYmd(s.onboardingCursor) ? s.onboardingCursor : null,
    onboardingFloor: isYmd(s.onboardingFloor) ? s.onboardingFloor : null,
    lastSteadyAtMs: Number.isFinite(s.lastSteadyAtMs as number)
      ? Number(s.lastSteadyAtMs)
      : 0,
    lastNightlyYmd: isYmd(s.lastNightlyYmd) ? s.lastNightlyYmd : null,
    nightlyStartedYmd: isYmd(s.nightlyStartedYmd) ? s.nightlyStartedYmd : null,
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

export function countPlanDays(ranges: KdpSyncRange[]): number {
  const days = new Set<string>();
  for (const r of ranges) for (const d of eachYmd(r.from, r.to)) days.add(d);
  return days.size;
}

export function resolveWakeMode(reason: string, opts?: { force?: boolean }): KdpWakeMode {
  const r = String(reason || "").toLowerCase();
  if (opts?.force) return "processing";
  if (r === "enable" || r === "manual" || r === "foreground" || r === "processing") {
    return "processing";
  }
  // background / push / interval → short recent wake (Royaltix BGAppRefresh / silent push)
  return "recent";
}

/**
 * Pick wake mode for locked-phone TaskManager deliveries.
 * Native BGAppRefresh → recent (today+yesterday).
 * Native BGProcessing → processing (2am last-30 + onboarding).
 * Expo-only worker → processing when backfill is due, else recent.
 */
export function resolveBackgroundKdpWakeMode(args: {
  pendingNativeKind?: KdpWakeMode | null;
  hour: number;
  onboardingDone: boolean;
  incompleteNightly: boolean;
  deferredCount: number;
}): KdpWakeMode {
  // 90-day leftover always wins — a native BGAppRefresh "recent" stamp must
  // not abandon onboarding after the user closes the app.
  if (!args.onboardingDone) return "processing";
  if (args.pendingNativeKind === "processing" || args.pendingNativeKind === "recent") {
    return args.pendingNativeKind;
  }
  if (args.hour >= NIGHTLY_HOUR && args.incompleteNightly) return "processing";
  if (args.deferredCount > DEFERRED_DAY_LIMIT_RECENT) return "processing";
  return "recent";
}

/** Inclusive last-30 window ending yesterday (steady covers today). */
export function nightlyWindow(today: string): { from: string; to: string } {
  return {
    from: addDaysYmd(today, -NIGHTLY_BACKFILL_DAYS),
    to: addDaysYmd(today, -1),
  };
}

export function hasIncompleteNightly(state: KdpSyncState): boolean {
  const s = normalizeSyncState(state);
  return Boolean(s.nightlyStartedYmd && s.lastNightlyYmd !== s.nightlyStartedYmd);
}

/** Seal only when the queued 30-day window has no remaining deferred days. */
export function sealNightlyIfClear(
  state: KdpSyncState,
  today: string,
  deferred: string[],
): KdpSyncState {
  const next = normalizeSyncState(state);
  if (!isYmd(today) || next.nightlyStartedYmd !== today) return next;
  const window = nightlyWindow(today);
  const pending = deferred.filter((d) => isYmd(d) && d >= window.from && d <= window.to);
  if (pending.length > 0) return next;
  next.lastNightlyYmd = today;
  return next;
}

export function planSync(
  now: Date,
  prev: KdpSyncState,
  opts: PlanOptions = {},
): PlanResult {
  const tz = opts.timeZone;
  const wakeMode: KdpWakeMode = opts.wakeMode === "processing" ? "processing" : "recent";
  const nowMs = now.getTime();
  const today = ymdInTz(now, tz);
  const yesterday = addDaysYmd(today, -1);
  const state = normalizeSyncState(prev);
  const ranges: KdpSyncRange[] = [];
  const reasons: string[] = [];
  let continueSoon = false;
  // Every wake may advance onboarding. Processing chains chunks; recent does one.

  // ---- STEADY: today + yesterday every ~15 min (or forced) — always allowed ----
  const steadyDue = opts.force || nowMs - state.lastSteadyAtMs >= SYNC_EVERY_MS;
  if (steadyDue) {
    ranges.push({ from: yesterday, to: today, kind: "steady" });
    state.lastSteadyAtMs = nowMs;
    reasons.push(opts.force ? "steady(forced)" : "steady");
  }

  // ---- Initialize onboarding: 30-day milestone first, then 90 ----
  // A premature Chrome seal leaves milestone30Done with a null cursor. Reopen
  // those phones via the leftover journal — do not walk the last 90 again.
  if (
    !state.onboardingDone &&
    !state.onboardingCursor &&
    !state.onboardingFloor &&
    !state.milestone30Done
  ) {
    state.onboardingAnchorYmd = today;
    const span = ONBOARDING_MILESTONE_30_DAYS;
    state.onboardingFloor = addDaysYmd(today, -(span - 1));
    state.onboardingCursor = today;
  }

  // ---- ONBOARDING: one 14-day chunk per tick (processing wakes only) ----
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
      const anchor = isYmd(state.onboardingAnchorYmd) ? state.onboardingAnchorYmd : today;
      if (!state.milestone30Done) {
        // Seal 30-day milestone, extend floor to 90 days, keep walking backward.
        state.milestone30Done = true;
        const floor90 = addDaysYmd(anchor, -(ONBOARDING_DAYS - 1));
        state.onboardingFloor = floor90;
        state.onboardingCursor = addDaysYmd(floor, -1);
        if (state.onboardingCursor >= floor90) {
          continueSoon = true;
          reasons.push("milestone30→90");
        } else {
          state.onboardingDone = true;
          state.onboardingCursor = null;
          reasons.push("milestone30(done-covers-90)");
        }
      } else {
        state.onboardingDone = true;
        state.onboardingCursor = null;
        reasons.push("milestone90");
      }
    } else {
      state.onboardingCursor = addDaysYmd(chunkFrom, -1);
      continueSoon = true;
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

  // ---- NIGHTLY: open a last-30 queue at/after 02:00. Do not seal here. ----
  if (state.onboardingDone && hourInTz(now, tz) >= NIGHTLY_HOUR && state.lastNightlyYmd !== today) {
    if (state.nightlyStartedYmd !== today) {
      const window = nightlyWindow(today);
      ranges.push({ from: window.from, to: window.to, kind: "nightly" });
      state.nightlyStartedYmd = today;
      reasons.push("nightly");
    } else if (hasIncompleteNightly(state)) {
      reasons.push("nightly(leftover)");
    }
  } else if (state.onboardingDone && hasIncompleteNightly(state)) {
    reasons.push("nightly(leftover)");
  }

  if (wakeMode === "recent") continueSoon = false;

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
    reason: reasons.join(" + ") || (wakeMode === "recent" ? "idle(recent)" : "idle"),
    continueSoon,
    leftoverNightly: hasIncompleteNightly(state),
  };
}

