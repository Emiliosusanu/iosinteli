import { formatKdpChartDate } from "./kdpFormatRoyalties.ts";
import { safeDivide } from "./format.ts";

export type AdsEngineTotals = {
  impressions: number;
  clicks: number;
  orders: number;
  acos: number;
};

export type AdsEngineSeries = {
  impressions: Array<{ value: number; label?: string }>;
  clicks: Array<{ value: number; label?: string }>;
  orders: Array<{ value: number; label?: string }>;
  acos: Array<{ value: number; label?: string }>;
  totals: AdsEngineTotals;
};

export function emptyAdsEngineSeries(): AdsEngineSeries {
  return {
    impressions: [],
    clicks: [],
    orders: [],
    acos: [],
    totals: { impressions: 0, clicks: 0, orders: 0, acos: 0 },
  };
}

export function adsEnginePeriodLabel(series: AdsEngineSeries): string {
  const first = series.impressions[0]?.label;
  const last = series.impressions[series.impressions.length - 1]?.label;
  if (first && last && first !== last) return `${first}–${last}`;
  return first || "Period";
}

export function dailyToAdsEngineSeries(
  daily: Array<{ date: string; impressions: number; clicks: number; orders: number; spend: number; sales: number }>,
): AdsEngineSeries {
  let impressions = 0;
  let clicks = 0;
  let orders = 0;
  let spend = 0;
  let sales = 0;
  for (const day of daily) {
    impressions += Number(day.impressions) || 0;
    clicks += Number(day.clicks) || 0;
    orders += Number(day.orders) || 0;
    spend += Number(day.spend) || 0;
    sales += Number(day.sales) || 0;
  }
  return {
    impressions: daily.map((m) => ({ value: m.impressions, label: formatKdpChartDate(m.date) })),
    clicks: daily.map((m) => ({ value: m.clicks, label: formatKdpChartDate(m.date) })),
    orders: daily.map((m) => ({ value: m.orders, label: formatKdpChartDate(m.date) })),
    acos: daily.map((m) => ({
      value: safeDivide(m.spend, m.sales) * 100,
      label: formatKdpChartDate(m.date),
    })),
    totals: {
      impressions,
      clicks,
      orders,
      acos: safeDivide(spend, sales) * 100,
    },
  };
}
