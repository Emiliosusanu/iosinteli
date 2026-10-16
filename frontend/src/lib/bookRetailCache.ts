type RetailRow = { asin: string; amazonRating?: number | null; amazonReviewCount?: number | null; amazonStockStatus?: string | null; amazonRetailPending?: boolean };

/** In-memory exact-ASIN observations. Scope includes authenticated viewer,
 * customer and profile; unknown reads expire sooner and are never zeroes. */
export class BookRetailObservationCache<T extends RetailRow> {
  private entries = new Map<string, { at: number; ttl: number; rows: T[] }>();
  private readonly capacity: number;
  constructor(capacity = 8000) { this.capacity = capacity; }
  read(scope: string, asins: readonly string[], now = Date.now()) {
    const rows: T[] = [], missing: string[] = [];
    for (const asin of asins) {
      const key = JSON.stringify([scope, asin]);
      const entry = this.entries.get(key);
      if (!entry || entry.rows.some(row => row.amazonRetailPending) || now - entry.at >= entry.ttl) {
        this.entries.delete(key); missing.push(asin);
      } else rows.push(...entry.rows);
    }
    return { rows, missing };
  }
  write(scope: string, asins: readonly string[], rows: readonly T[], now = Date.now()) {
    const byAsin = new Map<string, T[]>();
    const requested = new Set(asins);
    for (const row of rows) {
      const asin = row.asin.trim().toUpperCase();
      if (!requested.has(asin)) continue;
      const matches = byAsin.get(asin) ?? []; matches.push({ ...row, asin }); byAsin.set(asin, matches);
    }
    for (const asin of asins) {
      const matches = byAsin.get(asin) ?? [];
      const observed = matches.some(row => row.amazonRating != null || row.amazonReviewCount != null || !!row.amazonStockStatus);
      const key = JSON.stringify([scope, asin]);
      this.entries.delete(key);
      this.entries.set(key, { at: now, rows: matches, ttl: observed ? 5 * 60_000 : 30_000 });
    }
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}
