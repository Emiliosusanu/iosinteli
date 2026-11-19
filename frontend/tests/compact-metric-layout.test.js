import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/Primitives.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Primitives.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['estimateMetricWidth', 'metricStripColumns'].includes(node.name?.text));
const context = { typography: { headline: { fontSize: 17 } }, dashboard: { metricGap: 10 } };
vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const items = ['ACoS', 'Spend', 'Impr', 'Clicks', 'Orders'].map(label => ({ label, value: '0' }));

test('Search terms caps five metrics at three columns on a 14 Pro', () => {
  assert.equal(context.metricStripColumns(items, 328, 1, 3), 3);
  const terms = readFileSync(new URL('../app/more/search-terms.tsx', import.meta.url), 'utf8');
  assert.match(terms, /<MetricStrip\s+maxColumns=\{3\}/);
});

test('metric rows reflow for narrow width, large values and Dynamic Type', () => {
  for (const width of [240, 280, 328, 361, 700]) {
    for (const scale of [1, 1.3, 2, 3]) {
      const columns = context.metricStripColumns(items, width, scale, 3);
      assert.ok(columns >= 1 && columns <= 3);
      if (columns > 1) assert.ok((width - 10 * (columns - 1)) / columns >= 56 * scale);
    }
  }
  assert.equal(context.metricStripColumns(items.map(item => ({ ...item, value: '$123,456.78' })), 328, 1, 3), 2);
  assert.equal(context.metricStripColumns(items.slice(0, 4), 328, 1), 4, 'Books remains four columns when it fits');
  assert.equal(context.metricStripColumns(items, 0, 1, 3), 1);
  assert.equal(context.metricStripColumns([], 328, 1), 1);
});

test('widget headers may wrap without changing unrelated card headers', () => {
  const header = readFileSync(new URL('../src/components/DashboardSurface.tsx', import.meta.url), 'utf8');
  const widget = readFileSync(new URL('../src/components/OverviewSwipeWidget.tsx', import.meta.url), 'utf8');
  assert.match(header, /wrapTitle = false/);
  assert.match(header, /numberOfLines=\{wrapTitle \? 0 : 1\}/);
  assert.match(widget, /<OverviewCardHeader\s+wrapTitle/);
  assert.match(widget, /title=\{headerTitle\}/, 'Keep actual selected page context');
});
