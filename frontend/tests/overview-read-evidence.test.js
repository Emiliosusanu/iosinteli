import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { optionalMetric } from '../src/lib/metricEvidence.ts';
import { overviewReadLabel, overviewRecommendationRows } from '../src/lib/overviewReadEvidence.ts';
import { keywordsSpendingNoOrders, searchTermsSpendNoOrders, booksSpendingNoAdSales,
  campaignsHighAcos, campaignsLowAcos, compareByAcosAscending } from '../src/lib/overviewWidgets.ts';

test('no-orders recommendations require positive spend and a measured zero, not null or impressions', () => {
  for (const pick of [keywordsSpendingNoOrders, searchTermsSpendNoOrders]) {
    const rows = [null, undefined, '', ' ', false, NaN, Infinity, -1, 1, 0, '0'].map((orders, i) => ({
      id: String(i), total_spend: 5, total_orders: orders,
    }));
    rows.push({ id: 'impressions', total_spend: 0, total_orders: 0, total_impressions: 50 });
    rows.push({ id: 'bad-spend', total_spend: Infinity, total_orders: 0 });
    assert.deepEqual(pick(rows).map(r => r.id), ['9', '10']);
  }
  assert.deepEqual(booksSpendingNoAdSales([
    { asin: 'unknown', spend: 5, sales: null }, { asin: 'spent', spend: 5, sales: 0 },
    { asin: 'impressions', spend: 0, sales: 0, impressions: 100 },
  ]).map(r => r.asin), ['spent']);
});

test('ACoS pages and ascending list distinguish missing ratios from a real zero ratio', () => {
  const rows = [
    { id: 'high', sales: 10, spend: 8, acos: 80 },
    { id: 'unknown', sales: 10, spend: 99, acos: null },
    { id: 'zero', sales: 10, spend: 0, acos: 0 },
    { id: 'no-sales', sales: 0, spend: 90, acos: 0 },
    { id: 'low', sales: 10, spend: 1, acos: 10 },
    { id: 'nan', sales: 10, spend: 1, acos: NaN },
  ];
  assert.deepEqual(campaignsHighAcos(rows).map(r => r.id), ['high', 'low', 'zero']);
  assert.deepEqual(campaignsLowAcos(rows).map(r => r.id), ['zero', 'low', 'high']);
  assert.deepEqual([...rows].sort(compareByAcosAscending).map(r => r.id), ['zero', 'low', 'high', 'unknown', 'no-sales', 'nan']);
});

test('read evidence never claims Amazon freshness or leaves a frozen just-now label', () => {
  const input = { updatedAt: new Date('2026-10-17T12:34:00Z').getTime(), fetching: false, failed: false };
  assert.match(overviewReadLabel(input), /^Server read · /);
  assert.doesNotMatch(overviewReadLabel(input), /just now|fresh|latest/i);
  assert.equal(overviewReadLabel({ ...input, fetching: true }), 'Updating from server');
  assert.equal(overviewReadLabel({ ...input, failed: true }), 'Cached data · update failed');
  assert.equal(overviewReadLabel({ ...input, updatedAt: 0, failed: true }), 'Update unavailable');
  for (const updatedAt of [0, -1, NaN, Infinity]) assert.equal(overviewReadLabel({ ...input, updatedAt }), 'Waiting for server');
});

test('failed cached recommendations disappear without mutating the retained query cache', () => {
  const rows = [{ id: 'old' }];
  assert.deepEqual(overviewRecommendationRows(rows, true), []);
  assert.deepEqual(rows, [{ id: 'old' }]);
  assert.deepEqual(overviewRecommendationRows(rows, false), rows);
  assert.deepEqual(overviewRecommendationRows(undefined, false), []);
});

test('actual ad-group verdict does not invent profit, zeros or period absence', () => {
  const source = readFileSync(new URL('../app/more/ad-groups.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('function adGroupVerdict('), end = source.indexOf('\nfunction emptyCopy', start);
  const context = { optionalMetric };
  vm.runInNewContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const label = item => context.adGroupVerdict(item).label;
  assert.equal(label({ total_sales: 20, total_acos: 35 }), 'ACoS ≤35%');
  assert.equal(label({ total_sales: 20, total_acos: 36 }), 'ACoS >35%');
  assert.equal(label({ total_sales: 20, total_acos: null }), 'Metrics incomplete');
  assert.equal(label({ total_spend: 5, total_orders: null }), 'Metrics incomplete');
  assert.equal(label({ total_spend: 5, total_orders: 0 }), 'Spend without orders');
  assert.equal(label({ total_spend: 0 }), 'No spend in period');
  assert.equal(label({}), 'Metrics incomplete');
});

test('widget bindings expose bounded coverage, source-specific read evidence and truthful list handoffs', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const campaigns = readFileSync(new URL('../app/(tabs)/campaigns.tsx', import.meta.url), 'utf8');
  assert.match(home, /sort: "acos-low"/);
  assert.match(campaigns, /sortKey === "acos-low" \? compareByAcosAscending/);
  assert.match(home, /perf: "converting", sort: "acos", enabledParents: "1"/);
  for (const query of ['topCampaignsQ', 'topBooksQ', 'bleedersQ', 'adGroupsQ', 'searchTermsPulseQ', 'placementMixQ']) {
    assert.ok(home.includes(`${query}.dataUpdatedAt`), query);
    assert.ok(home.includes(`${query}.isError`), query);
  }
  assert.match(home, /key: "kw-unavailable"/);
  assert.match(home, /key: "st-unavailable"/);
  assert.match(home, /Within the top 80 campaigns by spend/);
  assert.match(home, /Within loaded books/);
  assert.doesNotMatch(home, /label: "Best ACoS"/);
});
