import { netRoyalties } from "./netRoyalties.ts";

export type OverviewAdsDay = {
  date: string;
  spend?: number | null;
  sales?: number | null;
};

export type OverviewFinanceDay = {
  date: string;
  royalties: number;
  spend: number;
  net: number;
  sales: number;
};

/**
 * Builds one shared calendar for Gross, Net and Ads spend. A day is included
 * only when its KDP royalty value is known. An absent Ads activity row on a
 * verified KDP day is a real zero-spend day, while an unknown royalty day is
 * excluded rather than painted as zero.
 */
export function buildOverviewFinanceTrend(input: {
  adsDaily: readonly OverviewAdsDay[];
  kdpDates: readonly string[];
  royaltiesForDate: (date: string) => number | null;
  kdpReady: boolean;
}): OverviewFinanceDay[] {
  if (!input.kdpReady) return [];
  const adsByDate = new Map(
    input.adsDaily.map((row) => [String(row.date).slice(0, 10), row] as const),
  );
  const dates = new Set<string>([
    ...input.adsDaily.map((row) => String(row.date).slice(0, 10)),
    ...input.kdpDates.map((date) => String(date).slice(0, 10)),
  ]);
  return [...dates]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((date) => {
      const royalties = input.royaltiesForDate(date);
      if (royalties == null || !Number.isFinite(royalties)) return [];
      const ads = adsByDate.get(date);
      const spend = Number(ads?.spend ?? 0);
      const sales = Number(ads?.sales ?? 0);
      const net = netRoyalties({ kdpRoyalties: royalties, adsSpend: spend });
      if (net == null) return [];
      return [{ date, royalties, spend, net, sales }];
    });
}
