/**
 * Period-bound React Query options for Home and other date-scoped screens.
 * Global QueryClient uses keepPreviousData — period keys must opt out explicitly
 * or Month/Week numbers flash under the wrong label.
 */

export type PeriodRange = { start: string; end: string };

export function periodQueryKey(range: PeriodRange, profileIds: readonly string[]): string {
  const profiles = [...profileIds].sort().join(",");
  return `${range.start}|${range.end}|${profiles}`;
}

/** Blocks inherited keepPreviousData from _layout QueryClient defaults. */
export function noPeriodPlaceholder<T>(): T | undefined {
  return undefined;
}

export const HOME_PERIOD_QUERY_CACHE = {
  staleTime: 30_000,
  gcTime: 12 * 60 * 60_000,
  placeholderData: noPeriodPlaceholder,
  refetchOnMount: "always" as const,
};

export const HOME_PERIOD_LIVE_CACHE = {
  staleTime: 15_000,
  gcTime: 6 * 60 * 60_000,
  placeholderData: noPeriodPlaceholder,
  refetchOnMount: "always" as const,
};

export function periodQueryPending(query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
}): boolean {
  if (query.isPlaceholderData) return true;
  if (query.isPending && query.data == null && !query.isError) return true;
  return false;
}

export function periodFinancePending(
  metrics: Parameters<typeof periodQueryPending>[0],
  royalties: Parameters<typeof periodQueryPending>[0],
): boolean {
  return periodQueryPending(metrics) || periodQueryPending(royalties);
}

export function periodQueryRefreshing(query: {
  isFetching: boolean;
  isFetched: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
}): boolean {
  return query.isFetching && query.isFetched && !query.isError && !query.isPlaceholderData;
}
