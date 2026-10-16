import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function fetchTopBooksRange(');
const end = source.indexOf('// ---------- Optimization Rules ----------', start);
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('actual Books query publishes the authenticated web rows before slower catalog assembly', async () => {
  const core = [{ asin: 'B0ABCDEFGH', royalties: 19, spend: 4, ads_state: 'ready' }];
  const failure = new Error('catalog unavailable');
  let published;
  const context = { exports: {},
    fetchKdpAccountIdsForRoyaltyQuery: async () => [],
    hasNestToken: async () => true,
    hasMobileApiSession: async () => true,
    fetchNestTopBooks: async opts => { assert.equal(opts.filterUserId, undefined); return core; },
    nestShelfCatalogRows: () => { assert.equal(published, core); throw failure; },
  };
  vm.runInNewContext(compiled, context);
  await assert.rejects(context.exports.fetchTopBooksRange({ profileIds: ['owned-us'], start: '2026-10-01', end: '2026-10-16',
    limit: 0, activityDays: 0, onCoreRows: rows => { published = rows; } }), e => e === failure);
  assert.equal(published, core);
});


test('a successful web financial read unions the campaign shelf without replaying local KDP/Ads pages', async () => {
  const core = [{ asin: 'B0ABCDEFGH', royalties: 19, spend: 4, net: 15, ads_state: 'ready' }];
  const campaignOnly = {asin:'B0ABCDEFGI',royalties:null,spend:0,has_campaign:true};
  let published = false, unions = 0;
  const context = { exports: {},
    fetchKdpAccountIdsForRoyaltyQuery: async () => ['owned-kdp'],
    hasNestToken: async () => true,
    hasMobileApiSession: async () => true,
    fetchNestTopBooks: async () => core,
    nestShelfCatalogRows: async () => {assert.equal(published,true);return [campaignOnly];},
    finalizeCatalogBooksList: async (rows, profiles, accounts, limit, shelf) => {
      unions++; assert.equal(rows,core); assert.equal(profiles[0],'owned-us'); assert.equal(accounts[0],'owned-kdp');assert.equal(limit,0);
      return [...rows,...shelf];
    },
    fetchRequiredPages: () => {throw new Error('must not replay local financial pages');},
  };
  vm.runInNewContext(compiled, context);
  const result=await context.exports.fetchTopBooksRange({profileIds:['owned-us'],start:'2026-10-01',end:'2026-10-16',limit:0,activityDays:0,onCoreRows:()=>{published=true;}});
  assert.equal(unions,1);assert.equal(result.length,2);assert.equal(result[0].net,15);assert.equal(result[1].has_campaign,true);
});


test('Amazon Supabase-only login uses verified server financial rows instead of local KDP/Ads replay', async () => {
  const core = [{ asin: 'B0ABCDEFGH', royalties: 19, spend: 4, net: 15, ads_state: 'ready' }];
  let serverReads = 0;
  const context = { exports: {},
    fetchKdpAccountIdsForRoyaltyQuery: async () => ['owned-kdp'],
    hasNestToken: async () => false,
    hasMobileApiSession: async () => true,
    fetchNestTopBooks: async opts => { serverReads++; assert.equal(opts.profileIds[0], 'owned-us'); return core; },
    nestShelfCatalogRows: async () => [],
    finalizeCatalogBooksList: async rows => rows,
    fetchRequiredPages: () => { throw new Error('Supabase-only session incorrectly replayed local financial pages'); },
  };
  vm.runInNewContext(compiled, context);
  const result=await context.exports.fetchTopBooksRange({profileIds:['owned-us'],start:'2026-10-01',end:'2026-10-16',limit:0,activityDays:0});
  assert.equal(serverReads,1); assert.equal(result[0].net,15); assert.equal(result[0].ads_state,'ready');
});

test('server access denial does not fall back to seller local financial reads', async () => {
  for (const status of [401,403]) {
    const denied=Object.assign(new Error('access denied'),{status});
    const context={exports:{},fetchKdpAccountIdsForRoyaltyQuery:async()=>[],hasNestToken:async()=>false,hasMobileApiSession:async()=>true,
      fetchNestTopBooks:async()=>{throw denied;},logBooksStage:()=>{},nestShelfCatalogRows:()=>{throw new Error('must not bypass denial');}};
    vm.runInNewContext(compiled,context);
    await assert.rejects(context.exports.fetchTopBooksRange({profileIds:['owned-us'],start:'2026-10-01',end:'2026-10-16',activityDays:0}),e=>e===denied);
  }
});
