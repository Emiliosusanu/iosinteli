import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as format from '../src/lib/format.ts';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/AdsEngineReadout.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports,
  require(name) {
    if (name === 'react') return { default: { createElement: (type, props, ...children) => ({ type, props, children }) } };
    if (name === 'react-native') return { View: 'View', Text: 'Text', StyleSheet: { create: x => x } };
    if (name.endsWith('/format')) return format;
    if (name.endsWith('/theme')) return { useTheme: () => ({ typography: { caption2: {}, callout: {} }, colors: {} }) };
    throw Error(name);
  },
});

test('actual readout keeps four distinct metrics and exact spoken counts, including genuine zero', () => {
  const tree = exports.AdsEngineReadout({ label: 'Oct 1 – Oct 18', impressions: 1234567, clicks: 12345, orders: 0, acos: null });
  assert.equal(tree.children[0].children[0], 'Oct 1 – Oct 18');
  const grid = tree.children[1];
  assert.equal(grid.props.style.flexWrap, 'wrap');
  const metrics = grid.children[0];
  assert.equal(metrics.length, 4);
  assert.deepEqual(Array.from(metrics, m => m.props.accessibilityLabel), ['Impressions, 1,234,567', 'Clicks, 12,345', 'Orders, 0', 'ACoS, unavailable']);
  for (const metric of metrics) {
    assert.equal(metric.props.style.width, '25%');
    assert.equal(metric.props.style.minWidth, 64);
    for (const text of metric.children) assert.equal(text.props.numberOfLines, undefined, 'Dynamic Type must wrap rather than ellipsize');
  }
  assert.equal(metrics[3].children[1].children[0], '—');
  assert.equal(metrics[2].children[1].children[0], '0', 'A count is not a money amount with decimal places');
});

test('period and inspected-day readouts render finite ACoS without changing the value', () => {
  for (const acos of [0, 19, 135.5]) {
    const tree = exports.AdsEngineReadout({ label: 'Oct 18', impressions: 5, clicks: 1, orders: 1, acos });
    assert.equal(tree.children[1].children[0][3].children[1].children[0], format.formatPercent(acos));
  }
});
