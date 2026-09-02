/**
 * Publisher Net Royalties contract.
 *
 *   netRoyalties = kdpRoyalties - adsSpend
 *
 * Amazon Ads `sales` is attributed retail. It is never an input here.
 */

export const NET_ROYALTIES_LABEL = "Net Royalties";
export const NET_ROYALTIES_CAPTION = "KDP royalties minus Amazon Ads spend.";
export const KDP_ROYALTIES_LABEL = "KDP royalties";
export const ADS_SPEND_LABEL = "Amazon Ads spend";
export const ADS_SALES_LABEL = "Amazon Ads sales";

export type MoneyLike = number | null | undefined;

export function kdpRoyaltiesAreKnown(kdpRoyalties: MoneyLike): kdpRoyalties is number {
  return typeof kdpRoyalties === "number" && Number.isFinite(kdpRoyalties);
}

export function adsSpendOrZero(adsSpend: MoneyLike): number {
  return typeof adsSpend === "number" && Number.isFinite(adsSpend) ? adsSpend : 0;
}

/**
 * `adsSales` is accepted only so callers can pass it and tests can prove it is ignored.
 */
export function netRoyalties(input: {
  kdpRoyalties: MoneyLike;
  adsSpend: MoneyLike;
  adsSales?: MoneyLike;
}): number | null {
  void input.adsSales;
  if (!kdpRoyaltiesAreKnown(input.kdpRoyalties)) return null;
  return input.kdpRoyalties - adsSpendOrZero(input.adsSpend);
}

export function netRoyaltiesKnown(kdpRoyalties: number, adsSpend: number): number {
  return kdpRoyalties - adsSpend;
}

export type BookNetRow = {
  royalties: number | null;
  spend: number;
  net?: number | null;
  ads_state?: "ready" | "pending" | "missing" | string;
  kdp_state?: "ready" | "partial" | "missing" | string;
};

/** Single book net for lists, widgets, and detail — never trust a stale/null net field alone. */
export function resolveBookNet(row: BookNetRow): number | null {
  if (row.kdp_state === "missing") return null;
  if (!kdpRoyaltiesAreKnown(row.royalties)) return null;
  if (row.ads_state === "pending" || row.ads_state === "missing") return null;
  if (typeof row.net === "number" && Number.isFinite(row.net)) return row.net;
  return netRoyalties({ kdpRoyalties: row.royalties, adsSpend: row.spend });
}

export function bookNetIsKnown(row: BookNetRow): boolean {
  return resolveBookNet(row) != null;
}

export function netRoyaltiesVoiceOver(args: {
  kdpRoyalties: string;
  adsSpend: string;
  netRoyalties: string;
  adsSales?: string;
}): string {
  const parts = [
    `${KDP_ROYALTIES_LABEL}, ${args.kdpRoyalties}`,
    `${ADS_SPEND_LABEL}, ${args.adsSpend}`,
    `${NET_ROYALTIES_LABEL}, ${args.netRoyalties}`,
  ];
  if (args.adsSales) parts.push(`${ADS_SALES_LABEL}, ${args.adsSales}`);
  return parts.join(". ");
}
