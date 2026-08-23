import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const AD_QUERY_PREFIXES = [
  "campaigns-list-range",
  "top-campaigns-range",
  "campaign-detail",
  "campaign-placements",
  "campaign-metrics",
  "targeting-keywords",
  "targeting-products",
  "targeting-placements",
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
  "bid-recommendations",
  "bid-engine-status",
  "bid-engine-settings",
  "bid-engine-apply-log",
  "bid-engine-placements",
  "placement-mix-range",
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
