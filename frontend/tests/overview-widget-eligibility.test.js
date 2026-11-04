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
test('Home search terms require live campaign and ad group even for historical observations', () => {
  const rows = ['enabled', 'paused', 'archived'].map((state, i) => ({ id: state,
    campaign_state: state, ad_group_state: state, total_spend: i + 1, total_orders: 0 }));
  assert.deepEqual(searchTermsSpendNoOrders(activeOverviewRows(rows, 'searchTerm')).map(r => r.id), ['enabled']);
});

const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
const begin = source.indexOf('async function overviewReadOwner(');
const end = source.indexOf('// ---------- Keywords ----------', begin);
const compiled = ts.transpileModule(source.slice(begin, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const calls = [];
  const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) },
    from: () => { throw Error('Widget must not download the parent catalog'); },
    rpc: (name, payload) => {
      calls.push({ name, payload });
      const q = { in: (column, ids) => { calls.push({ column, ids }); return q; },
        order: (column, options) => { calls.push({ column, options }); return q; },
        limit: async limit => { calls.push({ limit }); return { data: [{ id: 'group', state: 'enabled', total_spend: 1 }], error: null }; } };
      return q;
    } };
  const context = { exports: {}, supabase,
    fetchMobileTargetingPage: async payload => { calls.push({ payload }); return { rows: [{ id: 'keyword' }] }; } };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, calls };
}
test('widget reads use server period ranking and enabled parent predicates without a client catalog scan', async () => {
  const h = harness();
  const keywords = await h.api.fetchOverviewActiveKeywords(['p'], { start: '2026-10-01', end: '2026-10-16', limit: 1 });
  assert.deepEqual(Array.from(keywords, r => r.id), ['keyword']);
  assert.equal(h.calls[0].payload.state, 'enabled');
  assert.equal(h.calls[0].payload.ownerId, 'owner');
  assert.equal(h.calls[0].payload.start, '2026-10-01');
  assert.equal(h.calls[0].payload.end, '2026-10-16');
  assert.equal(h.calls[0].payload.sort, 'spend');
  assert.equal(h.calls[0].payload.pageSize, 1);
  const groups = await h.api.fetchOverviewActiveAdGroups(['p'], { start: '2026-10-01', end: '2026-10-16', limit: 1 });
  assert.deepEqual(Array.from(groups, r => r.id), ['group']);
  assert.equal(groups[0].campaign_state, 'enabled');
  assert.equal(h.calls[1].name, 'get_ad_groups_with_metrics');
  assert.equal(h.calls[1].payload.p_user_id, 'owner');
  assert.equal(h.calls[1].payload.p_state, 'enabled');
  assert.equal(h.calls[1].payload.p_campaign_status, 'enabled');
  assert.equal(h.calls[1].payload.p_start_date, '2026-10-01');
  assert.equal(h.calls[2].column, 'amazon_profile_id');
  assert.deepEqual(Array.from(h.calls[2].ids), ['p']);
  assert.equal(h.calls[3].column, 'total_spend');
  assert.equal(h.calls.at(-1).limit, 1);
});

test('entity mutations invalidate active widget caches and customer campaign keys cannot collide', () => {
  const invalidation = readFileSync(new URL('../src/lib/invalidateAds.ts', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  for (const root of ['top-campaigns-range-v2', 'bleeding-keywords', 'overview-ad-groups']) assert.ok(invalidation.includes(`"${root}"`));
  assert.match(home, /"top-campaigns-range-v2"[^\n]+adminFilterUserId/);
});
