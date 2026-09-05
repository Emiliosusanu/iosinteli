/**
 * Period / profile scoped React Query options.
 *
 * Speed comes from real cache hits (same key), persistence, and prefetch —
 * never from showing another period's or profile's rows under a new label.
 *
 * Global QueryClient must NOT use keepPreviousData. Period/list screens opt
 * into same-scope warm placeholders only (Overview top-N for the same dates).
 */

export type PeriodRange = { start: string; end: string };

/** Stable profile scope so selection order does not duplicate caches. */
export function sortedProfileIds(ids: readonly string[]): string[] {
  return [...ids].map((id) => String(id || "").trim()).filter(Boolean).sort();
}

export function periodQueryKey(range: PeriodRange, profileIds: readonly string[]): string {
  const profiles = sortedProfileIds(profileIds).join(",");
  return `${range.start}|${range.end}|${profiles}`;
}

/**
 * Financial list/KPI cache identity — period + sorted profiles + currency.
 * Prevents a late response for another currency from painting under the new label.
 */
export function financialPeriodQueryKey(
  range: PeriodRange,
  profileIds: readonly string[],
  currency: string | null | undefined,
): string {
  const code = String(currency || "none").trim().toUpperCase() || "NONE";
  return `${periodQueryKey(range, profileIds)}|${code}`;
}

/** Blocks any inherited placeholder — empty until this key has real data or same-scope warm. */
export function noPeriodPlaceholder<T>(): T | undefined {
  return undefined;
}

/**
 * Instant paint from Overview warm data for the *same* period + profiles only.
 * Never accepts observer `previous` from a different query key.
 */
export function sameScopeWarmPlaceholder<T>(warm: T | undefined | null): T | undefined {
  return warm == null ? undefined : warm;
}

/** Home KPIs / charts — short stale, always remount refetch, no cross-key bleed. */
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

/**
 * Campaigns / Books / Targets lists — memory-fast revisit of the same scope,
 * but remount always revalidates so overnight / filter changes stay honest.
 */
export const LIST_PERIOD_QUERY_CACHE = {
  staleTime: 45_000,
  gcTime: 12 * 60 * 60_000,
  placeholderData: noPeriodPlaceholder,
  refetchOnMount: "always" as const,
  retry: 1 as const,
};

/**
 * Profile-scoped reference data (book catalog, default bids) — longer stale,
 * still keyed by profiles; never reuse another profile set via keepPreviousData.
 */
export const STABLE_SCOPED_CACHE = {
  staleTime: 5 * 60_000,
  gcTime: 24 * 60 * 60_000,
  placeholderData: noPeriodPlaceholder,
  refetchOnMount: true as const,
  retry: 1 as const,
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
