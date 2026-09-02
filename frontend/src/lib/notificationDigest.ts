/** Pure notification digest copy — spend, orders, ACoS, optional KDP net. */

import { formatCurrency, formatInt, formatPercent } from "./format.ts";

export const DIGEST_HOURS = [8, 10, 12, 14, 16, 18, 20] as const;

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

export function shouldSendDigestHour(
  localHour: number,
  lastDigestHour: number | undefined,
  today: string,
  digestDay: string | undefined,
): boolean {
  if (!DIGEST_HOURS.includes(localHour as (typeof DIGEST_HOURS)[number])) return false;
  if (digestDay !== today) return true;
  return lastDigestHour !== localHour;
}
