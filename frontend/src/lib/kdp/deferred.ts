/**
 * Deferred KDP day journal (Royaltix parity).
 *
 * Days are journaled before network so a short wake / 429 / timeout cannot
 * silently drop coverage. Recent wakes drain a short leftover slice (14);
 * processing wakes drain up to 30 (full last-30 nightly when possible).
 */
import { isYmd } from "./dates.ts";

/**
 * Royaltix BGAppRefresh leftover slice: KDP is three parallel reports, so
 * 14 historical days still fits a short wake after today+yesterday.
 */
export const DEFERRED_DAY_LIMIT_RECENT = 14;
/** BGProcessing / foreground: finish a full last-30 correction in one tick when possible. */
export const DEFERRED_DAY_LIMIT_PROCESSING = 30;

export function normalizeDeferredDays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const day = String(item || "").slice(0, 10);
    if (!isYmd(day) || seen.has(day)) continue;
    seen.add(day);
    out.push(day);
  }
  return out.sort();
}

export function journalDeferredDays(existing: string[], days: string[]): string[] {
  return normalizeDeferredDays([...existing, ...days]);
}

export function acknowledgeDeferredDays(existing: string[], days: string[]): string[] {
  const drop = new Set(days.filter(isYmd));
  return normalizeDeferredDays(existing).filter((d) => !drop.has(d));
}

export function takeDeferredDays(existing: string[], limit: number): string[] {
  if (limit <= 0) return [];
  return normalizeDeferredDays(existing).slice(0, limit);
}

export function deferredDayLimitForWake(wakeMode: "recent" | "processing"): number {
  return wakeMode === "recent" ? DEFERRED_DAY_LIMIT_RECENT : DEFERRED_DAY_LIMIT_PROCESSING;
}
