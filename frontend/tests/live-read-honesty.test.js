import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { shouldPersistQuery } from '../src/lib/queryPersist.ts';
import { targetingFreshnessLabel } from '../src/lib/targetingPageFreshness.ts';
import { shouldRefreshForNotification, shouldPresentNotification } from '../src/lib/notificationContract.ts';
import { createSingleFlight } from '../src/lib/kdp/singleFlight.ts';

const source = readFileSync(new URL('../app/(tabs)/targeting.tsx', import.meta.url), 'utf8');

test('actual Targets read gate waits for hydration, enabled scope and a successful nonempty book map', () => {
  const expression = source.match(/const canReadPage =([\s\S]*?);/)[1];
  const base = { focused: true, filtersReady: true, profilesLoading: false, searchPending: false, scopeProfiles: ['enabled-owned'], bookFilterActive: false, booksQ: { isSuccess: false, isError: false }, bookCampaignIdList: [] };
  const read = change => vm.runInNewContext(expression, { ...base, ...change });
  assert.equal(read({}), true);
  for (const change of [{ filtersReady: false }, { profilesLoading: true }, { scopeProfiles: [] }, { focused: false }, { searchPending: true }, { bookFilterActive: true }, { bookFilterActive: true, booksQ: { isSuccess: false, isError: true } }, { bookFilterActive: true, booksQ: { isSuccess: true } }]) {
    assert.equal(read(change), false);
  }
  assert.equal(read({ bookFilterActive: true, booksQ: { isSuccess: true }, bookCampaignIdList: ['owned-campaign'] }), true);
});

test('restorable Targets head is bounded and cannot be future-dated or older than 15 minutes', () => {
  const now = Date.now();
  const q = { queryKey: ['mobile-targeting-page-v1', 'self', 'owner', 'period', 'profile', 'page-size-100', 'catalog-head'], state: { status: 'success', dataUpdatedAt: now } };
  assert.equal(shouldPersistQuery(q), true);
  assert.equal(shouldPersistQuery({ ...q, queryKey: q.queryKey.filter(v => v !== 'page-size-100') }), false);
  for (const stamp of [now - 900_001, now + 60_000, NaN, 0]) {
    assert.equal(shouldPersistQuery({ ...q, state: { ...q.state, dataUpdatedAt: stamp } }), false);
  }
  assert.equal(shouldPersistQuery({ ...q, state: { ...q.state, status: 'error' } }), false);
});

test('freshness does not equate a recent server check with a successful Amazon sync', () => {
  const base = { now: 100_000, updatedAt: 99_999, fetching: false, failed: false };
  assert.equal(targetingFreshnessLabel(base), 'Server checked just now');
  assert.equal(targetingFreshnessLabel({ ...base, updatedAt: 1 }), 'Cached data · awaiting update');
  assert.equal(targetingFreshnessLabel({ ...base, failed: true }), 'Cached data · update failed');
  assert.equal(targetingFreshnessLabel({ ...base, fetching: true }), 'Updating from server');
  assert.match(source, /setQueryData\(mobilePageQueryKey,[\s\S]*?\{ updatedAt \}\)/);
  assert.match(source, /generation !== catalogGenerationRef\.current/);
});

test('refresh rejects previous-login, local and transport-test alerts', () => {
  assert.equal(shouldRefreshForNotification({ event: 'ads_new_orders', userId: 'owner' }, 'owner'), true);
  assert.equal(shouldRefreshForNotification({ event: 'ads_new_orders', userId: 'other' }, 'owner'), false);
  assert.equal(shouldRefreshForNotification({ silent: true, userId: 'other' }, 'owner'), false);
  assert.equal(shouldRefreshForNotification({ event: 'daily_ads_summary', userId: 'owner', origin: 'local' }, 'owner'), false);
  assert.equal(shouldRefreshForNotification({ event: 'smart_notification_transport_test', userId: 'owner' }, 'owner'), false);
  assert.equal(shouldRefreshForNotification({ event: 'kdp-wake', silent: true }, 'owner'), true);
  assert.equal(shouldRefreshForNotification({ silent: true }, null), false);
  assert.equal(shouldRefreshForNotification({}, 'owner'), false);
});

test('foreground banners respect current preferences and account, while tests remain available', () => {
  const data = { event: 'ads_new_orders', userId: 'owner' };
  assert.equal(shouldPresentNotification(data, 'owner', { newOrder: true }), true);
  assert.equal(shouldPresentNotification(data, 'owner', { newOrder: false }), false);
  assert.equal(shouldPresentNotification(data, 'other', { newOrder: true }), false);
  assert.equal(shouldPresentNotification({ ...data, silent: true }, 'owner', { newOrder: true }), false);
  assert.equal(shouldPresentNotification({ event: 'test', userId: 'owner' }, 'owner', {}), true);
});

test('push and foreground refresh include Home parent-gated widgets and the Search Terms list', () => {
  const app = readFileSync(new URL('../src/contexts/AppContext.tsx', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../src/lib/backgroundFinancialSync.ts', import.meta.url), 'utf8');
  for (const root of ['bleeding-keywords', 'overview-ad-groups', 'search-terms']) {
    assert.ok(app.includes('"' + root + '"'));
    assert.ok(sync.includes('"' + root + '"'));
  }
});

test('overlapping alert evaluations share one job and recover after failure', async () => {
  let calls = 0, finish;
  const run = createSingleFlight(async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const requests = Array.from({ length: 100 }, () => run());
  await Promise.resolve(); assert.equal(calls, 1);
  finish(2); assert.deepEqual(await Promise.all(requests), Array(100).fill(2));
  const next = run(); await Promise.resolve(); assert.equal(calls, 2); finish(3); assert.equal(await next, 3);
  let failures = 0;
  const fail = createSingleFlight(async () => { failures++; throw Error('offline'); });
  await Promise.allSettled([fail(), fail()]); await assert.rejects(fail()); assert.equal(failures, 2);
});

test('enabled search-term pages advance past paused parents and propagate failed parent reads', async () => {
  const queries = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
  const body = queries.slice(queries.indexOf('export async function fetchEnabledSearchTermsPage('), queries.indexOf('export async function fetchOverviewActiveSearchTerms('));
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [];
  const context = { exports: {}, fetchNestSearchTermsPage: async input => { calls.push(input.page); return { page: input.page, hasNextPage: input.page < 3, data: [{ id: input.page }] }; },
    attachParentEntityStates: async (rows, options) => { assert.equal(options.strict, true); return rows; },
    activeOverviewRows: rows => rows.filter(row => row.id === 3) };
  vm.runInNewContext(js, context);
  const result = await context.exports.fetchEnabledSearchTermsPage({ page: 1 });
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(result.page, 3); assert.equal(result.data[0].id, 3);
  context.attachParentEntityStates = async () => { throw Error('offline'); };
  await assert.rejects(context.exports.fetchEnabledSearchTermsPage({ page: 1 }), /offline/);
  await assert.rejects(context.exports.fetchEnabledSearchTermsPage({ page: 1, filterUserId: 'customer' }), /customer preview/);
});
