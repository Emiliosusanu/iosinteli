import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { activeOverviewRows } from '../src/lib/overviewWidgetEligibility.ts';
import { searchTermsSpendNoOrders } from '../src/lib/overviewWidgets.ts';

test('widget keywords require their own state and both active parents, including uppercase aliases', () => {
  const live = { id: 'live', status: 'ENABLED', campaign_state: 'active', ad_group_state: 'enabled' };
  const rows = [live, { ...live, id: 'kw-paused', status: 'paused' },
    { ...live, id: 'campaign-paused', campaign_state: 'paused' },
    { ...live, id: 'group-archived', ad_group_state: 'archived' },
    { ...live, id: 'parent-unknown', campaign_state: null }];
  assert.deepEqual(activeOverviewRows(rows, 'keyword').map(r => r.id), ['live']);
});
test('campaign and ad-group widgets exclude archived, paused and missing parent states', () => {
  const rows = [{ id: 'live', state: 'enabled', campaign_state: 'enabled' },
    { id: 'campaign-paused', state: 'active', campaign_state: 'paused' },
    { id: 'unknown', state: 'enabled' }, { id: 'archived', state: 'archived', campaign_state: 'enabled' }];
  assert.deepEqual(activeOverviewRows(rows, 'adGroup').map(r => r.id), ['live']);
  assert.deepEqual(activeOverviewRows(rows, 'campaign').map(r => r.id), ['live', 'campaign-paused', 'unknown']);
});
test('historical search terms remain eligible even under inactive campaigns or groups', () => {
  const rows = ['enabled', 'paused', 'archived'].map((state, i) => ({ id: state,
    campaign_state: state, ad_group_state: state, total_spend: i + 1, total_orders: 0 }));
  assert.deepEqual(searchTermsSpendNoOrders(rows).map(r => r.id), ['archived', 'paused', 'enabled']);
});

const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
const begin = source.indexOf('async function fetchOverviewActiveGroupScope(');
const end = source.indexOf('// ---------- Keywords ----------', begin);
const compiled = ts.transpileModule(source.slice(begin, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const campaigns = [{ id: 'live', state: 'enabled', amazon_profile_id: 'p' }, { id: 'off', state: 'paused', amazon_profile_id: 'p' }];
  const groups = [
    ...Array.from({ length: 100 }, (_, i) => ({ id: `bad-${i}`, campaign_id: 'off', state: 'enabled', amazon_profile_id: 'p', total_spend: 10000 })),
    { id: 'paused-group', campaign_id: 'live', state: 'paused', amazon_profile_id: 'p', total_spend: 20000 },
    { id: 'good', campaign_id: 'live', state: 'enabled', amazon_profile_id: 'p', total_spend: 1 },
    { id: 'foreign', campaign_id: 'live', state: 'enabled', amazon_profile_id: 'other', total_spend: 1 },
  ];
  const calls = [];
  const supabase = { from: table => {
    let rows = [...(table === 'campaigns' ? campaigns : groups)];
    const q = { select: () => q, in: (column, ids) => { rows = rows.filter(r => ids.includes(r[column])); return q; },
      order: () => q, range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }) };
    return q;
  } };
  const context = { exports: {}, supabase, fetchAllPages: async build => (await build(0, 999)).data,
    chunkArray: (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n)),
    mapPoolLimited: async (xs, limit, fn) => { assert.equal(limit, 3); return Promise.all(xs.map(fn)); },
    fetchKeywords: async (profiles, opts) => { calls.push({ profiles, opts }); return opts.adGroupIds.map(id => ({ id: 'kw-' + id, campaign_id: 'live', ad_group_id: id, status: 'enabled', campaign_state: 'enabled', ad_group_state: 'enabled', total_spend: 5 })); },
    fetchMetricTotalsByEntity: async () => new Map(), emptyTotals: () => ({}), applyMetricTotals: row => row };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, calls };
}
test('actual widget query resolves active parents before top-N; 100 paused-parent groups cannot crowd out live rows', async () => {
  const h = harness();
  const keywords = await h.api.fetchOverviewActiveKeywords(['p'], { start: '2026-10-01', end: '2026-10-16', limit: 1 });
  assert.deepEqual(Array.from(keywords, r => r.id), ['kw-good']);
  assert.equal(h.calls[0].opts.status, 'enabled');
  assert.deepEqual(Array.from(h.calls[0].opts.adGroupIds), ['good']);
  const groups = await h.api.fetchOverviewActiveAdGroups(['p'], { start: '2026-10-01', end: '2026-10-16', limit: 1 });
  assert.deepEqual(Array.from(groups, r => r.id), ['good']);
  assert.equal(groups[0].campaign_state, 'enabled');
});

test('entity mutations invalidate active widget caches and customer campaign keys cannot collide', () => {
  const invalidation = readFileSync(new URL('../src/lib/invalidateAds.ts', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  for (const root of ['top-campaigns-range-v2', 'bleeding-keywords', 'overview-ad-groups']) assert.ok(invalidation.includes(`"${root}"`));
  assert.match(home, /"top-campaigns-range-v2"[^\n]+adminFilterUserId/);
});
