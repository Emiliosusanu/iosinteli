/**
 * Targeting / Campaigns Filter sheet — book option dedupe, parent-format
 * rollup, eligibility, and local search.
 * Kept separate from queries.ts so unit tests can exercise the contract
 * without loading Supabase/Nest clients.
 *
 * Contexts:
 * - targets: filter campaigns/ad groups by book → campaigns activity only
 * - create: campaign-create book pickers → in-stock AND (KDP or Ads activity)
 */

export type TargetingBookFilterOption = {
  asin: string;
  title: string;
  image_url?: string | null;
  campaignIds: string[];
  campaignCount?: number;
  /** True when this ASIN has meaningful KDP royalty/daily/KENP evidence — not catalog-only. */
  hasKdpData?: boolean;
  /** Purchased / Nest Create in-stock (ads-eligible shelf). */
  inStock?: boolean;
  /** Sibling format ASINs (ebook / print / hardcover / audio) for parent rollup. */
  formatAsins?: string[];
  /** DIGITAL=/PRINT= or KDP:account:book_id identity key when known. */
  groupKey?: string | null;
};

/** Targets filter vs campaign-create (and similar) book pickers. */
export type TargetingBookEligibilityContext = "targets" | "create";

function pickCover(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

function normalizeAsin(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function isValidAsin(asin: string): boolean {
  return /^[A-Z0-9]{10}$/.test(asin);
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Real KDP signal for create / KDP filter rows — not a bare catalog title and
 * not a zeroed daily stub. Any of royalties, format royalties, KENP, orders,
 * or pages-read counts.
 */
export function hasMeaningfulKdpDailySignal(row: {
  royalties?: unknown;
  orders?: unknown;
  ebook_royalties?: unknown;
  paperback_royalties?: unknown;
  kenp_royalties?: unknown;
  kenp_pages?: unknown;
  pages_read?: unknown;
  units?: unknown;
}): boolean {
  const royalties = money(row.royalties);
  const formatSum =
    money(row.ebook_royalties) +
    money(row.paperback_royalties) +
    money(row.kenp_royalties);
  if (royalties !== 0 || formatSum !== 0) return true;
  if ((Number(row.orders) || 0) > 0) return true;
  if ((Number(row.units) || 0) > 0) return true;
  if ((Number(row.kenp_pages) || 0) > 0) return true;
  if ((Number(row.pages_read) || 0) > 0) return true;
  return false;
}

/** Prefer DIGITAL/Kindle ASIN as the stable filter row anchor (Books parity). */
function primaryAsinFromGroupKey(groupKey: string, fallbackAsins: Iterable<string> = []): string {
  const key = String(groupKey ?? "").trim();
  const digital = key.match(/DIGITAL=([A-Z0-9]{8,})/i);
  if (digital?.[1]) return normalizeAsin(digital[1]);
  const print = key.match(/PRINT=([A-Z0-9]{8,})/i);
  if (print?.[1]) return normalizeAsin(print[1]);
  for (const asin of fallbackAsins) {
    const normalized = normalizeAsin(asin);
    if (normalized) return normalized;
  }
  return "";
}

function editionYear(title: string): number {
  const years = title.match(/\b20\d{2}\b/g) ?? [];
  return years.reduce((latest, value) => Math.max(latest, Number(value) || 0), 0);
}

function preferTitle(a: string, b: string, fallbackAsin: string): string {
  const left = a.trim();
  const right = b.trim();
  const leftHuman = left && left.toUpperCase() !== fallbackAsin ? left : "";
  const rightHuman = right && right.toUpperCase() !== fallbackAsin ? right : "";
  if (!leftHuman) return rightHuman || right || left || fallbackAsin;
  if (!rightHuman) return leftHuman;
  const leftYear = editionYear(leftHuman);
  const rightYear = editionYear(rightHuman);
  if (rightYear > leftYear) return rightHuman;
  if (leftYear > rightYear) return leftHuman;
  return rightHuman.length > leftHuman.length ? rightHuman : leftHuman;
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
  const asin = normalizeAsin(book.asin);
  const title = String(book.title || "").trim();
  if (!title) return false;
  return title.toUpperCase() !== asin;
}

/**
 * Context-correct book filter membership.
 *
 * - targets: only books that actually have campaign/ad-group activity (filter
 *   campaigns by book). Empty published / KDP-only / stock-only stay out.
 * - create: in-stock shelf **and** (meaningful KDP **or** Ads campaign
 *   activity). Stock-only empties and KDP/Ads-only without stock stay out.
 */
export function isEligibleTargetingBookOption(
  book: TargetingBookFilterOption,
  context: TargetingBookEligibilityContext = "targets",
): boolean {
  const asin = normalizeAsin(book.asin);
  if (!isValidAsin(asin)) return false;

  if (context === "targets") {
    return targetingBookHasCampaigns(book);
  }

  // create: inStock && (hasMeaningfulKdp || hasAds)
  const hasAds = targetingBookHasCampaigns(book);
  const hasKdp = !!book.hasKdpData;
  return !!book.inStock && (hasKdp || hasAds);
}

function identitiesForTargetingBook(book: TargetingBookFilterOption): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    const asin = normalizeAsin(value);
    if (isValidAsin(asin)) out.add(asin);
  };
  add(book.asin);
  for (const sibling of book.formatAsins ?? []) add(sibling);
  const key = String(book.groupKey ?? "").trim();
  if (key) {
    for (const match of key.matchAll(/(?:^|[=:])((?:B0[A-Z0-9]{8}|\d{9}[\dX]))(?=$|[:])/gi)) {
      add(match[1]);
    }
  }
  return [...out];
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
    const asin = normalizeAsin(book.asin);
    if (!isValidAsin(asin)) continue;
    const campaignIds = [
      ...new Set((book.campaignIds ?? []).map(String).filter(Boolean)),
    ];
    const formatAsins = [
      ...new Set(
        [...(book.formatAsins ?? []), asin]
          .map(normalizeAsin)
          .filter(isValidAsin),
      ),
    ];
    const next = {
      ...book,
      asin,
      title: String(book.title || "").trim() || asin,
      image_url: book.image_url ?? null,
      campaignIds,
      campaignCount: Number(book.campaignCount) || campaignIds.length || 0,
      hasKdpData: !!book.hasKdpData,
      inStock: !!book.inStock,
      formatAsins,
      groupKey: book.groupKey ? String(book.groupKey) : null,
    } as T;
    const prev = byAsin.get(asin);
    if (!prev) {
      byAsin.set(asin, next);
      continue;
    }
    const mergedIds = [...new Set([...prev.campaignIds, ...next.campaignIds])];
    const mergedFormats = [
      ...new Set([...(prev.formatAsins ?? []), ...(next.formatAsins ?? [])]),
    ];
    byAsin.set(asin, {
      ...prev,
      ...next,
      asin,
      title: preferTitle(prev.title, next.title, asin),
      image_url: pickCover(prev.image_url, next.image_url),
      campaignIds: mergedIds,
      campaignCount: Math.max(
        Number(prev.campaignCount) || 0,
        Number(next.campaignCount) || 0,
        mergedIds.length,
      ),
      hasKdpData: !!(prev.hasKdpData || next.hasKdpData),
      inStock: !!(prev.inStock || next.inStock),
      formatAsins: mergedFormats,
      groupKey: next.groupKey || prev.groupKey || null,
    } as T);
  }
  return [...byAsin.values()];
}

/**
 * Collapse Kindle / paperback / hardcover / audio siblings into one filter row.
 * Same parent-format spirit as Books `collapseTopBooksByFormatGroup` /
 * Barndominium DIGITAL+PRINT rollup — never list formats as separate filters.
 */
export function collapseTargetingBookOptionsByParent<T extends TargetingBookFilterOption>(
  books: T[],
): T[] {
  const rows = dedupeTargetingBookOptions(books);
  if (rows.length <= 1) return rows;

  const parent = rows.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };

  const identityIndex = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const identity of identitiesForTargetingBook(row)) {
      const prior = identityIndex.get(identity);
      if (prior == null) identityIndex.set(identity, index);
      else unite(prior, index);
    }
    const key = String(row.groupKey ?? "").trim();
    if (key && !/^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/i.test(key)) {
      const groupId = `KEY:${key}`;
      const prior = identityIndex.get(groupId);
      if (prior == null) identityIndex.set(groupId, index);
      else unite(prior, index);
    }
  });

  const buckets = new Map<number, T[]>();
  rows.forEach((row, index) => {
    const root = find(index);
    const bucket = buckets.get(root) ?? [];
    bucket.push(row);
    buckets.set(root, bucket);
  });

  return [...buckets.values()].map((bucket) => {
    if (bucket.length === 1) return { ...bucket[0] };
    const formatAsins = new Set<string>();
    const campaignIds = new Set<string>();
    let groupKey: string | null = null;
    let title = "";
    let image_url: string | null = null;
    let hasKdpData = false;
    let inStock = false;
    for (const row of bucket) {
      for (const id of identitiesForTargetingBook(row)) formatAsins.add(id);
      for (const id of row.campaignIds ?? []) {
        const trimmed = String(id || "").trim();
        if (trimmed) campaignIds.add(trimmed);
      }
      if (!groupKey && row.groupKey) groupKey = String(row.groupKey);
      title = preferTitle(title, row.title, row.asin);
      image_url = pickCover(image_url, row.image_url);
      hasKdpData = hasKdpData || !!row.hasKdpData;
      inStock = inStock || !!row.inStock;
    }
    const preferred =
      bucket.find((row) => /DIGITAL=/i.test(String(row.groupKey ?? ""))) ??
      bucket.find((row) => targetingBookHasCampaigns(row)) ??
      bucket.find((row) => row.hasKdpData) ??
      bucket[0];
    const primary =
      primaryAsinFromGroupKey(groupKey ?? "", formatAsins) ||
      normalizeAsin(preferred.asin);
    const ids = [...campaignIds];
    return {
      ...preferred,
      asin: primary,
      title: title || primary,
      image_url,
      campaignIds: ids,
      campaignCount: Math.max(
        ...bucket.map((row) => Number(row.campaignCount) || 0),
        ids.length,
      ),
      hasKdpData,
      inStock,
      formatAsins: [...formatAsins],
      groupKey,
    } as T;
  });
}

/** Dedupe → parent rollup → context eligibility. Default: Targets (campaigns only). */
export function selectEligibleTargetingBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
  context: TargetingBookEligibilityContext = "targets",
): T[] {
  return collapseTargetingBookOptionsByParent(books).filter((book) =>
    isEligibleTargetingBookOption(book, context),
  );
}

/** Create-flow alias: in-stock AND (KDP or Ads) after parent rollup. */
export function selectEligibleCreateBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
): T[] {
  return selectEligibleTargetingBookOptions(books, "create");
}

/** Union campaign-linked books with KDP books, then Targets eligibility-gate. */
export function mergeTargetingBookOptionSources<T extends TargetingBookFilterOption>(
  campaignBooks: T[],
  kdpBooks: T[],
  context: TargetingBookEligibilityContext = "targets",
): T[] {
  return selectEligibleTargetingBookOptions([...campaignBooks, ...kdpBooks], context);
}

/** Case-insensitive title / ASIN match for the targeting Filter sheet search. */
export function filterTargetingBookOptions<T extends TargetingBookFilterOption>(
  books: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter((book) => {
    if (book.title.toLowerCase().includes(q) || book.asin.toLowerCase().includes(q)) {
      return true;
    }
    return (book.formatAsins ?? []).some((asin) => asin.toLowerCase().includes(q));
  });
}

export function unionCampaignIdsForBookAsins(
  books: Array<Pick<TargetingBookFilterOption, "asin" | "campaignIds" | "formatAsins">>,
  asins: string[],
): string[] {
  const want = new Set(
    asins.map((value) => normalizeAsin(value)).filter(Boolean),
  );
  const ids = new Set<string>();
  for (const book of books) {
    const identities = new Set([
      normalizeAsin(book.asin),
      ...(book.formatAsins ?? []).map(normalizeAsin),
    ]);
    let hit = false;
    for (const identity of identities) {
      if (want.has(identity)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    for (const campaignId of book.campaignIds ?? []) {
      const id = String(campaignId || "").trim();
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}
