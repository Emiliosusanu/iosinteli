/**
 * Detect whether Chrome/web already imported enough KDP history so the
 * iPhone helper can skip the 90-day onboarding backfill, and recover days
 * missing from the last-30 nightly window.
 */
import { supabase } from "../supabase.ts";
import { missingDays } from "./coverage.ts";
import { addDaysYmd, isYmd } from "./dates.ts";
import { ONBOARDING_DAYS } from "./planner.ts";

/** Distinct days in the last 90 that mean "web already onboarded". */
export const WEB_HISTORY_MIN_DAYS = 45;

async function cloudDaysInRange(
  accountId: string,
  fromYmd: string,
  toYmd: string,
): Promise<string[]> {
  const id = String(accountId || "").trim();
  if (!id || !isYmd(fromYmd) || !isYmd(toYmd) || fromYmd > toYmd) return [];
  try {
    const { data, error } = await supabase
      .from("kdp_daily_data")
      .select("date")
      .eq("account_id", id)
      .gte("date", fromYmd)
      .lte("date", toYmd);
    if (error) return [];
    const days = new Set<string>();
    for (const row of data ?? []) {
      const day = String((row as { date?: string }).date || "").slice(0, 10);
      if (isYmd(day)) days.add(day);
    }
    return [...days].sort();
  } catch {
    return [];
  }
}

export async function cloudHistorySealsOnboarding(
  accountId: string,
  todayYmd: string,
): Promise<{ sealed: boolean; dayCount: number }> {
  const id = String(accountId || "").trim();
  if (!id || !todayYmd) return { sealed: false, dayCount: 0 };
  const floor = addDaysYmd(todayYmd, -(ONBOARDING_DAYS - 1));
  const days = await cloudDaysInRange(id, floor, todayYmd);
  return { sealed: days.length >= WEB_HISTORY_MIN_DAYS, dayCount: days.length };
}

/** Days in [from,to] with no kdp_daily_data row — hands-free hole recovery. */
export async function cloudMissingDays(
  accountId: string,
  fromYmd: string,
  toYmd: string,
): Promise<string[]> {
  const have = await cloudDaysInRange(accountId, fromYmd, toYmd);
  return missingDays(have, fromYmd, toYmd);
}
