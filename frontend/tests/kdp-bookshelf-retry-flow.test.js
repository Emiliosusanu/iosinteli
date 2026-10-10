import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as capture from '../src/lib/kdp/vendor/kdpPricingCapture.js';
import * as candidateModule from '../src/lib/kdp/pricingCandidates.ts';
import * as fastModule from '../src/lib/kdp/bookshelfPrimaryPricing.ts';
import * as checkpoints from '../src/lib/kdp/pricingCheckpoint.ts';
const account = 'a'; const asin = '1807973794'; const setup = 'MT02FVSE645';
const shelf = `${'x'.repeat(500)}<div id="dual-print-price-asin-${setup}">ASIN: ${asin}</div><div id="dual-print-price-list-price-${setup}">16.99 USD</div><div id="dual-print-status-live-status-${setup}">Live</div>`;
function harness({ formatReadFails = false, ebookAlias = false } = {}) {
  const title = { account_id: account, asin, kdp_setup_book_id: setup, kdp_list_price: 15.99, printing_cost: 3.064, royalty_rate: .6, pricing_marketplace: 'US', pricing_currency: 'USD', pricing_captured_at: new Date().toISOString() };
  const dirty = new Set(); const writes = []; const logs = []; const auth = []; let locked = true; let setupRequests = 0;
  const local = new Map();
  const storage = { getItem: async (key, fallback) => local.get(key) ?? fallback, setItem: async (key, value) => { local.set(key, value); return true; } };
  const bootstrap = { bookshelfHtmlLooksSeeded: () => true, loadPricingBootstrap: async () => ({}), patchPricingBootstrap: async () => {} };
  const pricingDirty = { loadDirtyPricingSetupIds: async () => [...dirty].map(setupId => ({ setupId })), markPricingSetupDirty: async (_, id) => { dirty.add(id); return true; }, clearDirtyPricingSetupIds: async (_, ids) => { ids.forEach(id => dirty.delete(id)); } };
  const supabase = { from: (table) => {
    const formats = [{ asin, format: 'paperback' }, ...(ebookAlias ? [{asin:'B0H8FWKBLV',format:'ebook'}, {asin:'B0H8FWKBLV',format:'ku'}] : [])];
    const titles = [{ ...title }, ...(ebookAlias ? [{...title,asin:'B0H8FWKBLV'}] : [])];
    const q = { select: () => q, eq: () => q, in: () => q, not: () => q, gte: () => q, order: () => q, range: () => q,
      then: (resolve) => Promise.resolve(table === 'kdp_book_formats'
        ? {data: formatReadFails ? null : formats, error: formatReadFails ? {message:'network unavailable'} : null}
        : {data: titles, error:null}).then(resolve) }; return q;
  } };
  const runtime = { getKdpHelperStatus: () => ({ currentUrl: 'https://kdp.amazon.com/en_US/bookshelf' }), isKdpWebViewActive: () => false, navigateKdpWebView: () => {}, setKdpHelperError: () => {}, setKdpHelperPricingAuth: value => auth.push(value), setKdpHelperRunning: () => {},
    kdpPageFetch: async ({ url }) => {
      if (url.includes('/bookshelf')) return { ok: true, status: 200, text: shelf };
      setupRequests++;
      if (locked) return { ok: true, status: 200, text: '<html>Amazon Sign-in ap/signin</html>' };
      const json = { book: { asin, title: 'Test' }, pricing: { US: { priceVatExclusive: 16.99, currencyCode: 'USD' }, CA: { priceVatExclusive: 23.99, currencyCode: 'CAD' } }, pricingSpec: { current: { US: { printingCost: 3.064, programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: .6 }] } } }, CA: { printingCost: 4, programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: .6 }] } } } } } };
      return { ok: true, status: 200, text: JSON.stringify(json) };
    } };
  const modules = { '@/src/utils/storage': { storage }, './pricingCheckpoint.ts': checkpoints, '../supabase.ts': { supabase }, './activity.ts': { appendKdpActivity: async msg => logs.push(msg) }, './bookshelfPrimaryPricing.ts': fastModule, './pricingCandidates.ts': candidateModule, './pricingBootstrap.ts': bootstrap, './pricingDirty.ts': pricingDirty, './runtime.ts': runtime, './helperUi.ts': { isKdpHelperScreenFocused: () => false }, './upsert.ts': { writeKdpPricing: async payload => { writes.push(payload); Object.assign(title, payload.titleRows[0]); } }, './vendor/kdpVendor.generated.js': { looksLikeHtmlErrorPage: () => false }, './vendor/kdpPricingCapture.js': capture };
  const source = readFileSync(new URL('../src/lib/kdp/pricingSync.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: path => { assert.ok(modules[path], path); return modules[path]; }, console, setTimeout, Date });
  return { sync: () => exports.syncKdpPaperbackPricing({ accountId: account, formatRows: [{ asin, format: 'paperback' }] }), dirty, writes, logs, auth, title, unlock: () => { locked = false; }, requests: () => setupRequests };
}
test('persisted ebook alias never receives print pricing when recent report has only paperback', async () => {
  const h=harness({ebookAlias:true});h.unlock();await h.sync();
  assert.ok(h.writes.length>0);
  assert.ok(h.writes.every(write => [...write.titleRows,...write.marketplaceRows].every(row => row.asin!== 'B0H8FWKBLV')));
});
test('format identity fetch failure preserves existing prices and performs no fast or detailed write', async () => {
  const h=harness({formatReadFails:true});
  await assert.rejects(h.sync(),/format identity unavailable/);
  assert.equal(h.writes.length,0);assert.equal(h.title.kdp_list_price,15.99);
});
test('locked gate applies fast price despite fresh detail; next wake retries and open gate fills native markets', async () => {
  const h = harness(); const oldCapture = h.title.pricing_captured_at;
  const first = await h.sync();
  assert.equal(first.authRequired, true); assert.equal(first.pending, 1);
  assert.equal(h.dirty.has(setup), true); assert.equal(h.title.kdp_list_price, 16.99);
  assert.equal(h.title.pricing_captured_at, oldCapture);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].marketplaceRows.length, 1);
  const requests = h.requests(); await h.sync();
  assert.ok(h.requests() > requests, 'dirty setup must retry even though old detail timestamp is fresh');
  assert.equal(h.writes.length, 1, 'unchanged Bookshelf price must not be rewritten');
  h.unlock(); const final = await h.sync();
  assert.equal(final.synced, 1); assert.equal(final.pending, 0); assert.equal(h.dirty.size, 0);
  const detailed = h.writes.at(-1);
  assert.deepEqual(Array.from(detailed.marketplaceRows, r => r.pricing_currency).sort(), ['CAD', 'USD']);
  assert.ok(h.auth.some(row => row.required === false));
});
