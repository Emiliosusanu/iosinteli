import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FINANCIAL_QUERY_ROOTS } from "./financialReadVersion";

const AD_QUERY_PREFIXES = [
  "campaigns-list-range",
  "campaigns-list-range-v2",
  "top-campaigns-range",
  "top-campaigns-range-v2",
  "campaign-detail",
  "campaign-placements",
  "campaign-metrics",
  "campaign-metrics-complete-v2",
  "campaign-metrics-prev-complete-v2",
  "campaign-metrics-today-complete-v2",
  "campaign-metrics-yesterday-complete-v2",
  "campaign-metrics-daybefore-complete-v2",
  "mobile-overview",
  "mobile-overview-complete-v2",
  "targeting-keywords",
  "targeting-products",
  "targeting-placements",
  "targeting-placements-v2",
  "products-range",
  "top-books-range",
  "search-terms",
  "ad-groups",
  "ad-group-detail",
  "optimization-rules",
  "rule-executions",
  "rule-executions-dashboard",
  "rule-execution-entities",
  "sync-overview",
  "sync-logs",
  "amazon-profiles",
  "kdp-accounts",
  "kdp-royalties",
  "bid-recommendations",
  "bid-engine-status",
  "bid-engine-settings",
  "bid-engine-apply-log",
  "bid-engine-placements",
  "placement-mix-range",
  "placement-mix-range-complete-v2",
  // complete-v3 financial roots (Ads + KDP) so sync refreshes Net Royalties too
  ...Object.values(FINANCIAL_QUERY_ROOTS),
];

export function useInvalidateAds() {
  const queryClient = useQueryClient();
  return useCallback(
    async (extra: string[] = []) => {
      const prefixes = [...AD_QUERY_PREFIXES, ...extra];
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}`));
        },
      });
    },
    [queryClient],
  );
}
