import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { normalizeEntityState } from '../src/lib/campaigns.ts';
const require = createRequire(import.meta.url), ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/overviewAdminWidgets.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(respond) {
  const calls = [];
  const dependencies = {
    './campaigns': { normalizeEntityState },
    './dashboardApi': { fetchAggregatedCampaigns: async opts => { calls.push({ campaigns: opts }); return [{ id: 'campaign-live', state: 'enabled' }, { id: 'campaign-paused', state: 'paused' }]; },
      mapNestKeyword: r => ({ ...r, campaign_id: r.campaignId, ad_group_id: r.adGroupId, status: r.status, amazon_profile_id: r.amazonProfileId, total_spend: r.total_spend }) },
    './rulesApi': { nestApiJson: async path => { const u = new URL('https://qa.invalid' + path); calls.push(u); return respond(u); } },
  };
  const context = { exports: {}, URLSearchParams, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; } };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, calls };
}
const scope = { filterUserId: 'customer', start: '2026-10-01', end: '2026-10-16', limit: 1 };
const group = { id: 'group-live', campaignId: 'campaign-live', state: 'enabled', amazonProfileId: 'US', total_spend: 2 };

test('admin uses customer-scoped API for active parents and walks past a full page of inactive-parent keywords', async () => {
  const h = harness(u => {
    assert.equal(u.searchParams.get('filterUserId'), 'customer');
    assert.equal(u.searchParams.get('startDate'), scope.start);
    assert.equal(u.searchParams.get('endDate'), scope.end);
    assert.equal(u.searchParams.get('campaignStatus'), 'enabled');
    if (u.pathname === '/ad-groups') {
      assert.equal(u.searchParams.get('state'), 'enabled');
      assert.equal(u.searchParams.get('campaignIds'), 'campaign-live');
      return { data: [group, { ...group, id: 'group-paused', state: 'paused' }, { ...group, id: 'wrong-campaign', campaignId: 'campaign-paused' }], hasNextPage: false };
    }
    assert.equal(u.searchParams.get('status'), 'enabled');
    assert.equal(u.searchParams.get('amazonProfileId'), 'US');
    return u.searchParams.get('page') === '1'
      ? { data: Array.from({ length: 200 }, (_, i) => ({ id: 'inactive-' + i, campaignId: 'campaign-live', adGroupId: 'group-paused', status: 'enabled', amazonProfileId: 'US', total_spend: 100 })), hasNextPage: true }
      : { data: [{ id: 'live-keyword', campaignId: 'campaign-live', adGroupId: 'group-live', status: 'enabled', amazonProfileId: 'US', total_spend: 1 }], hasNextPage: false };
  });
  const rows = await h.api.fetchAdminOverviewActiveKeywords(['US'], scope);
  assert.deepEqual(Array.from(rows, r => r.id), ['live-keyword']);
  assert.equal(rows[0].campaign_state, 'enabled'); assert.equal(rows[0].ad_group_state, 'enabled');
  assert.equal(h.calls.filter(c => c.pathname === '/keywords').length, 2);
});
test('admin ad groups preserve API period metrics and reject foreign/paused parents', async () => {
  const h = harness(() => ({ data: [group, { ...group, id: 'foreign', amazonProfileId: 'CA' }, { ...group, id: 'paused', campaignId: 'campaign-paused' }], hasNextPage: false }));
  const rows = await h.api.fetchAdminOverviewActiveAdGroups(['US'], scope);
  assert.deepEqual(Array.from(rows, r => r.id), ['group-live']);
  assert.equal(rows[0].total_spend, 2); assert.equal(rows[0].campaign_id, 'campaign-live');
});
test('API access denial propagates; no admin RLS fallback or invented empty success', async () => {
  const h = harness(() => { throw Object.assign(new Error('denied'), { status: 403 }); });
  await assert.rejects(h.api.fetchAdminOverviewActiveKeywords(['US'], scope), e => e.status === 403);
});
test('empty selected profile scope does not issue an all-customer API request', async () => {
  const h = harness(() => { throw new Error('must not call'); });
  assert.equal((await h.api.fetchAdminOverviewActiveKeywords([], scope)).length, 0);
  assert.equal((await h.api.fetchAdminOverviewActiveAdGroups([], scope)).length, 0);
  assert.equal(h.calls.length, 0);
});
test('repeated ad-group pages fail honestly instead of looping or declaring a complete catalog', async () => {
  const h = harness(() => ({ data: [group], hasNextPage: true }));
  await assert.rejects(h.api.fetchAdminOverviewActiveAdGroups(['US'], scope), /pagination stalled/);
});
test('malformed customer API response is an error, not zero active groups', async () => {
  const h = harness(() => ({ unavailable: true }));
  await assert.rejects(h.api.fetchAdminOverviewActiveAdGroups(['US'], scope), /unavailable/);
});
