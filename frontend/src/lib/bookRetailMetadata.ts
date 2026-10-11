import { formatsFromWorkKey } from "./bookCampaignFormats.ts";
import { identityAsinsForBookRow } from "./booksListActivity.ts";

export type BookRetailSnapshot = {
  asin: string;
  rating: number | null;
  reviewCount: number | null;
  stockStatus: string | null;
  checkedAt: string | null;
  /** Listing metadata belongs to this exact ASIN, never a sibling edition. */
  title?: string;
  coverUrl?: string;
  marketplaceCode?: string;
  coverCacheKey?: string;
  marketplaceSnapshots?: BookRetailSnapshot[];
};

export type BookRetailSourceRow = {
  account_id?: string | null;
  asin?: string | null;
  amazon_rating?: number | string | null;
  amazon_review_count?: number | string | null;
  amazon_stock_status?: string | null;
  amazon_meta_updated_at?: string | null;
  title?: string | null;
  cover_url?: string | null;
  marketplace_code?: string | null;
};

export type ProfileBookRetailRow = {
  asin: string;
  amazonRating?: number | null;
  amazonReviewCount?: number | null;
  amazonStockStatus?: string | null;
  title?: string | null;
  coverUrl?: string | null;
  amazonMetaUpdatedAt?: string | null;
  marketplaceCode?: string | null;
};

export type RetailBookIdentity = {
  asin: string;
  sku?: string | null;
  book_key: string;
  format_asins?: readonly string[] | null;
};

const asinKey = (value: unknown) => String(value ?? "").trim().toUpperCase();

function checkedTime(value: string | null): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Exact-ASIN metadata only. Never copy a sibling edition's reviews or stock. */
export function indexBookRetailSnapshots(rows: readonly BookRetailSourceRow[]): Record<string, BookRetailSnapshot> {
  const byAsin: Record<string, BookRetailSnapshot> = {};
  for (const row of rows) {
    const asin = asinKey(row.asin);
    if (!/^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(asin)) continue;
    const rating = Number(row.amazon_rating);
    const reviews = Number(row.amazon_review_count);
    const stockStatus = String(row.amazon_stock_status ?? "").trim().slice(0, 80) || null;
    const checkedAt = String(row.amazon_meta_updated_at ?? "").trim() || null;
    const title = String(row.title ?? "").trim();
    const coverUrl = String(row.cover_url ?? "").trim();
    const marketplaceCode = String(row.marketplace_code ?? "").trim().toUpperCase();
    const snapshot: BookRetailSnapshot = {
      asin,
      rating: row.amazon_rating != null && Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
      reviewCount: row.amazon_review_count != null && Number.isInteger(reviews) && reviews >= 0 ? reviews : null,
      stockStatus,
      checkedAt,
      ...(title ? { title } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(marketplaceCode ? { marketplaceCode } : {}),
    };
    if (snapshot.rating == null && snapshot.reviewCount == null && !snapshot.stockStatus && !snapshot.coverUrl) continue;
    const prior = byAsin[asin];
    if (!prior || checkedTime(snapshot.checkedAt) > checkedTime(prior.checkedAt)) byAsin[asin] = snapshot;
  }
  return byAsin;
}

/** Use the same per-profile API payload as /amazon; never infer metadata from a sibling ASIN. */
export function indexProfileBookRetailSnapshots(
  rows: readonly ProfileBookRetailRow[],
  allowedAsins: readonly string[],
  preferredMarketplaceCode = "",
): Record<string, BookRetailSnapshot> {
  const allowed = new Set(allowedAsins.map(asinKey));
  const exactRows = rows.filter((row) => allowed.has(asinKey(row.asin)))
    .sort((a, b) => checkedTime(b.amazonMetaUpdatedAt ?? null) - checkedTime(a.amazonMetaUpdatedAt ?? null));
  const byAsinAndMarket = new Map<string, BookRetailSnapshot>();
  for (const row of exactRows) {
    const market = String(row.marketplaceCode ?? "").trim().toUpperCase();
    const asin = asinKey(row.asin);
    const key = `${asin}:${market}`;
    if (byAsinAndMarket.has(key)) continue;
    // The web endpoint's timestamp can be a catalog fetch date rather than a
    // review/stock observation. Use it for image cache invalidation, not as a
    // user-facing "checked" date.
    const snapshot = indexBookRetailSnapshots([{
      asin,
      amazon_rating: row.amazonRating,
      amazon_review_count: row.amazonReviewCount,
      amazon_stock_status: row.amazonStockStatus,
      amazon_meta_updated_at: null,
      title: row.title,
      cover_url: row.coverUrl,
      marketplace_code: market,
    }])[asin];
    if (!snapshot) continue;
    const version = checkedTime(row.amazonMetaUpdatedAt ?? null);
    if (snapshot.coverUrl && Number.isFinite(version)) {
      snapshot.coverCacheKey = `${asin}:${market}:${version}:${snapshot.coverUrl}`;
    }
    byAsinAndMarket.set(key, snapshot);
  }
  const preferred = String(preferredMarketplaceCode).trim().toUpperCase();
  const result: Record<string, BookRetailSnapshot> = {};
  const marketsByAsin = new Map<string, BookRetailSnapshot[]>();
  for (const snapshot of byAsinAndMarket.values()) {
    const markets = marketsByAsin.get(snapshot.asin) ?? [];
    markets.push(snapshot);
    marketsByAsin.set(snapshot.asin, markets);
  }
  for (const [asin, markets] of marketsByAsin) {
    markets.sort((a, b) =>
      Number(b.marketplaceCode === preferred) - Number(a.marketplaceCode === preferred) ||
      String(a.marketplaceCode ?? "").localeCompare(String(b.marketplaceCode ?? "")),
    );
    result[asin] = { ...markets[0], marketplaceSnapshots: markets.slice(1) };
  }
  return result;
}

export function bookRetailAsins(books: readonly RetailBookIdentity[]): string[] {
  return [...new Set(books.flatMap(identityAsinsForBookRow))].filter((asin) =>
    /^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(asin),
  ).sort();
}

export function bookRetailEditions(
  book: RetailBookIdentity,
  byAsin: Readonly<Record<string, BookRetailSnapshot>>,
): Array<{ format: string; snapshot: BookRetailSnapshot }> {
  const formatByAsin = new Map(formatsFromWorkKey(book.book_key).map((format) => [format.asin, format.label]));
  return identityAsinsForBookRow(book)
    .filter((asin) => /^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(asin))
    .flatMap((asin) => {
      const primary = byAsin[asin] ?? { asin, rating: null, reviewCount: null, stockStatus: null, checkedAt: null };
      const format = formatByAsin.get(asin) ?? "Edition";
      return [primary, ...(primary.marketplaceSnapshots ?? [])].map((snapshot) => ({ format, snapshot }));
    })
    .sort((a, b) => {
      const priority = (format: string) => format === "Paperback" ? 0 : format === "Kindle" ? 1 : format === "Hardcover" ? 2 : 3;
      return priority(a.format) - priority(b.format) || a.snapshot.asin.localeCompare(b.snapshot.asin);
    });
}

export function primaryBookRetailEdition(
  book: RetailBookIdentity,
  byAsin: Readonly<Record<string, BookRetailSnapshot>>,
): { format: string; snapshot: BookRetailSnapshot } | null {
  const editions = bookRetailEditions(book, byAsin);
  const year = (value: string | undefined) => Math.max(0, ...(value?.match(/\b20\d{2}\b/g) ?? []).map(Number));
  const stockRank = (value: string | null) => {
    const tone = bookRetailStockTone(value);
    return tone === "good" ? 2 : tone === "neutral" ? 1 : 0;
  };
  const formatRank = (format: string) => format === "Paperback" ? 2 : format === "Hardcover" ? 1 : 0;
  return [...editions].sort((a, b) =>
    stockRank(b.snapshot.stockStatus) - stockRank(a.snapshot.stockStatus) ||
    year(b.snapshot.title) - year(a.snapshot.title) ||
    Number(b.snapshot.asin === asinKey(book.asin)) - Number(a.snapshot.asin === asinKey(book.asin)) ||
    formatRank(b.format) - formatRank(a.format) ||
    Number(b.snapshot.reviewCount != null) - Number(a.snapshot.reviewCount != null) ||
    a.snapshot.asin.localeCompare(b.snapshot.asin),
  ).find(({ snapshot }) =>
    snapshot.rating != null || snapshot.reviewCount != null || snapshot.stockStatus != null || snapshot.coverUrl != null,
  ) ?? editions[0] ?? null;
}

export function bookRetailStockTone(value: string | null): "good" | "danger" | "neutral" {
  const status = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/^(in stock|instock|available)$/.test(status)) return "good";
  if (/^(out of stock|outofstock|not in stock|currently unavailable|unavailable)$/.test(status)) return "danger";
  return "neutral";
}

export function bookRetailStockLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/^(in stock|instock)$/.test(normalized)) return "In stock";
  if (/^(out of stock|outofstock)$/.test(normalized)) return "Out of stock";
  if (normalized === "currently unavailable") return "Currently unavailable";
  return value.trim();
}
