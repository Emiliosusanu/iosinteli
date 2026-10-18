import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/components/OverviewSwipeWidget.tsx', import.meta.url), 'utf8');
const element = (type, props, ...children) => ({ type, props: props ?? {}, children });
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports,
  require(name) {
    if (name === 'react') return { default: { createElement: element } };
    if (name === 'react-native') return { View: 'View', Text: 'Text', StyleSheet: { create: value => value } };
    if (name === 'react-native-reanimated') return { Easing: { bezier: () => null } };
    if (name.endsWith('/theme')) return { dashboard: { compactGap: 8 } };
    if (name.endsWith('/Native')) return { SFSymbol: 'Symbol' };
    if (name.endsWith('/OverviewWidgetPageSwipe')) return { OverviewWidgetPageSwipeContext: {} };
    return {};
  },
});
const theme = { colors: { tone_warning: '#AA7700', text_tertiary: '#777777', text_secondary: '#333333' }, typography: { meta: {} } };

test('actual widget state uses explicit evidence, never message-based success or failure', () => {
  for (const [kind, icon] of [['loading', 'arrow.triangle.2.circlepath'], ['error', 'exclamationmark.triangle'], ['timeout', 'clock'], ['offline', 'wifi.slash'], ['info', 'info.circle']]) {
    const tree = exports.SwipeEmpty({ kind, message: 'Same message', t: theme });
    assert.equal(tree.props.testID, `overview-widget-status-${kind}`);
    assert.equal(tree.children[0].children[0].props.name, icon);
    assert.ok(tree.props.style.minHeight >= 44);
    assert.equal(tree.children[1].props.style[1].flex, 1);
  }
  for (const message of ['No per-book data', 'No KDP royalties', 'Book profit is unavailable in this currency view.', 'Loading is only part of this example']) {
    const tree = exports.SwipeEmpty({ message, t: theme });
    assert.equal(tree.props.testID, 'overview-widget-status-info');
    assert.equal(tree.children[0].children[0].props.name, 'info.circle');
  }
});

function runSyncAction(state, stalled) {
  let reads = 0;
  const routes = [];
  const start = home.indexOf('const onSyncChromePress = () => {');
  const end = home.indexOf('const scrubbing', start);
  const context = {
    syncPresentation: { state }, kdpStalled: stalled,
    onRefresh: () => { reads++; return Promise.resolve(); },
    router: { push: route => routes.push(route) },
  };
  vm.runInNewContext(ts.transpileModule(home.slice(start, end) + '\nonSyncChromePress();', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { reads, routes };
}

test('actual Home action retries dashboard reads on refresh failure without starting helper jobs', () => {
  for (const stalled of [false, true]) assert.deepEqual(runSyncAction('failed', stalled), { reads: 1, routes: [] });
  assert.deepEqual(runSyncAction('stale', true), { reads: 0, routes: ['/more/kdp-status'] });
  assert.deepEqual(runSyncAction('stale', false), { reads: 0, routes: ['/more/sync'] });
});

test('financial retry has explicit outer touch bounds and scheme-aware visual feedback', () => {
  const start = home.indexOf('accessibilityLabel="Retry financial data"');
  const button = home.slice(start, home.indexOf('</PressableScale>', start));
  assert.match(button, /containerStyle=\{\{ minHeight: t.layout.minTap/);
  assert.match(button, /arrow.clockwise/);
  assert.match(button, /t.colors.tone_primary/);
});
