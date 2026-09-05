/** Pure date windows and Ads period compare helpers. No Expo / network. */

export const ACOS_MOVE_POINTS = 5;
export const MIN_LEAK_SPEND = 5;
export const MAX_LEAK_ALERTS = 2;

export type PeriodSlice = {
  start: string;
  end: string;
  orders: number;
  spend: number;
  sales: number;
  acos: number | null;
};

export type LeakCampaign = {
  name: string;
  spend: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function monthToDateWindows(localDate: string): {
  thisMonth: { start: string; end: string };
  lastMonthSamePeriod: { start: string; end: string };
} {
  const [year, month, day] = localDate.split("-").map(Number);
  const lastAnchor = new Date(Date.UTC(year, month - 2, 1));
  const lastYear = lastAnchor.getUTCFullYear();
  const lastMonth = lastAnchor.getUTCMonth() + 1;
  const lastMonthDays = new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate();
  const lastDay = Math.min(day, lastMonthDays);
  return {
    thisMonth: { start: `${year}-${pad2(month)}-01`, end: localDate },
    lastMonthSamePeriod: {
      start: `${lastYear}-${pad2(lastMonth)}-01`,
      end: `${lastYear}-${pad2(lastMonth)}-${pad2(lastDay)}`,
    },
  };
}

export function periodMonthKey(localDate: string): string {
  return localDate.slice(0, 7);
}

export function sumPeriod(
  rows: Array<{ orders?: number | null; spend?: number | null; sales?: number | null }>,
  start: string,
  end: string,
): PeriodSlice {
  let orders = 0;
  let spend = 0;
  let sales = 0;
  for (const row of rows) {
    orders += Number(row.orders) || 0;
    spend += Number(row.spend) || 0;
    sales += Number(row.sales) || 0;
  }
  return {
    start,
    end,
    orders,
    spend,
    sales,
    acos: sales > 0 && Number.isFinite(spend) ? (spend / sales) * 100 : null,
  };
}

export function rowsInRange<T extends { date?: string | null }>(rows: T[], start: string, end: string): T[] {
  return rows.filter((row) => {
    const date = typeof row.date === "string" ? row.date : "";
    return date >= start && date <= end;
  });
}

export function acosDirection(
  current: number | null | undefined,
  prior: number | null | undefined,
): "up" | "down" | "flat" | null {
  if (current == null || prior == null) return null;
  const delta = current - prior;
  if (delta >= ACOS_MOVE_POINTS) return "up";
  if (delta <= -ACOS_MOVE_POINTS) return "down";
  return "flat";
}

export function pickZeroOrderLeaks(
  campaigns: Array<{ name?: string | null; spend?: number | null; orders?: number | null }>,
  minSpend = MIN_LEAK_SPEND,
  max = MAX_LEAK_ALERTS,
): LeakCampaign[] {
  return campaigns
    .map((campaign) => ({
      name: typeof campaign.name === "string" ? campaign.name.trim() : "",
      spend: Number(campaign.spend) || 0,
      orders: Number(campaign.orders) || 0,
    }))
    .filter((campaign) => campaign.name && campaign.orders <= 0 && campaign.spend >= minSpend)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, max)
    .map(({ name, spend }) => ({ name, spend }));
}

export function bookAlertLabel(book: {
  title?: string | null;
  asin?: string | null;
  sku?: string | null;
}): string {
  const title = typeof book.title === "string" ? book.title.trim() : "";
  if (title) return title;
  const asin = typeof book.asin === "string" ? book.asin.trim() : "";
  if (asin) return asin;
  const sku = typeof book.sku === "string" ? book.sku.trim() : "";
  if (sku) return sku;
  return "Book";
}

export function bookMatchKey(book: { asin?: string | null; sku?: string | null }): string {
  const asin = typeof book.asin === "string" ? book.asin.trim().toUpperCase() : "";
  if (asin) return asin;
  const sku = typeof book.sku === "string" ? book.sku.trim().toUpperCase() : "";
  return sku;
}

export function booksWithAcosRise(
  current: Array<{
    title?: string | null;
    asin?: string | null;
    sku?: string | null;
    acos?: number | null;
    sales?: number | null;
  }>,
  prior: Array<{
    asin?: string | null;
    sku?: string | null;
    acos?: number | null;
    sales?: number | null;
  }>,
): Array<{ key: string; label: string; currentAcos: number; priorAcos: number }> {
  const priorByKey = new Map<string, { acos: number; sales: number }>();
  for (const book of prior) {
    const key = bookMatchKey(book);
    if (!key) continue;
    priorByKey.set(key, { acos: Number(book.acos) || 0, sales: Number(book.sales) || 0 });
  }
  const rises: Array<{ key: string; label: string; currentAcos: number; priorAcos: number }> = [];
  for (const book of current) {
    const key = bookMatchKey(book);
    if (!key) continue;
    const nowSales = Number(book.sales) || 0;
    const nowAcos = Number(book.acos) || 0;
    const last = priorByKey.get(key);
    if (!last || nowSales <= 0 || last.sales <= 0) continue;
    if (acosDirection(nowAcos, last.acos) !== "up") continue;
    rises.push({
      key,
      label: bookAlertLabel(book),
      currentAcos: nowAcos,
      priorAcos: last.acos,
    });
  }
  return rises;
}

export function pruneDatedKeys(
  map: Record<string, true> | undefined,
  keepDays: string[],
): Record<string, true> {
  const keep = new Set(keepDays);
  const next: Record<string, true> = {};
  for (const key of Object.keys(map ?? {})) {
    if (keep.has(key.slice(0, 10))) next[key] = true;
  }
  return next;
}

export function datedAlertKey(day: string, entity?: string): string {
  return entity ? `${day}:${entity}` : day;
}
