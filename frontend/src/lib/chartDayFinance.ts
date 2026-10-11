/**
 * Overview Net chart scrub finance — date-aligned, never invent $0 / period totals.
 *
 * Index-aligned royalties/spend series can diverge (royalty-only days vs Ads days).
 * Missing day values stay null so hero paints "—", not a fake zero or period latch.
 */

import { netRoyalties, type MoneyLike } from "./netRoyalties.ts";

export type ChartDayPoint = {
  value?: number | null;
  label?: string;
  date?: string;
  sales?: number | null;
};

export type ChartDaySeriesPoint = {
  date?: string;
  value?: number | null;
};

export type ResolvedChartDayFinance = {
  index: number;
  label?: string;
  date?: string;
  net: number | null;
  royalties: number | null;
  spend: number | null;
  sales: number | null;
};

function finiteOrNull(value: MoneyLike): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Match overlay series by calendar day — never by parallel index. */
export function seriesValueOnDate(
  series: readonly ChartDaySeriesPoint[] | null | undefined,
  date: string | undefined,
): number | null {
  const day = String(date ?? "").slice(0, 10);
  if (!day || !series?.length) return null;
  const hit = series.find((point) => String(point.date ?? "").slice(0, 10) === day);
  return finiteOrNull(hit?.value);
}

/**
 * Build scrub finance for hero Gross / Net / Ad spend.
 * Does not fall back to period totals or coerce missing → 0.
 */
export function resolveChartDayFinance(input: {
  index: number;
  netPoint?: ChartDayPoint | null;
  royaltiesSeries?: readonly ChartDaySeriesPoint[] | null;
  spendSeries?: readonly ChartDaySeriesPoint[] | null;
}): ResolvedChartDayFinance {
  const date = input.netPoint?.date;
  const royalties = seriesValueOnDate(input.royaltiesSeries, date);
  const spend = seriesValueOnDate(input.spendSeries, date);
  const sales = finiteOrNull(input.netPoint?.sales);
  const netFromPoint = finiteOrNull(input.netPoint?.value);
  const net =
    netFromPoint ??
    netRoyalties({ kdpRoyalties: royalties, adsSpend: spend });
  return {
    index: input.index,
    label: input.netPoint?.label,
    date,
    net,
    royalties,
    spend,
    sales,
  };
}
