import type { TopBookRow } from "@/src/lib/queries";

/** A human-readable catalog title. Never use a raw ASIN as a customer-facing title. */
export function bookDisplayTitle(book: Pick<TopBookRow, "title" | "ads_state" | "kdp_state">): string {
  const title = String(book.title ?? "").trim();
  if (title) return title;
  return "Title unavailable";
}

/**
 * Top-books is a merchandising/ranking surface. A royalty row without a title
 * is retained in Books for diagnosis, but is not eligible to displace a fully
 * identified book in this compact widget.
 */
export function hasResolvedBookMetadata(book: Pick<TopBookRow, "title">): boolean {
  return String(book.title ?? "").trim().length > 0;
}
