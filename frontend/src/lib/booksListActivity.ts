/**
 * Books list eligibility — only titles with KDP or Ads activity in the rolling window.
 */

import { rangePresets } from "./format.ts";

export const BOOKS_LIST_ACTIVITY_DAYS = 60;

export type BookListRow = {
  book_key: string;
  asin: string;
  sku: string | null;
  royalties: number | null;
  orders: number;
  spend: number;
  sales: number;
  impressions: number;
  clicks: number;
};

export function booksListActivityRange(now = new Date()): { start: string; end: string } {
  const { last60 } = rangePresets(now);
  return { start: last60.start, end: last60.end };
}

export function bookRowHasRecentActivityKey(row: BookListRow, activeKeys: ReadonlySet<string>): boolean {
  if (activeKeys.has(row.book_key)) return true;
  if (row.asin && activeKeys.has(row.asin)) return true;
  if (row.sku && activeKeys.has(row.sku)) return true;
  return false;
}

export function filterTopBooksByRecentActivity<T extends BookListRow>(
  rows: readonly T[],
  activeKeys: ReadonlySet<string> | null | undefined,
): T[] {
  // null/undefined = activity gate unavailable → keep rows.
  // Empty Set = gate ran and found no active books → show none.
  if (activeKeys == null) return [...rows];
  return rows.filter((row) => bookRowHasRecentActivityKey(row, activeKeys));
}

export function booksEmptyCopy(
  search: string,
  opts: { iosHelperOn?: boolean; hasLinkedKdp?: boolean; hasAccountRoyalties?: boolean } = {},
): { title: string; subtitle: string } {
  if (search.trim()) {
    return { title: "No matching books", subtitle: "Try another search" };
  }
  if (opts.hasAccountRoyalties) {
    return {
      title: "No per-book breakdown",
      subtitle: "",
    };
  }
  if (!opts.hasLinkedKdp && !opts.iosHelperOn) {
    return {
      title: "Connect KDP",
      subtitle: "",
    };
  }
  return {
    title: "No book data in range",
    subtitle: "",
  };
}

export function bookHasSignalInRange(row: BookListRow): boolean {
  const royalties = Number(row.royalties) || 0;
  const orders = Number(row.orders) || 0;
  const spend = Number(row.spend) || 0;
  const sales = Number(row.sales) || 0;
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  return royalties !== 0 || orders !== 0 || spend > 0 || sales > 0 || impressions > 0 || clicks > 0;
}
