/**
 * Completeness generation for persisted financial reads.
 * These roots identify reads whose completeness semantics are safe to persist.
 */
export const FINANCIAL_READ_VERSION = "complete-v3";

export const FINANCIAL_QUERY_ROOTS = {
  campaignMetrics: "campaign-metrics-complete-v3",
  campaignMetricsPrev: "campaign-metrics-prev-complete-v3",
  campaignMetricsToday: "campaign-metrics-today-complete-v3",
  campaignMetricsYesterday: "campaign-metrics-yesterday-complete-v3",
  campaignMetricsDaybefore: "campaign-metrics-daybefore-complete-v3",
  placementMix: "placement-mix-range-complete-v3",
  mobileOverview: "mobile-overview-complete-v3",
  kdpRoyalties: "kdp-royalties-complete-v3",
  kdpRoyaltiesPrev: "kdp-royalties-prev-complete-v3",
  kdpRoyaltiesToday: "kdp-royalties-today-complete-v3",
  kdpRoyaltiesSevenDay: "kdp-royalties-7d-complete-v3",
  kdpRoyaltiesYesterday: "kdp-royalties-yesterday-complete-v3",
  kdpRoyaltiesDaybefore: "kdp-royalties-daybefore-complete-v3",
  topBooks: "top-books-range-complete-v3",
  products: "products-range-complete-v3",
  topBooksYesterday: "top-books-yesterday-complete-v3",
} as const;

export const OBSOLETE_FINANCIAL_QUERY_ROOTS = [
  "campaign-metrics",
  "campaign-metrics-prev",
  "campaign-metrics-today",
  "campaign-metrics-yesterday",
  "campaign-metrics-daybefore",
  "placement-mix-range",
  "mobile-overview",
  "kdp-royalties",
  "kdp-royalties-prev",
  "kdp-royalties-horizon",
  "kdp-royalties-yesterday",
  "kdp-royalties-daybefore",
  "top-books-range",
  "products-range",
  "top-books-yesterday",
] as const;

const COMPLETE_ROOTS = new Set<string>(Object.values(FINANCIAL_QUERY_ROOTS));
const OBSOLETE_ROOTS = new Set<string>(OBSOLETE_FINANCIAL_QUERY_ROOTS);

export function isCompleteFinancialQueryRoot(key: unknown): boolean {
  return typeof key === "string" && COMPLETE_ROOTS.has(key);
}

export function isObsoleteFinancialQueryRoot(key: unknown): boolean {
  return typeof key === "string" && OBSOLETE_ROOTS.has(key);
}

export function financialQueryMeta() {
  return { financialReadVersion: FINANCIAL_READ_VERSION, complete: true as const };
}

export function canPersistFinancialQuery(query: {
  queryKey?: readonly unknown[];
  state?: { status?: string };
  meta?: { complete?: unknown; financialReadVersion?: unknown };
}): boolean {
  const root = query.queryKey?.[0];
  if (!isCompleteFinancialQueryRoot(root)) return false;
  if (query.state?.status !== "success") return false;
  if (query.meta?.complete === false) return false;
  const version = query.meta?.financialReadVersion;
  return version == null || version === FINANCIAL_READ_VERSION;
}
