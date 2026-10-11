import { buildSafeBookshelfPrimaryPricingPatch } from "./vendor/kdp-bookshelf-primary-pricing.js";
import {
  extractBookshelfPrintRowsFromHtml,
  looksLikeAmazonAsin,
  looksLikeKdpSetupBookId,
} from "./vendor/kdpPricingCapture.js";

type Row = Record<string, unknown>;
type Wake = Row & { asin: string; setupId: string };

/** A current, explicitly Live physical row is the only Bookshelf authority. */
export function planBookshelfPrimaryPriceChanges(opts: {
  accountId: string;
  bookshelfHtml: string;
  storedRows: Row[];
}): { wake: Wake; stored: Row; patch: Row | null }[] {
  const storedByAsin = new Map(opts.storedRows
    .filter((row) => row.account_id === opts.accountId)
    .map((row) => [String(row.asin || "").toUpperCase(), row]));
  const rows = extractBookshelfPrintRowsFromHtml(opts.bookshelfHtml);
  const plans: { wake: Wake; stored: Row; patch: Row | null }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.printStatus !== "live") continue;
    const asin = String(row.printAsin || "").trim().toUpperCase();
    const setupId = String(row.kdpBookId || "").trim().toUpperCase();
    if (!looksLikeAmazonAsin(asin) || !looksLikeKdpSetupBookId(setupId)) continue;
    // Conflicting identities across pages are not authority for a fast write.
    if (rows.some((other) => other.printAsin === asin && other.kdpBookId !== setupId)) continue;
    const stored = storedByAsin.get(asin);
    if (!stored || String(stored.kdp_setup_book_id || "").toUpperCase() !== setupId) continue;
    const current = Number(row.displayedPrice);
    const previous = stored.kdp_list_price == null ? Number.NaN : Number(stored.kdp_list_price);
    const currency = String(row.currency || "").toUpperCase();
    if (!currency || !Number.isFinite(current) || current <= 0) continue;
    if (Number.isFinite(previous) && Math.abs(current - previous) < .005
      && currency === String(stored.pricing_currency || "").toUpperCase()) continue;
    if (seen.has(asin)) continue;
    seen.add(asin);
    const wake: Wake = { trigger: "bookshelf_price_changed", asin, setupId,
      currentPrice: row.displayedPrice, currency };
    plans.push({ wake, stored, patch: buildSafeBookshelfPrimaryPricingPatch({ wake, stored }) });
  }
  return plans;
}

/** Persist retry BEFORE any price write; only detailed capture may clear it. */
export async function applyBookshelfPrimaryPriceChanges(opts: {
  accountId: string;
  bookshelfHtml: string;
  storedRows: Row[];
  markDirty: (accountId: string, setupId: string, opts: { source: string }) => Promise<boolean>;
  writePricing: (opts: { accountId: string; titleRows: Row[]; marketplaceRows: Row[] }) => Promise<void>;
  log: (message: string) => Promise<void>;
}): Promise<{ changed: number; updated: number; failed: number }> {
  const plans = planBookshelfPrimaryPriceChanges(opts);
  let updated = 0;
  let failed = 0;
  for (const { wake, patch } of plans) {
    try {
      if (!await opts.markDirty(opts.accountId, wake.setupId, { source: "bookshelf_price_changed" })) continue;
      if (!patch) {
        await opts.log(`pricing.bookshelf_primary_deferred · ${wake.asin} · detailed pricing pending`);
        continue;
      }
      const { kdp_setup_book_id: _setupId, pricing_marketplace, ...market } = patch;
      delete market.pricing_captured_at;
      await opts.writePricing({ accountId: opts.accountId, titleRows: [patch],
        marketplaceRows: [{ ...market, marketplace: pricing_marketplace }] });
      updated += 1;
      await opts.log(`pricing.bookshelf_primary_updated · ${wake.asin} · ${patch.kdp_list_price} ${patch.pricing_currency} · detailed pricing pending`);
    } catch {
      failed += 1;
      await opts.log(`pricing.bookshelf_primary_update_failed · ${wake.asin} · retry pending`);
    }
  }
  return { changed: plans.length, updated, failed };
}
