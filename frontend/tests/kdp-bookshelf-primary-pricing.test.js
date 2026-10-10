import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBookshelfPrimaryPriceChanges, planBookshelfPrimaryPriceChanges } from '../src/lib/kdp/bookshelfPrimaryPricing.ts';
const stored = { account_id: 'account-a', asin: '1807973794', kdp_setup_book_id: 'MT02FVSE645', kdp_list_price: 15.99, printing_cost: 3.064, royalty_rate: .6, pricing_currency: 'USD', pricing_marketplace: 'US', pricing_captured_at: '2026-10-01T00:00:00Z' };
const shelf = (price = '16.99', status = 'live', currency = 'USD', asin = stored.asin, setup = stored.kdp_setup_book_id) =>
  `<div id="zme-indie-bookshelf-dual-print-price-asin-${setup}">ASIN: ${asin}</div>`
  + `<div id="zme-indie-bookshelf-dual-print-price-list-price-${setup}">${price} ${currency}</div>`
  + `<div id="zme-indie-bookshelf-dual-print-status-${status === 'live' ? 'live-status' : 'draft'}-${setup}">${status}</div>`;
const plan = (html = shelf(), rows = [stored]) => planBookshelfPrimaryPriceChanges({ accountId: 'account-a', bookshelfHtml: html, storedRows: rows });
test('live ISBN updates one primary native market after persisting retry', async () => {
  const calls = [];
  const result = await applyBookshelfPrimaryPriceChanges({ accountId: 'account-a', bookshelfHtml: shelf(), storedRows: [stored],
    markDirty: async (acct, id) => { calls.push(['dirty', acct, id]); return true; },
    writePricing: async (payload) => { calls.push(['write', payload]); }, log: async (msg) => { calls.push(['log', msg]); } });
  assert.deepEqual(result, { changed: 1, updated: 1, failed: 0 });
  assert.equal(calls[0][0], 'dirty');
  const payload = calls[1][1];
  assert.equal(payload.titleRows[0].net_royalty_per_sale, 7.13);
  assert.equal(payload.marketplaceRows.length, 1);
  assert.equal(payload.marketplaceRows[0].marketplace, 'US');
  assert.equal(payload.marketplaceRows[0].pricing_currency, 'USD');
  assert.equal('pricing_captured_at' in payload.titleRows[0], false);
  assert.equal('pricing_captured_at' in payload.marketplaceRows[0], false);
});
test('unchanged, draft, foreign account, alias and setup mismatch produce no wake', () => {
  assert.equal(plan(shelf('15.99')).length, 0);
  assert.equal(plan(shelf('16.99', 'draft')).length, 0);
  assert.equal(plan(shelf(), [{ ...stored, account_id: 'other' }]).length, 0);
  assert.equal(plan(shelf('16.99', 'live', 'USD', 'B0H9M11FM7')).length, 0);
  assert.equal(plan(shelf(), [{ ...stored, kdp_setup_book_id: 'OTHERSETUP1' }]).length, 0);
});
test('cross-tier and non-US prices persist retry without overwriting economics', async () => {
  for (const html of [shelf('9.98'), shelf('16.99', 'live', 'CAD')]) {
    let dirty = 0; let writes = 0;
    await applyBookshelfPrimaryPriceChanges({ accountId: 'account-a', bookshelfHtml: html, storedRows: [stored],
      markDirty: async () => { dirty++; return true; }, writePricing: async () => { writes++; }, log: async () => {} });
    assert.equal(writes, 0); assert.equal(dirty, 1);
  }
  assert.equal(plan(shelf('16.99', 'live', '$')).length, 0);
});
test('failed price write preserves dirty retry', async () => {
  const calls = [];
  const result = await applyBookshelfPrimaryPriceChanges({ accountId: 'account-a', bookshelfHtml: shelf(), storedRows: [stored],
    markDirty: async () => { calls.push('dirty'); return true; }, writePricing: async () => { calls.push('write'); throw new Error('offline'); }, log: async () => {} });
  assert.deepEqual(calls, ['dirty', 'write']);
  assert.deepEqual(result, { changed: 1, updated: 0, failed: 1 });
});
