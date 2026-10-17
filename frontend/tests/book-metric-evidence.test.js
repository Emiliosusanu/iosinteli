import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optionalMetric, knownMetricSum } from '../src/lib/metricEvidence.ts';
import { mergeTopBookCatalogRows } from '../src/lib/booksListActivity.ts';
import { FINANCIAL_QUERY_ROOTS, isObsoleteFinancialQueryRoot } from '../src/lib/financialReadVersion.ts';

test('absent, invalid and measured zero are distinct observations', () => {
  for (const value of [null, undefined, '', '  ', [], {}, NaN, Infinity, false, -1, 'bad']) assert.equal(optionalMetric(value), null);
  assert.equal(optionalMetric(0), 0); assert.equal(optionalMetric('18'), 18);
  assert.equal(optionalMetric(-2, true), -2);
  assert.equal(knownMetricSum([3, 0, 5]), 8);
  assert.equal(knownMetricSum([3, null]), null);
  assert.equal(knownMetricSum([]), null);
});

test('book catalog merge retains unknown clicks and known actual zero', () => {
  const book = { asin: 'B0ABCDEFGH', book_key: 'B0ABCDEFGH', clicks: null, impressions: null };
  assert.equal(mergeTopBookCatalogRows([book], [book])[0].clicks, null);
  assert.equal(mergeTopBookCatalogRows([book], [{ ...book, clicks: 0 }])[0].clicks, 0);
  assert.equal(mergeTopBookCatalogRows([{ ...book, clicks: 12 }], [book])[0].clicks, 12);
});

test('old fabricated-zero book caches cannot hydrate under the new contract', () => {
  assert.equal(isObsoleteFinancialQueryRoot('top-books-range-complete-v5'), true);
  assert.equal(isObsoleteFinancialQueryRoot('products-range-complete-v6'), true);
  assert.notEqual(FINANCIAL_QUERY_ROOTS.products, 'products-range-complete-v6');
});

test('book widget suppresses missing counts and identifies KDP units separately from Ads orders', () => {
  const rows = readFileSync(new URL('../src/components/OverviewWidgetRows.tsx', import.meta.url), 'utf8');
  assert.match(rows, /book\.clicks != null/);
  assert.match(rows, /book\.orders_source === "kdp" \? "KDP units" : "ad orders"/);
  for (const metric of ['campaign.clicks', 'row.total_clicks']) assert.ok(rows.includes('observedCount(' + metric + ')'));
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /<OverviewHeaderCompactSticky/);
  const header = readFileSync(new URL('../src/components/OverviewHeaderV3.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(header, /<SyncDot/);
  assert.match(header, /busy=\{showRefreshGlow && expandedInteractive\}/);
  assert.match(header, /useReduceMotion/);
});
