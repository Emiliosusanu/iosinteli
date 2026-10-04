import { formatsFromWorkKey } from "./bookCampaignFormats.ts";
import { identityAsinsForBookRow } from "./booksListActivity.ts";

export type BookRetailSnapshot = {
  asin: string;
  rating: number | null;
  reviewCount: number | null;
  stockStatus: string | null;
  checkedAt: string | null;
};

export type BookRetailSourceRow = {
  account_id?: string | null;
  asin?: string | null;
  amazon_rating?: number | string | null;
  amazon_review_count?: number | string | null;
  amazon_stock_status?: string | null;
  amazon_meta_updated_at?: string | null;
};

export type ProfileBookRetailRow = {
  asin: string;
  amazonRating?: number | null;
  amazonReviewCount?: number | null;
  amazonStockStatus?: string | null;
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
    const snapshot: BookRetailSnapshot = {
      asin,
      rating: row.amazon_rating != null && Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
      reviewCount: row.amazon_review_count != null && Number.isInteger(reviews) && reviews >= 0 ? reviews : null,
      stockStatus,
      checkedAt,
    };
    if (snapshot.rating == null && snapshot.reviewCount == null && !snapshot.stockStatus) continue;
    const prior = byAsin[asin];
    if (!prior || checkedTime(snapshot.checkedAt) > checkedTime(prior.checkedAt)) byAsin[asin] = snapshot;
  }
  return byAsin;
}

/** Use the same per-profile API payload as /amazon; never infer metadata from a sibling ASIN. */
export function indexProfileBookRetailSnapshots(
  rows: readonly ProfileBookRetailRow[],
  allowedAsins: readonly string[],
): Record<string, BookRetailSnapshot> {
  const allowed = new Set(allowedAsins.map(asinKey));
  const exactRows = rows.filter((row) => allowed.has(asinKey(row.asin)));
  // The web endpoint's amazonMetaUpdatedAt may be a catalog fetch date rather
  // than the review/stock observation date. Do not present it as a check time.
  return indexBookRetailSnapshots(exactRows.map((row) => ({
    asin: row.asin,
    amazon_rating: row.amazonRating,
    amazon_review_count: row.amazonReviewCount,
    amazon_stock_status: row.amazonStockStatus,
    amazon_meta_updated_at: null,
  })));
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
    .map((asin) => ({
      format: formatByAsin.get(asin) ?? "Edition",
      snapshot: byAsin[asin] ?? { asin, rating: null, reviewCount: null, stockStatus: null, checkedAt: null },
    }))
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
  return editions.find(({ snapshot }) =>
    snapshot.rating != null || snapshot.reviewCount != null || snapshot.stockStatus != null,
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
