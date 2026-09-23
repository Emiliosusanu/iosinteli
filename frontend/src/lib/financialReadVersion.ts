/**
 * Completeness generation for persisted financial reads.
 * These roots identify reads whose completeness semantics are safe to persist.
 * Bump when pagination / completeness semantics change so stale undercounts cannot hydrate.
 */
export const FINANCIAL_READ_VERSION = "complete-v4";

export const FINANCIAL_QUERY_ROOTS = {
  campaignMetrics: "campaign-metrics-complete-v4",
  campaignMetricsPrev: "campaign-metrics-prev-complete-v4",
  campaignMetricsToday: "campaign-metrics-today-complete-v4",
  campaignMetricsYesterday: "campaign-metrics-yesterday-complete-v4",
  campaignMetricsDaybefore: "campaign-metrics-daybefore-complete-v4",
  placementMix: "placement-mix-range-complete-v4",
  mobileOverview: "mobile-overview-complete-v4",
  kdpRoyalties: "kdp-royalties-complete-v4",
  kdpRoyaltiesPrev: "kdp-royalties-prev-complete-v4",
  kdpRoyaltiesToday: "kdp-royalties-today-complete-v4",
  kdpRoyaltiesSevenDay: "kdp-royalties-7d-complete-v4",
  kdpRoyaltiesYesterday: "kdp-royalties-yesterday-complete-v4",
  kdpRoyaltiesDaybefore: "kdp-royalties-daybefore-complete-v4",
  topBooks: "top-books-range-complete-v4",
  products: "products-range-complete-v4",
  topBooksYesterday: "top-books-yesterday-complete-v4",
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
  "campaign-metrics-complete-v3",
  "campaign-metrics-prev-complete-v3",
  "campaign-metrics-today-complete-v3",
  "campaign-metrics-yesterday-complete-v3",
  "campaign-metrics-daybefore-complete-v3",
  "placement-mix-range-complete-v3",
  "mobile-overview-complete-v3",
  "kdp-royalties-complete-v3",
  "kdp-royalties-prev-complete-v3",
  "kdp-royalties-today-complete-v3",
  "kdp-royalties-7d-complete-v3",
  "kdp-royalties-yesterday-complete-v3",
  "kdp-royalties-daybefore-complete-v3",
  "top-books-range-complete-v3",
  "products-range-complete-v3",
  "top-books-yesterday-complete-v3",
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

/** Persist only fully-covered KDP reads — never undercounted partial pages. */
export function financialQueryMetaForKdpCoverage(coverage: string | undefined, completeness?: string) {
  const complete =
    coverage === "complete" && (completeness == null || completeness === "COMPLETE");
  return { financialReadVersion: FINANCIAL_READ_VERSION, complete };
}

export function canPersistFinancialQuery(query: {
  queryKey?: readonly unknown[];
  state?: { status?: string; data?: { coverage?: unknown; completeness?: unknown } };
  meta?: { complete?: unknown; financialReadVersion?: unknown };
}): boolean {
  const root = query.queryKey?.[0];
  if (!isCompleteFinancialQueryRoot(root)) return false;
  if (query.state?.status !== "success") return false;
  if (query.meta?.complete === false) return false;
  if (typeof root === "string" && root.startsWith("kdp-royalties")) {
    const data = query.state?.data;
    if (data && typeof data === "object") {
      const coverage = (data as { coverage?: unknown }).coverage;
      const completeness = (data as { completeness?: unknown }).completeness;
      if (coverage === "partial" || completeness === "PARTIAL") return false;
    }
  }
  const version = query.meta?.financialReadVersion;
  return version == null || version === FINANCIAL_READ_VERSION;
}
