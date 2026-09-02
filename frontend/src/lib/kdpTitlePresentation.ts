/**
 * Cover + calculator break-even from the same kdp_titles fields the web
 * Product Ads table uses. Do not treat KDP sash/action chrome as a cover,
 * and do not invent break-even from royalties ÷ ad sales.
 */

const PLACEHOLDER_COVER_RE =
  /images\/S\/sash\/|sCxYoSS1zm8glOt\.svg|placeholder|no[-_]?cover/i;

export function isPlaceholderCoverUrl(value: unknown): boolean {
  const url = String(value ?? "").trim();
  return url.length > 0 && PLACEHOLDER_COVER_RE.test(url);
}

export function pickUsableCoverUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const url = String(candidate ?? "").trim();
    if (url && !isPlaceholderCoverUrl(url)) return url;
  }
  return null;
}

export function calculatorBreakEvenFromKdpTitle(row: {
  target_break_even_acos?: unknown;
  net_royalty_per_sale?: unknown;
  kdp_list_price?: unknown;
}): number | null {
  const stored = Number(row.target_break_even_acos);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const net = Number(row.net_royalty_per_sale);
  const list = Number(row.kdp_list_price);
  if (net > 0 && list > 0) return (net / list) * 100;
  return null;
}

export function pickCalculatorBreakEvenAcos(values: Array<number | null | undefined>): number {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (!finite.length) return 0;
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2));
}

export function hasAuthoritativeBreakEven(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 200;
}

/** Web Product Ads cell: `toFixed(2)%`, or `—` when calculator pricing is missing. */
export function formatBreakEvenAcos(value: unknown): string {
  if (!hasAuthoritativeBreakEven(value)) return "—";
  return `${Number(value).toFixed(2)}%`;
}

export function isOverBreakEven(acos: number, breakEven: unknown): boolean {
  return hasAuthoritativeBreakEven(breakEven) && acos > 0 && acos > Number(breakEven);
}
