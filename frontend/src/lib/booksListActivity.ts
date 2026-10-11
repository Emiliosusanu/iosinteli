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
): { title: string; subtitle: string; actionLabel?: string } {
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
      subtitle: "Import royalties with Chrome on a computer or the iPhone helper.",
      actionLabel: "Set up royalties",
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

type BookIdentityRow = {
  book_key?: string | null;
  asin?: string | null;
  sku?: string | null;
};

type CatalogBookRow = BookIdentityRow & {
  title?: string | null;
  image_url?: string | null;
  royalties?: number | null;
  kdp_orders?: number | null;
  spend?: number | null;
  sales?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  orders?: number | null;
  acos?: number | null;
  roas?: number | null;
  net?: number | null;
  /** Calculator / Nest break-even % — preserve across merges (0 is missing). */
  breakeven_acos?: number | null;
  format_asins?: readonly string[] | null;
  sponsorable?: boolean;
  has_campaign?: boolean;
  in_stock?: boolean;
  has_format_activity?: boolean;
  published_at?: string | null;
  first_seen_at?: string | null;
  created_at?: string | null;
};

/** Prefer a real calculator BE; Nest often sends 0 which must not wipe local pricing. */
export function preferAuthoritativeBreakEven(
  base: unknown,
  overlay: unknown,
): number {
  const overlayN = Number(overlay);
  const baseN = Number(base);
  if (Number.isFinite(overlayN) && overlayN > 0 && overlayN < 200) return overlayN;
  if (Number.isFinite(baseN) && baseN > 0 && baseN < 200) return baseN;
  return 0;
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function identityAsinsForBookRow(row: BookIdentityRow & { format_asins?: readonly string[] | null }): string[] {
  const identities = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeIdentity(value);
    if (normalized) identities.add(normalized);
  };
  add(row.asin);
  add(row.sku);
  for (const formatAsin of row.format_asins ?? []) add(formatAsin);
  const key = normalizeIdentity(row.book_key);
  if (key) {
    if (/^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(key)) add(key);
    for (const match of key.matchAll(/(?:^|[=:])((?:B0[A-Z0-9]{8}|\d{9}[\dX]))(?=$|[:])/g)) {
      add(match[1]);
    }
  }
  return [...identities];
}

function editionYear(title: string | null | undefined): number {
  const years = String(title ?? "").match(/\b20\d{2}\b/g) ?? [];
  return years.reduce((latest, value) => Math.max(latest, Number(value) || 0), 0);
}

function coverForPreferredEdition<T extends { title?: string | null; image_url?: string | null; in_stock?: boolean }>(
  rows: readonly T[],
): string | null {
  return pickFirstCover([...rows]
    .filter((row) => String(row.image_url ?? "").trim())
    .sort((a, b) => editionYear(b.title) - editionYear(a.title) || Number(!!b.in_stock) - Number(!!a.in_stock))
    .map((row) => row.image_url));
}

/** Keep stable copy unless the candidate is a clearly newer edition. */
export function preferEditionTitle(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  const a = String(current ?? "").trim();
  const b = String(candidate ?? "").trim();
  if (!a) return b || null;
  if (!b) return a;
  const aYear = editionYear(a);
  const bYear = editionYear(b);
  return bYear > aYear ? b : a;
}

function preferEvidenceMetric(base: unknown, overlay: unknown): number {
  const baseN = Number(base) || 0;
  const overlayN = Number(overlay) || 0;
  // Nest break-even rows often hard-zero impr/clicks/royalties. Never let a
  // zero overlay wipe real local KDP/Ads evidence.
  if (overlayN !== 0) return overlayN;
  return baseN;
}

function preferEvidenceRoyalties(base: unknown, overlay: unknown): number | null {
  const baseEmpty = base == null || base === "";
  const overlayEmpty = overlay == null || overlay === "";
  const baseN = baseEmpty ? null : Number(base);
  const overlayN = overlayEmpty ? null : Number(overlay);
  const baseVal = baseN != null && !Number.isNaN(baseN) ? baseN : null;
  const overlayVal = overlayN != null && !Number.isNaN(overlayN) ? overlayN : null;
  if (overlayVal != null && overlayVal !== 0) return overlayVal;
  if (baseVal != null && baseVal !== 0) return baseVal;
  if (overlayVal != null) return overlayVal;
  return baseVal;
}

/**
 * Overlay period metrics onto the complete Nest/KDP shelf by verified identity.
 * Catalog metadata remains available for zero-signal rows.
 * Metric fields prefer non-zero evidence from either side so Nest zeros cannot
 * clobber local KDP/Ads (impressions/clicks/royalties/spend).
 */
export function mergeTopBookCatalogRows<T extends CatalogBookRow>(
  catalogRows: readonly T[],
  periodRows: readonly T[],
): T[] {
  const identityToCatalog = new Map<string, number>();
  catalogRows.forEach((row, index) => {
    for (const identity of identityAsinsForBookRow(row)) {
      if (!identityToCatalog.has(identity)) identityToCatalog.set(identity, index);
    }
  });

  const merged = catalogRows.map((row) => ({ ...row }));
  const consumedPeriod = new Set<number>();
  periodRows.forEach((period, periodIndex) => {
    const catalogIndex = identityAsinsForBookRow(period)
      .map((identity) => identityToCatalog.get(identity))
      .find((index): index is number => index !== undefined);
    if (catalogIndex === undefined) return;
    const catalog = merged[catalogIndex];
    const formatAsins = new Set<string>([
      ...identityAsinsForBookRow(catalog),
      ...identityAsinsForBookRow(period),
    ]);
    const royalties = preferEvidenceRoyalties(catalog.royalties, period.royalties);
    const spend = preferEvidenceMetric(catalog.spend, period.spend);
    const sales = preferEvidenceMetric(catalog.sales, period.sales);
    const impressions = preferEvidenceMetric(catalog.impressions, period.impressions);
    const clicks = preferEvidenceMetric(catalog.clicks, period.clicks);
    const orders = preferEvidenceMetric(catalog.orders, period.orders);
    const kdpOrders = preferEvidenceMetric(
      (catalog as { kdp_orders?: number | null }).kdp_orders,
      (period as { kdp_orders?: number | null }).kdp_orders,
    );
    const acos =
      sales > 0
        ? (spend / sales) * 100
        : preferEvidenceMetric(
            (catalog as { acos?: number | null }).acos,
            (period as { acos?: number | null }).acos,
          );
    const roas = spend > 0 ? sales / spend : null;
    const net =
      royalties != null
        ? royalties - spend
        : ((catalog as { net?: number | null }).net ??
          (period as { net?: number | null }).net ??
          null);
    const breakeven_acos = preferAuthoritativeBreakEven(
      catalog.breakeven_acos,
      period.breakeven_acos,
    );
    merged[catalogIndex] = {
      ...catalog,
      ...period,
      book_key: catalog.book_key || period.book_key,
      asin: catalog.asin || period.asin,
      sku: catalog.sku ?? period.sku,
      format_asins: [...formatAsins],
      title: preferEditionTitle(catalog.title, period.title),
      image_url: coverForPreferredEdition([catalog, period]),
      royalties,
      spend,
      sales,
      impressions,
      clicks,
      orders,
      kdp_orders: kdpOrders,
      acos,
      roas,
      net,
      breakeven_acos,
      sponsorable: Boolean(catalog.sponsorable || period.sponsorable),
      has_campaign: Boolean(catalog.has_campaign || period.has_campaign),
      in_stock: Boolean(catalog.in_stock || period.in_stock),
      published_at: catalog.published_at ?? period.published_at,
      has_format_activity: Boolean(
        catalog.has_format_activity ||
          period.has_format_activity ||
          (royalties != null && royalties !== 0) ||
          kdpOrders > 0,
      ),
    } as T;
    consumedPeriod.add(periodIndex);
  });

  periodRows.forEach((row, index) => {
    if (!consumedPeriod.has(index)) merged.push({ ...row });
  });
  return merged;
}

export function annotateBooksListVisibility<T extends CatalogBookRow>(
  rows: readonly T[],
  identity: {
    sponsorableAsins: ReadonlySet<string>;
    inStockAsins: ReadonlySet<string>;
    campaignAsins: ReadonlySet<string>;
  },
): Array<T & Required<Pick<CatalogBookRow, "sponsorable" | "in_stock" | "has_campaign" | "has_format_activity">>> {
  return rows.map((row) => {
    const asins = identityAsinsForBookRow(row);
    const has = (set: ReadonlySet<string>) => asins.some((asin) => set.has(asin));
    return {
      ...row,
      sponsorable: Boolean(row.sponsorable || has(identity.sponsorableAsins)),
      in_stock: Boolean(row.in_stock || has(identity.inStockAsins)),
      has_campaign: Boolean(row.has_campaign || has(identity.campaignAsins)),
      has_format_activity: Boolean(
        row.has_format_activity ||
          (Number(row.royalties) || 0) !== 0 ||
          (Number(row.kdp_orders) || 0) > 0,
      ),
    };
  });
}

function pickFirstCover(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const url = String(candidate ?? "").trim();
    if (url) return url;
  }
  return null;
}

/**
 * KDP royalties/units, Ads period metrics, or an enabled Ads campaign.
 * Not stock-only / recently-published Create shelf noise.
 *
 * Bare `has_campaign` is intentional: campaignOnlyShelf + annotateBooksListVisibility
 * only stamp it from enabled product ads / campaigns. Quiet editions (e.g. Nova
 * Scotia with $0 in range) must still appear when they are advertised.
 */
export function bookHasKdpOrAdsEvidence(row: CatalogBookRow): boolean {
  if (row.has_format_activity === true) return true;
  if (row.has_campaign === true) return true;
  const royalties = Number(row.royalties) || 0;
  const kdpOrders = Number(row.kdp_orders) || 0;
  if (royalties !== 0 || kdpOrders > 0) return true;
  return bookHasSignalInRange({
    book_key: String(row.book_key ?? ""),
    asin: String(row.asin ?? ""),
    sku: row.sku ?? null,
    royalties: null,
    orders: Number(row.orders) || 0,
    spend: Number(row.spend) || 0,
    sales: Number(row.sales) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
  });
}

/**
 * Books visibility: KDP activity, Ads metrics, or live campaign in scope.
 * In-stock / recently-published alone is not enough (Create shelf noise).
 */
export function filterBooksListVisibility<T extends CatalogBookRow>(
  rows: readonly T[],
  _now = new Date(),
): T[] {
  void _now;
  return rows.filter((row) => bookHasKdpOrAdsEvidence(row));
}

function sumNum(...values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (Number(value) || 0), 0);
}

/**
 * Collapse Kindle/paperback/hardcover/audiobook siblings that share identity
 * into one card and sum Ads + KDP metrics. Nest often emits one row per ASIN.
 */
export function collapseTopBooksByFormatGroup<T extends CatalogBookRow>(rows: readonly T[]): T[] {
  if (rows.length <= 1) return [...rows];

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
    for (const identity of identityAsinsForBookRow(row)) {
      const prior = identityIndex.get(identity);
      if (prior == null) identityIndex.set(identity, index);
      else unite(prior, index);
    }
    const key = normalizeIdentity(row.book_key);
    if (key && !/^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(key)) {
      const prior = identityIndex.get(`KEY:${key}`);
      if (prior == null) identityIndex.set(`KEY:${key}`, index);
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
    for (const row of bucket) {
      for (const identity of identityAsinsForBookRow(row)) formatAsins.add(identity);
    }
    const preferred =
      bucket.find((row) => String(row.book_key ?? "").includes("KDP:")) ??
      bucket.find((row) => /DIGITAL=|PRINT=/i.test(String(row.book_key ?? ""))) ??
      bucket[0];
    const royalties = (() => {
      const kdpBucket = bucket.filter(
        (row) =>
          String(row.book_key ?? "").includes("KDP:") ||
          /DIGITAL=|PRINT=/i.test(String(row.book_key ?? "")),
      );
      const source = kdpBucket.length ? kdpBucket : bucket;
      return source.reduce<number | null>((acc, row) => {
        if (row.royalties == null) return acc;
        return (acc ?? 0) + Number(row.royalties);
      }, null);
    })();
    const spend = sumNum(...bucket.map((row) => row.spend));
    const sales = sumNum(...bucket.map((row) => row.sales));
    const orders = sumNum(...bucket.map((row) => row.orders));
    const impressions = sumNum(...bucket.map((row) => row.impressions));
    const clicks = sumNum(...bucket.map((row) => row.clicks));
    const kdpOrders = sumNum(...bucket.map((row) => row.kdp_orders));
    let title = preferred.title ?? null;
    for (const row of bucket) title = preferEditionTitle(title, row.title);
    const acos = sales > 0 ? (spend / sales) * 100 : Number((preferred as { acos?: number }).acos) || 0;
    const roas = spend > 0 ? sales / spend : Number((preferred as { roas?: number | null }).roas) || 0;
    const net =
      royalties == null
        ? null
        : royalties - spend;
    const breakeven_acos = bucket.reduce(
      (best, row) => preferAuthoritativeBreakEven(best, row.breakeven_acos),
      0,
    );
    return {
      ...preferred,
      title,
      image_url: coverForPreferredEdition(bucket),
      format_asins: [...formatAsins],
      royalties,
      kdp_orders: kdpOrders,
      spend,
      sales,
      orders,
      impressions,
      clicks,
      acos,
      roas,
      net,
      breakeven_acos,
      has_campaign: bucket.some((row) => row.has_campaign === true),
      has_format_activity: bucket.some((row) => row.has_format_activity === true),
      in_stock: bucket.some((row) => row.in_stock === true),
      sponsorable: bucket.some((row) => row.sponsorable === true),
    } as T;
  });
}
