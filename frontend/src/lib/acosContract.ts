/**
 * Amazon Ads ACoS product contract — copied from production web
 * (DashboardNorthStar → GET /dashboard/bootstrap → getDashboardMetrics).
 * Do not invent a second formula on Home, alerts, or entity screens.
 */

export const ACOS_DISPLAY_DECIMALS = 1;

/** Web AdsKpiStrip: Number(avgAcos).toFixed(1) */
export function formatAcosKpi(acos: number | null | undefined): string {
  if (acos == null || !Number.isFinite(Number(acos))) return "—";
  return `${Number(acos).toFixed(ACOS_DISPLAY_DECIMALS)}%`;
}

/**
 * Web getMetricsForPeriod:
 *   sales > 0 ? (spend / sales) * 100 : 0
 * Named avgAcos on the API; it is not AVG(campaign ACoS).
 */
export function acosFromSpendSales(spend: number, sales: number): number {
  const s = Number(spend);
  const d = Number(sales);
  if (!Number.isFinite(s) || !Number.isFinite(d) || !(d > 0)) return 0;
  return (s / d) * 100;
}

export function aggregateAcos(
  rows: Array<{ spend?: number | null; sales?: number | null }>,
): { spend: number; sales: number; acos: number } {
  let spend = 0;
  let sales = 0;
  for (const row of rows) {
    spend += Number(row.spend) || 0;
    sales += Number(row.sales) || 0;
  }
  return { spend, sales, acos: acosFromSpendSales(spend, sales) };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Local calendar date, matching web dayjs() and iOS toDateString. */
export function localYmd(now: Date): string {
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Web periodUtils.computeRange('month'): startOf('month') → endOf('month'). */
export function webMonthRange(anchor: Date): { start: string; end: string } {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: localYmd(start), end: localYmd(end) };
}

/** Web periodUtils.computeRange('week'): ISO week Monday → Sunday. */
export function webIsoWeekRange(anchor: Date): { start: string; end: string } {
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + mondayOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start: localYmd(start), end: localYmd(end) };
}

/** Current iOS Overview Week (pre-parity): rolling 7 days ending on the anchor. */
export function iosRolling7Range(anchor: Date): { start: string; end: string } {
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  return { start: localYmd(start), end: localYmd(end) };
}

/** Current iOS Overview / rangePresets This month: month start → today. */
export function iosMonthToTodayRange(anchor: Date): { start: string; end: string } {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return { start: localYmd(start), end: localYmd(anchor) };
}
