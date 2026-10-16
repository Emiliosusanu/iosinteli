import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/contexts/AuthContext';
import { useApp } from '@/src/contexts/AppContext';
import { fetchBookRetailMetadata } from '@/src/lib/queries';
import { bookRetailAsins, type BookRetailSnapshot, type RetailBookIdentity } from '@/src/lib/bookRetailMetadata';
import { canReadBookRetailMetadata, mergeScopedRetailCache } from '@/src/lib/bookRetailWindow';

/** List and detail share progressive metadata and the same exact-ASIN cache. */
export function useBookRetailMetadata(books: readonly RetailBookIdentity[], profileIds: string[], key: string, priorityMarketplaceCodes: readonly string[] = []) {
  const { user } = useAuth();
  const { profiles, selectedProfileIds, adminFilterUserId, isAdminViewer } = useApp();
  const asins = useMemo(() => bookRetailAsins(books), [books]);
  const preferredMarketplaceCode = profiles.find(profile => selectedProfileIds.includes(profile.id) || selectedProfileIds.includes(profile.profile_id))?.country_code;
  const scope = JSON.stringify([user?.id, adminFilterUserId, profileIds, preferredMarketplaceCode]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const forceRefresh = useRef(false);
  const [progress, setProgress] = useState<{ scope: string; data: Record<string, BookRetailSnapshot> }>({ scope: '', data: {} });
  const enabled = canReadBookRetailMetadata({ userId: user?.id, filterUserId: adminFilterUserId, isAdminViewer, profileIds, asins });
  const query = useQuery({
    queryKey: [key, scope, asins, priorityMarketplaceCodes],
    queryFn: ({ signal }) => fetchBookRetailMetadata({
      books, adsProfileIds: profileIds, userId: user?.id, filterUserId: adminFilterUserId,
      preferredMarketplaceCode, priorityMarketplaceCodes, signal, forceRefresh: forceRefresh.current,
      marketplaceCodes: Object.fromEntries(profiles.flatMap(profile => {
        const code = String(profile.country_code ?? '').trim().toUpperCase();
        return code ? [[profile.id, code], [profile.profile_id, code]] : [];
      })),
      onProgress: snapshots => {
        if (!signal.aborted && currentScope.current === scope && Object.keys(snapshots).length) {
          setProgress(previous => mergeScopedRetailCache(previous, scope, snapshots));
        }
      },
    }),
    enabled, staleTime: 5 * 60_000, retry: false,
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
