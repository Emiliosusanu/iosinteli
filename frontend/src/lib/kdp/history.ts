/**
 * Detect whether Chrome/web already imported the last 90 KDP days so the
 * iPhone helper can skip onboarding, and recover days still missing.
 */
import { supabase } from "../supabase.ts";
import { missingDays, webHistorySealsOnboarding, type WebHistorySeal } from "./coverage.ts";
import { addDaysYmd, isYmd } from "./dates.ts";
import { ONBOARDING_DAYS } from "./planner.ts";
import { hasVerifiedNativeCoverage } from "./marketplaceCoverage.ts";

export { webHistorySealsOnboarding };
export type { WebHistorySeal };

async function cloudDaysInRange(
  accountId: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ ok: boolean; days: string[] }> {
  const id = String(accountId || "").trim();
  if (!id || !isYmd(fromYmd) || !isYmd(toYmd) || fromYmd > toYmd) {
    return { ok: false, days: [] };
  }
  try {
    const [daily, coverage] = await Promise.all([
      supabase.from("kdp_daily_data").select("date,updated_at")
        .eq("account_id", id).gte("date", fromYmd).lte("date", toYmd),
      supabase.from("kdp_marketplace_day_coverage").select("date,daily_updated_at,marketplaces")
        .eq("account_id", id).gte("date", fromYmd).lte("date", toYmd),
    ]);
    if (daily.error || coverage.error) return { ok: false, days: [] };
    const markers = new Map((coverage.data ?? []).map((row) => [row.date, row]));
    const days = new Set<string>();
    for (const row of daily.data ?? []) {
      const day = String((row as { date?: string }).date || "").slice(0, 10);
      if (isYmd(day) && hasVerifiedNativeCoverage(row.updated_at, markers.get(day))) days.add(day);
    }
    return { ok: true, days: [...days].sort() };
  } catch {
    return { ok: false, days: [] };
  }
}

export async function cloudHistorySealsOnboarding(
  accountId: string,
  todayYmd: string,
): Promise<WebHistorySeal> {
  const id = String(accountId || "").trim();
  if (!id || !isYmd(todayYmd)) {
    return { sealed: false, dayCount: 0, missingHistorical: [], unknown: true };
  }
  const floor = addDaysYmd(todayYmd, -(ONBOARDING_DAYS - 1));
  const result = await cloudDaysInRange(id, floor, todayYmd);
  if (!result.ok) {
    return { sealed: false, dayCount: 0, missingHistorical: [], unknown: true };
  }
  return { ...webHistorySealsOnboarding({ haveDays: result.days, todayYmd }), unknown: false };
}

/** Days in [from,to] with no kdp_daily_data row — hands-free hole recovery. */
export async function cloudMissingDays(
  accountId: string,
  fromYmd: string,
  toYmd: string,
): Promise<string[]> {
  const result = await cloudDaysInRange(accountId, fromYmd, toYmd);
  if (!result.ok) return [];
  return missingDays(result.days, fromYmd, toYmd);
}
