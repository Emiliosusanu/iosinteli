import { parseBookshelfDisplayedMoney, looksLikeKdpSetupBookId, looksLikeAmazonAsin } from './kdpPricingCapture.js';

function normalizeAsin(value) {
  return looksLikeAmazonAsin(value) ? String(value).trim().toUpperCase() : null;
}

function normalizeBookshelfDisplayedPrice(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+\.\d{2}$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0 && num <= 999999) return num.toFixed(2);
  }
  const parsed = parseBookshelfDisplayedMoney(raw);
  if (parsed.displayedPrice) return parsed.displayedPrice;
  const fallback = Number(raw.replace(',', '.'));
  if (!Number.isFinite(fallback) || fallback < 0 || fallback > 999999) return null;
  return fallback.toFixed(2);
}

function normalizeBookshelfCurrency(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'US$' || raw === 'US $') return 'USD';
  if (raw === 'CA$' || raw === 'CA $' || raw === 'C$') return 'CAD';
  if (raw === 'AU$' || raw === 'AU $' || raw === 'A$') return 'AUD';
  if (raw === '€') return 'EUR';
  if (raw === '£') return 'GBP';
  if (raw === '¥') return 'JPY';
  if (/^[A-Z]{3}$/.test(raw)) return raw;
  return null;
}

/**
 * Build a safe immediate pricing patch from the Bookshelf's displayed price.
 *
 * The Bookshelf is authoritative for the physical ASIN's primary list price,
 * but it does not expose printing cost, royalty tiers, VAT or the other
 * marketplaces. Reuse previously captured calculator inputs only for the US
 * USD row, where KDP's royalty formula is list * rate - printing cost. The
 * detailed setup-page capture remains pending and will refresh every market.
 *
 * Returning null is deliberate: a price-only write with stale royalty/ACoS
 * would be more misleading than leaving the detailed record pending.
 */
export function buildSafeBookshelfPrimaryPricingPatch({
  wake = null,
  stored = null,
  nowIso = null,
} = {}) {
  if (String(wake?.trigger || '') !== 'bookshelf_price_changed') return null;
  const asin = normalizeAsin(wake?.asin);
  if (!asin || normalizeAsin(stored?.asin) !== asin) return null;

  const wakeSetup = String(wake?.setupId || '').trim().toUpperCase();
  const storedSetup = String(stored?.kdp_setup_book_id || '').trim().toUpperCase();
  if (!looksLikeKdpSetupBookId(wakeSetup) || wakeSetup !== storedSetup) return null;

  const listPrice = Number(normalizeBookshelfDisplayedPrice(wake?.currentPrice));
  const previousPrice = Number(normalizeBookshelfDisplayedPrice(stored?.kdp_list_price));
  // The live Bookshelf observation must identify its currency explicitly.
  // Never let a bare dollar symbol inherit USD from a stored row because the
  // primary KDP marketplace may be Canada or Australia.
  const currency = normalizeBookshelfCurrency(wake?.currency);
  const storedCurrency = normalizeBookshelfCurrency(stored?.pricing_currency);
  const marketplace = String(stored?.pricing_marketplace || '').trim().toUpperCase();
  const printingCost = stored?.printing_cost == null || stored?.printing_cost === ''
    ? Number.NaN
    : Number(stored.printing_cost);
  let royaltyRate = stored?.royalty_rate == null || stored?.royalty_rate === ''
    ? Number.NaN
    : Number(stored.royalty_rate);
  if (royaltyRate > 1 && royaltyRate <= 100) royaltyRate /= 100;

  if (
    !Number.isFinite(listPrice) || listPrice <= 0
    || !Number.isFinite(previousPrice) || previousPrice <= 0
    || marketplace !== 'US'
    || currency !== 'USD'
    || storedCurrency !== 'USD'
    || !Number.isFinite(printingCost) || printingCost < 0
    || !Number.isFinite(royaltyRate) || royaltyRate <= 0 || royaltyRate > 1
  ) return null;

  // KDP's US paperback tier changes at $9.99. A cached rate cannot certify
  // a changed tier, nor an inconsistent historical calculator row.
  // https://kdp.amazon.com/en_US/help/topic/G201834330
  const previousTier = previousPrice >= 9.99 ? 0.6 : 0.5;
  const currentTier = listPrice >= 9.99 ? 0.6 : 0.5;
  if (previousTier !== currentTier || Math.abs(royaltyRate - previousTier) > 0.000001) return null;

  const netRoyalty = listPrice * royaltyRate - printingCost;
  if (!Number.isFinite(netRoyalty) || netRoyalty < 0) return null;
  const targetBreakEvenAcos = (netRoyalty / listPrice) * 100;
  const same = (left, right, epsilon = 0.0001) => {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
  };
  if (
    same(stored?.kdp_list_price, listPrice, 0.0049)
    && same(stored?.net_royalty_per_sale, netRoyalty, 0.0049)
    && same(stored?.target_break_even_acos, targetBreakEvenAcos, 0.0049)
  ) return null;
  const updatedAt = String(nowIso || '').trim() || new Date().toISOString();
  return {
    account_id: String(stored?.account_id || '').trim(),
    asin,
    kdp_setup_book_id: wakeSetup || storedSetup || null,
    kdp_list_price: Number(listPrice.toFixed(2)),
    printing_cost: Number(printingCost.toFixed(4)),
    net_royalty_per_sale: Number(netRoyalty.toFixed(4)),
    royalty_rate: Number(royaltyRate.toFixed(6)),
    target_break_even_acos: Number(targetBreakEvenAcos.toFixed(4)),
    pricing_marketplace: 'US',
    pricing_currency: 'USD',
    // Keep pricing_captured_at unchanged: the full marketplace detail is
    // still awaiting a setup-page capture. updated_at records this fast path.
    updated_at: updatedAt,
  };
}
