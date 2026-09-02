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
