import { formatKdpChartDate } from "./kdpFormatRoyalties.ts";
import { safeDivide } from "./format.ts";

export type AdsEngineTotals = {
  impressions: number;
  clicks: number;
  orders: number;
  /** Period ACoS only when sales > 0. Never invent 0% from spend/0. */
  acos: number | null;
};

export type AdsEngineSeries = {
  impressions: Array<{ value: number; label?: string }>;
  clicks: Array<{ value: number; label?: string }>;
  orders: Array<{ value: number; label?: string }>;
  /** Day ACoS points carry `sales` so the chart can refuse fake 0%. */
  acos: Array<{ value: number; label?: string; sales?: number }>;
  totals: AdsEngineTotals;
};

export function emptyAdsEngineSeries(): AdsEngineSeries {
  return {
    impressions: [],
    clicks: [],
    orders: [],
    acos: [],
    totals: { impressions: 0, clicks: 0, orders: 0, acos: null },
  };
}

export function adsEnginePeriodLabel(series: AdsEngineSeries): string {
  const first = series.impressions[0]?.label;
  const last = series.impressions[series.impressions.length - 1]?.label;
  if (first && last && first !== last) return `${first}–${last}`;
  return first || "Period";
}

/** Honest period / day ACoS — null when sales are 0 (never paint 0% from safeDivide). */
export function adsEngineAcosValue(spend: number, sales: number): number | null {
  if (!(sales > 0)) return null;
  const acos = safeDivide(spend, sales) * 100;
  return Number.isFinite(acos) ? acos : null;
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
    acos: daily.map((m) => {
      const daySales = Number(m.sales) || 0;
      const dayAcos = adsEngineAcosValue(Number(m.spend) || 0, daySales);
      return {
        // Chart needs a finite y; 0 sits on the floor when ACoS is unknown — readout uses —.
        value: dayAcos ?? 0,
        label: formatKdpChartDate(m.date),
        sales: daySales,
      };
    }),
    totals: {
      impressions,
      clicks,
      orders,
      acos: adsEngineAcosValue(spend, sales),
    },
  };
}
