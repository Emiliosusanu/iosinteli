/**
 * Home reporting windows. Each period has its own date identity.
 * Publisher Net still uses KDP royalties − Ads spend. Missing royalties stay null.
 */

import { iosMonthToTodayRange, iosRolling7Range, localYmd, webIsoWeekRange } from "./acosContract.ts";
import { adsSpendOrZero, kdpRoyaltiesAreKnown, netRoyalties, type MoneyLike } from "./netRoyalties.ts";
import { FINANCIAL_QUERY_ROOTS } from "./financialReadVersion.ts";

export type HomeHorizon = "today" | "yesterday" | "7d";
export type HomeCalendarPeriod = "month" | "week";

/** Canonical query-key fragments for Home financial domains (period identity required). */
export function adsHorizonQueryKey(
  horizon: HomeHorizon,
  profileIds: string[],
  start: string,
  end: string,
) {
  return ["home-ads-horizon", horizon, profileIds, start, end] as const;
}

export function homeHorizonRange(horizon: HomeHorizon, now = new Date()): { start: string; end: string } {
  if (horizon === "yesterday") return yesterdayRange(now);
  if (horizon === "7d") return rolling7Range(now);
  return todayRange(now);
}

export type KdpDay = { date: string; royalties: number };

export function reportingToday(now = new Date()): string {
  return localYmd(now);
}

export function reportingYesterday(now = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  today.setDate(today.getDate() - 1);
  return localYmd(today);
}

export function todayRange(now = new Date()): { start: string; end: string } {
  const day = reportingToday(now);
  return { start: day, end: day };
}

export function yesterdayRange(now = new Date()): { start: string; end: string } {
  const day = reportingYesterday(now);
  return { start: day, end: day };
}

export function rolling7Range(now = new Date()): { start: string; end: string } {
  return iosRolling7Range(now);
}

export function isoWeekRange(now = new Date()): { start: string; end: string } {
  return webIsoWeekRange(now);
}

export function monthToTodayRange(now = new Date()): { start: string; end: string } {
  return iosMonthToTodayRange(now);
}

export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cursor <= last) {
    out.push(localYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function kdpRoyaltiesOnDate(daily: readonly KdpDay[] | undefined, date: string): number | null {
  if (!daily?.length) return null;
  const row = daily.find((day) => day.date === date);
  if (!row || !kdpRoyaltiesAreKnown(row.royalties)) return null;
  return row.royalties;
}

export function kdpRoyaltiesInRange(
  daily: readonly KdpDay[] | undefined,
  start: string,
  end: string,
): {
  royalties: number | null;
  daysKnown: number;
  daysInRange: number;
  complete: boolean;
} {
  const dates = enumerateDates(start, end);
  let sum = 0;
  let known = 0;
  for (const date of dates) {
    const value = kdpRoyaltiesOnDate(daily, date);
    if (value == null) continue;
    sum += value;
    known += 1;
  }
  return {
    royalties: known > 0 ? sum : null,
    daysKnown: known,
    daysInRange: dates.length,
    complete: known === dates.length && dates.length > 0,
  };
}

/** Net only when royalties are known. Missing royalties never become 0 − spend. */
export function publisherNetForPeriod(kdpRoyalties: MoneyLike, adsSpend: MoneyLike): number | null {
  return netRoyalties({ kdpRoyalties, adsSpend });
}

export function adsSpendIfKnown(spend: MoneyLike, state?: string | null): number | null {
  if (state === "missing" || state === "no_sync") return null;
  if (typeof spend === "number" && Number.isFinite(spend)) return spend;
  return null;
}

export function horizonQueryKey(profileIds: string[], start: string, end: string) {
  return [FINANCIAL_QUERY_ROOTS.kdpRoyaltiesSevenDay, profileIds, start, end] as const;
}

export function periodRoyaltiesQueryKey(
  kind: "range" | "prev" | "yesterday" | "daybefore" | "horizon",
  profileIds: string[],
  start: string,
  end: string,
) {
  if (kind === "horizon") return horizonQueryKey(profileIds, start, end);
  if (kind === "yesterday") return [FINANCIAL_QUERY_ROOTS.kdpRoyaltiesYesterday, profileIds, start] as const;
  if (kind === "daybefore") return [FINANCIAL_QUERY_ROOTS.kdpRoyaltiesDaybefore, profileIds, start] as const;
  if (kind === "prev") return [FINANCIAL_QUERY_ROOTS.kdpRoyaltiesPrev, profileIds, start, end] as const;
  return [FINANCIAL_QUERY_ROOTS.kdpRoyalties, profileIds, start, end] as const;
}

export function sameRange(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start === b.start && a.end === b.end;
}

export { adsSpendOrZero };
