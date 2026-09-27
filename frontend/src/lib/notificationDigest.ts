/** Pure notification digest copy: spend, orders, ACoS, optional KDP net. */

import { formatCurrency, formatInt, formatPercent } from "./format.ts";
import { LOCAL_MORNING_DIGEST_AUTHORITY } from "./notificationContract.ts";

/** Honest unknown marker in alert bodies (never invent $0). No em dash. */
export const DIGEST_UNKNOWN = "n/a";

/**
 * Local daytime digests. Hour 8 (Nest morning summary) is included only when
 * LOCAL_MORNING_DIGEST_AUTHORITY is true (default false to avoid dual digests).
 */
export const MORNING_DIGEST_HOUR = 8;
export const DAYTIME_DIGEST_HOURS = [10, 12, 14, 16, 18, 20] as const;
export const DIGEST_HOURS = (
  LOCAL_MORNING_DIGEST_AUTHORITY
    ? [MORNING_DIGEST_HOUR, ...DAYTIME_DIGEST_HOURS]
    : [...DAYTIME_DIGEST_HOURS]
) as readonly number[];

/** Spend/orders may be null = unknown (never coerce missing/no_sync to 0). */
export type DigestTotals = {
  spend: number | null;
  orders: number | null;
  acos: number | null;
  royalties?: number | null;
  net?: number | null;
};

export type DigestMetricPresence =
  | "verified"
  | "verified_zero"
  | "missing"
  | "no_sync"
  | "unknown";

export type HonestDigestTotals = {
  spend: number | null; // null = unknown, NOT zero
  orders: number | null;
  acos: number | null;
  royalties?: number | null;
  net?: number | null;
  state: DigestMetricPresence;
  currency: string;
};

function normalizePresence(state?: string | null): DigestMetricPresence {
  if (
    state === "verified" ||
    state === "verified_zero" ||
    state === "missing" ||
    state === "no_sync"
  ) {
    return state;
  }
  return "unknown";
}

function finiteOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * From MobileDailyPoint-like: missing/no_sync → null spend/orders (never fake 0).
 */
export function honestTotalsFromDayPoint(
  point: {
    spend?: number | null;
    orders?: number | null;
    sales?: number | null;
    acos?: number | null;
    state?: string | null;
  } | null | undefined,
  currency: string,
): HonestDigestTotals {
  const code = String(currency || "USD").trim().toUpperCase() || "USD";
  const state = normalizePresence(point?.state);
  if (state === "missing" || state === "no_sync") {
    return { spend: null, orders: null, acos: null, state, currency: code };
  }

  const spend = finiteOrNull(point?.spend);
  const orders = finiteOrNull(point?.orders);
  const sales = finiteOrNull(point?.sales);
  let acos = finiteOrNull(point?.acos);
  if (acos == null && spend != null && sales != null && sales > 0) {
    acos = (spend / sales) * 100;
  }

  // Never upgrade ambiguous Nest payloads to verified_zero: zero-fill without an
  // explicit state must stay unknown (Spend n/a) rather than invent "Spend $0".
  let resolved: DigestMetricPresence = state;
  if (state === "unknown" && spend != null && spend > 0) {
    resolved = "verified";
  }

  return {
    spend: state === "unknown" && spend === 0 ? null : spend,
    orders: state === "unknown" && spend === 0 ? null : orders,
    acos: state === "unknown" && spend === 0 ? null : acos,
    state: resolved,
    currency: code,
  };
}

/**
 * Single-currency metrics line. Null spend → "Spend n/a" (not $0).
 * Null orders → "n/a orders". Number spend keeps prior formatting.
 */
export function digestMetricsLine(
  totals: DigestTotals,
  currency: string,
  includeKdpNet: boolean,
): string {
  const parts = [
    totals.spend == null
      ? `Spend ${DIGEST_UNKNOWN}`
      : `Spend ${formatCurrency(totals.spend, currency, { compact: true })}`,
    totals.orders == null ? `${DIGEST_UNKNOWN} orders` : `${formatInt(totals.orders)} orders`,
    totals.acos != null ? `ACoS ${formatPercent(totals.acos)}` : `ACoS ${DIGEST_UNKNOWN}`,
  ];
  if (includeKdpNet) {
    if (totals.net != null) {
      parts.push(`Net ${formatCurrency(totals.net, currency, { compact: true })}`);
    } else if (totals.royalties != null) {
      parts.push(`Royalties ${formatCurrency(totals.royalties, currency, { compact: true })}`);
    }
  }
  return parts.join(" · ");
}

/** Multi-currency digest body: one line per currency (`USD Spend …`). Unknown spend → "Spend n/a". */
export function digestMetricsLines(
  lines: HonestDigestTotals[],
  includeKdpNet: boolean,
): string {
  return lines
    .map((line) => `${line.currency} ${digestMetricsLine(line, line.currency, includeKdpNet)}`)
    .join("\n");
}

export function mixedCurrencyDigestNote(currencies: readonly string[]): string | null {
  const codes = [...new Set(currencies.map((c) => String(c || "").trim().toUpperCase()).filter(Boolean))];
  if (codes.length < 2) return null;
  return `${codes.join(" + ")} listed separately · not converted\nOpen InteliAds for the full summary`;
}

/** Append coverage / mixed-currency footer when incomplete. */
export function formatDigestBody(input: {
  lines: HonestDigestTotals[];
  includeKdpNet: boolean;
  coverageLine?: string | null;
  mixedCurrencyNote?: string | null;
}): string {
  const parts: string[] = [];
  if (input.lines.length) {
    parts.push(digestMetricsLines(input.lines, input.includeKdpNet));
  }
  const mixed =
    input.mixedCurrencyNote ??
    mixedCurrencyDigestNote(input.lines.map((line) => line.currency));
  if (mixed) parts.push(mixed);
  if (input.coverageLine) parts.push(input.coverageLine);
  return parts.join("\n");
}

export function notificationBodyWithTotals(
  headline: string,
  totals: DigestTotals,
  currency: string,
  includeKdpNet: boolean,
): string {
  return `${headline}\n${digestMetricsLine(totals, currency, includeKdpNet)}`;
}

export function isMorningDigestHour(localHour: number): boolean {
  return localHour === MORNING_DIGEST_HOUR;
}

export function digestTitleForHour(localHour: number): string {
  return isMorningDigestHour(localHour) ? "Yesterday's Amazon Ads" : "Today so far";
}

export function digestHeadlineForHour(localHour: number): string {
  return isMorningDigestHour(localHour)
    ? "Yesterday's totals"
    : "Today so far";
}

export function shouldSendDigestHour(
  localHour: number,
  lastDigestHour: number | undefined,
  today: string,
  digestDay: string | undefined,
): boolean {
  if (!DIGEST_HOURS.includes(localHour)) return false;
  if (digestDay !== today) return true;
  return lastDigestHour !== localHour;
}
