import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { withKdpTaskRequest } from '../src/lib/kdp/backgroundBudget.ts';
import * as catalog from '../src/lib/kdp/pricingCatalog.ts';
import * as policy from '../src/lib/kdp/pricingCheckpoint.ts';
import * as capture from '../src/lib/kdp/vendor/kdpPricingCapture.js';
import * as discovery from '../src/lib/kdp/vendor/kdp-bookshelf-discovery.js';
import { collectPricingCandidatesForIos } from '../src/lib/kdp/pricingCandidates.ts';

const source = readFileSync(new URL('../src/lib/kdp/pricingSync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const candidates = Array.from({ length: 5 }, (_, i) => ({ asin: `B0TEST000${i}`, kdpBookId: `SETUP00000${i}`, title: null }));
function storageHarness() {
  const values = new Map();
  return { values, getItem: async (key, fallback) => values.get(key) ?? fallback,
    setItem: async (key, value) => { values.set(key, value); return true; } };
}
function harness(storage, { failWrite = null, interruptAfter = null, gateAfter = null, staleFirst = false, marketCount = 2, largeFormats = false, inactiveFirst = false, unknownAll = false, unknownAfter = Infinity, freshReadFailure = false } = {}) {
  const writes = [], probes = [], auth = [], fresh = storage.fresh ??= new Set();
  let lastOptions;
  const dirty = new Set();
  const store = policy.createPricingCheckpointStore(storage);
  const q = () => {
    let table, selected = '', onlyFresh = false, cutoff, offset = 0, size = 1000, ids = null;
    const query = {
      from(t) { table = t; return this; }, select(s) { selected = s; return this; },
      eq() { return this; }, in(_field, values) { ids = values; return this; }, not() { return this; },
      abortSignal() { return this; }, order() { return this; }, range(from, to) { offset = from; size = to - from + 1; return this; }, gte(_field, value) { onlyFresh = true; cutoff = value; return this; },
      then(resolve) {
        if (onlyFresh && freshReadFailure) return Promise.resolve({ data: null, error: { message: 'database unavailable' } }).then(resolve);
        const data = table === 'kdp_book_formats' ? [...candidates.map(c => ({ asin: c.asin, format: 'paperback' })), ...(largeFormats ? candidates.map((_,i) => ({ asin: `B1TEST${String(i).padStart(4, '0')}`, format: 'ebook' })) : [])]
          : onlyFresh ? [...fresh].map(asin => ({ asin, pricing_captured_at: storage.capturedAt?.get(asin) || new Date().toISOString() }))
            .filter(row => row.pricing_captured_at >= cutoff)
          : selected === 'asin,pricing_captured_at' ? candidates.map(c => ({ asin: c.asin, pricing_captured_at: 'old' }))
          : candidates.map(c => ({ asin: c.asin, kdp_setup_book_id: c.kdpBookId }));
        return Promise.resolve({ data: data.filter(row => !ids || ids.includes(row.asin)).slice(offset, offset + size), error: null }).then(resolve);
      },
    }; return query;
  };
  const modules = {
    '../supabase.ts': { supabase: { from: t => q().from(t) } },
    '@/src/utils/storage': { storage }, './pricingCheckpoint.ts': policy,
    './backgroundBudget.ts': { withKdpTaskRequest },
    './pricingCatalog.ts': { ...catalog, createPricingCatalogStore: () => ({ load: async () => ({ ...catalog.emptyPricingCatalog(), complete: true, rows: candidates.map((c,i) => ({ kdpBookId: c.kdpBookId, printAsin: c.asin, printStatus: unknownAll || i >= unknownAfter ? 'unknown' : inactiveFirst && i===0 ? 'unpublished' : 'live' })) }), save: async () => {} }) },
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
    './vendor/kdp-bookshelf-discovery.js': discovery,
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
    const currencies = { US:'USD', GB:'GBP', DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', NL:'EUR', PL:'PLN', SE:'SEK', BE:'EUR', IE:'EUR', CA:'CAD', AU:'AUD', JP:'JPY' };
    const markets = Object.entries(currencies).slice(0, marketCount);
    const json = { book: { asin: c.asin },
      pricing: Object.fromEntries(markets.map(([key,currencyCode]) => [key, { priceVatExclusive: key==='JP' ? 1599 : 15.99, currencyCode }])),
      pricingSpec: { current: Object.fromEntries(markets.map(([key]) => [key, { printingCost: key==='JP' ? 250 : 2.5,
        programs: { RETAIL: { royaltyRates: [{ threshold: 0, royaltyRate: 0.6 }] } } }])) } };
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
  assert.ok(!restarted.probes.includes(candidates[0].kdpBookId));
  assert.equal(new Set(restarted.probes).size,3);
  const final = harness(storage);
  const last = await final.run();
  assert.equal(last.synced, 1); assert.equal(last.pending, 0);
  assert.equal(final.probes.length,1);
  assert.deepEqual(new Set([...first.probes, ...restarted.probes, ...final.probes]), new Set(candidates.map(c=>c.kdpBookId)));
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

test('historical format identities cannot admit an unpublished or unverified live edition', async () => {
  const h=harness(storageHarness(),{inactiveFirst:true});
  await h.run(); assert.ok(h.probes.length>0);
  assert.ok(!h.probes.includes(candidates[0].kdpBookId));
  const unknown=harness(storageHarness(),{unknownAll:true});
  const result=await unknown.run(); assert.equal(result.synced,0);
  assert.ok(result.pending>0); assert.equal(unknown.probes.length,0); assert.equal(unknown.writes.length,0);
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
  assert.equal(next.probes[0], candidates[0].kdpBookId, 'changed live book preempts old retry tail');
  await next.run();
  assert.ok(next.probes.includes(candidates[0].kdpBookId));
  assert.equal(next.dirty.size, 0);
});


for (const bookCount of [700, 1000]) test(`${bookCount} books ×14 native markets drain through restarts without starving aged confirmations or truncating format identities`, async () => {
  const original = candidates.splice(0);
  candidates.push(...Array.from({length:bookCount}, (_,i) => ({ asin:`B0CAT${String(i).padStart(5,'0')}`, kdpBookId:`SETUP${String(i).padStart(5,'0')}`, title:null })));
  try {
    const storage = storageHarness(), allWrites = [], allProbes = [];
    const start = performance.now();
    for (let slice=0;slice<bookCount/20;slice++) {
      const h = harness(storage, { marketCount:14, largeFormats:true });
      const result = await h.run({ maxBooks:20 });
      allWrites.push(...h.writes); allProbes.push(...h.probes);
      storage.fresh.clear(); // completed entries may age beyond the audit window
      if (slice <bookCount/20-1) assert.ok(result.pending>0);
      else assert.equal(result.pending,0);
    }
    assert.equal(new Set(allProbes).size,bookCount); assert.equal(allProbes.length,bookCount);
    const rows = allWrites.flatMap(w => w.marketplaceRows);
    assert.equal(rows.length,bookCount*14);
    assert.equal(new Set(rows.map(r=>r.asin+':'+r.marketplace)).size,bookCount*14);
    for(const r of rows) {
      assert.ok(r.pricing_currency);assert.ok(r.printing_cost>0);
      assert.ok(Math.abs(r.target_break_even_acos - 100*r.net_royalty_per_sale/r.kdp_list_price)<.02);
    }
    console.log(`${bookCount}-book simulated ACK throughput: ${Math.round(performance.now()-start)}ms; ${bookCount/20} slices, ${bookCount*14} rows; excludes network/iOS scheduling`);
  } finally { candidates.splice(0,candidates.length,...original); }
});


test('persistent dirty arrivals and failing head cannot starve the thousand-book tail', () => {
  const rows = Array.from({length:1000}, (_,i) => ({ asin:`B0FAIR${String(i).padStart(4,'0')}`,kdpBookId:`FAIR${i}`,pendingSinceMs:1 }));
  let pending=rows, time=10;
  const priorKeys=new Set(rows.map(policy.pricingCandidateKey)), completed=new Set();
  for(let slice=0;slice<150 && completed.size<999;slice++) {
    const admission=policy.admitPricingCandidates(pending,20,new Set(['FAIR0']),priorKeys,++time);
    for(const row of admission.selected) if(row.kdpBookId!=='FAIR0') completed.add(policy.pricingCandidateKey(row));
    pending=admission.pending.filter(row=>row.kdpBookId==='FAIR0' || !completed.has(policy.pricingCandidateKey(row)));
  }
  assert.equal(completed.size,999); assert.equal(pending.length,1);
  assert.ok(pending[0].lastAttemptMs>0);
});


test('repeated force refresh resumes unfinished sweep and does not recapture the acknowledged head', async () => {
  const storage=storageHarness();
  const first=harness(storage,{interruptAfter:1});
  await first.run({forceRefresh:true});
  storage.fresh.clear();
  const next=harness(storage);
  await next.run({forceRefresh:true});
  assert.ok(!next.probes.includes(candidates[0].kdpBookId));
  const last=harness(storage);
  await last.run({forceRefresh:true});
  assert.equal(new Set([...first.probes,...next.probes,...last.probes]).size,5);
  assert.equal(first.probes.length+next.probes.length+last.probes.length,5);
});

test('temporarily unknown live status preserves pending checkpoint until fresh discovery resumes',async()=>{
  const storage=storageHarness();
  await harness(storage,{interruptAfter:1}).run();
  const before=await policy.createPricingCheckpointStore(storage).load('account-a');
  await harness(storage,{unknownAll:true}).run();
  const unknown=await policy.createPricingCheckpointStore(storage).load('account-a');
  assert.deepEqual(unknown.pending,before.pending);
  assert.equal(unknown.needsDiscovery,true);
  const next=harness(storage);await next.run();
  assert.ok(!next.probes.includes(candidates[0].kdpBookId));
});

test('a partial live-status refresh retains unresolved tail while confirmed live work continues',async()=>{
  const storage=storageHarness();
  await harness(storage,{interruptAfter:1}).run();
  const next=harness(storage,{unknownAfter:2});await next.run();
  assert.deepEqual(next.probes,[candidates[1].kdpBookId]);
  const checkpoint=await policy.createPricingCheckpointStore(storage).load('account-a');
  assert.equal(checkpoint.pending.length,3);
  assert.equal(checkpoint.needsDiscovery,true);
  const fresh=harness(storage);await fresh.run();
  assert.deepEqual(new Set(fresh.probes),new Set(candidates.slice(2).map(row=>row.kdpBookId)));
});

test('fresh live prices cannot hide a retained unknown-status edition or clear its auth banner', async () => {
  const storage = storageHarness();
  await policy.createPricingCheckpointStore(storage).save('account-a', {
    needsDiscovery: true,
    pending: [candidates[4]],
    completed: candidates.slice(0, 4).map(policy.pricingCandidateKey),
  });
  storage.fresh = new Set(candidates.map(row => row.asin));
  const next = harness(storage, { unknownAfter: 4 });
  const result = await next.run();
  assert.equal(result.synced, 0);
  assert.equal(result.pending, 1);
  assert.equal(next.probes.length, 0);
  assert.equal(next.writes.length, 0);
  assert.equal(next.auth.length, 0);
  const checkpoint = await next.store.load('account-a');
  assert.deepEqual(checkpoint.pending, [candidates[4]]);
  assert.equal(checkpoint.needsDiscovery, true);
  const recovered = await harness(storage).run();
  assert.equal(recovered.pending, 0);
});

test('700 verified books skip the second gate; one detected change refreshes only its fourteen markets', async () => {
  const original = [...candidates];
  try {
    candidates.splice(0, candidates.length, ...Array.from({length:700}, (_,i) => ({
      asin:`B0TEST${String(i).padStart(4,'0')}`, kdpBookId:`SETUP${String(i).padStart(6,'0')}`, title:null,
    })));
    const storage=storageHarness();
    storage.fresh=new Set(candidates.map(row=>row.asin));
    storage.capturedAt=new Map(candidates.map(row=>[row.asin,new Date(Date.now()-2*60*60*1000).toISOString()]));
    const steady=harness(storage,{marketCount:14});
    const result=await steady.run();
    assert.equal(result.synced,0); assert.equal(result.pending,0);
    assert.equal(steady.probes.length,0); assert.equal(steady.writes.length,0);

    const changed=candidates[699];
    const next=harness(storage,{marketCount:14});
    next.dirty.add(changed.kdpBookId);
    await next.run();
    assert.deepEqual(next.probes,[changed.kdpBookId]);
    assert.equal(next.writes.length,1);
    assert.equal(next.writes[0].marketplaceRows.length,14);
    assert.ok(next.writes[0].marketplaceRows.every(row=>row.asin===changed.asin));
    assert.equal(next.dirty.size,0);
    const after=harness(storage,{marketCount:14});
    await after.run(); assert.equal(after.probes.length,0);
  } finally { candidates.splice(0,candidates.length,...original); }
});

test('periodic audit selects an expired price while unchanged recent books remain skipped', async () => {
  const storage=storageHarness();
  storage.fresh=new Set(candidates.map(row=>row.asin));
  storage.capturedAt=new Map(candidates.map(row=>[row.asin,new Date(Date.now()-24*60*60*1000).toISOString()]));
  storage.capturedAt.set(candidates[4].asin,new Date(Date.now()-8*24*60*60*1000).toISOString());
  const h=harness(storage); await h.run();
  assert.deepEqual(h.probes,[candidates[4].kdpBookId]);
});

test('a missing price is captured without rereading the verified catalog', async () => {
  const storage=storageHarness(); storage.fresh=new Set(candidates.slice(0,4).map(row=>row.asin));
  const h=harness(storage); await h.run();
  assert.deepEqual(h.probes,[candidates[4].kdpBookId]);
});

test('freshness database failure preserves the retry checkpoint instead of sweeping every book', async () => {
  const storage=storageHarness();
  const store=policy.createPricingCheckpointStore(storage);
  await store.save('account-a',{needsDiscovery:false,pending:[candidates[4]],completed:[]});
  const before=await store.load('account-a');
  const h=harness(storage,{freshReadFailure:true});
  await assert.rejects(h.run(),/database unavailable/);
  assert.equal(h.probes.length,0); assert.equal(h.writes.length,0);
  const after=await store.load('account-a');
  assert.deepEqual(after.pending,before.pending);
  assert.deepEqual(after.completed,before.completed);
  assert.equal(after.needsDiscovery,true);
});
