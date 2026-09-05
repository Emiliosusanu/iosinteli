import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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

/** Immediately paint a queued bid so the list doesn't flash the old Amazon value. */
export function applyOptimisticEntityBid(
  queryClient: QueryClient,
  entityKind: "keyword" | "product_target",
  entityId: string,
  bid: number,
): number | null {
  let previousBid: number | null = null;
  const stamp = new Date().toISOString();
  const patchRow = (row: any) => {
    if (!row || row.id !== entityId) return row;
    if (previousBid == null) {
      const raw = entityKind === "keyword" ? row.bid_amount : row.bid ?? row.bid_amount;
      const n = Number(raw);
      if (Number.isFinite(n)) previousBid = n;
    }
    if (entityKind === "keyword") {
      return { ...row, bid_amount: bid, bid_last_modified_at: stamp, bid_change_source: "ios" };
    }
    return { ...row, bid, bid_amount: bid, bid_last_modified_at: stamp, bid_change_source: "ios" };
  };
  queryClient.setQueriesData(
    {
      predicate: (query) => {
        const key = query.queryKey[0];
        return (
          typeof key === "string" &&
          (key.startsWith("targeting-") ||
            key.startsWith("campaign") ||
            key.startsWith("keyword") ||
            key.startsWith("product-target") ||
            key.startsWith("product_target") ||
            key.startsWith("ad-group") ||
            key === "ad-groups")
        );
      },
    },
    (old: unknown) => {
      if (Array.isArray(old)) return old.map(patchRow);
      if (old && typeof old === "object" && (old as any).id === entityId) return patchRow(old);
      return old;
    },
  );
  return previousBid;
}

/** Undo an optimistic bid when the Amazon write permanently fails. */
export function revertOptimisticEntityBid(
  queryClient: QueryClient,
  entityKind: "keyword" | "product_target",
  entityId: string,
  previousBid: number | null,
) {
  if (previousBid == null || !Number.isFinite(previousBid)) {
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && (key.startsWith("targeting-") || key.startsWith("keyword") || key.startsWith("product"));
      },
    });
    return;
  }
  applyOptimisticEntityBid(queryClient, entityKind, entityId, previousBid);
}

type EntityStateKind = "keyword" | "product_target" | "campaign" | "ad_group";

function entityStateQueryPredicate(entityKind: EntityStateKind) {
  return (query: { queryKey: readonly unknown[] }) => {
    const key = query.queryKey[0];
    if (typeof key !== "string") return false;
    if (entityKind === "keyword") {
      return (
        key.startsWith("targeting-keywords") ||
        key.startsWith("keyword") ||
        key.startsWith("ad-group") ||
        key === "ad-groups"
      );
    }
    if (entityKind === "product_target") {
      return (
        key.startsWith("targeting-products") ||
        key.startsWith("product-target") ||
        key.startsWith("product_target") ||
        key.startsWith("target") ||
        key.startsWith("ad-group") ||
        key === "ad-groups"
      );
    }
    if (entityKind === "ad_group") {
      return key.startsWith("ad-group") || key === "ad-groups" || key.startsWith("campaign");
    }
    return (
      key.startsWith("campaigns-list") ||
      key.startsWith("top-campaigns") ||
      key.startsWith("campaign") ||
      key === "campaign-api" ||
      key.startsWith("mobile-overview")
    );
  };
}

/**
 * Paint enable/pause instantly so the Switch never waits on Nest + a full
 * invalidateAds storm (that lag made toggles feel stuck / "can't re-enable").
 */
export function applyOptimisticEntityState(
  queryClient: QueryClient,
  entityKind: EntityStateKind,
  entityId: string,
  enabled: boolean,
): boolean | null {
  let previous: boolean | null = null;
  const nextStatus = enabled ? "enabled" : "paused";
  const stamp = new Date().toISOString();
  const patchRow = (row: any) => {
    if (!row || row.id !== entityId) return row;
    if (previous == null) {
      const raw = row.status ?? row.state;
      previous = raw === "enabled" || raw === true;
    }
    if (entityKind === "keyword") {
      return {
        ...row,
        status: nextStatus,
        bid_last_modified_at: stamp,
        bid_change_source: "ios",
      };
    }
    return {
      ...row,
      state: nextStatus,
      status: nextStatus,
      bid_last_modified_at: stamp,
      bid_change_source: "ios",
    };
  };
  queryClient.setQueriesData({ predicate: entityStateQueryPredicate(entityKind) }, (old: unknown) => {
    if (Array.isArray(old)) return old.map(patchRow);
    if (old && typeof old === "object" && (old as any).id === entityId) return patchRow(old);
    return old;
  });
  return previous;
}

export function revertOptimisticEntityState(
  queryClient: QueryClient,
  entityKind: EntityStateKind,
  entityId: string,
  previousEnabled: boolean | null,
) {
  if (previousEnabled == null) {
    void queryClient.invalidateQueries({
      predicate: entityStateQueryPredicate(entityKind),
      refetchType: "active",
    });
    return;
  }
  applyOptimisticEntityState(queryClient, entityKind, entityId, previousEnabled);
}

/** Soft refresh of active list/detail queries only — never a full ads cache wipe. */
export function invalidateEntityStateQueries(
  queryClient: QueryClient,
  entityKind: EntityStateKind,
) {
  return queryClient.invalidateQueries({
    predicate: entityStateQueryPredicate(entityKind),
    refetchType: "active",
  });
}
