import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { homeWidgetStatus } from '../src/lib/queryTimeout.ts';
import { overviewRecommendationRows } from '../src/lib/overviewReadEvidence.ts';
import { activeOverviewRows } from '../src/lib/overviewWidgetEligibility.ts';
import { netRoyalties } from '../src/lib/netRoyalties.ts';

const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
function evaluate(start, end, values, names) {
  const fragment = home.slice(home.indexOf(start), home.indexOf(end, home.indexOf(start)));
  const context = { ...values };
  vm.runInNewContext(ts.transpileModule(fragment + `\nglobalThis.result = {${names.join(',')}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.result;
}
const settled = { isPending: false, isError: false, data: [{ id: 'x' }], error: null };

test('actual Home Campaigns/Books phase follows its own success, empty, failure or timeout despite unrelated pending finance', () => {
  for (const state of [settled, { ...settled, data: [] }, { ...settled, isError: true, data: undefined, error: { code: '57014' } }, { ...settled, isError: true, error: Error('offline') }]) {
    const phases = evaluate('  const campaignsPhase =', '  const daily =', {
      homeWidgetStatus, topCampaignsQ: state, topBooksQ: state, topCampaigns: state.data ?? [], topBooks: state.data ?? [],
      viewingAsAdmin: false, activeBookKeysQ: { isPending: true }, metricsWaiting: true, royaltiesWaiting: true,
    }, ['campaignsWidgetPhase', 'booksWidgetPhase']);
    const expected = homeWidgetStatus({ ...state, isEmpty: state.data?.length === 0 });
    assert.equal(phases.campaignsWidgetPhase, expected === 'stale' ? 'error' : expected);
    assert.equal(phases.booksWidgetPhase, expected === 'stale' ? 'error' : expected);
  }
});

test('actual placement/search/ad-group sources are independent of pending royalties and do not reuse rows after errors', () => {
  const row = { id: 'x', state: 'enabled', status: 'enabled', campaign_state: 'enabled', ad_group_state: 'enabled' };
  for (const isError of [false, true]) {
    const data = evaluate('  const placementMix =', '  const [', {
      periodLoading: true, viewingAsAdmin: false, overviewRecommendationRows, activeOverviewRows,
      placementMixQ: { data: [row], isError }, searchTermsPulseQ: { data: [row], isError }, adGroupsQ: { data: [row], isError },
    }, ['placementMix', 'searchTerms', 'adGroups']);
    for (const values of Object.values(data)) assert.equal(values.length, isError ? 0 : 1);
  }
});

test('actual Gross never displays a retained amount after its source fails, including an active chart scrub', () => {
  for (const scrubbing of [false, true]) {
    for (const failed of ['ads', 'royalties', 'both']) {
      const values = evaluate('  const scrubbing =', '  // Scrub / latch', {
        chartDay: scrubbing ? { royalties: 100, spend: 20, sales: 60, net: 80 } : null,
        viewingAsAdmin: false, royaltiesQ: { isError: failed !== 'ads' }, metricsQ: { isError: failed !== 'royalties' },
        royaltiesWaiting: false, metricsWaiting: false, adsReady: true, kdpRoyaltiesAreKnown: n => n != null,
        totals: { royalties: 100, spend: 20, sales: 60, net: 80 }, paintedFinance: { royalties: 100, spend: 20, sales: 60, net: 80 }, netRoyalties,
      }, ['heroRoyalties', 'heroSpend', 'heroSales', 'heroNet']);
      assert.equal(values.heroNet, null);
      if (failed !== 'royalties') { assert.equal(values.heroSpend, null); assert.equal(values.heroSales, null); }
      if (failed !== 'ads') assert.equal(values.heroRoyalties, null);
    }
  }
});

test('latched finance scope includes actor/customer as well as market/dates/currency', () => {
  assert.match(home, /paintedFinanceRef.current.periodKey !== homeReadContextKey/);
  assert.match(home, /periodKey: homeReadContextKey/);
});
