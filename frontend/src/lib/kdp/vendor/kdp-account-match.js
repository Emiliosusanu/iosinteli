/**
 * Fail-closed KDP account ↔ Chrome bookshelf ASIN matching.
 *
 * ASIN is the truth (same title on two accounts is fine; same ASIN on two
 * InteliAds kdp_accounts is contamination). Sponsored-ASIN overlap is handled
 * by auto-link separately; this module only decides whether a scrape may be
 * written into the selected account.
 */

/** Selected must cover at least this share of scraped ASINs to win alone. */
export const ACCOUNT_MISMATCH_SELECTED_MIN_RATIO = 0.5;
/** Sibling needs at least this scrape coverage to be a clear alternative. */
export const ACCOUNT_MISMATCH_BEST_MIN_RATIO = 0.5;
/** Sibling must beat selected by this much to block / redirect the write. */
export const ACCOUNT_MISMATCH_CLEAR_WINNER_DELTA = 0.25;
/** Scraped size for ratio-based decisions (exclusive ASIN path may use 1). */
export const ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS = 3;
/** 100% of scrape in one other account → hands-free auto-switch. */
export const ACCOUNT_MISMATCH_AUTOFIX_MIN_RATIO = 1.0;
/** Empty selected may seed only when no sibling reaches this coverage. */
export const ACCOUNT_MISMATCH_EMPTY_BLOCK_OTHER_RATIO = 0.5;
/**
 * When scrape ASINs are mirrored across contaminated catalogs (0 exclusives),
 * prefer the account whose stored catalog is better covered by the scrape.
 */
export const ACCOUNT_MISMATCH_CATALOG_FIT_DELTA = 0.05;

export function normalizeAsinSet(asins) {
  const out = new Set();
  for (const raw of asins instanceof Set ? asins : (Array.isArray(asins) ? asins : [])) {
    const asin = String(raw || '').trim().toUpperCase();
    if (asin) out.add(asin);
  }
  return out;
}

export function computeAsinOverlapRatio(scrapedAsins, storedAsins) {
  const scraped = normalizeAsinSet(scrapedAsins);
  const stored = normalizeAsinSet(storedAsins);
  if (!scraped.size) return null;
  let hits = 0;
  for (const asin of scraped) {
    if (stored.has(asin)) hits += 1;
  }
  return hits / scraped.size;
}

export function computeCatalogFitRatio(scrapedAsins, storedAsins) {
  const scraped = normalizeAsinSet(scrapedAsins);
  const stored = normalizeAsinSet(storedAsins);
  if (!stored.size) return 0;
  let hits = 0;
  for (const asin of scraped) {
    if (stored.has(asin)) hits += 1;
  }
  return hits / stored.size;
}

export function countExclusiveHits(scrapedAsins, ownStored, allStoredByAccount, ownAccountId) {
  const scraped = normalizeAsinSet(scrapedAsins);
  const own = normalizeAsinSet(ownStored);
  // Pre-normalize sibling sets once for O(accounts) not O(accounts*asins*normalize).
  const siblings = [];
  for (const [acctId, stored] of allStoredByAccount.entries()) {
    if (String(acctId) === String(ownAccountId)) continue;
    siblings.push(normalizeAsinSet(stored));
  }
  let hits = 0;
  for (const asin of scraped) {
    if (!own.has(asin)) continue;
    let elsewhere = false;
    for (const sib of siblings) {
      if (sib.has(asin)) {
        elsewhere = true;
        break;
      }
    }
    if (!elsewhere) hits += 1;
  }
  return hits;
}

function scoreAccount(scraped, storedSet, storedByAccount, accountId) {
  const stored = normalizeAsinSet(storedSet);
  if (!stored.size) {
    return { overlap: 0, exclusive: 0, catalogFit: 0, storedSize: 0 };
  }
  return {
    overlap: computeAsinOverlapRatio(scraped, stored) || 0,
    exclusive: countExclusiveHits(scraped, stored, storedByAccount, accountId),
    catalogFit: computeCatalogFitRatio(scraped, stored),
    storedSize: stored.size,
  };
}

function isBetterCandidate(a, b) {
  if (a.exclusive !== b.exclusive) return a.exclusive > b.exclusive;
  if (a.overlap !== b.overlap) return a.overlap > b.overlap;
  if (a.catalogFit !== b.catalogFit) return a.catalogFit > b.catalogFit;
  return false;
}

/**
 * Pure decision: may this scrape be written into selectedAccountId?
 *
 * @param {object} input
 * @param {string} input.selectedAccountId
 * @param {Iterable} input.scrapedAsins
 * @param {Map<string, Set<string>|string[]>} input.storedByAccount
 * @param {Array<{id:string,name?:string}>} [input.accounts]
 * @param {boolean} [input.ignoreMismatch]
 */
export function decideKdpAccountCatalogMatch(input = {}) {
  if (input.ignoreMismatch) {
    return { ok: true, skipped: true, reason: 'override' };
  }

  const selectedId = String(input.selectedAccountId || '').trim();
  const scraped = normalizeAsinSet(input.scrapedAsins);
  const storedByAccount = input.storedByAccount instanceof Map
    ? input.storedByAccount
    : new Map(Object.entries(input.storedByAccount || {}));
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];

  if (!selectedId) {
    return { ok: true, skipped: true, reason: 'missing_selected' };
  }

  const selectedStored = normalizeAsinSet(storedByAccount.get(selectedId) || []);
  const selectedScore = scoreAccount(scraped, selectedStored, storedByAccount, selectedId);
  const selectedOverlap = selectedScore.overlap;
  const selectedExclusive = selectedScore.exclusive;
  const selectedCatalogFit = selectedScore.catalogFit;

  let bestOtherId = null;
  let bestOther = { overlap: 0, exclusive: 0, catalogFit: 0, storedSize: 0 };
  for (const [acctId, stored] of storedByAccount.entries()) {
    if (String(acctId) === selectedId) continue;
    const score = scoreAccount(scraped, stored, storedByAccount, acctId);
    if (!score.storedSize) continue;
    if (!bestOtherId || isBetterCandidate(score, bestOther)) {
      bestOtherId = String(acctId);
      bestOther = score;
    }
  }

  const label = (id) => {
    const found = accounts.find((a) => a && String(a.id) === String(id));
    const name = found?.name == null ? '' : String(found.name).trim();
    return name || String(id || '');
  };

  const clearWinnerByExclusive = Boolean(
    bestOtherId
    && bestOther.exclusive >= 1
    && selectedExclusive === 0,
  );
  const clearWinnerByRatio = Boolean(
    bestOtherId
    && scraped.size >= ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS
    && bestOther.overlap >= ACCOUNT_MISMATCH_BEST_MIN_RATIO
    && (bestOther.overlap - selectedOverlap) >= ACCOUNT_MISMATCH_CLEAR_WINNER_DELTA,
  );
  // Contaminated mirrors: same scrape ASINs on two accounts (0 exclusives).
  // Prefer the account whose catalog is better explained by this Chrome session.
  const clearWinnerByCatalogFit = Boolean(
    bestOtherId
    && scraped.size >= ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS
    && selectedExclusive === 0
    && bestOther.exclusive === 0
    && bestOther.overlap >= ACCOUNT_MISMATCH_SELECTED_MIN_RATIO
    && selectedOverlap >= ACCOUNT_MISMATCH_SELECTED_MIN_RATIO
    && (bestOther.catalogFit - selectedCatalogFit) >= ACCOUNT_MISMATCH_CATALOG_FIT_DELTA,
  );
  const hasClearWinner = clearWinnerByExclusive || clearWinnerByRatio || clearWinnerByCatalogFit;
  const autoFixEligible = Boolean(
    bestOtherId
    && (
      (scraped.size >= ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS
        && bestOther.overlap >= ACCOUNT_MISMATCH_AUTOFIX_MIN_RATIO
        && bestOther.overlap > selectedOverlap)
      || (clearWinnerByExclusive && bestOther.exclusive >= 3)
      || (clearWinnerByCatalogFit && bestOther.overlap >= ACCOUNT_MISMATCH_AUTOFIX_MIN_RATIO)
    ),
  );

  // Empty selected: allow seed only when no sibling is a strong match.
  if (!selectedStored.size) {
    const blockEmpty = Boolean(
      bestOtherId
      && (
        bestOther.exclusive >= 1
        || (scraped.size >= ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS
          && bestOther.overlap >= ACCOUNT_MISMATCH_EMPTY_BLOCK_OTHER_RATIO)
      ),
    );
    if (!blockEmpty) {
      return {
        ok: true,
        skipped: true,
        reason: 'empty_selected_account',
        selectedOverlap: 0,
        selectedExclusive: 0,
      };
    }
    // Fall through to mismatch with suggested sibling.
  } else if (scraped.size < ACCOUNT_MISMATCH_MIN_SCRAPED_ASINS && !clearWinnerByExclusive) {
    return {
      ok: true,
      skipped: true,
      reason: 'insufficient_scrape',
      selectedOverlap,
      selectedExclusive,
    };
  } else if (!hasClearWinner && selectedExclusive > bestOther.exclusive) {
    return {
      ok: true,
      selectedOverlap,
      selectedExclusive,
      selectedCatalogFit,
      bestOtherId,
      bestOtherOverlap: bestOther.overlap,
      bestOtherExclusive: bestOther.exclusive,
      bestOtherCatalogFit: bestOther.catalogFit,
    };
  } else if (
    !hasClearWinner
    && selectedExclusive >= bestOther.exclusive
    && selectedOverlap >= ACCOUNT_MISMATCH_SELECTED_MIN_RATIO
    && selectedOverlap >= bestOther.overlap
    && selectedCatalogFit >= bestOther.catalogFit
  ) {
    // Selected is strictly best or tied on every signal — allow write.
    return {
      ok: true,
      selectedOverlap,
      selectedExclusive,
      selectedCatalogFit,
      bestOtherId,
      bestOtherOverlap: bestOther.overlap,
      bestOtherExclusive: bestOther.exclusive,
      bestOtherCatalogFit: bestOther.catalogFit,
    };
  } else if (
    !hasClearWinner
    && selectedOverlap >= ACCOUNT_MISMATCH_SELECTED_MIN_RATIO
    && selectedExclusive >= 1
  ) {
    return {
      ok: true,
      selectedOverlap,
      selectedExclusive,
      selectedCatalogFit,
      bestOtherId,
      bestOtherOverlap: bestOther.overlap,
      bestOtherExclusive: bestOther.exclusive,
      bestOtherCatalogFit: bestOther.catalogFit,
    };
  }

  const mismatch = {
    autoFixEligible,
    selectedAccountId: selectedId,
    selectedAccountName: label(selectedId),
    selectedOverlap,
    selectedExclusive,
    selectedCatalogFit,
    scrapedCount: scraped.size,
    storedCount: selectedStored.size,
    suggestedAccountId: hasClearWinner ? bestOtherId : null,
    suggestedAccountName: hasClearWinner ? label(bestOtherId) : null,
    suggestedOverlap: hasClearWinner ? bestOther.overlap : null,
    suggestedExclusive: hasClearWinner ? bestOther.exclusive : null,
    suggestedCatalogFit: hasClearWinner ? bestOther.catalogFit : null,
  };

  let message = `KDP catalog does not match the selected InteliAds account "${mismatch.selectedAccountName}" (${Math.round(selectedOverlap * 100)}% ASIN overlap).`;
  if (hasClearWinner) {
    message += ` Switch to "${mismatch.suggestedAccountName}" (${Math.round(bestOther.overlap * 100)}% match${bestOther.exclusive ? `, ${bestOther.exclusive} exclusive ASIN` : ''})?`;
  } else {
    message += ' Sign in to the correct KDP account in Chrome, or pick a different InteliAds account.';
  }
  mismatch.message = message;

  return {
    ok: false,
    mismatch,
    selectedOverlap,
    selectedExclusive,
    selectedCatalogFit,
    bestOtherId,
    bestOtherOverlap: bestOther.overlap,
    bestOtherExclusive: bestOther.exclusive,
    bestOtherCatalogFit: bestOther.catalogFit,
  };
}
