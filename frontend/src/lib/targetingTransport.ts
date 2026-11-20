import { withAbortableQueryTimeout, TARGETING_QUERY_TIMEOUT_MS, isHomeQueryTimeout } from "./queryTimeout";
import { shouldRetryRead } from "./readRequest";

export function targetingPageQueryKey(scope: readonly unknown[], page: number, snapshot: string | null) {
  return [...scope, page === 1 ? "catalog-head" : "catalog-tail", page, snapshot] as const;
}

export function targetingCanAutoRefresh(error: unknown): boolean {
  return !isHomeQueryTimeout(error);
}

/** Both observed head reads and imperative tail reads use Query's single flight. */
export function targetingPageQueryOptions<T>(
  scope: readonly unknown[],
  page: number,
  snapshot: string | null,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs = TARGETING_QUERY_TIMEOUT_MS,
) {
  return {
    queryKey: targetingPageQueryKey(scope, page, snapshot),
    queryFn: ({ signal }: { signal: AbortSignal }) => withAbortableQueryTimeout(task, timeoutMs, signal),
    retry: shouldRetryRead,
    refetchOnReconnect: (query: { state: { error: unknown } }) => targetingCanAutoRefresh(query.state.error),
    refetchOnWindowFocus: (query: { state: { error: unknown } }) => targetingCanAutoRefresh(query.state.error),
    staleTime: 0,
  };
}
