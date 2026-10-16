import { useMemo, useRef, useState } from 'react';
import { shouldRetryBooksRead, bookRetailRefetchInterval } from '@/src/lib/booksReadRecovery';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/contexts/AuthContext';
import { useApp } from '@/src/contexts/AppContext';
import { fetchBookRetailMetadata } from '@/src/lib/queries';
import { bookRetailAsins, type BookRetailSnapshot, type RetailBookIdentity } from '@/src/lib/bookRetailMetadata';
import { canReadBookRetailMetadata, mergeScopedRetailCache, cachedBookRetailSnapshots } from '@/src/lib/bookRetailWindow';

/** List and detail share progressive metadata and the same exact-ASIN cache. */
export function useBookRetailMetadata(books: readonly RetailBookIdentity[], profileIds: string[], key: string, priorityMarketplaceCodes: readonly string[] = [], primaryMarketplaceByAsin: Readonly<Record<string, string>> = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { profiles, selectedProfileIds, adminFilterUserId, isAdminViewer } = useApp();
  const asins = useMemo(() => bookRetailAsins(books), [books]);
  const preferredMarketplaceCode = profiles.find(profile => selectedProfileIds.includes(profile.id) || selectedProfileIds.includes(profile.profile_id))?.country_code;
  // Observations belong to the viewer/customer/profile scope, not a viewport.
  // Scrolling changes the request plan but must not erase already loaded cards.
  const scope = JSON.stringify([user?.id, adminFilterUserId, profileIds, preferredMarketplaceCode]);
  const requestScope = JSON.stringify([scope, asins, primaryMarketplaceByAsin]);
  const currentRequest = useRef(requestScope);
  currentRequest.current = requestScope;
  const forceRefresh = useRef(false);
  const [progress, setProgress] = useState<{ scope: string; data: Record<string, BookRetailSnapshot> }>({ scope: '', data: {} });
  const enabled = canReadBookRetailMetadata({ userId: user?.id, filterUserId: adminFilterUserId, isAdminViewer, profileIds, asins });
  const query = useQuery({
    queryKey: [key, "primary-market-v2", scope, asins, priorityMarketplaceCodes, primaryMarketplaceByAsin],
    queryFn: ({ signal }) => fetchBookRetailMetadata({
      books, adsProfileIds: profileIds, userId: user?.id, filterUserId: adminFilterUserId,
      preferredMarketplaceCode, priorityMarketplaceCodes, primaryMarketplaceByAsin, signal, forceRefresh: forceRefresh.current,
      marketplaceCodes: Object.fromEntries(profiles.flatMap(profile => {
        const code = String(profile.country_code ?? '').trim().toUpperCase();
        return code ? [[profile.id, code], [profile.profile_id, code]] : [];
      })),
      onProgress: snapshots => {
        if (!signal.aborted && currentRequest.current === requestScope && Object.keys(snapshots).length) {
          setProgress(previous => mergeScopedRetailCache(previous, scope, snapshots));
        }
      },
    }),
    placeholderData: () => {
      if (!enabled) return undefined;
      const snapshots = cachedBookRetailSnapshots(
        queryClient.getQueriesData<{ snapshots: Record<string, BookRetailSnapshot> }>({}), scope, asins,
      );
      return Object.keys(snapshots).length ? { snapshots, failedRequests: 0, pendingRequests: 0 } : undefined;
    },
    enabled, staleTime: 5 * 60_000, retry: shouldRetryBooksRead,
    retryDelay: attempt => Math.min(5000 * 2 ** attempt, 20_000),
    // These are fast server-cache reads, not Amazon requests from the phone.
    // Pending rows bypass the local observation TTL until the server finishes.
    refetchInterval: bookRetailRefetchInterval,
    refetchIntervalInBackground: false,
  });
  const status = Number((query.error as { status?: number; statusCode?: number } | null)?.status
    ?? (query.error as { statusCode?: number } | null)?.statusCode ?? 0);
  const snapshots = useMemo(() => {
    if (status === 401 || status === 403) return {};
    // During a refetch, the old settled response must not overwrite a fresh
    // per-market observation that has already arrived from the API.
    if (query.isFetching) return mergeScopedRetailCache(
      { scope, data: query.data?.snapshots ?? {} }, scope, progress.scope === scope ? progress.data : {},
    ).data;
    return mergeScopedRetailCache(progress, scope, query.data?.snapshots ?? {}).data;
  }, [progress, scope, query.data, query.isFetching, status]);
  const refresh = async () => {
    if (!enabled) return;
    forceRefresh.current = true;
    try { return await query.refetch(); } finally { forceRefresh.current = false; }
  };
  return { query, snapshots, refresh, enabled };
}
