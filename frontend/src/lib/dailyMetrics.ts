import type { CampaignMetric } from "./types";
import { convertAdsAmount } from "./fxRates.ts";

export function aggregateDailyMetrics(rows: CampaignMetric[]) {
  return aggregateDailyMetricsForDisplay(rows);
}

/**
 * Daily rollup for Overview / Books money displays.
 * When `moneyProfileIds` is set, spend/sales AND counts (impr/clicks/orders)
 * stay on that set.
 *
 * When `displayCurrency` is USD and `fxRates` + `profileCurrencyById` are set,
 * foreign marketplace spend/sales are converted via market FX before summing
 * (same day rate for spend and sales). Counts stay unconverted.
 *
 * Empty `moneyProfileIds` (Ads selected but none enabled/money-eligible)
 * must withhold all metrics — never fall back to summing every tagged profile.
 * Omit `moneyProfileIds` (undefined) to keep the legacy all-rows sum.
 */
export function aggregateDailyMetricsForDisplay(
  rows: CampaignMetric[],
  opts?: {
    moneyProfileIds?: readonly string[];
    displayCurrency?: string;
    profileCurrencyById?: ReadonlyMap<string, string> | Record<string, string>;
    fxRates?: Map<string, number>;
  },
) {
  const tagged = rows.some((row) => row.amazon_profile_id);
  // null = no isolation; Set (possibly empty) = only those ids contribute.
  const moneySet =
    tagged && opts?.moneyProfileIds != null ? new Set(opts.moneyProfileIds) : null;
  const display = String(opts?.displayCurrency || "").trim().toUpperCase() || null;
  const fxRates = opts?.fxRates;
  const currencyById = opts?.profileCurrencyById;
  const currencyOf = (profileId: string | null | undefined): string | null => {
    const id = String(profileId || "").trim();
    if (!id || !currencyById) return null;
    if (currencyById instanceof Map) return currencyById.get(id) ?? null;
    return currencyById[id] ?? null;
  };

  const map = new Map<string, { date: string; spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  for (const r of rows) {
    const d = r.date;
    const existing = map.get(d) ?? { date: d, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    const include =
      !moneySet || (r.amazon_profile_id != null && moneySet.has(r.amazon_profile_id));
    if (include) {
      let spend = Number(r.spend) || 0;
      let sales = Number(r.sales) || 0;
      if (display === "USD" && fxRates && fxRates.size > 0) {
        const from = currencyOf(r.amazon_profile_id);
        if (from && from !== "USD") {
          const cSpend = convertAdsAmount(spend, d, from, "USD", fxRates);
          const cSales = convertAdsAmount(sales, d, from, "USD", fxRates);
          // Fail closed for this row when rate missing — do not mix native CAD into USD.
          if (cSpend == null || cSales == null) {
            map.set(d, existing);
            continue;
          }
          spend = cSpend;
          sales = cSales;
        }
      }
      existing.spend += spend;
      existing.sales += sales;
      existing.orders += Number(r.orders) || 0;
      existing.clicks += Number(r.clicks) || 0;
      existing.impressions += Number(r.impressions) || 0;
    }
    map.set(d, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
