/**
 * Temporary KDP royalties read traces for Phase A Core Read.
 * Prefix only — no secrets / tokens / emails / ASINs.
 */

const PREFIX = "[inteliads:kdp-trace]";
const t0 = Date.now();

function ms() {
  return Date.now() - t0;
}

export function kdpTrace(
  marker: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(`${PREFIX} ${marker} ms=${ms()}${parts ? ` ${parts}` : ""}`);
}

/** Sum account-day kdp_daily_data rows. One row per account_id+date. */
export function aggregateKdpDailyRows(
  rows: readonly { account_id?: string | null; date?: string | null; royalties?: unknown; orders?: unknown }[],
  linkedAccountCount: number,
  range?: { start: string; end: string; source: "kdp_daily_data" | "kdp_entries" },
): {
  daily: { date: string; royalties: number; orders: number }[];
  totalRoyalties: number;
  totalOrders: number;
  rawCount: number;
  accountCount: number;
  coveredDays: number;
  daysInRange: number;
  coveredAccountDays: number;
  expectedAccountDays: number;
  coverage: "complete" | "partial" | "missing" | "not_linked";
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
} {
  const byDate = new Map<string, { date: string; royalties: number; orders: number }>();
  const accounts = new Set<string>();
  const accountDays = new Set<string>();
  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date : "";
    if (!date) continue;
    const accountId = typeof row.account_id === "string" ? row.account_id : "";
    if (accountId) {
      accounts.add(accountId);
      accountDays.add(`${accountId}:${date}`);
    }
    const current = byDate.get(date) ?? { date, royalties: 0, orders: 0 };
    const roy = Number(row.royalties);
    const ord = Number(row.orders);
    current.royalties += Number.isFinite(roy) ? roy : 0;
    current.orders += Number.isFinite(ord) ? ord : 0;
    byDate.set(date, current);
  }
  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const totalRoyalties = daily.reduce((sum, day) => sum + day.royalties, 0);
  const totalOrders = daily.reduce((sum, day) => sum + day.orders, 0);
  const daysInRange = range ? countInclusiveDays(range.start, range.end) : daily.length;
  const expectedAccountDays = linkedAccountCount * daysInRange;
  const coverage = linkedAccountCount <= 0
    ? "not_linked"
    : rows.length === 0
      ? "missing"
      : range?.source === "kdp_entries"
        ? "partial"
        : expectedAccountDays > 0 && accountDays.size >= expectedAccountDays
          ? "complete"
          : "partial";
  const completeness = coverage === "complete" ? "COMPLETE" : coverage === "partial" ? "PARTIAL" : "UNKNOWN";
  return {
    daily,
    totalRoyalties,
    totalOrders,
    rawCount: rows.length,
    accountCount: accounts.size,
    coveredDays: byDate.size,
    daysInRange,
    coveredAccountDays: accountDays.size,
    expectedAccountDays,
    coverage,
    completeness,
  };
}

function countInclusiveDays(start: string, end: string): number {
  const first = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || first > last) return 0;
  return Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1;
}
