/**
 * Pure ASIN attribution helpers for the iPhone KDP helper.
 *
 * Rule: a KDP catalog may only auto-link to Amazon Ads profiles that already
 * sponsor at least one ASIN from that catalog. Same KDP account ⇒ all catalog
 * ASINs ride with those correctly matched Ads links.
 */

const ASIN_RE = /^[A-Z0-9]{10}$/;

export function normalizeAsin(raw: unknown): string | null {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (!ASIN_RE.test(s)) return null;
  return s;
}

export function uniqueNormalizedAsins(raw: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const asin = normalizeAsin(item);
    if (asin) out.add(asin);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Extract every ASIN from a KDP titles `booksObj` (vendor shape). */
export function catalogAsinsFromBooksObj(booksObj: unknown): string[] {
  const out = new Set<string>();
  if (!booksObj || typeof booksObj !== "object") return [];
  for (const value of Object.values(booksObj as Record<string, unknown>)) {
    const book = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const asins = book.asins && typeof book.asins === "object" ? (book.asins as Record<string, unknown>) : {};
    for (const candidate of Object.values(asins)) {
      const asin = normalizeAsin(candidate);
      if (asin) out.add(asin);
    }
    for (const key of ["asin", "digitalAsin", "printAsin", "hardcoverAsin", "audiobookAsin"] as const) {
      const asin = normalizeAsin(book[key]);
      if (asin) out.add(asin);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function intersectAsins(
  catalogAsins: readonly string[],
  sponsoredAsins: readonly string[],
): string[] {
  const sponsored = new Set(uniqueNormalizedAsins(sponsoredAsins));
  return uniqueNormalizedAsins(catalogAsins).filter((asin) => sponsored.has(asin));
}

export function profilesEligibleForCatalog(opts: {
  catalogAsins: readonly string[];
  sponsoredAsinsByProfileId: Record<string, readonly string[]>;
}): string[] {
  const catalog = new Set(uniqueNormalizedAsins(opts.catalogAsins));
  if (!catalog.size) return [];
  const eligible: string[] = [];
  for (const [profileId, asins] of Object.entries(opts.sponsoredAsinsByProfileId || {})) {
    const pid = String(profileId || "").trim();
    if (!pid) continue;
    if (uniqueNormalizedAsins(asins).some((asin) => catalog.has(asin))) {
      eligible.push(pid);
    }
  }
  return eligible.sort((a, b) => a.localeCompare(b));
}

export type AccountAsinOverlap = {
  accountId: string;
  overlap: number;
  asins: string[];
};

/** Prefer the account with the largest catalog ∩ titles overlap; break ties with preferredId. */
export function pickBestAccountByAsinOverlap(opts: {
  catalogAsins: readonly string[];
  accounts: readonly { accountId: string; asins: readonly string[] }[];
  preferredAccountId?: string | null;
  /** Accounts already linked to Ads profiles that sponsor this catalog — beat sticky poison. */
  boostAccountIds?: readonly string[];
}): AccountAsinOverlap | null {
  const catalog = uniqueNormalizedAsins(opts.catalogAsins);
  if (!catalog.length || !opts.accounts.length) return null;
  const boost = new Set(
    (opts.boostAccountIds ?? []).map((id) => String(id || "").trim()).filter(Boolean),
  );

  let best: AccountAsinOverlap | null = null;
  let bestScore = -1;
  for (const row of opts.accounts) {
    const accountId = String(row.accountId || "").trim();
    if (!accountId) continue;
    const asins = intersectAsins(catalog, row.asins);
    if (!asins.length) continue;
    const score =
      asins.length * 1000 +
      (boost.has(accountId) ? 100 : 0) +
      (opts.preferredAccountId && accountId === opts.preferredAccountId && boost.has(accountId)
        ? 1
        : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { accountId, overlap: asins.length, asins };
    }
  }
  return best;
}

/** True when preferred has zero catalog overlap but another account does. */
export function shouldSwitchStickyAccount(opts: {
  preferredAccountId: string | null | undefined;
  catalogAsins: readonly string[];
  accounts: readonly { accountId: string; asins: readonly string[] }[];
  boostAccountIds?: readonly string[];
}): boolean {
  const preferred = String(opts.preferredAccountId || "").trim();
  if (!preferred) return false;
  const best = pickBestAccountByAsinOverlap({
    catalogAsins: opts.catalogAsins,
    accounts: opts.accounts,
    preferredAccountId: preferred,
    boostAccountIds: opts.boostAccountIds,
  });
  if (!best) return false;
  if (best.accountId === preferred) return false;
  const preferredRow = opts.accounts.find((a) => a.accountId === preferred);
  const preferredOverlap = preferredRow
    ? intersectAsins(opts.catalogAsins, preferredRow.asins).length
    : 0;
  if (preferredOverlap === 0 && best.overlap > 0) return true;
  // Poisoned sticky: same ASINs written to wrong account, but Ads proof points elsewhere.
  const boost = new Set(
    (opts.boostAccountIds ?? []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  if (boost.size && !boost.has(preferred) && boost.has(best.accountId)) return true;
  return false;
}
