/**
 * Pure coverage math for KDP day recovery (Royaltix leftover / missing-day).
 */
import { addDaysYmd, eachYmd, isYmd } from "./dates.ts";
import {
  ONBOARDING_DAYS,
  ONBOARDING_MILESTONE_30_DAYS,
  normalizeSyncState,
  type KdpSyncState,
} from "./planner.ts";

export type WebHistorySeal = {
  sealed: boolean;
  dayCount: number;
  missingHistorical: string[];
  /** True when cloud coverage could not be read — do not unseal or invent holes. */
  unknown?: boolean;
};

/** Last-90 onboarding is done only when every historical day is already in cloud. */
export function webHistorySealsOnboarding(input: {
  haveDays: readonly string[];
  todayYmd: string;
}): WebHistorySeal {
  const today = String(input.todayYmd || "").slice(0, 10);
  if (!isYmd(today)) return { sealed: false, dayCount: 0, missingHistorical: [] };
  const floor = addDaysYmd(today, -(ONBOARDING_DAYS - 1));
  const have: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.haveDays) {
    const day = String(raw || "").slice(0, 10);
    if (!isYmd(day) || seen.has(day)) continue;
    seen.add(day);
    have.push(day);
  }
  const missingHistorical = missingDays(have, floor, today).filter((day) => day < today);
  return {
    sealed: have.length > 0 && missingHistorical.length === 0,
    dayCount: have.length,
    missingHistorical,
  };
}

/**
 * A prior 45-day Chrome seal must not strand leftover last-90 days on disk.
 * Incomplete history reopens onboarding; complete history seals it.
 */
export function reopenOnboardingIfIncomplete(
  state: KdpSyncState,
  seal: WebHistorySeal,
): KdpSyncState {
  const next = normalizeSyncState(state);
  if (seal.unknown) return next;
  if (seal.sealed) {
    next.onboardingDone = true;
    next.milestone30Done = true;
    next.onboardingCursor = null;
    next.onboardingFloor = null;
    return next;
  }
  if (!seal.missingHistorical.length) return next;
  next.onboardingDone = false;
  if (seal.dayCount >= ONBOARDING_MILESTONE_30_DAYS) next.milestone30Done = true;
  return next;
}

export function missingDays(have: Iterable<string>, from: string, to: string): string[] {
  if (!isYmd(from) || !isYmd(to) || from > to) return [];
  const owned = new Set<string>();
  for (const raw of have) {
    const day = String(raw || "").slice(0, 10);
    if (isYmd(day)) owned.add(day);
  }
  return eachYmd(from, to).filter((day) => !owned.has(day));
}

export function daysInWindow(days: Iterable<string>, from: string, to: string): string[] {
  if (!isYmd(from) || !isYmd(to)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of days) {
    const day = String(raw || "").slice(0, 10);
    if (!isYmd(day) || day < from || day > to || seen.has(day)) continue;
    seen.add(day);
    out.push(day);
  }
  return out.sort();
}

/** Today + yesterday first, then oldest holes — matches Royaltix recent-then-leftover. */
export function orderDaysForWake(days: string[], today: string, yesterday: string): string[] {
  const unique = [...new Set(days.filter(isYmd))];
  const prefer = [today, yesterday].filter((d) => unique.includes(d));
  const rest = unique.filter((d) => d !== today && d !== yesterday).sort();
  return [...prefer, ...rest];
}
