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
  if (hasAuthoritativeBreakEven(stored)) return stored;
  const net = Number(row.net_royalty_per_sale);
  const list = Number(row.kdp_list_price);
  if (net > 0 && list > 0) {
    const computed = (net / list) * 100;
    return hasAuthoritativeBreakEven(computed) ? computed : null;
  }
  return null;
}

export function pickCalculatorBreakEvenAcos(values: Array<number | null | undefined>): number {
  const finite = values.filter((value): value is number => hasAuthoritativeBreakEven(value));
  if (!finite.length) return 0;
  return Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2));
}

export type OverallBreakEvenBook = {
  breakeven_acos?: number | null;
  calculatorBreakEvenAcos?: number | null;
  breakEvenAcos?: number | null;
  pricingSynced?: boolean;
  spend?: number | null;
  adSpend?: number | null;
  sales?: number | null;
  adSales?: number | null;
  royalties?: number | null;
  orders?: number | null;
  listPrice?: number | null;
};

/** Calculator BE first (web Product Ads), then an authoritative stored value. */
export function resolveAuthoritativeBreakEvenAcos(book: OverallBreakEvenBook): number | null {
  if (book.pricingSynced !== false && hasAuthoritativeBreakEven(book.calculatorBreakEvenAcos)) {
    return Number(book.calculatorBreakEvenAcos);
  }
  if (hasAuthoritativeBreakEven(book.breakeven_acos)) return Number(book.breakeven_acos);
  if (hasAuthoritativeBreakEven(book.breakEvenAcos)) return Number(book.breakEvenAcos);
  return null;
}

/**
 * Ads Engine / Product Ads portfolio break-even — same as web
 * `computeBreakEvenPct`: calculator BE per book, weighted by ad spend.
 * Never invents BE from period royalties ÷ ads AOV.
 */
export function computeOverallBreakEvenAcos(books: readonly OverallBreakEvenBook[]): number {
  const withBE = (books ?? [])
    .map((book) => ({ book, be: resolveAuthoritativeBreakEvenAcos(book) }))
    .filter((row): row is { book: OverallBreakEvenBook; be: number } => row.be != null);
  if (!withBE.length) return 0;

  let weightSum = 0;
  let weighted = 0;
  for (const { book, be } of withBE) {
    const spendWeight = Math.max(0, Number(book.adSpend ?? book.spend) || 0);
    const fallback = Math.max(
      0,
      (Number(book.listPrice) || 0) * (Number(book.orders) || 0),
      Number(book.adSales ?? book.sales) || 0,
      Number(book.royalties) || 0,
    );
    const w = spendWeight > 0 ? spendWeight : fallback;
    if (w <= 0) continue;
    weighted += be * w;
    weightSum += w;
  }
  if (weightSum > 0) return weighted / weightSum;
  return withBE.reduce((sum, row) => sum + row.be, 0) / withBE.length;
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
