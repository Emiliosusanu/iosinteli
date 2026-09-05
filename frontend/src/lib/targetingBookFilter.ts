/**
 * Targeting Filter sheet — book option dedupe, eligibility, and local search.
 * Kept separate from queries.ts so unit tests can exercise the contract
 * without loading Supabase/Nest clients.
 */

export type TargetingBookFilterOption = {
  asin: string;
  title: string;
  image_url?: string | null;
  campaignIds: string[];
  campaignCount?: number;
  /** True when this ASIN has KDP catalog and/or royalty/daily rows. */
  hasKdpData?: boolean;
};

function pickCover(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

export function targetingBookHasCampaigns(
  book: Pick<TargetingBookFilterOption, "campaignIds" | "campaignCount">,
): boolean {
  return (book.campaignIds?.length ?? 0) > 0 || (Number(book.campaignCount) || 0) > 0;
}

/** Title that is not just a fallback to the raw ASIN/ISBN. */
export function targetingBookHasHumanLabel(
  book: Pick<TargetingBookFilterOption, "asin" | "title">,
): boolean {
  const asin = String(book.asin || "")
    .trim()
    .toUpperCase();
  const title = String(book.title || "").trim();
  if (!title) return false;
  return title.toUpperCase() !== asin;
}

/**
 * Book filter membership: campaigns available OR KDP data.
 * Drops bare ASIN/ISBN-only chips that have campaigns but no human title,
 * cover, or KDP meta — those are not useful selectable books.
 */
export function isEligibleTargetingBookOption(book: TargetingBookFilterOption): boolean {
  const asin = String(book.asin || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return false;

  const hasKdp = !!book.hasKdpData;
  if (hasKdp) return true;

  if (!targetingBookHasCampaigns(book)) return false;

  const hasCover = !!String(book.image_url || "").trim();
  return targetingBookHasHumanLabel(book) || hasCover;
}

/**
 * One row per ASIN. Keeps the richer title / cover and unions campaign ids
 * when Nest (or another source) emits duplicates.
 */
export function dedupeTargetingBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
): T[] {
  const byAsin = new Map<string, T>();
  for (const book of books) {
    const asin = String(book.asin || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const campaignIds = [
      ...new Set((book.campaignIds ?? []).map(String).filter(Boolean)),
    ];
    const next = {
      ...book,
      asin,
      title: String(book.title || "").trim() || asin,
      image_url: book.image_url ?? null,
      campaignIds,
      campaignCount: Number(book.campaignCount) || campaignIds.length || 0,
      hasKdpData: !!book.hasKdpData,
    } as T;
    const prev = byAsin.get(asin);
    if (!prev) {
      byAsin.set(asin, next);
      continue;
    }
    const mergedIds = [...new Set([...prev.campaignIds, ...next.campaignIds])];
    const prevTitle = prev.title && prev.title !== asin ? prev.title : "";
    const nextTitle = next.title && next.title !== asin ? next.title : "";
    byAsin.set(asin, {
      ...prev,
      ...next,
      asin,
      title: nextTitle.length > prevTitle.length ? nextTitle : prevTitle || nextTitle || asin,
      image_url: pickCover(prev.image_url, next.image_url),
      campaignIds: mergedIds,
      campaignCount: Math.max(
        Number(prev.campaignCount) || 0,
        Number(next.campaignCount) || 0,
        mergedIds.length,
      ),
      hasKdpData: !!(prev.hasKdpData || next.hasKdpData),
    } as T);
  }
  return [...byAsin.values()];
}

/** Dedupe then keep only campaign-linked and/or KDP-backed books. */
export function selectEligibleTargetingBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
): T[] {
  return dedupeTargetingBookOptions(books).filter(isEligibleTargetingBookOption);
}

/** Union campaign-linked books with KDP catalog/royalty books, then eligibility-gate. */
export function mergeTargetingBookOptionSources<T extends TargetingBookFilterOption>(
  campaignBooks: T[],
  kdpBooks: T[],
): T[] {
  return selectEligibleTargetingBookOptions([...campaignBooks, ...kdpBooks]);
}

/** Case-insensitive title / ASIN match for the targeting Filter sheet search. */
export function filterTargetingBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter(
    (book) =>
      book.title.toLowerCase().includes(q) || book.asin.toLowerCase().includes(q),
  );
}
