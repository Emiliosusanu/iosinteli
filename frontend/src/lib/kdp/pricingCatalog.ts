/** Durable structured Bookshelf discovery. A failed/ignored page never seals a catalog. */
import type { extractBookshelfPrintRowsFromHtml } from "./vendor/kdpPricingCapture.js";
export type ShelfRow = ReturnType<typeof extractBookshelfPrintRowsFromHtml>[number] & { observedAtMs?: number };
export type PricingCatalog = {
  version: 1; page: number; complete: boolean; rows: ShelfRow[];
  lastPageKeys: string[]; scanKeys?: string[]; checkedAtMs: number; stalled: boolean;
  discoverySkips?: number; totalTitles?: number; discoveryKeys?: string[];
};
type Storage = { getItem(key: string, fallback: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<boolean> };
export const emptyPricingCatalog = (): PricingCatalog => ({ version: 1, page: 1,
  complete: false, rows: [], lastPageKeys: [], scanKeys: [], checkedAtMs: 0, stalled: false });
const rowKey = (row: ShelfRow) => `${row.kdpBookId}:${row.printAsin || ''}`;
/** A short wake should service known live retries before another expensive
 * page fetch. Recheck discovery within an hour; empty/unknown/stale evidence
 * never establishes eligibility. This does not schedule an iOS wake. */
export function canResumeKnownLivePricing(catalog: PricingCatalog,
  pending: { kdpBookId: string }[], now = Date.now()): boolean {
  if (catalog.stalled || catalog.checkedAtMs < now - 60 * 60_000) return false;
  // Even with thousands of pending prices, discovery must reach the tail.
  // At most two short pricing slices may pass before the next catalog page.
  if (!catalog.complete && Number(catalog.discoverySkips || 0) >= 2) return false;
  const live = new Set(catalog.rows.filter(row => row.printStatus === 'live'
    && Number(row.observedAtMs) >= now - 24 * 60 * 60_000).map(row => row.kdpBookId));
  return pending.some(candidate => live.has(candidate.kdpBookId));
}
export function acceptCatalogPage(prior: PricingCatalog, page: number, rows: ShelfRow[], now = Date.now(), evidence: { keys: string[]; terminal: boolean; totalTitles?: number } = { keys: rows.map(rowKey), terminal: rows.length === 0 }): PricingCatalog {
  if (page !== prior.page) throw new Error('KDP Bookshelf cursor mismatch');
  const keys = evidence.keys;
  // Numbered pages that repeat the prior identities may mean Amazon ignored
  // page=. They are not evidence that every page was fetched.
  const previousKeys = new Set(prior.lastPageKeys);
  const repeated = page > 1 && keys.length > 0 && keys.every(key => previousKeys.has(key));
  const merged = new Map(prior.rows.map(row => [rowKey(row), row]));
  for (const row of rows) merged.set(rowKey(row), { ...row, observedAtMs: now });
  const scanSet = new Set([...(prior.scanKeys || []), ...rows.map(rowKey)]);
  const scanKeys = [...scanSet];
  if (!keys.length && !evidence.terminal) throw new Error('KDP Bookshelf page identities unverified; cursor retained');
  const discoveryKeys = [...new Set([...(prior.discoveryKeys || []), ...keys.filter(key => key.startsWith('title:'))])];
  const coverageMismatch = evidence.totalTitles != null && ((prior.totalTitles != null && prior.totalTitles !== evidence.totalTitles)
    || (evidence.terminal && discoveryKeys.length !== evidence.totalTitles));
  if (coverageMismatch) return { ...prior, stalled: true, complete: false, checkedAtMs: now };
  const complete = evidence.terminal;
  return { version: 1, ...(evidence.totalTitles != null ? { totalTitles: evidence.totalTitles, discoveryKeys } : {}), page: repeated || complete ? page : page + 1,
    complete, rows: [...merged.values()].filter(row => !complete || scanSet.has(rowKey(row))),
    lastPageKeys: keys, scanKeys, checkedAtMs: now, stalled: repeated, discoverySkips: 0 };
}
export function createPricingCatalogStore(storage: Storage) {
  const key = (account: string) => `inteliads.kdpHelper.pricingCatalog.v1:${account}`;
  return {
    async load(account: string): Promise<PricingCatalog> {
      const raw = await storage.getItem(key(account), '');
      try {
        const value = raw ? JSON.parse(raw) : null;
        if (value?.version === 1 && Number.isInteger(value.page) && value.page > 0
          && Array.isArray(value.rows) && Array.isArray(value.lastPageKeys)) return value;
      } catch { /* Corrupt discovery cannot establish a complete library. */ }
      return emptyPricingCatalog();
    },
    async save(account: string, value: PricingCatalog): Promise<void> {
      if (!await storage.setItem(key(account), JSON.stringify(value)))
        throw new Error('KDP Bookshelf checkpoint unavailable; retry pending');
    },
  };
}

/** All large reads have a stable ordering and explicit pages, including .in filters. */
export async function readAllPricingPages<T>(fetchPage: (offset: number, size: number) => Promise<T[]>, size = 500): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += size) {
    const page = await fetchPage(offset, size);
    out.push(...page);
    if (page.length < size) return out;
  }
}
export function pricingIdentityChunks<T>(values: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}
