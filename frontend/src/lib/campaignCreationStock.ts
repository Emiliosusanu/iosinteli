/** Campaign-create stock + profile scoping. Keep free of Nest/Supabase imports. */

import {
  expandProductSuggestionsWithMatchTypes,
  normalizeKeywordMatchType,
  offerExpandedCompanionsForExactOnly,
  offerKeywordMatchCompanions,
  parseProductMatchTypeOrNull,
  uniqueKeywordPhraseCount,
  type ProductMatchType,
} from "./amazonCampaignSuggestions.ts";

/**
 * Amazon SP keyword recommendations return cents (e.g. 111 → $1.11).
 * Nest converts; this repairs clearly-unconverted whole numbers (≥50).
 */
export function recommendationBidMajorUnits(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  let major = n;
  const whole =
    Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9;
  if (whole) {
    const asInt = Math.round(n);
    if (asInt >= 10_000) major = asInt / 1_000_000;
    else if (asInt >= 50) major = asInt / 100;
  }
  if (major < 0.02 || major > 1000) return null;
  return Number(major.toFixed(2));
}

export type StockEvidenceRow = {
  availabilityEvidence?: string | null;
  stockStatus?: string | null;
};

export type CreationMarketplace = {
  id: string;
  profileId: string;
  countryCode: string | null;
  currencyCode: string | null;
  marketplaceId: string | null;
  sku?: string | null;
  verificationSource?: "amazon_metadata" | "existing_product_ad";
  availabilityEvidence?: "in_stock" | "amazon_catalog" | "existing_product_ad";
  stockStatus?: string | null;
};

export type CreationMarketplaces = {
  asin: string;
  marketplaces: CreationMarketplace[];
  checkedCount: number;
  failedCount: number;
};

export type CreationBookLike = {
  asin: string;
  marketplaceIds?: string[] | null;
  workKey?: string | null;
  format?: string | null;
  /** Meaningful KDP royalties / KENP / orders — stamped by create enrichment. */
  hasKdpData?: boolean;
  /** Enabled Ads campaign / product-ad activity — stamped by create enrichment. */
  hasCampaign?: boolean;
};

/**
 * Create list needs Ads or KDP activity — not Nest stock-only shelf noise.
 * Soft `existing_product_ad` counts as Ads; explicit stamps cover KDP / campaigns.
 */
export function createPaperbackHasKdpOrAdsEvidence(
  book: (StockEvidenceRow & CreationBookLike) | null | undefined,
): boolean {
  if (!book) return false;
  if (adsStockSoftListed(book)) return true;
  if (book.hasKdpData) return true;
  if (book.hasCampaign) return true;
  return false;
}

type ProfileLike = {
  id: string;
  profile_id: string;
  country_code: string | null;
  currency_code: string | null;
  marketplace_id: string | null;
};

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizePreviewStockStatus(
  value: unknown,
): "in_stock" | "out_of_stock" | "unknown" | null {
  const status = normalizeStatus(value);
  if (!status) return null;
  if (status === "in_stock" || status === "instock" || status === "available") {
    return "in_stock";
  }
  if (
    status === "out_of_stock" ||
    status === "outofstock" ||
    status === "unavailable"
  ) {
    return "out_of_stock";
  }
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Live Amazon Ads stock reconfirmed (stricter than retail "In Stock"). */
export function amazonAdsStockConfirmed(row: StockEvidenceRow): boolean {
  if (row.availabilityEvidence === "in_stock") return true;
  const status = normalizeStatus(row.stockStatus);
  return status === "in_stock" || status === "instock";
}

/**
 * Nest book-candidates often tags buyable paperbacks as existing_product_ad
 * when an old product ad exists but bulk stock was not reconfirmed. Live
 * `/marketplaces?asin=` and preview/create can still succeed for those rows.
 */
export function adsStockSoftListed(row: StockEvidenceRow): boolean {
  return (
    String(row.availabilityEvidence ?? "")
      .trim()
      .toLowerCase() === "existing_product_ad"
  );
}

/** PRINT= ASIN from a Nest/KDP workKey, when present. */
export function printAsinFromWorkKey(
  workKey: string | null | undefined,
): string | null {
  const match = String(workKey ?? "")
    .toUpperCase()
    .match(/PRINT=([A-Z0-9]{8,})/);
  return match?.[1] ?? null;
}

/**
 * DIGITAL ASINs that any catalog workKey pairs with a distinct PRINT sibling.
 * Catches Nest rows that mislabel Kindle as format=paperback with a bare
 * workKey (e.g. Puerto Rico B0HBL32D6W) while the paperback row encodes
 * DIGITAL=<kindle>:PRINT=<paperback>.
 */
export function kindleAsinsFromCatalog(
  books: ReadonlyArray<Pick<CreationBookLike, "workKey">> | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const book of books ?? []) {
    const workKey = String(book.workKey ?? "").toUpperCase();
    const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/)?.[1];
    const print = workKey.match(/PRINT=([A-Z0-9]{8,})/)?.[1];
    if (digital && print && digital !== print) out.add(digital);
  }
  return out;
}

/** PRINT sibling for a Kindle ASIN from any catalog workKey encoding. */
export function printAsinForDigitalFromCatalog(
  digitalAsin: string | null | undefined,
  books: ReadonlyArray<Pick<CreationBookLike, "workKey">> | null | undefined,
): string | null {
  const want = String(digitalAsin ?? "")
    .trim()
    .toUpperCase();
  if (!want) return null;
  for (const book of books ?? []) {
    const workKey = String(book.workKey ?? "").toUpperCase();
    const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/)?.[1];
    if (digital !== want) continue;
    const print = workKey.match(/PRINT=([A-Z0-9]{8,})/)?.[1];
    if (print && print !== want) return print;
  }
  return null;
}

/**
 * Nest workKey encodes DIGITAL=<kindle>:PRINT=<paperback>.
 * Never offer the Kindle ASIN as a Create-campaign paperback, even if Nest
 * briefly marks it in_stock / format=paperback by mistake.
 * Optional catalogKindleAsins catches bare-workKey Kindle rows whose sibling
 * already encodes DIGITAL=…:PRINT=….
 */
export function isKindleAsinOnPrintWork(
  book: Pick<CreationBookLike, "asin" | "workKey"> | null | undefined,
  catalogKindleAsins?: ReadonlySet<string> | null,
): boolean {
  const asin = String(book?.asin ?? "")
    .trim()
    .toUpperCase();
  if (!asin) return false;
  if (catalogKindleAsins?.has(asin)) return true;
  const workKey = String(book?.workKey ?? "").toUpperCase();
  if (!workKey) return false;
  const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/);
  const print = workKey.match(/PRINT=([A-Z0-9]{8,})/);
  if (!digital?.[1] || !print?.[1]) return false;
  return digital[1] === asin && print[1] !== asin;
}

function titleOrAsinIncludes(
  book: Pick<CreationBookLike, "asin"> & { title?: string | null },
  needle: string,
): boolean {
  if (!needle) return true;
  return (
    String(book.title ?? "")
      .toLowerCase()
      .includes(needle) || String(book.asin ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Create-campaign paperback search.
 * Empty query → ads-eligible + in-stock ranked list only.
 * With a query → match title/ASIN on in-stock + soft-listed Verify rows
 * (soft-allow). Live out-of-stock stays searchable but ranked last so a stock
 * miss is visible, not faked empty. Exact Kindle ASINs resolve to the sibling
 * PRINT paperback when the catalog encodes it (e.g. B0DTJC4638 → B0F2Z6ZWFP /
 * Puerto Rico B0HBL32D6W → B0HFCPQMS8).
 */
export function searchCreatePaperbacks<
  T extends StockEvidenceRow &
    CreationBookLike & { title?: string | null },
>(
  books: T[],
  search: string,
  liveByAsin: Record<string, LiveAsinStock | undefined> = {},
): T[] {
  const kindleAsins = kindleAsinsFromCatalog(books);
  const needle = search.trim().toLowerCase();
  const inStockListed = filterRankCreatePaperbacks(books, liveByAsin);
  if (!needle) return inStockListed;

  const byAsin = new Map<string, T>();
  for (const book of books) {
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    if (asin) byAsin.set(asin, book);
  }

  const matched = new Map<string, T>();
  const add = (book: T | undefined | null) => {
    if (!book || !isPaperbackFormatCandidate(book, kindleAsins)) return;
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    if (!asin || matched.has(asin)) return;
    // Search soft-allow: in-stock, soft-listed, or live OOS (honest miss).
    // Never surface catalog-only / unknown blank rows.
    const live = liveByAsin[asin] ?? null;
    const selectable = isPaperbackCreateCandidate(book, live, kindleAsins);
    const liveOos = live?.status === "out_of_stock";
    if (!selectable && !liveOos) return;
    matched.set(asin, book);
  };

  for (const book of inStockListed) {
    if (titleOrAsinIncludes(book, needle)) add(book);
  }

  const exact = needle.toUpperCase().replace(/\s+/g, "");
  // Amazon catalog ASINs are B0…; KDP print also uses ISBN-10 digits (e.g. NE 1807973751).
  const isExactAsin =
    /^B0[A-Z0-9]{8}$/.test(exact) || /^\d{9}[\dX]$/.test(exact);
  if (isExactAsin) {
    const direct = byAsin.get(exact);
    if (direct && isKindleAsinOnPrintWork(direct, kindleAsins)) {
      add(
        byAsin.get(
          printAsinFromWorkKey(direct.workKey) ??
            printAsinForDigitalFromCatalog(exact, books) ??
            "",
        ),
      );
    } else {
      add(direct);
    }
    for (const book of books) {
      const workKey = String(book.workKey ?? "").toUpperCase();
      const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/);
      if (digital?.[1] === exact) add(book);
    }
  }

  for (const book of books) {
    if (!titleOrAsinIncludes(book, needle)) continue;
    add(book);
  }

  const inStockAsins = new Set(
    inStockListed.map((book) =>
      String(book.asin ?? "")
        .trim()
        .toUpperCase(),
    ),
  );
  return [...matched.values()].sort((a, b) => {
    const aAsin = String(a.asin).toUpperCase();
    const bAsin = String(b.asin).toUpperCase();
    const aLive = liveByAsin[aAsin];
    const bLive = liveByAsin[bAsin];
    const aRank =
      inStockAsins.has(aAsin) || aLive?.status === "in_stock"
        ? 0
        : aLive?.status === "out_of_stock"
          ? 2
          : 1; // soft / Verify
    const bRank =
      inStockAsins.has(bAsin) || bLive?.status === "in_stock"
        ? 0
        : bLive?.status === "out_of_stock"
          ? 2
          : 1;
    if (aRank !== bRank) return aRank - bRank;
    const yearDiff =
      editionYearFromTitle(b.title) - editionYearFromTitle(a.title);
    if (yearDiff) return yearDiff;
    return (
      String(a.title ?? "").localeCompare(String(b.title ?? "")) ||
      aAsin.localeCompare(bAsin)
    );
  });
}

/** Empty-state copy when Create paperback search returns nothing. */
export function createPaperbackSearchEmptyMessage(input: {
  search: string;
  books: Array<
    Pick<CreationBookLike, "asin" | "workKey"> & { title?: string | null }
  >;
}): string {
  const exact = input.search.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^B0[A-Z0-9]{8}$/.test(exact)) {
    return "No paperback found for this search.";
  }

  const kindleAsins = kindleAsinsFromCatalog(input.books);
  const direct = input.books.find(
    (book) => String(book.asin ?? "").trim().toUpperCase() === exact,
  );
  if (direct && isKindleAsinOnPrintWork(direct, kindleAsins)) {
    const print =
      printAsinFromWorkKey(direct.workKey) ??
      printAsinForDigitalFromCatalog(exact, input.books);
    return print
      ? `That's a Kindle ASIN. Use paperback ${print}.`
      : "That's a Kindle ASIN. Search for the paperback edition.";
  }

  for (const book of input.books) {
    const workKey = String(book.workKey ?? "").toUpperCase();
    const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/);
    if (digital?.[1] !== exact) continue;
    const print = printAsinFromWorkKey(book.workKey);
    if (print && String(book.asin).toUpperCase() === print) {
      // Sibling was found in catalog but filtered out (should be rare)
      return `Paperback ${print} is not available for ads right now.`;
    }
    if (print) {
      return `That's a Kindle ASIN. Use paperback ${print}.`;
    }
  }

  return "No paperback found for this search.";
}

/** Year from title ("Iceland Travel Guide 2026") — 0 when absent. */
export function editionYearFromTitle(title: string | null | undefined): number {
  const match = String(title ?? "").match(/\b(20\d{2})\b/);
  if (!match) return 0;
  const year = Number(match[1]);
  return year >= 2000 && year <= 2100 ? year : 0;
}

/** Title stem without year — groups 2024/2025/2026 guide editions. */
export function titleStemKey(title: string | null | undefined): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Group editions of one KDP work. Prefer TANDEM id, then DIGITAL= shared
 * identity, else the ASIN (never title alone — shared titles are not evidence).
 */
export function workFamilyKey(
  book: Pick<CreationBookLike, "asin" | "workKey"> | null | undefined,
): string {
  const workKey = String(book?.workKey ?? "").toUpperCase();
  const tandem = workKey.match(/TANDEM=([A-Z0-9_]+)/);
  if (tandem?.[1]) return `TANDEM:${tandem[1]}`;
  const digital = workKey.match(/DIGITAL=([A-Z0-9]{8,})/);
  if (digital?.[1]) return `DIGITAL:${digital[1]}`;
  const print = workKey.match(/PRINT=([A-Z0-9]{8,})/);
  if (print?.[1] && workKey.includes("DIGITAL=")) return `PRINT:${print[1]}`;
  return String(book?.asin ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Year-dedupe group: TANDEM/DIGITAL work identity when present, else title stem
 * so stale "Guide 2024" rows drop when a newer in-stock PRINT exists.
 */
export function yearDedupeGroupKey(
  book: Pick<CreationBookLike, "asin" | "workKey"> & {
    title?: string | null;
  },
): string {
  const family = workFamilyKey(book);
  if (
    family.startsWith("TANDEM:") ||
    family.startsWith("DIGITAL:") ||
    family.startsWith("PRINT:")
  ) {
    return family;
  }
  const stem = titleStemKey(book.title);
  return stem ? `STEM:${stem}` : family;
}

export type LiveAsinStockStatus =
  | "in_stock"
  | "out_of_stock"
  | "pending"
  | "error"
  | "unknown";

export type LiveAsinStock = {
  status: LiveAsinStockStatus;
};

/**
 * Paperback shape Nest / live may advertise (excludes Kindle DIGITAL and
 * non-print formats). Does not decide stock eligibility by itself.
 * Pass catalogKindleAsins when filtering a full catalog so bare-workKey
 * Kindle rows (mis-tagged format=paperback) are excluded.
 */
export function isPaperbackFormatCandidate(
  book: (StockEvidenceRow & CreationBookLike) | null | undefined,
  catalogKindleAsins?: ReadonlySet<string> | null,
): boolean {
  if (!book?.asin) return false;
  if (isKindleAsinOnPrintWork(book, catalogKindleAsins)) return false;
  const format = String(book.format ?? "")
    .trim()
    .toLowerCase();
  if (format && format !== "paperback" && format !== "print") return false;
  if (marketplaceExplicitlyUnavailable(book) && !adsStockSoftListed(book)) {
    return false;
  }
  return true;
}

/**
 * Ads-eligible + in stock + (KDP or Ads activity) for the Create book picker.
 * Soft `existing_product_ad` is Ads evidence; stock-only Nest shelf without
 * KDP/campaign stamps stays out. Soft-only (no confirmed stock) is still
 * Verify/search — not the default empty-search list.
 * Definitive live `out_of_stock` is never listed.
 * Never Kindle DIGITAL; never catalog-only.
 */
export function isPaperbackInStockListCandidate(
  book: (StockEvidenceRow & CreationBookLike) | null | undefined,
  live?: LiveAsinStock | null,
  catalogKindleAsins?: ReadonlySet<string> | null,
): boolean {
  if (!isPaperbackFormatCandidate(book, catalogKindleAsins)) return false;
  if (live?.status === "out_of_stock") return false;
  const inStock =
    amazonAdsStockConfirmed(book!) || live?.status === "in_stock";
  if (!inStock) return false;
  return createPaperbackHasKdpOrAdsEvidence(book);
}

/**
 * Selectable for Create / Verify:
 * - Nest / live Ads `in_stock`, OR
 * - Soft-listed `existing_product_ad` (Verify / search soft-allow; preview may
 *   proceed while create still gates true `in_stock` on Nest).
 * Definitive live `out_of_stock` is never creatable.
 * Never Kindle DIGITAL; never catalog-only.
 */
export function isPaperbackCreateCandidate(
  book: (StockEvidenceRow & CreationBookLike) | null | undefined,
  live?: LiveAsinStock | null,
  catalogKindleAsins?: ReadonlySet<string> | null,
): boolean {
  if (isPaperbackInStockListCandidate(book, live, catalogKindleAsins)) {
    return true;
  }
  if (!isPaperbackFormatCandidate(book, catalogKindleAsins)) return false;
  if (live?.status === "out_of_stock") return false;
  // Soft-listed: Verify / explicit search — not the default empty-search list.
  return adsStockSoftListed(book!);
}

/**
 * Rank / filter paperbacks for the Create primary list: ads-eligible + in stock
 * only. Soft-listed rows stay out until the user searches (Verify path).
 * Prefer newer year editions within a work family when a newer in-stock PRINT
 * exists. Older same-family editions are dropped.
 */
export function filterRankCreatePaperbacks<
  T extends StockEvidenceRow & CreationBookLike & { title?: string | null },
>(
  books: T[],
  liveByAsin: Record<string, LiveAsinStock | undefined> = {},
): T[] {
  const kindleAsins = kindleAsinsFromCatalog(books);
  const creatable = books.filter((book) => {
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    return isPaperbackInStockListCandidate(
      book,
      liveByAsin[asin] ?? null,
      kindleAsins,
    );
  });

  const bestYearByFamily = new Map<string, number>();
  for (const book of creatable) {
    const family = yearDedupeGroupKey(book);
    const year = editionYearFromTitle(book.title);
    const prev = bestYearByFamily.get(family) ?? 0;
    if (year > prev) bestYearByFamily.set(family, year);
  }

  // Also lift stem best-year across TANDEM siblings that share a title stem
  // (Portugal 2024 asin-only workKey vs 2026 TANDEM).
  const bestYearByStem = new Map<string, number>();
  for (const book of creatable) {
    const stem = titleStemKey(book.title);
    if (!stem) continue;
    const year = editionYearFromTitle(book.title);
    const prev = bestYearByStem.get(stem) ?? 0;
    if (year > prev) bestYearByStem.set(stem, year);
  }

  const deduped = creatable.filter((book) => {
    const year = editionYearFromTitle(book.title);
    if (year <= 0) return true;
    const family = yearDedupeGroupKey(book);
    const bestFamily = bestYearByFamily.get(family) ?? 0;
    if (bestFamily > 0 && year < bestFamily) return false;
    const stem = titleStemKey(book.title);
    const bestStem = stem ? bestYearByStem.get(stem) ?? 0 : 0;
    if (bestStem > 0 && year < bestStem) return false;
    return true;
  });

  return deduped.slice().sort((a, b) => {
    const aSoft =
      adsStockSoftListed(a) && !amazonAdsStockConfirmed(a) ? 1 : 0;
    const bSoft =
      adsStockSoftListed(b) && !amazonAdsStockConfirmed(b) ? 1 : 0;
    if (aSoft !== bSoft) return aSoft - bSoft;
    const yearDiff =
      editionYearFromTitle(b.title) - editionYearFromTitle(a.title);
    if (yearDiff) return yearDiff;
    return (
      String(a.title ?? "").localeCompare(String(b.title ?? "")) ||
      String(a.asin).localeCompare(String(b.asin))
    );
  });
}

/** Soft-listed rows awaiting live /marketplaces (not yet creatable). */
export function softListedAwaitingLiveConfirm<
  T extends StockEvidenceRow & CreationBookLike,
>(
  books: T[],
  liveByAsin: Record<string, LiveAsinStock | undefined> = {},
): T[] {
  const kindleAsins = kindleAsinsFromCatalog(books);
  return books.filter((book) => {
    if (!isPaperbackFormatCandidate(book, kindleAsins)) return false;
    if (!adsStockSoftListed(book) || amazonAdsStockConfirmed(book)) return false;
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    const live = liveByAsin[asin];
    return !live || live.status === "pending" || live.status === "unknown";
  });
}

/** Live-confirmed out of stock / Ads-ineligible paperbacks (not creatable). */
export function ineligibleOutOfStockPaperbacks<
  T extends StockEvidenceRow & CreationBookLike,
>(
  books: T[],
  liveByAsin: Record<string, LiveAsinStock | undefined> = {},
): T[] {
  const kindleAsins = kindleAsinsFromCatalog(books);
  return books.filter((book) => {
    if (!isPaperbackFormatCandidate(book, kindleAsins)) return false;
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    return liveByAsin[asin]?.status === "out_of_stock";
  });
}

/**
 * Build live stock status from a /marketplaces payload.
 * Empty rows after checks are definitive OOS only when Nest did not already
 * mark the paperback buyable / soft-listed — otherwise treat as unknown so
 * soft-fallback + preview can proceed (Iceland B0HB5MB9L9 false OOS).
 */
export function liveStockStatusFromMarketplaces(input: {
  marketplaces: StockEvidenceRow[];
  checkedCount: number;
  failedCount: number;
  requestFailed?: boolean;
  /** Nest book-candidates already said in_stock / soft product-ad. */
  nestBuyable?: boolean;
}): LiveAsinStockStatus {
  if (input.requestFailed) return "error";
  const inStock = input.marketplaces.some((row) => amazonAdsStockConfirmed(row));
  if (inStock) return "in_stock";
  if (input.failedCount > 0) return "error";
  const explicitOos = input.marketplaces.some((row) =>
    marketplaceExplicitlyUnavailable(row),
  );
  if (explicitOos) return "out_of_stock";
  if (input.checkedCount > 0) {
    // Clean empty miss: hard OOS for unknown Nest rows (Madrid). Nest-buyable
    // / soft-listed empties are flaky — not retail/Ads proof of OOS.
    if (input.nestBuyable) return "unknown";
    return "out_of_stock";
  }
  return "unknown";
}

export function marketplaceExplicitlyUnavailable(row: StockEvidenceRow): boolean {
  const evidence = String(row.availabilityEvidence ?? "").trim().toLowerCase();
  // Catalog-only is not advertisable. existing_product_ad is soft — live
  // marketplaces / preview may still succeed (see Iceland B0HB5MB9L9).
  if (evidence === "amazon_catalog") {
    return true;
  }
  const status = normalizeStatus(row.stockStatus);
  return status === "out_of_stock" || status === "outofstock" || status === "unavailable";
}

/**
 * A marketplace the user may pick. Missing evidence is allowed because the
 * per-ASIN endpoint already scoped the row; out-of-stock / catalog-only is not.
 * Soft-list existing_product_ad so linked profiles remain choosable when Nest
 * did not reconfirm bulk stock but preview/create still works.
 */
export function marketplaceIsCreateChoice(row: StockEvidenceRow): boolean {
  if (marketplaceExplicitlyUnavailable(row)) return false;
  return (
    amazonAdsStockConfirmed(row) ||
    adsStockSoftListed(row) ||
    !String(row.availabilityEvidence ?? "").trim()
  );
}

/** Caption for a paperback row before/after the live marketplaces probe. */
export function paperbackEditionStockCaption(input: {
  book: StockEvidenceRow;
  selected: boolean;
  liveInStockCount: number;
  livePending: boolean;
  displayProfileCount: number;
  usingFallback: boolean;
  liveStatus?: LiveAsinStockStatus;
}): string {
  const {
    book,
    selected,
    liveInStockCount,
    livePending,
    displayProfileCount,
    usingFallback,
    liveStatus,
  } = input;
  if (liveStatus === "out_of_stock") {
    return "Out of stock";
  }
  if (selected) {
    // Soft-fallback can already show Nest-linked profiles while the live probe
    // is still in flight — keep the pill honest (Croatia B0FW468FBB).
    if (livePending) return "Checking…";
    if (liveInStockCount > 0) {
      return `In stock · ${displayProfileCount} profile${displayProfileCount === 1 ? "" : "s"}`;
    }
    if (displayProfileCount > 0) {
      return usingFallback
        ? `Linked profile · not reconfirmed`
        : `In stock · ${displayProfileCount} profile${displayProfileCount === 1 ? "" : "s"}`;
    }
    if (liveStatus === "error") return "Check failed — retry";
    if (liveStatus === "pending" || adsStockSoftListed(book)) return "Checking…";
    return "No profile";
  }
  if (amazonAdsStockConfirmed(book) || liveStatus === "in_stock") {
    return "In stock";
  }
  // Non-selected rows: show Nest bulk evidence before tap — never wait for
  // the live /marketplaces probe that only runs after selectBook.
  if (liveStatus === "pending") return "Checking…";
  if (liveStatus === "error") return "Check failed — retry";
  if (adsStockSoftListed(book)) return "Linked · not reconfirmed";
  const evidence = String(book.availabilityEvidence ?? "")
    .trim()
    .toLowerCase();
  if (evidence === "amazon_catalog") return "Catalog only · not ads stock";
  // Owned rows must never render a blank stock pill.
  return "Stock not confirmed";
}

/** Marketplace helper copy when live Ads stock could not be reconfirmed. */
export function marketplaceFallbackHint(input: {
  failedCount?: number;
  requestFailed?: boolean;
  profileCount: number;
}): string {
  const failed =
    Boolean(input.requestFailed) || (Number(input.failedCount) || 0) > 0;
  const n = Math.max(0, Number(input.profileCount) || 0);
  const linked =
    n === 1 ? "the linked Ads profile" : `${n} linked Ads profiles`;
  if (failed) {
    return `Amazon availability check failed. Retry, continue with ${linked}, or pick another paperback.`;
  }
  return `Amazon did not reconfirm stock. Retry, continue with ${linked}, or pick another paperback.`;
}

function readString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function readEvidence(
  row: Record<string, unknown>,
): CreationMarketplace["availabilityEvidence"] {
  const raw = readString(row, ["availabilityEvidence", "availability_evidence"]);
  if (raw === "in_stock" || raw === "amazon_catalog" || raw === "existing_product_ad") {
    return raw;
  }
  return undefined;
}

export function coerceCreationMarketplace(value: unknown): CreationMarketplace | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readString(row, ["id", "profileId", "profile_id"]);
  const profileId = readString(row, ["profileId", "profile_id", "id"]);
  if (!id && !profileId) return null;
  return {
    id: id || profileId,
    profileId: profileId || id,
    countryCode: readString(row, ["countryCode", "country_code"]) || null,
    currencyCode: readString(row, ["currencyCode", "currency_code"]) || null,
    marketplaceId: readString(row, ["marketplaceId", "marketplace_id"]) || null,
    sku: readString(row, ["sku"]) || null,
    verificationSource:
      readString(row, ["verificationSource", "verification_source"]) ===
      "existing_product_ad"
        ? "existing_product_ad"
        : readString(row, ["verificationSource", "verification_source"]) ===
            "amazon_metadata"
          ? "amazon_metadata"
          : undefined,
    availabilityEvidence: readEvidence(row),
    stockStatus: readString(row, ["stockStatus", "stock_status"]) || null,
  };
}

export function normalizeCampaignCreationMarketplaces(
  raw: unknown,
  asin: string,
): CreationMarketplaces {
  const root = asRecord(raw);
  const nested = root ? asRecord(root.data) : null;
  const body = nested ? { ...root, ...nested } : root;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(body?.marketplaces)
      ? body.marketplaces
      : Array.isArray(body?.profiles)
        ? body.profiles
        : Array.isArray(body?.items)
          ? body.items
          : [];
  const marketplaces = list
    .map(coerceCreationMarketplace)
    .filter((row): row is CreationMarketplace => Boolean(row));
  const checkedCount = Number(body?.checkedCount ?? body?.checked_count ?? marketplaces.length) || 0;
  const failedCount = Number(body?.failedCount ?? body?.failed_count ?? 0) || 0;
  return {
    asin: String(body?.asin ?? asin),
    marketplaces,
    checkedCount,
    failedCount,
  };
}

/** React Query key shared by Create STEP 1 and Books Nest shelf. */
export const CAMPAIGN_CREATION_BOOKS_QUERY_KEY = ["campaign-creation-books"] as const;

/** Persists Create-selected paperback meta so Books can seed live-confirmed ASINs. */
export const CAMPAIGN_CREATION_SELECTED_BOOK_KEY = "campaign-creation-selected-book" as const;

export type CampaignCreationSelectedBookMeta = {
  asin: string;
  title: string | null;
  subtitle?: string | null;
  author?: string | null;
  topic?: string | null;
  coverUrl: string | null;
  workKey: string | null;
  sku: string | null;
  publishedAt: string | null;
};

export type NestCreateShelfCatalogBook = CreationBookLike &
  StockEvidenceRow & {
    sku?: string | null;
    title?: string | null;
    subtitle?: string | null;
    author?: string | null;
    authors?: string | null;
    topic?: string | null;
    category?: string | null;
    coverUrl?: string | null;
    publishedAt?: string | null;
    published_at?: string | null;
    verificationSource?: string | null;
    verification_source?: string | null;
    availability_evidence?: string | null;
    stock_status?: string | null;
    work_key?: string | null;
  };

/**
 * Same Nest #468 / Create soft+confirmed stock Books stamps as `in_stock`.
 * Soft product-ad / amazon_catalog / verificationSource soft count — never
 * as has_campaign. Soft stock ≠ campaign.
 */
export function nestCreateBookIsStockForBooks(
  book: NestCreateShelfCatalogBook | null | undefined,
): boolean {
  if (!book) return false;
  const evidence = String(
    book.availabilityEvidence ?? book.availability_evidence ?? "",
  )
    .trim()
    .toLowerCase();
  const stockStatus = book.stockStatus ?? book.stock_status ?? null;
  const verificationSource = String(
    book.verificationSource ?? book.verification_source ?? "",
  )
    .trim()
    .toLowerCase();
  const stockRow = {
    availabilityEvidence: evidence || book.availabilityEvidence,
    stockStatus,
  };
  const softListed =
    adsStockSoftListed(stockRow) || verificationSource === "existing_product_ad";
  return (
    amazonAdsStockConfirmed(stockRow) ||
    softListed ||
    evidence === "amazon_catalog"
  );
}

/** Minimal Books catalog shelf row seeded from Nest Create candidates. */
export type NestCreateShelfCatalogRow = {
  book_key: string;
  asin: string;
  sku: string | null;
  title: string | null;
  image_url: string | null;
  sponsorable: boolean;
  has_campaign: false;
  in_stock: boolean;
  published_at: string | null;
};

/**
 * Nest create-candidate shelf → Books catalog identity rows.
 * Shared by Create auth path and Books finalize — do not diverge filters.
 */
export function creationBooksToShelfCatalogRows(
  books: ReadonlyArray<NestCreateShelfCatalogBook> | null | undefined,
): NestCreateShelfCatalogRow[] {
  const list = books ?? [];
  const catalogKindleAsins = kindleAsinsFromCatalog(list);
  const rows: NestCreateShelfCatalogRow[] = [];
  for (const book of list) {
    if (isKindleAsinOnPrintWork(book, catalogKindleAsins)) continue;
    const workKey = String(book.workKey ?? book.work_key ?? "").trim();
    const publishedAt =
      String(book.publishedAt ?? book.published_at ?? "").trim() || null;
    const asin = String(book.asin ?? "")
      .trim()
      .toUpperCase();
    if (!asin) continue;
    rows.push({
      book_key: workKey || asin,
      asin,
      sku: book.sku ?? null,
      title: book.title || null,
      image_url: book.coverUrl ?? null,
      sponsorable: true,
      has_campaign: false,
      in_stock: nestCreateBookIsStockForBooks(book),
      published_at: publishedAt,
    });
  }
  return rows;
}

/**
 * Nest book-candidates.marketplaceIds are Amazon Ads profile IDs
 * (e.g. "2543611550477751"), NOT ATVPD… marketplace codes.
 */
export function bookAmazonProfileIds(book: CreationBookLike | null | undefined): string[] {
  const ids = (book?.marketplaceIds ?? [])
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function profileMatchesAmazonProfileIds(
  profile: ProfileLike,
  amazonProfileIds: string[],
): boolean {
  const ids = new Set(amazonProfileIds.map((id) => String(id).trim()).filter(Boolean));
  if (!ids.size) return false;
  return (
    ids.has(String(profile.profile_id)) ||
    ids.has(profile.id) ||
    // Rare: some payloads put the ads id only on marketplace_id numerically.
    Boolean(profile.marketplace_id && ids.has(profile.marketplace_id))
  );
}

/** @deprecated Use profileMatchesAmazonProfileIds — name was misleading. */
export function profileMatchesMarketplaceIds(
  profile: ProfileLike,
  marketplaceIds: string[],
): boolean {
  return profileMatchesAmazonProfileIds(profile, marketplaceIds);
}

/**
 * Only profiles that Nest already tied to this paperback.
 * Never returns the full profile list when book.marketplaceIds is empty —
 * that leaked unrelated Ads accounts into Create campaign.
 */
export function profilesForBook(
  profiles: ProfileLike[],
  book: CreationBookLike | null | undefined,
): ProfileLike[] {
  const wanted = bookAmazonProfileIds(book);
  if (!wanted.length) return [];
  return profiles.filter((profile) => profileMatchesAmazonProfileIds(profile, wanted));
}

/**
 * Resolve the local Ads profile for a create-marketplace row.
 * Match ONLY by Amazon Ads profile id / local row id — never by shared
 * marketplace codes like ATVPDKIKX0DER (many US accounts share that).
 */
export function matchLocalProfileForCreationMarketplace(
  profiles: ProfileLike[],
  marketplace: Pick<CreationMarketplace, "id" | "profileId">,
): ProfileLike | undefined {
  const adsId = String(marketplace.profileId || "").trim();
  const rowId = String(marketplace.id || "").trim();
  return profiles.find((profile) => {
    const profileAds = String(profile.profile_id || "").trim();
    if (adsId && profileAds && profileAds === adsId) return true;
    if (rowId && profile.id === rowId) return true;
    if (adsId && profile.id === adsId) return true;
    return false;
  });
}

/**
 * Resolve Ads profiles for create.
 * - Prefer live in_stock rows for THIS ASIN among the seller's enabled profiles.
 *   Live is ASIN-specific truth: Nest book-candidates.marketplaceIds can
 *   under-list (Puerto Rico: Mary in candidates, CA in live) or over-list
 *   (Nova Scotia: CA+VP2 candidates, live CA only). Do not require live ⊂
 *   book.marketplaceIds — that intersection emptied the picker while preview
 *   still worked on the live profile.
 * - When live succeeded empty (out of stock / ineligible), return [] — do not
 *   fake creatable profiles (Madrid B0FR8V9TLV) unless `allowSoftFallback`.
 * - Soft-fallback to book.marketplaceIds when Amazon rate-limits / errors, or
 *   when Nest bulk already marked the paperback in_stock and live flaked empty
 *   (Iceland / Vagus) — never invent profiles outside book.marketplaceIds then.
 */
export function marketplacesFromBookProfiles(
  profiles: ProfileLike[],
  book: CreationBookLike | null | undefined,
  live: CreationMarketplace[] = [],
  options: { allowSoftFallback?: boolean } = {},
): CreationMarketplace[] {
  const enabledByAdsId = new Map<string, ProfileLike>();
  for (const profile of profiles) {
    const adsId = String(profile.profile_id || profile.id);
    enabledByAdsId.set(adsId, profile);
    enabledByAdsId.set(profile.id, profile);
  }

  const scoped = profilesForBook(profiles, book);

  const liveHits = live.filter((row) => {
    if (!marketplaceIsCreateChoice(row)) return false;
    const adsId = String(row.profileId || row.id);
    return enabledByAdsId.has(adsId);
  });

  // Soft-fallback means live did not confirm in_stock for this ASIN (caller
  // contract). Prefer book.marketplaceIds only — never let leftover live rows
  // from another ASIN (or empty-evidence ghosts) replace scoped profiles
  // (Puerto Rico must not surface Emilian US).
  if (options.allowSoftFallback) {
    if (!scoped.length) return [];
  } else if (!liveHits.length) {
    return [];
  }

  const sourceProfiles: ProfileLike[] = options.allowSoftFallback
    ? scoped
    : liveHits
        .map((row) => enabledByAdsId.get(String(row.profileId || row.id)))
        .filter((profile): profile is ProfileLike => Boolean(profile));

  // De-dupe while preserving order
  const seen = new Set<string>();
  const uniqueProfiles: ProfileLike[] = [];
  for (const profile of sourceProfiles) {
    const key = String(profile.profile_id || profile.id);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueProfiles.push(profile);
  }

  const liveByAdsId = new Map<string, CreationMarketplace>();
  for (const row of liveHits) {
    liveByAdsId.set(String(row.profileId), row);
    liveByAdsId.set(String(row.id), row);
  }

  return uniqueProfiles.map((profile) => {
    const adsId = String(profile.profile_id || profile.id);
    const hit = liveByAdsId.get(adsId) || liveByAdsId.get(profile.id);
    const soft = Boolean(options.allowSoftFallback) && !hit;
    return {
      id: profile.id,
      // Nest preview/create expect the Amazon Ads profile id.
      profileId: adsId,
      countryCode: hit?.countryCode ?? profile.country_code,
      currencyCode: hit?.currencyCode ?? profile.currency_code,
      marketplaceId: hit?.marketplaceId ?? profile.marketplace_id,
      // Never invent in_stock after a soft fallback — label stays unconfirmed.
      availabilityEvidence: hit?.availabilityEvidence ?? (soft ? "existing_product_ad" : "in_stock"),
      stockStatus: hit?.stockStatus ?? (soft ? null : "IN_STOCK"),
      sku: hit?.sku,
      verificationSource: hit?.verificationSource,
    };
  });
}

/** @deprecated Prefer marketplacesFromBookProfiles. */
export function fallbackMarketplacesFromProfiles(
  profiles: ProfileLike[],
  marketplaceIds: string[] = [],
): CreationMarketplace[] {
  return marketplacesFromBookProfiles(
    profiles,
    { asin: "", marketplaceIds },
    [],
  );
}

/** Amazon Ads profile id to send on preview/create. */
export function resolveCreationProfileId(
  marketplace: Pick<CreationMarketplace, "id" | "profileId"> | null | undefined,
): string {
  if (!marketplace) return "";
  return String(marketplace.profileId || marketplace.id || "").trim();
}

export type CreationExistingCampaignKind =
  | "auto"
  | "keywords"
  | "products"
  | "unknown";

/**
 * Label Auto vs Manual Keywords vs Manual Products/ASINs for create UX.
 * Prefers campaign targeting_type, then ad-group targeting_type hints.
 */
export function classifyCreationCampaignTargeting(input: {
  campaignTargetingType?: string | null;
  adGroupTargetingTypes?: Array<string | null | undefined>;
}): { kind: CreationExistingCampaignKind; label: string } {
  const camp = String(input.campaignTargetingType ?? "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (camp === "auto") return { kind: "auto", label: "Auto" };

  const groups = (input.adGroupTargetingTypes ?? []).map((value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s_-]/g, ""),
  );
  const hasKw = groups.some(
    (n) => n === "keyword" || n === "keywords" || n.includes("keyword"),
  );
  const hasPt = groups.some(
    (n) =>
      n === "product" ||
      n === "products" ||
      n === "asin" ||
      n === "producttarget" ||
      n.includes("product"),
  );
  const hasAuto = groups.some((n) => n === "auto" || n === "autotarget");
  if (hasAuto && !hasKw && !hasPt) return { kind: "auto", label: "Auto" };
  if (hasKw && !hasPt) return { kind: "keywords", label: "Manual · Keywords" };
  if (hasPt && !hasKw) {
    return { kind: "products", label: "Manual · Products / ASINs" };
  }
  if (hasKw && hasPt) {
    return { kind: "unknown", label: "Manual · Keywords + Products" };
  }
  if (camp.includes("keyword")) {
    return { kind: "keywords", label: "Manual · Keywords" };
  }
  if (camp.includes("product") || camp.includes("asin")) {
    return { kind: "products", label: "Manual · Products / ASINs" };
  }
  if (camp === "manual" || camp) {
    return { kind: "unknown", label: "Manual" };
  }
  return { kind: "unknown", label: "Campaign" };
}

export function isRetryableCreationStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function parseCustomAsins(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\n,;\s]+/)
    .map((asin) => asin.trim().toUpperCase())
    .filter((asin) => {
      if (!/^B0[A-Z0-9]{8}$/.test(asin) || seen.has(asin)) return false;
      seen.add(asin);
      return true;
    })
    .slice(0, 200);
}

export function normalizeCampaignCreationPreview(raw: unknown): {
  source: "amazon_ads";
  fetchedAt: string;
  recommendationsAvailable: boolean;
  profile: {
    id: string;
    profileId: string;
    countryCode: string | null;
    currencyCode: string | null;
    marketplaceId: string | null;
  };
  book: {
    asin: string;
    title: string;
    subtitle: string | null;
    author: string | null;
    topic: string | null;
    coverUrl: string | null;
  };
  duplicateAuto: { id: string; name: string; state: string } | null;
  keywords: {
    keyword: string;
    matchType: "broad" | "phrase" | "exact";
    suggestedBid: number | null;
    rangeStart: number | null;
    rangeEnd: number | null;
  }[];
  /**
   * Amazon Ads API keyword rows BEFORE Broad/Phrase/Exact companions.
   * Counts come from the live Nest/Amazon payload for this campaign/ASIN
   * (console Broad-only ≈ phraseCount when Amazon returns one match type).
   */
  amazonKeywordApi: {
    rowCount: number;
    phraseCount: number;
  };
  productTargets: {
    asin: string;
    themes: string[];
    matchType: "exact" | "expanded";
    suggestedBid: number | null;
    title: string | null;
    subtitle: string | null;
    coverUrl: string | null;
    stockStatus: "in_stock" | "out_of_stock" | "unknown" | null;
    publishedAt: string | null;
  }[];
} {
  const root = asRecord(raw) ?? {};
  const nested = asRecord(root.data);
  const body = nested ? { ...root, ...nested } : root;
  const profileRaw = asRecord(body.profile) ?? {};
  const bookRaw = asRecord(body.book) ?? {};
  const dupRaw = asRecord(body.duplicateAuto) ?? asRecord(body.duplicate_auto);
  const keywordsRaw = Array.isArray(body.keywords)
    ? body.keywords
    : Array.isArray(body.keywordSuggestions)
      ? body.keywordSuggestions
      : [];
  const recommendations = asRecord(body.recommendations);
  const productsRaw = Array.isArray(body.productTargets)
    ? body.productTargets
    : Array.isArray(body.product_targets)
      ? body.product_targets
      : Array.isArray(body.productSuggestions)
        ? body.productSuggestions
        : Array.isArray(body.product_suggestions)
          ? body.product_suggestions
          : Array.isArray(body.recommendedProducts)
            ? body.recommendedProducts
            : Array.isArray(body.recommended_products)
              ? body.recommended_products
              : Array.isArray(body.targets)
                ? body.targets
                : Array.isArray(recommendations?.products)
                  ? recommendations!.products
                  : Array.isArray(recommendations?.productTargets)
                    ? recommendations!.productTargets
                    : Array.isArray(body.asins)
                      ? body.asins
                      : [];

  const keywordsMapped = keywordsRaw
    .map((row) => {
      const r = asRecord(row);
      if (!r) return null;
      const keyword = readString(r, ["keyword", "keywordText", "keyword_text"]);
      if (!keyword) return null;
      // Keep the row even when Amazon omits / uses enum-style match codes (CA).
      const matchType = normalizeKeywordMatchType(
        readString(r, ["matchType", "match_type", "matchTypeCode", "match_type_code"]),
      );
      const bid = recommendationBidMajorUnits(r.suggestedBid ?? r.suggested_bid);
      const start = recommendationBidMajorUnits(r.rangeStart ?? r.range_start);
      const end = recommendationBidMajorUnits(r.rangeEnd ?? r.range_end);
      return {
        keyword,
        matchType,
        suggestedBid: bid,
        rangeStart: start,
        rangeEnd: end,
      };
    })
    .filter(Boolean) as {
    keyword: string;
    matchType: "broad" | "phrase" | "exact";
    suggestedBid: number | null;
    rangeStart: number | null;
    rangeEnd: number | null;
  }[];
  // CA/UK often return one match type per phrase — offer Broad/Phrase/Exact
  // companions (never invent keyword text Amazon did not recommend).
  const amazonKeywordApi = {
    rowCount: keywordsMapped.length,
    phraseCount: uniqueKeywordPhraseCount(keywordsMapped),
  };
  const keywords = offerKeywordMatchCompanions(keywordsMapped);

  const productTargetsRaw = productsRaw
    .map((row) => {
      // Nest / Amazon occasionally return bare ASIN strings.
      if (typeof row === "string") {
        const asin = row.trim().toUpperCase();
        if (!asin) return null;
        return {
          asin,
          themes: [] as string[],
          matchType: null as ProductMatchType | null,
          matchTypeExplicit: false,
          suggestedBid: null as number | null,
          title: null as string | null,
          subtitle: null as string | null,
          coverUrl: null as string | null,
          stockStatus: null as "in_stock" | "out_of_stock" | "unknown" | null,
          publishedAt: null as string | null,
        };
      }
      const r = asRecord(row);
      if (!r) return null;
      const asin = readString(r, [
        "asin",
        "recommendedAsin",
        "recommended_asin",
        "targetAsin",
        "target_asin",
        "productAsin",
        "product_asin",
        "asinValue",
        "asin_value",
        "code",
      ]).toUpperCase();
      // Expression arrays: [{ type: "asinSameAs"|"asinExpandedFrom", value }]
      let expressionMatch: string | null = null;
      const expression = r.expression ?? r.expressions ?? r.targetingExpression;
      if (Array.isArray(expression)) {
        for (const item of expression) {
          const er = asRecord(item);
          if (!er) continue;
          const type = readString(er, [
            "type",
            "expressionType",
            "expression_type",
            "matchType",
            "match_type",
          ]);
          if (type) {
            expressionMatch = type;
            break;
          }
        }
      }
      const resolvedAsin =
        asin ||
        (Array.isArray(expression)
          ? expression
              .map((item) => {
                const er = asRecord(item);
                if (!er) return "";
                return readString(er, ["value", "asin", "targetAsin"]).toUpperCase();
              })
              .find((v) => /^[A-Z0-9]{10}$/.test(v)) || ""
          : "");
      if (!resolvedAsin) return null;
      const themesRaw = r.themes ?? r.theme ?? [];
      const themes = Array.isArray(themesRaw)
        ? themesRaw.map((t) => String(t)).filter(Boolean)
        : typeof themesRaw === "string" && themesRaw.trim()
          ? [themesRaw.trim()]
          : [];
      const bid = recommendationBidMajorUnits(
        r.suggestedBid ?? r.suggested_bid ?? r.bid,
      );
      const matchRaw =
        readString(r, [
          "matchType",
          "match_type",
          "expressionType",
          "expression_type",
          "targetType",
          "target_type",
        ]) || expressionMatch || "";
      const matchTypeExplicit = Boolean(String(matchRaw).trim());
      const matchType = parseProductMatchTypeOrNull(matchRaw);
      const title =
        readString(r, [
          "title",
          "productTitle",
          "product_title",
          "name",
          "itemName",
          "item_name",
          "recommendedAsinTitle",
          "asinTitle",
          "asin_title",
          "displayTitle",
          "display_title",
        ]) || null;
      const subtitle =
        readString(r, [
          "subtitle",
          "productSubtitle",
          "product_subtitle",
          "itemSubtitle",
          "item_subtitle",
        ]) || null;
      const coverUrl =
        readString(r, [
          "coverUrl",
          "cover_url",
          "imageUrl",
          "image_url",
          "image",
          "thumbnailUrl",
          "thumbnail_url",
        ]) || null;
      const stockStatus = normalizePreviewStockStatus(
        readString(r, ["stockStatus", "stock_status", "availability"]),
      );
      const publishedAt =
        readString(r, ["publishedAt", "published_at", "publishDate", "publish_date"]) ||
        null;
      return {
        asin: resolvedAsin,
        themes,
        matchType,
        matchTypeExplicit,
        suggestedBid: bid,
        title,
        subtitle,
        coverUrl,
        stockStatus,
        publishedAt,
      };
    })
    .filter(Boolean) as Array<{
    asin: string;
    themes: string[];
    matchType: ProductMatchType | null;
    matchTypeExplicit: boolean;
    suggestedBid: number | null;
    title: string | null;
    subtitle: string | null;
    coverUrl: string | null;
    stockStatus: "in_stock" | "out_of_stock" | "unknown" | null;
    publishedAt: string | null;
  }>;

  // Preserve every distinct entity Amazon returned. When the recommendation
  // API omits a product expression type, keep one row with Exact as the safe
  // creation default. Create UX then offers Expanded companions so both
  // match-type chips appear (never invent ASINs Amazon did not return).
  const productTargets = offerExpandedCompanionsForExactOnly(
    expandProductSuggestionsWithMatchTypes(
      productTargetsRaw.map((row) => ({
        asin: row.asin,
        themes: row.themes,
        matchType: row.matchType,
        suggestedBid: row.suggestedBid,
        title: row.title,
        subtitle: row.subtitle,
        coverUrl: row.coverUrl,
        stockStatus: row.stockStatus,
        publishedAt: row.publishedAt,
        matchTypeExplicit: row.matchTypeExplicit,
      })),
      {
        matchTypeWasExplicit: (row) => Boolean(row.matchTypeExplicit),
      },
    ).map(({ matchTypeExplicit: _explicit, ...row }) => ({
      ...row,
      matchType: row.matchType as ProductMatchType,
    })),
  );

  // Nest `/ad-groups/suggestions` returns top-level asin/profileId (no nested
  // book{} / profile{}). Map those so Groq relevance gets a real advertised ASIN.
  const topLevelAsin = readString(body, ["asin", "advertisedAsin", "advertised_asin"]);
  const topLevelProfileId = readString(body, [
    "profileId",
    "profile_id",
    "amazonProfileId",
    "amazon_profile_id",
  ]);
  const profileId =
    readString(profileRaw, ["profileId", "profile_id", "id"]) ||
    topLevelProfileId ||
    "";
  const bookAsin = readString(bookRaw, ["asin"]) || topLevelAsin || "";
  return {
    source: "amazon_ads",
    fetchedAt: readString(body, ["fetchedAt", "fetched_at"]) || new Date().toISOString(),
    recommendationsAvailable: Boolean(
      body.recommendationsAvailable ?? body.recommendations_available ?? (keywords.length + productTargets.length > 0),
    ),
    profile: {
      id: readString(profileRaw, ["id", "profileId", "profile_id"]) || profileId,
      profileId,
      countryCode: readString(profileRaw, ["countryCode", "country_code"]) || null,
      currencyCode: readString(profileRaw, ["currencyCode", "currency_code"]) || null,
      marketplaceId: readString(profileRaw, ["marketplaceId", "marketplace_id"]) || null,
    },
    book: {
      asin: bookAsin,
      title: readString(bookRaw, ["title"]) || "",
      subtitle:
        readString(bookRaw, ["subtitle", "bookSubtitle", "book_subtitle"]) ||
        null,
      author:
        readString(bookRaw, [
          "author",
          "authors",
          "authorName",
          "author_name",
          "contributor",
        ]) || null,
      topic:
        readString(bookRaw, [
          "topic",
          "topics",
          "category",
          "categories",
          "bisac",
          "genre",
        ]) || null,
      coverUrl: readString(bookRaw, ["coverUrl", "cover_url"]) || null,
    },
    duplicateAuto: dupRaw
      ? {
          id: readString(dupRaw, ["id"]),
          name: readString(dupRaw, ["name"]),
          state: readString(dupRaw, ["state"]),
        }
      : null,
    keywords,
    amazonKeywordApi,
    productTargets,
  };
}
