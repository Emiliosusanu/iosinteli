import type { LinkPreviewBook } from "./linkPreviewCompare.ts";

/**
 * KDP's format shelf is the catalog authority after the first full import.
 * `kdp_titles` remains useful enrichment, but can contain residual rows from
 * an older or interrupted account association. Legacy accounts that predate
 * format imports still fall back to their title shelf.
 */
export function authoritativeKdpCatalog(
  titleBooks: readonly LinkPreviewBook[],
  formatBooks: readonly LinkPreviewBook[],
): LinkPreviewBook[] {
  const titlesByAsin = new Map(titleBooks.map((book) => [book.asin, book]));
  const authority = formatBooks.length ? formatBooks : titleBooks;
  const byAsin = new Map<string, LinkPreviewBook>();

  for (const book of authority) {
    const titleBook = titlesByAsin.get(book.asin);
    const previous = byAsin.get(book.asin);
    byAsin.set(book.asin, {
      asin: book.asin,
      title: titleBook?.title || book.title || previous?.title || null,
      imageUrl: titleBook?.imageUrl || book.imageUrl || previous?.imageUrl || null,
    });
  }

  return [...byAsin.values()].sort((a, b) =>
    (a.title || a.asin).localeCompare(b.title || b.asin),
  );
}
