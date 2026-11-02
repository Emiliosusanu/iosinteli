import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { rangePresets as makeRangePresets } from '../src/lib/format.ts';

const rangePresets = () => makeRangePresets(new Date(2026, 9, 18, 12));

const source = readFileSync(new URL('../src/components/TopBar.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('TopBar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fragments = ast.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && ['DatePresetList', 'DateRangeControl'].includes(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'styles')),
).map(node => node.getText(ast));
const js = ts.transpileModule(fragments.join('\n') + '\nglobalThis.components = { DatePresetList, DateRangeControl };', {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nodes = tree => tree == null ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
const flattenStyle = value => Object.assign({}, ...(Array.isArray(value) ? value : [value]));
function harness(platform = 'ios') {
  let cursor = 0;
  const states = [], writes = [];
  const range = { start: '2026-10-01', end: '2026-10-18', label: 'This month' };
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });
  const env = { exports: {}, React: { createElement, useEffect() {} }, rangePresets,
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }]; },
    useApp: () => ({ dateRange: range, setDateRange: value => writes.push(value) }),
    useTheme: () => ({ colors: {}, typography: {} }), shortDateRangeContextLabel: () => 'This month',
    formatDateRangeLabel: () => 'Oct 1-18', StyleSheet: { create: value => value, hairlineWidth: 0.5 },
    layout: { minTap: 44 }, density: {}, dashboard: {}, Platform: { OS: platform },
  };
  for (const name of ['View', 'Text', 'Pressable', 'TouchableOpacity', 'SFSymbol', 'IOSDateField', 'Modal', 'ScrollView', 'HeaderPill']) env[name] = name;
  vm.runInNewContext(js, env);
  return { writes, range, preset: env.components.DatePresetList,
    render() { cursor = 0; return env.components.DateRangeControl({}); } };
}

test('both date-sheet Done controls expose button semantics and a real 44pt outer target', () => {
  for (const platform of ['ios', 'android']) {
    const h = harness(platform), tree = h.render();
    const done = nodes(tree).find(node => node.props.testID === 'date-range-done');
    assert.equal(done.type, 'TouchableOpacity');
    assert.equal(done.props.accessibilityRole, 'button');
    assert.equal(done.props.accessibilityLabel, 'Done');
    const style = flattenStyle(done.props.style);
    assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
    nodes(tree).find(node => node.type === 'HeaderPill').props.onPress();
    assert.equal(nodes(h.render()).find(node => node.type === 'Modal').props.visible, true);
    done.props.onPress();
    assert.equal(nodes(h.render()).find(node => node.type === 'Modal').props.visible, false);
    assert.equal(h.writes.length, 0, 'Closing the sheet must not change shared dates');
  }
});

test('custom Apply has a 44pt button and preserves exact chosen dates without an extra state write', () => {
  const h = harness(), picks = [];
  const tree = h.preset({ presets: [], dateRange: h.range, customStart: '2026-09-23', customEnd: '2026-10-07',
    onCustomStart() {}, onCustomEnd() {}, onPick: value => picks.push(value) });
  const apply = nodes(tree).find(node => node.props.testID === 'date-preset-custom');
  assert.equal(apply.props.accessibilityRole, 'button');
  assert.equal(apply.props.accessibilityLabel, 'Apply custom date range');
  const style = flattenStyle(apply.props.style);
  assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
  apply.props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(picks)), [{ start: '2026-09-23', end: '2026-10-07', label: 'Custom' }]);
  assert.equal(h.writes.length, 0);
});

test('date-sheet custom action still rejects reversed or malformed intervals', () => {
  const h = harness(), picks = [];
  for (const [start, end] of [['2026-10-18', '2026-10-01'], ['invalid', '2026-10-18']]) {
    const tree = h.preset({ presets: [], dateRange: h.range, customStart: start, customEnd: end,
      onCustomStart() {}, onCustomEnd() {}, onPick: value => picks.push(value) });
    nodes(tree).find(node => node.props.testID === 'date-preset-custom').props.onPress();
  }
  assert.equal(picks.length, 0);
});

function homeSheet() {
  const source = readFileSync(new URL('../src/components/OverviewHeaderV3.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('OverviewHeaderV3.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CustomRangeSheet');
  const styles = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'styles'));
  const object = styles.declarationList.declarations[0].initializer.arguments[0];
  const needed = new Set(['sheetHeader', 'dateSheetDone', 'presetRow', 'applyCustom', 'sheetFill', 'modalOverlay', 'sheet']);
  const pickedStyles = object.properties.filter(property => needed.has(property.name.getText(ast))).map(property => property.getText(ast));
  const code = ts.transpileModule(`const styles = {${pickedStyles.join(',')}};\n${component.getText(ast)}\nglobalThis.render = CustomRangeSheet;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const writes = [], closes = [];
  const env = { React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    useTheme: () => ({ colors: {}, typography: {} }), useState: value => [value, () => {}], useEffect() {},
    rangePresets, formatDateRangeLabel: range => `${range.start} to ${range.end}`,
    layout: { minTap: 44 }, dashboard: {}, StyleSheet: { hairlineWidth: 0.5 }, Platform: { OS: 'ios' },
  };
  for (const name of ['View', 'Text', 'Pressable', 'TouchableOpacity', 'SFSymbol', 'IOSDateField', 'Modal', 'ScrollView']) env[name] = name;
  vm.runInNewContext(code, env);
  const tree = env.render({ visible: true, dateRange: rangePresets().thisMonth,
    onClose: () => closes.push(true), onPick: range => writes.push(range) });
  return { tree, writes, closes };
}

test('Home custom sheet shares 44pt Done/Apply controls; closing does not apply dates', () => {
  const h = homeSheet();
  for (const id of ['home-custom-done', 'home-custom-apply']) {
    const button = nodes(h.tree).find(node => node.props.testID === id);
    assert.equal(button.props.accessibilityRole, 'button');
    const style = flattenStyle(button.props.style);
    assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
  }
  nodes(h.tree).find(node => node.props.testID === 'home-custom-done').props.onPress();
  assert.equal(h.closes.length, 1); assert.equal(h.writes.length, 0);
  nodes(h.tree).find(node => node.props.testID === 'home-custom-apply').props.onPress();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].start, rangePresets().thisMonth.start);
  assert.equal(h.writes[0].end, rangePresets().thisMonth.end);
  assert.equal(h.writes[0].label, 'Custom');
});

test('Home presets expose dates and selected state without relying on a visual checkmark', () => {
  const h = homeSheet();
  const presets = nodes(h.tree).filter(node => node.props.testID?.startsWith('home-custom-preset-'));
  assert.equal(presets.length, 5);
  assert.equal(presets.filter(node => node.props.accessibilityState.selected).length, 1);
  for (const preset of presets) {
    assert.equal(preset.props.accessibilityRole, 'button');
    assert.match(preset.props.accessibilityLabel, /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
  }
});
