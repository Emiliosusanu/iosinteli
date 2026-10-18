import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { kdpAccountsLinkedToSelection, combineKdpAccountFreshness } from '../src/lib/kdpIngestFreshness.ts';

const source = readFileSync(new URL('../src/lib/kdpIngestMonitor.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function loadScopedKdpFreshness(');
function harness(fetchKdpAccounts, overrides = {}) {
  const context = {
    fetchKdpAccounts, kdpAccountsLinkedToSelection, combineKdpAccountFreshness,
    getKdpRoyaltySource: async () => 'chrome', loadHelperAccountId: async () => null,
    loadHelperSyncState: async () => ({}), loadAccountSignals: async () => new Map(),
    isIosHelperEnabled: () => false, ...overrides,
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source.slice(start), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { ...context, exports });
  return exports.loadScopedKdpFreshness;
}

test('unavailable KDP accounts reject instead of becoming a false no-linked-account result', async () => {
  for (const error of [Object.assign(new Error('Database unavailable'), { status: 503 }), Object.assign(new Error('Statement timeout'), { code: '57014' }), new Error('Network request failed')]) {
    const read = harness(async () => { throw error; });
    await assert.rejects(read(['US']), received => received === error);
  }
});

test('verified empty scope stays empty; linked accounts remain isolated to selected profiles', async () => {
  const empty = harness(async () => []);
  assert.equal((await empty(['US'])).length, 0);
  const now = Date.parse('2026-10-18T07:00:00Z');
  const read = harness(async () => [
    { id: 'own', name: 'Selected', linked_amazon_profile_ids: ['US'], last_synced_at: '2026-10-18T06:59:00Z' },
    { id: 'other', name: 'Unselected', linked_amazon_profile_ids: ['CA'], last_synced_at: '2026-10-18T06:59:00Z' },
  ]);
  const rows = await read(['US'], now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountId, 'own');
  assert.equal(rows[0].stale, false);
  let requests = 0;
  const noScope = harness(async () => { requests++; return []; });
  assert.equal((await noScope([])).length, 0);
  assert.equal(requests, 0);
});

test('local helper storage failure is unavailable, not a false empty linked scope', async () => {
  const error = new Error('Local read failed');
  const read = harness(async () => [{ id: 'own', linked_amazon_profile_ids: ['US'] }], {
    loadHelperSyncState: async () => { throw error; },
  });
  await assert.rejects(read(['US']), received => received === error);
});
