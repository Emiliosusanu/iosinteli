/**
 * KDP royalty format mix (Paperback / KU / Kindle) for Overview charts.
 * Sourced from kdp_book_daily_data format columns written by the KDP helper.
 */

export type KdpFormatRoyaltyDay = {
  date: string;
  paperback: number;
  ku: number;
  kindle: number;
  total: number;
};

export type KdpFormatRoyaltyRange = {
  hasKdpData: boolean;
  hasFormatData: boolean;
  paperback: number;
  ku: number;
  kindle: number;
  total: number;
  daily: KdpFormatRoyaltyDay[];
};

export type KdpFormatBookDailyRow = {
  date?: string | null;
  royalties?: unknown;
  ebook_royalties?: unknown;
  paperback_royalties?: unknown;
  kenp_royalties?: unknown;
};

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function emptyKdpFormatRoyaltyRange(): KdpFormatRoyaltyRange {
  return {
    hasKdpData: false,
    hasFormatData: false,
    paperback: 0,
    ku: 0,
    kindle: 0,
    total: 0,
    daily: [],
  };
}

/** Aggregate book-day format columns into account-day mix series. */
export function aggregateKdpFormatRoyalties(
  rows: readonly KdpFormatBookDailyRow[],
): KdpFormatRoyaltyRange {
  const byDate = new Map<string, KdpFormatRoyaltyDay>();
  let formatColumnSum = 0;

  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
    if (!date) continue;
    const paperback = money(row.paperback_royalties);
    const ku = money(row.kenp_royalties);
    const kindle = money(row.ebook_royalties);
    const rowRoyalties = money(row.royalties);
    formatColumnSum += paperback + ku + kindle;

    const current = byDate.get(date) ?? {
      date,
      paperback: 0,
      ku: 0,
      kindle: 0,
      total: 0,
    };
    current.paperback += paperback;
    current.ku += ku;
    current.kindle += kindle;
    // Prefer format sum when present; otherwise fall back to total royalties.
    const formatTotal = paperback + ku + kindle;
    current.total += formatTotal > 0 ? formatTotal : rowRoyalties;
    byDate.set(date, current);
  }

  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const paperback = daily.reduce((sum, day) => sum + day.paperback, 0);
  const ku = daily.reduce((sum, day) => sum + day.ku, 0);
  const kindle = daily.reduce((sum, day) => sum + day.kindle, 0);
  const formatTotal = paperback + ku + kindle;
  const total = formatTotal > 0 ? formatTotal : daily.reduce((sum, day) => sum + day.total, 0);
  const hasKdpData = daily.length > 0 && total > 0;
  const hasFormatData = hasKdpData && formatColumnSum > 0;

  return {
    hasKdpData,
    hasFormatData,
    paperback,
    ku,
    kindle,
    total,
    daily: hasFormatData
      ? daily
      : daily.map((day) => ({
          ...day,
          paperback: 0,
          ku: 0,
          kindle: 0,
        })),
  };
}

export function formatSharePct(part: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(part)) return 0;
  return (part / total) * 100;
}

/** Chart axis label matching web MM-DD style. */
export function formatKdpChartDate(iso: string): string {
  const date = String(iso || "").slice(0, 10);
  if (date.length >= 10) return date.slice(5);
  return date;
}
