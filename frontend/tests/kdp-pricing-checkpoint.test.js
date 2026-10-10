import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/lib/kdp/pricingCheckpoint.ts';
import * as capture from '../src/lib/kdp/vendor/kdpPricingCapture.js';
import { collectPricingCandidatesForIos } from '../src/lib/kdp/pricingCandidates.ts';

const source = readFileSync(new URL('../src/lib/kdp/pricingSync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const candidates = Array.from({ length: 5 }, (_, i) => ({ asin: `B0TEST000${i}`, kdpBookId: `SETUP00000${i}`, title: null }));
function storageHarness() {
  const values = new Map();
  return { values, getItem: async (key, fallback) => values.get(key) ?? fallback,
    setItem: async (key, value) => { values.set(key, value); return true; } };
}
function harness(storage, { failWrite = null, interruptAfter = null, gateAfter = null, staleFirst = false } = {}) {
  const writes = [], probes = [], auth = [], fresh = storage.fresh ??= new Set();
  let lastOptions;
  const dirty = new Set();
  const store = policy.createPricingCheckpointStore(storage);
  const q = () => {
    let table, selected = '', onlyFresh = false;
    const query = {
      from(t) { table = t; return this; }, select(s) { selected = s; return this; },
      eq() { return this; }, in() { return this; }, not() { return this; },
      order() { return this; }, range() { return this; }, gte() { onlyFresh = true; return this; },
      then(resolve) {
        const data = table === 'kdp_book_formats' ? candidates.map(c => ({ asin: c.asin, format: 'paperback' }))
          : onlyFresh ? [...fresh].map(asin => ({ asin, pricing_captured_at: 'fresh' }))
          : selected === 'asin,pricing_captured_at' ? candidates.map(c => ({ asin: c.asin, pricing_captured_at: 'old' }))
          : candidates.map(c => ({ asin: c.asin, kdp_setup_book_id: c.kdpBookId }));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    }; return query;
  };
  const modules = {
    '../supabase.ts': { supabase: { from: t => q().from(t) } },
    '@/src/utils/storage': { storage }, './pricingCheckpoint.ts': policy,
    './activity.ts': { appendKdpActivity: async () => {} },
    './bookshelfPrimaryPricing.ts': { applyBookshelfPrimaryPriceChanges: async () => {} },
    './pricingCandidates.ts': { collectPricingCandidatesForIos },
    './pricingBootstrap.ts': { loadPricingBootstrap: async () => ({}), patchPricingBootstrap: async () => {}, bookshelfHtmlLooksSeeded: () => true },
    './pricingDirty.ts': { loadDirtyPricingSetupIds: async () => [...dirty].map(setupId => ({ setupId })), clearDirtyPricingSetupIds: async (_account, ids) => ids.forEach(id => dirty.delete(id)), markPricingSetupDirty: async () => {} },
    './runtime.ts': { getKdpHelperStatus: () => ({ currentUrl: 'https://kdp.amazon.com/en_US/bookshelf' }),
      setKdpHelperPricingAuth: value => auth.push(value), setKdpHelperRunning: () => {},
      setKdpHelperError: () => {}, isKdpWebViewActive: () => false },
    './helperUi.ts': { isKdpHelperScreenFocused: () => false },
    './vendor/kdpVendor.generated.js': { looksLikeHtmlErrorPage: () => false },
    './vendor/kdpPricingCapture.js': capture,
    './upsert.ts': { writeKdpPricing: async payload => {
      // Model a title write acknowledged before a marketplace write failure.
      fresh.add(payload.titleRows[0].asin);
      if (payload.titleRows[0].asin === failWrite) throw Error('marketplace write unavailable');
      writes.push(payload);
      if (writes.length === interruptAfter) lastOptions.deadlineAtMs = 0;
    } },
  };
  const exports = {};
  const context = vm.createContext({ exports, require: name => {
    if (!modules[name]) throw Error(`Unexpected module ${name}`); return modules[name];
  }, Date, Set, Map, Error, Promise, Number, String, Boolean, Array, JSON, Math, setTimeout, clearTimeout });
  vm.runInContext(compiled, context);
  context.fetchSetup = async id => {
    policy.pricingRequestTimeout(lastOptions.deadlineAtMs);
    probes.push(id);
    if (probes.length === gateAfter) return { ok: false, status: 403, text: 'sign_in', json: { reason: 'sign_in' }, attempts: [] };
    if (staleFirst && id === candidates[0].kdpBookId) return { ok: false, status: 404, text: 'ItemSetId not found', json: null,
      attempts: [{ status: 404, url: 'https://kdp.amazon.com/v2/get-setup-page' }] };
    const c = candidates.find(row => row.kdpBookId === id);
    const json = { book: { asin: c.asin }, pricing: { US: { priceVatExclusive: 15.99, currencyCode: 'USD' }, GB: { priceVatExclusive: 12.99, currencyCode: 'GBP' } },
      pricingSpec: { current: { US: { printingCost: 2.5, programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: 0.6 }] } } },
        GB: { printingCost: 2, programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: 0.6 }] } } } } } };
    return { ok: true, status: 200, text: JSON.stringify(json), json, marketplaceKey: 'US', attempts: [], pricing: capture.parseKdpGetSetupPage(json, 'US') };
  };
  vm.runInContext('fetchSetupPage = fetchSetup; ensureKdpBookshelfContext = async () => ""; sleep = async () => {};', context);
  return { probes, writes, auth, store, dirty, run: async (options = {}) => {
    lastOptions = { accountId: 'account-a', maxBooks: 3, ...options };
    return exports.syncKdpPaperbackPricing(lastOptions);
  } };
}

test('a short slice persists each book and restart resumes remaining exact ASINs, including both markets', async () => {
  const storage = storageHarness();
  const first = harness(storage, { interruptAfter: 1 });
  const result = await first.run();
  assert.equal(result.synced, 1); assert.equal(result.pending, 4);
  assert.equal(first.writes[0].marketplaceRows.length, 2);
  assert.deepEqual(first.writes[0].marketplaceRows.map(r => r.pricing_currency), ['USD', 'GBP']);
  storage.fresh.clear(); // completed books have aged beyond the freshness window
  const restarted = harness(storage);
  const next = await restarted.run();
  assert.equal(next.synced, 3); assert.equal(next.pending, 1);
  assert.deepEqual(restarted.probes, candidates.slice(1, 4).map(c => c.kdpBookId));
  const final = harness(storage);
  const last = await final.run();
  assert.equal(last.synced, 1); assert.equal(last.pending, 0);
  assert.deepEqual(final.probes, [candidates[4].kdpBookId]);
});

test('failed marketplace acknowledgement keeps that book pending despite fresh primary title', async () => {
  const h = harness(storageHarness(), { failWrite: candidates[1].asin });
  await assert.rejects(h.run(), /marketplace write unavailable/);
  assert.equal(h.writes.length, 1);
  const checkpoint = await h.store.load('account-a');
  assert.ok(checkpoint.pending.some(c => c.asin === candidates[1].asin));
  await h.run(); // untouched books run before the failed book
  const priorCalls = h.probes.length;
  await assert.rejects(h.run(), /marketplace write unavailable/);
  assert.ok(h.probes.slice(priorCalls).includes(candidates[1].kdpBookId));
});

test('an exhausted wake persists discovery intent without making an Amazon request or claiming completion', async () => {
  const h = harness(storageHarness());
  const result = await h.run({ deadlineAtMs: 0 });
  assert.equal(h.probes.length, 0); assert.equal(h.writes.length, 0);
  assert.ok(result.pending > 0); assert.match(result.message, /slice deferred/);
  assert.equal((await h.store.load('account-a')).needsDiscovery, true);
});

test('a gate reached after one successful book retains that commit and the remaining retry queue', async () => {
  const h = harness(storageHarness(), { gateAfter: 2 });
  const result = await h.run();
  assert.equal(result.synced, 1); assert.equal(result.pending, 4);
  assert.equal(result.authRequired, true);
  assert.equal(result.authBookId, candidates[1].kdpBookId);
  assert.ok(h.auth.at(-1).required);
});

test('a permanently stale first setup moves behind untouched live books on the next slice', async () => {
  const h = harness(storageHarness(), { staleFirst: true });
  await h.run();
  const before = h.probes.length;
  await h.run();
  assert.equal(h.probes[before], candidates[3].kdpBookId);
});

test('checkpoints are isolated by account and failed local persistence prevents probing', async () => {
  const storage = storageHarness(); const store = policy.createPricingCheckpointStore(storage);
  await store.save('account-a', { needsDiscovery: false, pending: candidates });
  assert.equal((await store.load('account-b')).pending.length, 0);
  const h = harness({ ...storage, setItem: async () => false });
  await assert.rejects(h.run(), /checkpoint could not be saved/);
  assert.equal(h.probes.length, 0);
});

test('resume drops old setup aliases and inactive editions excluded by current discovery', () => {
  const old = { ...candidates[0], kdpBookId: 'OLDSETUP000' };
  assert.deepEqual(policy.resumePricingCandidates([old, candidates[1]], [candidates[0]], [candidates[0]]), [candidates[0]]);
});

test('short pricing requests leave four seconds for commits and defer before less than a second remains', () => {
  assert.equal(policy.pricingRequestTimeout(22000, 10000), 8000);
  assert.equal(policy.pricingRequestTimeout(100000, 10000), 12000);
  assert.throws(() => policy.pricingRequestTimeout(22000, 18001), policy.PricingSliceExpiredError);
  assert.equal(policy.pricingRequestTimeout(undefined, 0), undefined);
});


test('a changed price can re-enter an unfinished sweep even when that book was already confirmed', async () => {
  const storage = storageHarness();
  await harness(storage, { interruptAfter: 1 }).run();
  const next = harness(storage);
  next.dirty.add(candidates[0].kdpBookId);
  await next.run();
  assert.ok((await next.store.load('account-a')).pending.some(c => c.asin === candidates[0].asin));
  await next.run();
  assert.ok(next.probes.includes(candidates[0].kdpBookId));
  assert.equal(next.dirty.size, 0);
});
