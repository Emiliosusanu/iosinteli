import { mergeBookRetailObservation, type BookRetailSnapshot } from "./bookRetailMetadata.ts";

type Book = { book_key: string; asin: string; sku?: string | null };
const key = (row: Book) => row.book_key || row.asin || row.sku || "";

/** Reviews/stock are listing metadata, not the financial import. Fetch the
 * viewport rather than walking a thousand-book shelf on every screen open.
 */
export function bookRetailWindow<T extends Book>(books: readonly T[], visibleKeys: readonly string[]): T[] {
  const visible = new Set(visibleKeys);
  const indexes = books.flatMap((row, index) => visible.has(key(row)) ? [index] : []);
  if (!indexes.length) return books.slice(0, 12);
  // Stable half-page boundaries avoid cancelling/restarting all reads whenever
  // one card crosses the viewport. Prefetch the next few cards, never the shelf.
  const start = Math.floor(indexes[0] / 6) * 6;
  const end = Math.min(start + 24, Math.max(start + 12, indexes[indexes.length - 1] + 1));
  return books.slice(start, end);
}

export function mergeScopedRetailCache(
  previous: { scope: string; data: Record<string, BookRetailSnapshot> },
  scope: string, incoming: Record<string, BookRetailSnapshot>,
) {
  const data = { ...(previous.scope === scope ? previous.data : {}) };
  for (const [asin, snapshot] of Object.entries(incoming)) {
    const prior = data[asin];
    if (!prior) { data[asin] = snapshot; continue; }
    const markets = new Map<string, BookRetailSnapshot>();
    for (const row of [prior, ...(prior.marketplaceSnapshots ?? []), snapshot, ...(snapshot.marketplaceSnapshots ?? [])]) {
      if (row.asin !== asin) continue;
      const market = row.marketplaceCode ?? "";
      const priorMarket = markets.get(market);
      markets.set(market, priorMarket ? { ...mergeBookRetailObservation(priorMarket, row), retailPending: row.retailPending } : { ...row, marketplaceSnapshots: undefined });
    }
    const primary = markets.get(snapshot.marketplaceCode ?? "")!;
    data[asin] = { ...primary, marketplaceSnapshots: [...markets.values()].filter(row => row !== primary) };
  }
  return { scope, data };
}

/** A customer preview uses that customer's profile ownership on the server,
 * not the administrator's own listing metadata. */
export function canReadBookRetailMetadata(opts: {
  userId?: string | null; filterUserId?: string | null; isAdminViewer: boolean;
  profileIds: readonly string[]; asins: readonly string[];
}): boolean {
  return Boolean(opts.userId) && (!opts.filterUserId || opts.isAdminViewer)
    && opts.profileIds.length > 0 && opts.asins.length > 0;
}


/** Reuse exact viewer/customer/profile observations across list and detail.
 * ASIN and marketplace observations stay intact; only requested editions leave
 * this selector. Existing observation dates remain authoritative.
 */
export function cachedBookRetailSnapshots(
  entries: readonly (readonly [readonly unknown[], { snapshots: Record<string, BookRetailSnapshot> } | undefined])[],
  scope: string, asins: readonly string[],
): Record<string, BookRetailSnapshot> {
  let merged = { scope, data: {} as Record<string, BookRetailSnapshot> };
  for (const [key, value] of entries) {
    if (!['book-retail-metadata', 'book-retail-metadata-detail'].includes(String(key[0]))
      || key[1] !== 'primary-market-v2' || key[2] !== scope || !value?.snapshots) continue;
    merged = mergeScopedRetailCache(merged, scope, value.snapshots);
  }
  return Object.fromEntries(asins.flatMap(asin => merged.data[asin] ? [[asin, merged.data[asin]]] : []));
}
