/**
 * Client-side market FX helpers (Frankfurter/ECB rates from Nest-populated
 * `fx_daily_rates`). Ads-only — never rewrite native campaign_metrics rows.
 * Not Amazon console FX.
 */

export type FxRateRow = {
  rate_date: string;
  from_currency: string;
  to_currency: string;
  rate: number;
};

export function normalizeFxCurrency(value: string | null | undefined): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function addFxCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function fxRateKey(rateDate: string, fromCurrency: string, toCurrency: string): string {
  return `${rateDate}|${fromCurrency}|${toCurrency}`;
}

export function buildFxRateMap(rows: readonly FxRateRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const from = normalizeFxCurrency(row.from_currency);
    const to = normalizeFxCurrency(row.to_currency);
    const date = String(row.rate_date ?? "").slice(0, 10);
    const rate = Number(row.rate);
    if (!from || !to || !date || !(rate > 0)) continue;
    map.set(fxRateKey(date, from, to), rate);
  }
  return map;
}

export function lookupFxRate(
  rates: Map<string, number>,
  date: string,
  fromCurrency: string,
  toCurrency: string,
  maxLookback = 10,
): number | null {
  const from = normalizeFxCurrency(fromCurrency);
  const to = normalizeFxCurrency(toCurrency);
  if (!from || !to) return null;
  if (from === to) return 1;
  for (let i = 0; i <= maxLookback; i++) {
    const day = addFxCalendarDays(date, -i);
    const direct = rates.get(fxRateKey(day, from, to));
    if (direct != null && direct > 0) return direct;
    const inverse = rates.get(fxRateKey(day, to, from));
    if (inverse != null && inverse > 0) return 1 / inverse;
  }
  return null;
}

/** Same rate for spend and sales on day D so ACoS does not drift. */
export function convertAdsAmount(
  amount: number,
  date: string,
  fromCurrency: string | null | undefined,
  toCurrency: string,
  rates: Map<string, number>,
): number | null {
  const from = normalizeFxCurrency(fromCurrency);
  const to = normalizeFxCurrency(toCurrency);
  if (!from || !to) return null;
  const rate = lookupFxRate(rates, date, from, to);
  if (rate == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n * rate;
}
