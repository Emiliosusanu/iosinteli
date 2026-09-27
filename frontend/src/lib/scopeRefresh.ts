/**
 * Scope-bound financial / list cache refresh.
 *
 * Profile chips, date range, and Overview focus must never leave Gross/spend
 * (or Targeting filters) painted from a prior selection past the cache window.
 */
import type { QueryClient } from "@tanstack/react-query";
import { FINANCIAL_QUERY_ROOTS } from "./financialReadVersion.ts";
import { shouldRevalidateTargetingPageOnVisit } from "./targetingPageFreshness.ts";

/** Roots / prefixes invalidated when Ads profiles or the Overview date change. */
export const SCOPE_BOUND_QUERY_PREFIXES = [
  ...Object.values(FINANCIAL_QUERY_ROOTS),
  "mobile-overview",
  "top-campaigns",
  "campaigns-list",
  "campaign-metrics",
  "top-books",
  "products-range",
  "products-range-complete",
  "placement-mix",
  "kdp-royalties",
  "kdp-format-royalties",
  "mobile-targeting-page-v1",
  "targeting-book-options-v2",
  "targeting-keywords",
  "targeting-products",
  "targeting-placements",
  "ads-engine-keywords-daily",
  "ads-engine-search-terms-daily",
  "search-terms-pulse",
  "bleeding-keywords",
  "overview-ad-groups",
  "overview-kdp-ingest",
  "sync-logs",
  "all-campaign-budgets",
  "rule-executions-dashboard",
  "optimization-rules",
  "today-execution-stats",
  "hourly-metrics",
  "books-activity-60d",
  "dashboard-bootstrap",
  "dashboard-campaigns",
  "campaign-creation-books",
  "campaign-creation-marketplaces",
  "campaign-creation-selected-book",
] as const;

export function isScopeBoundQueryKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return SCOPE_BOUND_QUERY_PREFIXES.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}`),
  );
}

/** Soft-invalidate active scope-bound reads after profile / date / focus changes. */
export function invalidateScopeBoundQueries(
  queryClient: QueryClient,
  opts?: { refetchType?: "active" | "all" | "none" },
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => isScopeBoundQueryKey(query.queryKey[0]),
    refetchType: opts?.refetchType ?? "active",
  });
}

/** Same age window as Targeting — revisit Overview only when the cache window elapsed. */
export function shouldRevalidateHomeOnVisit(
  updatedAt: number,
  now: number,
  maxAgeMs: number,
): boolean {
  return shouldRevalidateTargetingPageOnVisit(updatedAt, now, maxAgeMs);
}
