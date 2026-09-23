// Lightweight, zero-dependency persistence for React Query using AsyncStorage.
// Restores the cached data on cold start so the same data loads instantly
// instead of showing a spinner and refetching from scratch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import {
  FINANCIAL_QUERY_ROOTS,
  canPersistFinancialQuery,
  isCompleteFinancialQueryRoot,
  isObsoleteFinancialQueryRoot,
} from "./financialReadVersion.ts";
import { clearMobileHomeSnapshots } from "./mobileHomeSnapshot.ts";
import { debugIngest } from "./debugIngest.ts";

export const QUERY_CACHE_KEY = "inteliads.queryCache.v6";
const CACHE_KEY = QUERY_CACHE_KEY;
const MAX_AGE_MS = 1000 * 60 * 60 * 6; // 6h — match home snapshot freshness; no multi-day fiction
const MAX_QUERY_AGE_MS = MAX_AGE_MS;
const MAX_CACHE_BYTES = 2_500_000;
const PERSIST_DEBOUNCE_MS = 3000;

let queryCacheHydrated = false;
const hydrationWaiters: (() => void)[] = [];

export function isQueryCacheHydrated(): boolean {
  return queryCacheHydrated;
}

export function markQueryCacheHydrated() {
  if (queryCacheHydrated) return;
  queryCacheHydrated = true;
  for (const waiter of hydrationWaiters.splice(0)) waiter();
}

export function onQueryCacheHydrated(cb: () => void): () => void {
  if (queryCacheHydrated) {
    cb();
    return () => {};
  }
  hydrationWaiters.push(cb);
  return () => {
    const index = hydrationWaiters.indexOf(cb);
    if (index >= 0) hydrationWaiters.splice(index, 1);
  };
}

const PERSISTED_QUERY_KEYS = new Set([
  "amazon-profiles",
  "user-settings",
  FINANCIAL_QUERY_ROOTS.campaignMetrics,
  FINANCIAL_QUERY_ROOTS.campaignMetricsPrev,
  FINANCIAL_QUERY_ROOTS.campaignMetricsToday,
  FINANCIAL_QUERY_ROOTS.campaignMetricsYesterday,
  FINANCIAL_QUERY_ROOTS.campaignMetricsDaybefore,
  FINANCIAL_QUERY_ROOTS.placementMix,
  FINANCIAL_QUERY_ROOTS.mobileOverview,
  FINANCIAL_QUERY_ROOTS.kdpRoyalties,
  FINANCIAL_QUERY_ROOTS.kdpRoyaltiesPrev,
  FINANCIAL_QUERY_ROOTS.kdpRoyaltiesToday,
  FINANCIAL_QUERY_ROOTS.kdpRoyaltiesSevenDay,
  FINANCIAL_QUERY_ROOTS.kdpRoyaltiesYesterday,
  FINANCIAL_QUERY_ROOTS.kdpRoyaltiesDaybefore,
  "top-campaigns-range-v2",
  "campaigns-list-range-v3",
  "targeting-placements-v2",
  "targeting-keywords",
  "targeting-products",
  "ads-engine-keywords-daily",
  "ads-engine-search-terms-daily",
  "targeting-adgroup-default-bids",
  "targeting-book-options-v2",
  FINANCIAL_QUERY_ROOTS.topBooks,
  FINANCIAL_QUERY_ROOTS.topBooksYesterday,
  "sync-logs",
  "all-campaign-budgets",
  "today-execution-stats",
  "rule-executions-dashboard",
  "optimization-rules",
  "hourly-metrics",
  FINANCIAL_QUERY_ROOTS.products,
]);

type PersistableQuery = {
  queryKey: readonly unknown[];
  state: { status: string; dataUpdatedAt: number };
  meta?: { complete?: unknown; financialReadVersion?: unknown };
};

export function shouldPersistQuery(q: PersistableQuery): boolean {
  const key = q.queryKey[0];
  if (isObsoleteFinancialQueryRoot(key)) return false;
  if (isCompleteFinancialQueryRoot(key) && !canPersistFinancialQuery(q)) return false;
  return (
    q.state.status === "success" &&
    typeof key === "string" &&
    PERSISTED_QUERY_KEYS.has(key) &&
    Date.now() - q.state.dataUpdatedAt <= MAX_QUERY_AGE_MS
  );
}

export function stripObsoleteFinancialQueries<T>(state: T): T {
  if (!state || typeof state !== "object") return state;
  const value = state as { queries?: unknown[] };
  if (!Array.isArray(value.queries)) return state;
  return {
    ...value,
    queries: value.queries.filter((query) => {
      if (!query || typeof query !== "object") return false;
      const key = (query as { queryKey?: readonly unknown[] }).queryKey?.[0];
      return !isObsoleteFinancialQueryRoot(key);
    }),
  } as T;
}

// Restore persisted query data into the client. Root layout starts this after
// mount so a large/corrupt cache can never block the first React paint.
// Never overwrite a fresher in-memory result with an older AsyncStorage blob.
export async function hydrateQueryClient(client: QueryClient): Promise<void> {
  const hydrateT0 = Date.now();
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    // #region agent log
    debugIngest("queryPersist.ts:hydrate", "cache hydrate read", { ms: Date.now() - hydrateT0, bytes: raw?.length ?? 0, empty: !raw }, "D");
    // #endregion
    if (!raw) return;
    const saved = JSON.parse(raw) as { timestamp: number; state: unknown };
    if (!saved?.timestamp || Date.now() - saved.timestamp > MAX_AGE_MS) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return;
    }
    const stripped = stripObsoleteFinancialQueries(saved.state) as {
      queries?: Array<{ queryKey: readonly unknown[]; state?: { dataUpdatedAt?: number } }>;
    };
    if (Array.isArray(stripped.queries)) {
      stripped.queries = stripped.queries.filter((query) => {
        if (!query?.queryKey) return false;
        const current = client.getQueryState(query.queryKey as unknown[]);
        if (!current || current.dataUpdatedAt == null || current.dataUpdatedAt === 0) return true;
        const incoming = query.state?.dataUpdatedAt ?? 0;
        return incoming > current.dataUpdatedAt;
      });
    }
    hydrate(client, stripped);
  } catch {
    // Corrupt/incompatible cache — drop it silently.
    try { await AsyncStorage.removeItem(CACHE_KEY); } catch {}
  } finally {
    markQueryCacheHydrated();
  }
}

/** Best-effort removal of user-scoped snapshots during sign-out. */
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(CACHE_KEY),
      clearMobileHomeSnapshots(),
    ]);
  } catch {
    // Sign-out must continue even if cache storage is unavailable.
  }
}

// Subscribe to cache changes and persist (debounced) successful queries.
export function startQueryPersistence(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const state = dehydrate(client, {
          shouldDehydrateQuery: shouldPersistQuery,
        });
        const payload = JSON.stringify({ timestamp: Date.now(), state });
        if (payload.length > MAX_CACHE_BYTES) return;
        await AsyncStorage.setItem(CACHE_KEY, payload);
      } catch {
        // Storage full or serialization issue — ignore, cache is best-effort.
      }
    }, PERSIST_DEBOUNCE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe(save);
  save();
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
