// Lightweight, zero-dependency persistence for React Query using AsyncStorage.
// Restores the cached data on cold start so the same data loads instantly
// instead of showing a spinner and refetching from scratch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

const CACHE_KEY = "inteliads.queryCache.v1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24; // keep cached data for 24h
const MAX_QUERY_AGE_MS = 1000 * 60 * 60 * 6; // keep recently viewed dashboards warm
const MAX_CACHE_BYTES = 2_500_000;
const PERSIST_DEBOUNCE_MS = 3000;

const PERSISTED_QUERY_KEYS = new Set([
  "amazon-profiles",
  "user-settings",
  "campaign-metrics",
  "campaign-metrics-prev",
  "campaign-metrics-today",
  "campaign-metrics-yesterday",
  "campaign-metrics-daybefore",
  "kdp-royalties",
  "kdp-royalties-prev",
  "kdp-royalties-yesterday",
  "kdp-royalties-daybefore",
  "top-campaigns-range",
  "top-books-range",
  "top-books-yesterday",
  "placement-mix-range",
  "sync-logs",
  "all-campaign-budgets",
  "today-execution-stats",
  "rule-executions-dashboard",
  "optimization-rules",
  "hourly-metrics",
  "campaigns-list-range",
  "products-range",
]);

function shouldPersistQuery(q: { queryKey: readonly unknown[]; state: { status: string; dataUpdatedAt: number } }) {
  const key = q.queryKey[0];
  return (
    q.state.status === "success" &&
    typeof key === "string" &&
    PERSISTED_QUERY_KEYS.has(key) &&
    Date.now() - q.state.dataUpdatedAt <= MAX_QUERY_AGE_MS
  );
}

// Restore persisted query data into the client. Root layout starts this after
// mount so a large/corrupt cache can never block the first React paint.
export async function hydrateQueryClient(client: QueryClient): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { timestamp: number; state: unknown };
    if (!saved?.timestamp || Date.now() - saved.timestamp > MAX_AGE_MS) {
      await AsyncStorage.removeItem(CACHE_KEY);
      return;
    }
    hydrate(client, saved.state);
  } catch {
    // Corrupt/incompatible cache — drop it silently.
    try { await AsyncStorage.removeItem(CACHE_KEY); } catch {}
  }
}

/** Best-effort removal of user-scoped snapshots during sign-out. */
export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
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
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
