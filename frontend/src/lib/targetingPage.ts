/** Initial ranked Targets window; sorting/filtering still run globally in the RPC. */

export const TARGETING_PAGE_SIZE = 100;

/** Match mobile_targeting_page_v1's ACoS rank when merging campaign segments.
 * The RPC ranks zero-sale rows by clicks and impressions, not by spend. */
export function compareByTargetingRpcAcos(
  a: { id?: unknown; total_sales?: unknown; total_acos?: unknown; total_clicks?: unknown; total_impressions?: unknown; metrics_updated_at?: unknown },
  b: { id?: unknown; total_sales?: unknown; total_acos?: unknown; total_clicks?: unknown; total_impressions?: unknown; metrics_updated_at?: unknown },
): number {
  const metric = (value: unknown) => Number(value) || 0;
  const acos = (row: typeof a) =>
    metric(row.total_sales) > 0 && metric(row.total_acos) > 0 ? metric(row.total_acos) : null;
  const aAcos = acos(a);
  const bAcos = acos(b);
  if (aAcos !== null && bAcos !== null && aAcos !== bAcos) return bAcos - aAcos;
  if (aAcos !== null) return -1;
  if (bAcos !== null) return 1;
  const clicks = metric(b.total_clicks) - metric(a.total_clicks);
  if (clicks) return clicks;
  const impressions = metric(b.total_impressions) - metric(a.total_impressions);
  if (impressions) return impressions;
  const synced = (row: typeof a) => {
    const ms = Date.parse(String(row.metrics_updated_at ?? ""));
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  const freshness = synced(b) - synced(a);
  if (Number.isFinite(freshness) && freshness) return freshness;
  if (synced(a) !== synced(b)) return synced(a) === -Infinity ? 1 : -1;
  const aId = String(a.id ?? "");
  const bId = String(b.id ?? "");
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** Append a ranked server page without re-sorting or duplicating entity IDs. */
export function appendTargetingPageRows<T extends { id?: unknown }>(
  head: readonly T[],
  loadedTail: readonly T[],
  nextPage: readonly T[],
): T[] {
  const seen = new Set(
    [...head, ...loadedTail].map((row) => String(row.id ?? "")),
  );
  const append = nextPage.filter((row) => {
    const id = String(row.id ?? "");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...loadedTail, ...append];
}

/** Bounded page number strip: always first + last, and a window around current. */
export function targetingPageNumbers(page: number, totalPages: number): number[] {
  const safeTotal = Math.max(1, Math.floor(totalPages) || 1);
  const safePage = Math.max(1, Math.min(Math.floor(page) || 1, safeTotal));
  const pages = new Set<number>([1, safeTotal]);
  const start = Math.max(1, Math.min(safePage - 2, safeTotal - 4));
  for (let n = start; n <= Math.min(safeTotal, start + 4); n += 1) pages.add(n);
  return [...pages].filter((n) => n >= 1 && n <= safeTotal).sort((a, b) => a - b);
}

export function targetingTotalPages(total: number, pageSize: number = TARGETING_PAGE_SIZE): number {
  const size = Math.max(1, pageSize);
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}
