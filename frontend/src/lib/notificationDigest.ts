/** Pure notification digest copy — spend, orders, ACoS, optional KDP net. */

import { formatCurrency, formatInt, formatPercent } from "./format.ts";
import { LOCAL_MORNING_DIGEST_AUTHORITY } from "./notificationContract.ts";

/**
 * Local daytime digests. Hour 8 (Nest morning summary) is included only when
 * LOCAL_MORNING_DIGEST_AUTHORITY is true — default false to avoid dual digests.
 */
export const MORNING_DIGEST_HOUR = 8;
export const DAYTIME_DIGEST_HOURS = [10, 12, 14, 16, 18, 20] as const;
export const DIGEST_HOURS = (
  LOCAL_MORNING_DIGEST_AUTHORITY
    ? [MORNING_DIGEST_HOUR, ...DAYTIME_DIGEST_HOURS]
    : [...DAYTIME_DIGEST_HOURS]
) as readonly number[];

export type DigestTotals = {
  spend: number;
  orders: number;
  acos: number | null;
  royalties?: number | null;
  net?: number | null;
};

export function digestMetricsLine(
  totals: DigestTotals,
  currency: string,
  includeKdpNet: boolean,
): string {
  const parts = [
    `Spend ${formatCurrency(totals.spend, currency, { compact: true })}`,
    `${formatInt(totals.orders)} orders`,
    totals.acos != null ? `ACoS ${formatPercent(totals.acos)}` : "ACoS —",
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
