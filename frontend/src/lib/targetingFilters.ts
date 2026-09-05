/**
 * Targeting advanced filters — parity with web InteliAds
 * (`client/.../targetingAdvancedFilters.ts`), extended for iOS with min bid
 * and clicks/impressions ranges the product asked for.
 */
import { clampAmazonBid } from "./bulkOutboxContract.ts";

export type TargetingAdvancedFilters = {
  acosMin: number | null;
  acosMax: number | null;
  bidMin: number | null;
  bidMax: number | null;
  clicksMin: number | null;
  clicksMax: number | null;
  impressionsMin: number | null;
  impressionsMax: number | null;
};

export const EMPTY_TARGETING_ADVANCED_FILTERS: TargetingAdvancedFilters = {
  acosMin: null,
  acosMax: null,
  bidMin: null,
  bidMax: null,
  clicksMin: null,
  clicksMax: null,
  impressionsMin: null,
  impressionsMax: null,
};

/** Relative bid jump that requires an explicit confirm before writing Amazon. */
export const BID_CHANGE_CONFIRM_PCT = 30;

export type TargetingSortKey = "spend" | "acos" | "orders" | "clicks" | "impressions" | "bid";

export type TargetingRowMetrics = {
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  clicks: number;
  impressions: number;
  bid: number | null;
};

export function optionalFilterNumber(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

function swapRange(min: number | null, max: number | null): [number | null, number | null] {
  if (min != null && max != null && min > max) return [max, min];
  return [min, max];
}

export function normalizeTargetingAdvancedFilters(
  filters: TargetingAdvancedFilters,
): TargetingAdvancedFilters {
  const [acosMin, acosMax] = swapRange(filters.acosMin, filters.acosMax);
  const [bidMin, bidMax] = swapRange(filters.bidMin, filters.bidMax);
  const [clicksMin, clicksMax] = swapRange(filters.clicksMin, filters.clicksMax);
  const [impressionsMin, impressionsMax] = swapRange(filters.impressionsMin, filters.impressionsMax);

  const floorNonNeg = (n: number | null, asInt: boolean): number | null => {
    const v = optionalFilterNumber(n);
    if (v == null || v < 0) return null;
    return asInt ? Math.floor(v) : v;
  };

  return {
    acosMin: floorNonNeg(acosMin, false),
    acosMax: floorNonNeg(acosMax, false),
    bidMin: floorNonNeg(bidMin, false),
    bidMax: floorNonNeg(bidMax, false),
    clicksMin: floorNonNeg(clicksMin, true),
    clicksMax: floorNonNeg(clicksMax, true),
    impressionsMin: floorNonNeg(impressionsMin, true),
    impressionsMax: floorNonNeg(impressionsMax, true),
  };
}

export function countActiveAdvancedFilters(filters: TargetingAdvancedFilters): number {
  let count = 0;
  for (const value of Object.values(filters)) {
    if (value != null) count += 1;
  }
  return count;
}

export function hasActiveAdvancedFilters(filters: TargetingAdvancedFilters): boolean {
  return countActiveAdvancedFilters(filters) > 0;
}

export function rowMetricsFromEntity(item: any, bid: number | null = null): TargetingRowMetrics {
  return {
    spend: Number(item.total_spend ?? item.spend) || 0,
    sales: Number(item.total_sales ?? item.sales) || 0,
    orders: Number(item.total_orders ?? item.orders) || 0,
    acos: Number(item.total_acos ?? item.acos) || 0,
    clicks: Number(item.total_clicks ?? item.clicks) || 0,
    impressions: Number(item.total_impressions ?? item.impressions) || 0,
    bid: bid != null && Number.isFinite(bid) ? bid : null,
  };
}

export function matchesAdvancedFilters(
  metrics: TargetingRowMetrics,
  filters: TargetingAdvancedFilters,
): boolean {
  const f = normalizeTargetingAdvancedFilters(filters);
  if (f.acosMin != null && !(metrics.sales > 0 && metrics.acos >= f.acosMin)) return false;
  if (f.acosMax != null && !(metrics.sales > 0 && metrics.acos <= f.acosMax)) return false;
  if (f.bidMin != null) {
    if (metrics.bid == null || metrics.bid < f.bidMin) return false;
  }
  if (f.bidMax != null) {
    if (metrics.bid == null || metrics.bid > f.bidMax) return false;
  }
  if (f.clicksMin != null && metrics.clicks < f.clicksMin) return false;
  if (f.clicksMax != null && metrics.clicks > f.clicksMax) return false;
  if (f.impressionsMin != null && metrics.impressions < f.impressionsMin) return false;
  if (f.impressionsMax != null && metrics.impressions > f.impressionsMax) return false;
  return true;
}

/**
 * Sort is always the seller's explicit pick (default ACoS).
 * Numeric ranges only filter rows — they never silently change sort order.
 */
export function resolveTargetingSortKey(
  explicit: TargetingSortKey | null | undefined,
  _filters?: TargetingAdvancedFilters,
): TargetingSortKey {
  if (explicit) return explicit;
  return "acos";
}

/** @deprecated Ranges no longer override sort; kept so older call sites compile. */
export function advancedSortOverridesExplicit(
  _explicit?: TargetingSortKey | null,
  _filters?: TargetingAdvancedFilters,
): boolean {
  return false;
}

/** Drop bid ranges on Placement (campaigns have no dollar bid — ranges would empty the list). */
export function advancedFiltersForSegment(
  segment: string,
  filters: TargetingAdvancedFilters,
): TargetingAdvancedFilters {
  if (segment !== "placement") return filters;
  if (filters.bidMin == null && filters.bidMax == null) return filters;
  return { ...filters, bidMin: null, bidMax: null };
}

export function compareTargetingRows(
  a: TargetingRowMetrics,
  b: TargetingRowMetrics,
  sortKey: TargetingSortKey,
): number {
  if (sortKey === "bid") return (b.bid ?? -1) - (a.bid ?? -1);
  if (sortKey === "orders") return b.orders - a.orders;
  if (sortKey === "spend") return b.spend - a.spend;
  if (sortKey === "clicks") return b.clicks - a.clicks;
  if (sortKey === "impressions") return b.impressions - a.impressions;
  // ACoS high→low; rows without sales sink after real ACoS, then by spend.
  const aHas = a.sales > 0 && a.acos > 0;
  const bHas = b.sales > 0 && b.acos > 0;
  if (aHas && bHas) {
    if (b.acos !== a.acos) return b.acos - a.acos;
    return b.spend - a.spend;
  }
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (b.spend !== a.spend) return b.spend - a.spend;
  return b.impressions - a.impressions;
}

/** Sanitize typed money / % — strips currency symbols and junk. */
export function parseBidInput(raw: string): number | null {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[^0-9.,\-]/g, "")
    .replace(",", ".");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Filter range fields keep a string draft while typing.
 * `Number("0.") === 0` would otherwise wipe the decimal and turn `0.85` into `85`.
 */
export type FilterRangeParse =
  | { kind: "empty" }
  | { kind: "incomplete" }
  | { kind: "invalid" }
  | { kind: "value"; value: number };

export function parseFilterRangeInput(raw: string, asInteger = false): FilterRangeParse {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { kind: "empty" };
  // Allow "0.", "0,", ".", ",", "-" while the user is still typing.
  if (trimmed === "-" || trimmed === "." || trimmed === "," || /[.,]$/.test(trimmed)) {
    return { kind: "incomplete" };
  }
  const cleaned = trimmed.replace(/[^0-9.,\-]/g, "").replace(",", ".");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return { kind: "incomplete" };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return { kind: "invalid" };
  return { kind: "value", value: asInteger ? Math.floor(n) : n };
}

export function sanitizeBidForAmazon(raw: string): number | null {
  const n = parseBidInput(raw);
  if (n == null || n <= 0) return null;
  return clampAmazonBid(n);
}

export function bidChangePercent(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return (Math.abs(to - from) / from) * 100;
}

export function requiresBidChangeConfirm(from: number, to: number): boolean {
  const pct = bidChangePercent(from, to);
  return pct != null && pct > BID_CHANGE_CONFIRM_PCT;
}

export function applyBidDeltaUsd(base: number, deltaUsd: number): number {
  return clampAmazonBid(base + deltaUsd);
}

export function applyBidDeltaPercent(base: number, deltaPercent: number): number {
  return clampAmazonBid(base * (1 + deltaPercent / 100));
}
