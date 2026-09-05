/**
 * Pure coverage math for KDP day recovery (Royaltix leftover / missing-day).
 */
import { eachYmd, isYmd } from "./dates.ts";

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
