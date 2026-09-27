/**
 * Logical KDP book identity for seller-scope Book Detail.
 *
 * Kindle ASIN is the stable anchor when the current group_key encodes it.
 * Sibling formats are included only when they share that proven group_key.
 * Action-label titles are never used as identity evidence.
 */

export type KdpDailyIdentityRow = {
  asin?: string | null;
  group_key?: string | null;
};

function normalizeAsin(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeGroupKey(value: unknown): string {
  return String(value ?? "").trim();
}

export function groupKeysForOpenedAsin(
  openedAsin: string,
  rows: KdpDailyIdentityRow[],
): string[] {
  const opened = normalizeAsin(openedAsin);
  if (!opened) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    if (normalizeAsin(row.asin) !== opened) continue;
    const key = normalizeGroupKey(row.group_key);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

export function logicalBookAsinsFromDailyRows(
  openedAsin: string,
  rows: KdpDailyIdentityRow[],
): string[] {
  const opened = normalizeAsin(openedAsin);
  if (!opened) return [];

  const keys = new Set(groupKeysForOpenedAsin(opened, rows));
  const asins = new Set<string>([opened]);
  if (!keys.size) return [opened];

  for (const row of rows) {
    const key = normalizeGroupKey(row.group_key);
    const asin = normalizeAsin(row.asin);
    if (key && keys.has(key) && asin) asins.add(asin);
  }
  return Array.from(asins);
}

export function asinBelongsToLogicalBook(value: unknown, bookAsins: Iterable<string>): boolean {
  const asin = normalizeAsin(value);
  if (!asin) return false;
  for (const candidate of bookAsins) {
    if (normalizeAsin(candidate) === asin) return true;
  }
  return false;
}

/**
 * Build only unambiguous ASIN → group mappings from royalty rows.
 * Conflicting historical groups are omitted instead of merging unrelated books.
 */
export function verifiedAsinGroupsFromDailyRows(
  rows: readonly KdpDailyIdentityRow[],
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    const asin = normalizeAsin(row.asin);
    const groupKey = normalizeGroupKey(row.group_key);
    if (!asin || !groupKey) continue;
    const keys = candidates.get(asin) ?? new Set<string>();
    keys.add(groupKey);
    candidates.set(asin, keys);
  }
  const verified = new Map<string, string>();
  for (const [asin, keys] of candidates) {
    if (keys.size === 1) verified.set(asin, keys.values().next().value!);
  }
  return verified;
}

export type KdpCatalogIdentityRow = {
  account_id?: string | null;
  book_id?: string | null;
  asin?: string | null;
};

/**
 * Format catalog identity is server-owned: sibling ASINs may be grouped only
 * when they share the same KDP account and book id.
 */
export function verifiedKdpBookCatalog(rows: readonly KdpCatalogIdentityRow[]): {
  asinToGroup: Map<string, string>;
  asinsByGroup: Map<string, string[]>;
} {
  const candidates = new Map<string, Set<string>>();
  const asinsByGroup = new Map<string, Set<string>>();
  for (const row of rows) {
    const accountId = String(row.account_id ?? "").trim();
    const bookId = String(row.book_id ?? "").trim();
    const asin = normalizeAsin(row.asin);
    if (!accountId || !bookId || !asin) continue;
    const groupKey = `KDP:${accountId}:${bookId}`;
    const groups = candidates.get(asin) ?? new Set<string>();
    groups.add(groupKey);
    candidates.set(asin, groups);
    const asins = asinsByGroup.get(groupKey) ?? new Set<string>();
    asins.add(asin);
    asinsByGroup.set(groupKey, asins);
  }

  const asinToGroup = new Map<string, string>();
  for (const [asin, groups] of candidates) {
    if (groups.size === 1) asinToGroup.set(asin, groups.values().next().value!);
  }
  return {
    asinToGroup,
    asinsByGroup: new Map(
      [...asinsByGroup].map(([key, asins]) => [
        key,
        [...asins].filter((asin) => asinToGroup.get(asin) === key),
      ]),
    ),
  };
}

/** Resolve an advertised ASIN only through verified KDP identity evidence. */
export function logicalBookKeyForAdvertisedAsin(
  asin: unknown,
  asinToGroup: ReadonlyMap<string, string>,
): string | null {
  const normalized = normalizeAsin(asin);
  return normalized ? asinToGroup.get(normalized) ?? null : null;
}

export type CampaignBookIdentityRow = {
  campaign_id?: string | null;
  asin?: string | null;
  sku?: string | null;
};

/**
 * Campaign totals may stand in for product-ad metrics only for a proven
 * single-logical-book campaign. Any unresolved or conflicting advertised ASIN
 * invalidates that campaign fallback.
 */
export function verifiedCampaignLogicalBooks(
  rows: readonly CampaignBookIdentityRow[],
  asinToGroup: ReadonlyMap<string, string>,
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  const invalid = new Set<string>();
  for (const row of rows) {
    const campaignId = String(row.campaign_id ?? "").trim();
    if (!campaignId) continue;
    const advertisedAsin = normalizeAsin(row.asin ?? row.sku);
    if (!advertisedAsin) {
      invalid.add(campaignId);
      continue;
    }
    const groupKey = logicalBookKeyForAdvertisedAsin(advertisedAsin, asinToGroup);
    if (!groupKey) {
      invalid.add(campaignId);
      continue;
    }
    const groups = candidates.get(campaignId) ?? new Set<string>();
    groups.add(groupKey);
    candidates.set(campaignId, groups);
  }
  const verified = new Map<string, string>();
  for (const [campaignId, groups] of candidates) {
    if (!invalid.has(campaignId) && groups.size === 1) {
      verified.set(campaignId, groups.values().next().value!);
    }
  }
  return verified;
}

/** Kindle/DIGITAL ASIN is the stable list/detail anchor when the group_key encodes it. */
export function primaryAsinFromGroupKey(groupKey: string, fallbackAsins: Iterable<string> = []): string {
  const key = normalizeGroupKey(groupKey);
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

/**
 * Expand sibling ASINs from `kdp_book_formats` without replacing proven
 * DIGITAL=/PRINT= daily group keys.
 *
 * Blindly overwriting with `KDP:account:book_id` splits parent formats when
 * Kindle and paperback have different catalog book ids — KU/ebook royalties
 * stay on the digital ASIN while Books shows the print card alone.
 */
export function mergeCatalogIntoDailyAsinGroups(
  dailyAsinToGroup: ReadonlyMap<string, string>,
  catalog: {
    asinToGroup: ReadonlyMap<string, string>;
    asinsByGroup: ReadonlyMap<string, readonly string[]>;
  },
): Map<string, string> {
  const merged = new Map(dailyAsinToGroup);

  for (const [, catalogAsins] of catalog.asinsByGroup) {
    let preferredDaily: string | null = null;
    for (const asin of catalogAsins) {
      const daily = dailyAsinToGroup.get(normalizeAsin(asin));
      if (daily) {
        preferredDaily = daily;
        break;
      }
    }
    for (const rawAsin of catalogAsins) {
      const asin = normalizeAsin(rawAsin);
      if (!asin || merged.has(asin)) continue;
      if (preferredDaily) {
        merged.set(asin, preferredDaily);
        continue;
      }
      const catalogKey = catalog.asinToGroup.get(asin);
      if (catalogKey) merged.set(asin, catalogKey);
    }
  }

  // Catalog ASINs not covered by asinsByGroup (should be rare) — fill gaps only.
  for (const [asin, catalogKey] of catalog.asinToGroup) {
    if (!merged.has(asin)) merged.set(asin, catalogKey);
  }

  return merged;
}

export function bookRowMatchesOpenedAsin(
  row: { asin?: string | null; sku?: string | null; book_key?: string | null },
  openedAsin: string,
): boolean {
  const opened = normalizeAsin(openedAsin);
  if (!opened) return false;
  if (normalizeAsin(row.asin) === opened || normalizeAsin(row.sku) === opened) return true;
  const bookKey = String(row.book_key ?? "").toUpperCase();
  if (!bookKey) return false;
  if (bookKey === opened) return true;
  return (
    bookKey.includes(`=${opened}:`) ||
    bookKey.includes(`=${opened}::`) ||
    bookKey.endsWith(`=${opened}`)
  );
}
