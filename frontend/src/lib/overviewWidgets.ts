import type { SearchTerm } from "@/src/lib/types";
import type { TopBookRow, TopCampaignRow, AdGroupEnriched } from "@/src/lib/queries";
import { resolveBookNet } from "./netRoyalties.ts";

type MetricRow = {
  total_spend?: number | null;
  total_orders?: number | null;
  total_sales?: number | null;
  total_acos?: number | null;
  total_clicks?: number | null;
  total_impressions?: number | null;
  spend?: number;
  orders?: number;
  sales?: number;
  acos?: number;
  clicks?: number;
  impressions?: number;
  metrics_updated_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

function spendOf(row: MetricRow): number {
  return Number(row.total_spend ?? row.spend) || 0;
}

function ordersOf(row: MetricRow): number {
  return Number(row.total_orders ?? row.orders) || 0;
}

function salesOf(row: MetricRow): number {
  return Number(row.total_sales ?? row.sales) || 0;
}

function acosOf(row: MetricRow): number {
  return Number(row.total_acos ?? row.acos) || 0;
}

function impressionsOf(row: MetricRow): number {
  return Number(row.total_impressions ?? row.impressions) || 0;
}

/** ACoS high→low, then spend, impressions, last sync. Used for keywords / ASIN / auto / category / placement. */
export function compareByAcosSpendImpressionsSync(a: MetricRow, b: MetricRow): number {
  const aAcos = salesOf(a) > 0 ? acosOf(a) : null;
  const bAcos = salesOf(b) > 0 ? acosOf(b) : null;
  if (aAcos != null && bAcos != null && aAcos !== bAcos) return bAcos - aAcos;
  if (aAcos != null && bAcos == null) return -1;
  if (aAcos == null && bAcos != null) return 1;
  const spendDelta = spendOf(b) - spendOf(a);
  if (spendDelta !== 0) return spendDelta;
  const impressionDelta = impressionsOf(b) - impressionsOf(a);
  if (impressionDelta !== 0) return impressionDelta;
  return lastSyncedMs(b) - lastSyncedMs(a);
}

/** Prefer metrics_updated_at, then entity updated_at / created_at. */
export function lastSyncedMs(row: MetricRow): number {
  const raw = row.metrics_updated_at || row.updated_at || row.created_at;
  if (!raw) return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

export const OVERVIEW_SWIPE_ROW_LIMIT = 7;

type FillTier<T> = Array<{
  pick: (row: T) => boolean;
  compare: (a: T, b: T) => number;
}>;

/**
 * Fill up to `limit` rows by walking tiers in order.
 * Each tier only considers rows not already picked — so ACoS pages pad with
 * clicks → impressions → last sync when the period has few converting entities.
 */
export function fillOverviewWidgetRows<T>(
  rows: readonly T[],
  tiers: FillTier<T>,
  limit = OVERVIEW_SWIPE_ROW_LIMIT,
  getId: (row: T) => string = (row) => String((row as { id?: string }).id ?? ""),
): T[] {
  const out: T[] = [];
  const used = new Set<string>();
  for (const tier of tiers) {
    if (out.length >= limit) break;
    const candidates = rows
      .filter((row) => {
        const id = getId(row);
        return !!id && !used.has(id) && tier.pick(row);
      })
      .sort(tier.compare);
    for (const row of candidates) {
      if (out.length >= limit) break;
      out.push(row);
      used.add(getId(row));
    }
  }
  return out;
}

function bookRowId(row: TopBookRow): string {
  return String(row.book_key || row.asin || row.sku || "").trim();
}

function acosFillTiers<T extends MetricRow>(direction: "high" | "low"): FillTier<T> {
  const acosCompare =
    direction === "high"
      ? (a: T, b: T) => acosOf(b) - acosOf(a)
      : (a: T, b: T) => acosOf(a) - acosOf(b);
  return [
    {
      pick: (row) => salesOf(row) > 0 && acosOf(row) > 0,
      compare: acosCompare,
    },
    {
      pick: (row) => spendOf(row) > 0,
      compare: (a, b) => spendOf(b) - spendOf(a),
    },
    {
      pick: (row) => impressionsOf(row) > 0,
      compare: (a, b) => impressionsOf(b) - impressionsOf(a),
    },
    {
      pick: () => true,
      compare: (a, b) => lastSyncedMs(b) - lastSyncedMs(a),
    },
  ];
}

function spendFillTiers<T extends MetricRow>(opts?: { requireNoOrders?: boolean }): FillTier<T> {
  const requireNoOrders = opts?.requireNoOrders === true;
  return [
    {
      pick: (row) => spendOf(row) > 0 && (!requireNoOrders || ordersOf(row) === 0),
      compare: (a, b) => spendOf(b) - spendOf(a),
    },
    {
      pick: (row) => impressionsOf(row) > 0,
      compare: (a, b) => impressionsOf(b) - impressionsOf(a),
    },
    {
      pick: () => true,
      compare: (a, b) => lastSyncedMs(b) - lastSyncedMs(a),
    },
  ];
}

function bookRoyaltiesOf(row: TopBookRow): number {
  return Number(row.royalties) || 0;
}

/** KDP royalties in period — independent of Amazon Ads attributed sales. */
export function booksTopRoyalties(rows: TopBookRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopBookRow[] {
  return [...rows]
    .filter((row) => row.kdp_state !== "missing" && bookRoyaltiesOf(row) > 0)
    .sort((a, b) => bookRoyaltiesOf(b) - bookRoyaltiesOf(a))
    .slice(0, limit);
}

export function booksSpendingNoAdSales(rows: TopBookRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopBookRow[] {
  return fillOverviewWidgetRows(
    rows,
    [
      {
        pick: (row) => row.spend > 0 && row.sales === 0,
        compare: (a, b) => b.spend - a.spend,
      },
      {
        pick: (row) => (Number(row.impressions) || 0) > 0,
        compare: (a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0),
      },
      {
        pick: () => true,
        compare: (a, b) => lastSyncedMs(b) - lastSyncedMs(a),
      },
    ],
    limit,
    bookRowId,
  );
}

export function campaignsTopSpend(rows: TopCampaignRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopCampaignRow[] {
  return fillOverviewWidgetRows(rows, spendFillTiers<TopCampaignRow>(), limit);
}

/** Hide a second swipe page when it is the same entities sorted differently. */
export function overviewLowAcosDiffersFromHigh<T extends { id: string }>(high: T[], low: T[]): boolean {
  if (high.length === 0 || low.length === 0) return false;
  if (high.length !== low.length) return true;
  const highIds = new Set(high.map((row) => row.id));
  return low.some((row) => !highIds.has(row.id));
}

export function keywordsSpendingNoOrders<T extends MetricRow & { id: string; keyword_text?: string | null }>(
  rows: T[],
  limit = OVERVIEW_SWIPE_ROW_LIMIT,
): T[] {
  return fillOverviewWidgetRows(rows, spendFillTiers<T>({ requireNoOrders: true }), limit);
}

export function keywordsHighAcos<T extends MetricRow & { id: string }>(
  rows: T[],
  limit = OVERVIEW_SWIPE_ROW_LIMIT,
): T[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<T>("high"), limit);
}

export function searchTermsSpendNoOrders(rows: SearchTerm[], limit = OVERVIEW_SWIPE_ROW_LIMIT): SearchTerm[] {
  return fillOverviewWidgetRows(rows, spendFillTiers<SearchTerm>({ requireNoOrders: true }), limit);
}

export function searchTermsLowAcos(rows: SearchTerm[], limit = OVERVIEW_SWIPE_ROW_LIMIT): SearchTerm[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<SearchTerm>("low"), limit);
}

export function booksHighAcos(rows: TopBookRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopBookRow[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<TopBookRow>("high"), limit, bookRowId);
}

export function booksLowAcos(rows: TopBookRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopBookRow[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<TopBookRow>("low"), limit, bookRowId);
}

export function booksWorstProfit(rows: TopBookRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopBookRow[] {
  return [...rows]
    .filter((row) => row.royalties != null || row.spend > 0)
    .sort((a, b) => {
      const netA = resolveBookNet(a) ?? (Number(a.royalties ?? 0) - a.spend);
      const netB = resolveBookNet(b) ?? (Number(b.royalties ?? 0) - b.spend);
      return netA - netB;
    })
    .slice(0, limit);
}

export function campaignsHighAcos(rows: TopCampaignRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopCampaignRow[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<TopCampaignRow>("high"), limit);
}

export function campaignsLowAcos(rows: TopCampaignRow[], limit = OVERVIEW_SWIPE_ROW_LIMIT): TopCampaignRow[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<TopCampaignRow>("low"), limit);
}

export function adGroupsHighAcos(rows: AdGroupEnriched[], limit = OVERVIEW_SWIPE_ROW_LIMIT): AdGroupEnriched[] {
  return fillOverviewWidgetRows(rows, acosFillTiers<AdGroupEnriched>("high"), limit);
}
