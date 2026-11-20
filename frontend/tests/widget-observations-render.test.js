import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { optionalMetric } from '../src/lib/metricEvidence.ts';

const source = readFileSync(new URL('../src/components/OverviewWidgetRows.tsx', import.meta.url), 'utf8');
const exports = {};
const element = (type, props, ...children) => ({ type, props: props || {}, children });
const context = { exports, require(name) {
  if (name === 'react') return { default: { createElement: element, Fragment: 'Fragment' } };
  if (name === 'react-native') return { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: x => x, hairlineWidth: 1 } };
  if (name.endsWith('/metricEvidence')) return { optionalMetric };
  if (name.endsWith('/format')) return { formatInt: String, formatCurrency: n => '$' + n, formatPercent: n => n + '%' };
  if (name.endsWith('/theme')) return { acosTone: () => 'neutral', toneColor: () => 'gray', dashboard: {} };
  if (name.endsWith('/netRoyalties')) return { resolveBookNet: b => b.net, bookNetIsKnown: b => b.net != null };
  if (name.endsWith('/kdpTitlePresentation')) return { hasAuthoritativeBreakEven: n => n > 0 };
  if (name.endsWith('/targeting')) return { fallbackAsinCoverUrl: () => null };
  return { BookCover: 'Cover', BookMarketplaceFlags: 'Flags', SFSymbol: 'Symbol' };
} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);
const flatten = n => n == null ? [] : Array.isArray(n) ? n.flatMap(flatten) : typeof n === 'object' ? [n, ...n.children.flatMap(flatten)] : [n];
const text = tree => flatten(tree).filter(n => typeof n === 'string' || typeof n === 'number').join('');
const t = { colors: {}, typography: {}, spacing: { md: 8 } };

test('all five widget row types preserve missing, zero and actual click evidence and their actions', () => {
  const cases = [
    ['KeywordWidgetRow', 'row', 'total_clicks'],
    ['SearchTermWidgetRow', 'row', 'total_clicks'],
    ['AdGroupWidgetRow', 'row', 'total_clicks'],
    ['CampaignWidgetRow', 'campaign', 'clicks'],
    ['BookWidgetRow', 'book', 'clicks'],
  ];
  for (const [component, prop, key] of cases) for (const count of [undefined, null, 0, 18]) {
    let pressed = 0;
    const data = { asin: 'B0ABCDEFGH', name: 'Actual item', title: 'Actual book', spend: 12, total_spend: 12, sales: 24, total_sales: 24, orders: 2, total_orders: 2, acos: 50, total_acos: 50, royalties: 20, net: 8, [key]: count };
    const tree = exports[component]({ [prop]: data, currency: 'USD', t, onPress: () => pressed++ });
    const rendered = text(tree);
    if (count == null) {
      assert.doesNotMatch(rendered, /0 clicks/, component);
      if (prop === 'book') assert.doesNotMatch(rendered, /clicks/);
      else assert.match(rendered, /— clicks/);
    } else assert.ok(rendered.includes(count + ' clicks'), component + ': ' + rendered);
    flatten(tree).find(n => n?.type === 'Button').props.onPress();
    assert.equal(pressed, 1);
  }
});

test('book widget identifies signed KDP corrections and never labels them Ads orders', () => {
  const rendered = text(exports.BookWidgetRow({ book: { asin: 'B0ABCDEFGH', orders: -2, orders_source: 'kdp', spend: 5, sales: 0, royalties: -3, net: -8 }, currency: 'USD', t, onPress() {} }));
  assert.match(rendered, /-2 orders/);
  assert.doesNotMatch(rendered, /KDP units|ad orders|0 clicks/);
  assert.match(rendered, /\$-3/);
});
