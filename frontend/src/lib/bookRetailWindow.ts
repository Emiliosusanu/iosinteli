import type { BookRetailSnapshot } from "./bookRetailMetadata.ts";

type Book = { book_key: string; asin: string; sku?: string | null };
const key = (row: Book) => row.book_key || row.asin || row.sku || "";

/** Reviews/stock are listing metadata, not the financial import. Fetch the
 * viewport rather than walking a thousand-book shelf on every screen open.
 */
export function bookRetailWindow<T extends Book>(books: readonly T[], visibleKeys: readonly string[]): T[] {
  const visible = new Set(visibleKeys);
  const inView = books.filter(row => visible.has(key(row)));
  return (inView.length ? inView : books.slice(0, 12)).slice(0, 24);
}

export function mergeScopedRetailCache(
  previous: { scope: string; data: Record<string, BookRetailSnapshot> },
  scope: string, incoming: Record<string, BookRetailSnapshot>,
) {
  return { scope, data: { ...(previous.scope === scope ? previous.data : {}), ...incoming } };
}
