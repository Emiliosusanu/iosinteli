export const BOOK_COLOR_PALETTE = [
  "#0A84FF",
  "#34C759",
  "#FF9500",
  "#FF2D55",
  "#00A6A6",
  "#AF52DE",
  "#5856D6",
  "#FF6B35",
  "#30B0C7",
  "#64D2FF",
];

export function normalizeBookColorKey(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

export function bookColorKeyFor(item: {
  book_key?: string | null;
  book_asin?: string | null;
  asin?: string | null;
  sku?: string | null;
  title?: string | null;
  book_title?: string | null;
}) {
  return normalizeBookColorKey(
    item.book_key ??
      item.book_asin ??
      item.asin ??
      item.sku ??
      item.book_title ??
      item.title,
  );
}

export function hashBookKey(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function fallbackBookColor(key: string, fallbackIndex = 0) {
  const seed = key ? hashBookKey(key) : fallbackIndex;
  return BOOK_COLOR_PALETTE[seed % BOOK_COLOR_PALETTE.length];
}

export function buildBookColorMap(keys: string[]) {
  const map = new Map<string, string>();
  const used = new Set<string>();

  for (const rawKey of keys) {
    const key = normalizeBookColorKey(rawKey);
    if (!key || map.has(key)) continue;

    let index = hashBookKey(key) % BOOK_COLOR_PALETTE.length;
    for (let attempts = 0; attempts < BOOK_COLOR_PALETTE.length; attempts += 1) {
      const color = BOOK_COLOR_PALETTE[index];
      if (!used.has(color)) {
        map.set(key, color);
        used.add(color);
        break;
      }
      index = (index + 1) % BOOK_COLOR_PALETTE.length;
    }

    if (!map.has(key)) map.set(key, fallbackBookColor(key));
  }

  return map;
}
