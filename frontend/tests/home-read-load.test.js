import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateScopeBoundQueries } from '../src/lib/scopeRefresh.ts';
import { FINANCIAL_QUERY_ROOTS } from '../src/lib/financialReadVersion.ts';
import { aggregateDailyMetricsForDisplay } from '../src/lib/dailyMetrics.ts';
import { overviewAdsProfileIdsForMarket } from '../src/lib/overviewMarketplace.ts';
import { buildFxRateMap } from '../src/lib/fxRates.ts';

const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
const widgets = readFileSync(new URL('../src/components/OverviewChartWidgets.tsx', import.meta.url), 'utf8');
const swipe = readFileSync(new URL('../src/components/OverviewSwipeWidget.tsx', import.meta.url), 'utf8');
const refreshSource = home.slice(home.indexOf('const onRefresh = async () => {'), home.indexOf('\n  if (selectedProfileIds.length === 0', home.indexOf('const onRefresh = async () => {')));

function refreshHarness(client, opts = {}) {
  const states = [];
  let accountReads = 0;
  const noopRead = { refetch: async () => {} };
  const context = {
    queryClient: client, invalidateScopeBoundQueries,
    setRefreshing: value => states.push(value), refreshInFlightRef: { current: false },
    homeVisible: true, guestMode: false, viewingAsAdmin: false, user: { id: 'owner' },
    selectedAdsMarket: null, belowFoldReady: true, kdpOnlyDashboard: false,
    ...Object.fromEntries(['snapshotQ', 'metricsQ', 'royaltiesQ', 'syncLogsQ', 'bootstrapQ', 'prevMetricsQ', 'prevRoyaltiesQ', 'topBooksQ', 'bleedersQ', 'searchTermsPulseQ', 'adGroupsQ', 'adminCampaignsQ', 'topCampaignsQ', 'placementMixQ', 'todayMetricsQ', 'allBudgetsQ', 'budgetHistoryQ', 'ruleExecsQ', 'rulesQ', 'todayStatsQ', 'bidBotStatusQ', 'formatRoyaltiesQ'].map(name => [name, noopRead])),
    royaltySetup: { refetchAccounts: async () => { accountReads++; } }, ...opts,
  };
  vm.runInNewContext(ts.transpileModule(refreshSource + '\nglobalThis.runRefresh = onRefresh;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { run: context.runRefresh, states, get accountReads() { return accountReads; } };
}

test('actual Home refresh revalidates active reads once, invalidates inactive cache, and respects disabled query gates', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const calls = new Map();
  const setup = (root, enabled, active = true) => {
    const queryKey = [root, 'owner', 'US', '2026-10-01', '2026-10-17'];
    client.setQueryData(queryKey, { old: true });
    const observer = new QueryObserver(client, { queryKey, enabled, queryFn: async () => { calls.set(root, (calls.get(root) ?? 0) + 1); return { fresh: true }; } });
    const unsubscribe = active ? observer.subscribe(() => {}) : () => {};
    return { queryKey, observer, unsubscribe };
  };
  const sources = [setup(FINANCIAL_QUERY_ROOTS.campaignMetrics, true), setup('bleeding-keywords', true), setup('bid-engine-status', true), setup('dashboard-campaigns', false), setup('products-range-inactive', true, false), setup('ads-engine-keywords-daily', false)];
  sources.push(setup('overview-budget-history', true));
  try {
    const h = refreshHarness(client, { metricsQ: sources[0].observer, bleedersQ: sources[1].observer, bidBotStatusQ: sources[2].observer, adminCampaignsQ: sources[3].observer });
    await h.run();
    for (const root of [FINANCIAL_QUERY_ROOTS.campaignMetrics, 'bleeding-keywords', 'bid-engine-status', 'overview-budget-history']) assert.equal(calls.get(root), 1);
    for (const root of ['dashboard-campaigns', 'products-range-inactive', 'ads-engine-keywords-daily']) assert.equal(calls.get(root) ?? 0, 0);
    assert.equal(client.getQueryState(sources[4].queryKey).isInvalidated, true);
    assert.deepEqual(h.states, [true, false]);
    assert.equal(h.accountReads, 1);
  } finally { for (const s of sources) { s.unsubscribe(); s.observer.destroy(); } client.clear(); }
});

test('overlapping Home refresh gestures share the running refresh and release the guard after failure', async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const client = { invalidateQueries: () => { calls++; return pending; } };
  const h = refreshHarness(client, { guestMode: true });
  const first = h.run();
  await h.run();
  assert.equal(calls, 2);
  finish();
  await first;
  assert.deepEqual(h.states, [true, false]);
  const failed = refreshHarness({ invalidateQueries: async () => { throw Error('offline'); } }, { guestMode: true });
  await assert.rejects(failed.run(), /offline/);
  assert.deepEqual(failed.states, [true, false]);
  await assert.rejects(failed.run(), /offline/);
});

test('Home pull-to-refresh does not query the owner accounts in customer preview, guest mode, or hidden Home', async () => {
  for (const opts of [{ viewingAsAdmin: true }, { guestMode: true }, { homeVisible: false }, { user: null }]) {
    const h = refreshHarness({ invalidateQueries: async () => {} }, opts);
    await h.run(); assert.equal(h.accountReads, 0);
  }
});

test('Home leaves funnel reads to the mounted swipe page instead of eager warm observers', () => {
  for (const name of ['fetchKeywordDailyAggregate', 'fetchSearchTermDailyAggregate', 'ads-engine-keywords-daily', 'ads-engine-search-terms-daily']) assert.equal(home.includes(name), false, name);
  assert.match(swipe, /\{page\.content\}/);
  assert.doesNotMatch(swipe, /visiblePages\.map\([^)]*content/);
  assert.match(home, /<AdsEngineKeywordsPage\s+active=\{homeVisible\}/);
  assert.match(home, /<AdsEngineSearchTermsPage\s+active=\{homeVisible\}/);
  assert.equal((widgets.match(/enabled: active && ids\.length > 0 && fxReady/g) ?? []).length, 2);
});

test('Ads Engine narrows the existing complete campaign read and does not issue a duplicate market read', () => {
  assert.doesNotMatch(home, /adsWidgetMetricsQ|overview-ads-market-metrics/);
  const body = home.slice(home.indexOf('const adsWidgetDaily ='), home.indexOf('const marketplaceAdsRows ='));
  assert.match(body, /aggregateDailyMetricsForDisplay\(metricRows,/);
  assert.match(body, /moneyProfileIds: adsWidgetProfileIds/);
  const profiles = [{ id: 'us', country_code: 'US' }, { id: 'ca', country_code: 'CA' }];
  const rows = [
    { date: '2026-10-01', amazon_profile_id: 'us', spend: 5, sales: 20, orders: 2, clicks: 8, impressions: 100 },
    { date: '2026-10-01', amazon_profile_id: 'ca', spend: 10, sales: 40, orders: 3, clicks: 10, impressions: 200 },
  ];
  const currency = new Map([['us', 'USD'], ['ca', 'CAD']]);
  const fxRates = buildFxRateMap([{ rate_date: '2026-10-01', from_currency: 'CAD', to_currency: 'USD', rate: 0.75 }]);
  for (const market of ['US', 'CA', null]) {
    const ids = overviewAdsProfileIdsForMarket(['us', 'ca'], profiles, market);
    const options = { moneyProfileIds: ids, displayCurrency: 'USD', profileCurrencyById: currency, fxRates };
    const shared = aggregateDailyMetricsForDisplay(rows, options);
    const separate = aggregateDailyMetricsForDisplay(rows.filter(r => ids.includes(r.amazon_profile_id)), options);
    assert.deepEqual(shared, separate);
    assert.equal(shared[0].spend, market === 'US' ? 5 : market === 'CA' ? 7.5 : 12.5);
    assert.equal(shared[0].clicks, market === 'US' ? 8 : market === 'CA' ? 10 : 18);
  }
  const unknown = aggregateDailyMetricsForDisplay(rows, { moneyProfileIds: ['us', 'ca'], displayCurrency: 'USD', profileCurrencyById: currency, fxRates: new Map() });
  assert.deepEqual(unknown, [], 'a missing conversion rate must not become a partial USD total');
});
