import { withKdpTaskRequest } from "./backgroundBudget.ts";
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
  deadlineAtMs?: number,
): Promise<{ ok: boolean; days: string[] }> {
  const id = String(accountId || "").trim();
  if (!id || !isYmd(fromYmd) || !isYmd(toYmd) || fromYmd > toYmd) {
    return { ok: false, days: [] };
  }
  try {
    const [daily, coverage] = await withKdpTaskRequest(deadlineAtMs, async signal => {
      const dailyRead = supabase.from("kdp_daily_data").select("date,updated_at")
        .eq("account_id", id).gte("date", fromYmd).lte("date", toYmd);
      const coverageRead = supabase.from("kdp_marketplace_day_coverage").select("date,daily_updated_at,marketplaces")
        .eq("account_id", id).gte("date", fromYmd).lte("date", toYmd);
      const results = await Promise.allSettled([
        signal ? dailyRead.abortSignal(signal) : dailyRead,
        signal ? coverageRead.abortSignal(signal) : coverageRead,
      ]);
      if (results[0].status === "rejected") throw results[0].reason;
      if (results[1].status === "rejected") throw results[1].reason;
      return [results[0].value, results[1].value] as const;
    });
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
  deadlineAtMs?: number,
): Promise<WebHistorySeal> {
  const id = String(accountId || "").trim();
  if (!id || !isYmd(todayYmd)) {
    return { sealed: false, dayCount: 0, missingHistorical: [], unknown: true };
  }
  const floor = addDaysYmd(todayYmd, -(ONBOARDING_DAYS - 1));
  const result = await cloudDaysInRange(id, floor, todayYmd, deadlineAtMs);
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
  deadlineAtMs?: number,
): Promise<string[]> {
  const result = await cloudDaysInRange(accountId, fromYmd, toYmd, deadlineAtMs);
  if (!result.ok) return [];
  return missingDays(result.days, fromYmd, toYmd);
}
