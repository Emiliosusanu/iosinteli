import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { motion } from '../src/lib/motion.ts';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const native = read('../src/components/ios/Native.tsx');
const ast = ts.createSourceFile('Native.tsx', native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const searchSource = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'IOSSearchBar').getText(ast);

function renderSearch(reduced = false) {
  const values = [], animations = [], changes = [], cancelled = [], cleanups = [], states = [];
  const env = {
    exports: {}, motion, View: 'View', TextInput: 'TextInput', SFSymbol: 'SFSymbol',
    Animated: { View: 'Animated.View' }, styles: { search: {}, searchInput: {}, searchFocus: {} },
    useTheme: () => ({ colors: { glass_background: '#141417', tone_primary: '#007aff', text_primary: '#fff', text_secondary: '#aaa' } }),
    useReduceMotion: () => reduced,
    useSharedValue: initial => {
      const shared = { value: initial, get() { return this.value; }, set(value) { this.value = value; } };
      values.push(shared); return shared;
    },
    useAnimatedStyle: fn => fn(),
    withSpring: (value, config) => { animations.push({ kind: 'spring', config }); return value; },
    withTiming: (value, config) => { animations.push({ kind: 'timing', config }); return value; },
    cancelAnimation: value => cancelled.push(value),
    React: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useState: initial => [initial, value => states.push(value)],
      useEffect: fn => cleanups.push(fn()),
    },
  };
  vm.runInNewContext(ts.transpileModule(searchSource, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, env);
  const root = env.exports.IOSSearchBar({ value: 'initial', onChangeText: value => changes.push(value), placeholder: 'Search keywords', testID: 'search' });
  const flatten = node => [node, ...node.children.filter(Boolean).flatMap(flatten)];
  const input = flatten(root).find(node => node.type === 'TextInput');
  return { root, input, values, animations, changes, cancelled, cleanups, states };
}

test('search forwards each edit immediately and animates only its decorative icon', () => {
  const h = renderSearch();
  for (const text of ['a', 'ab', '', 'travel guide']) h.input.props.onChangeText(text);
  assert.deepEqual(h.changes, ['a', 'ab', '', 'travel guide']);
  assert.equal(h.input.props.value, 'initial');
  assert.equal(h.animations.filter(item => item.kind === 'spring').length, 4);
  assert.equal(h.input.props.accessibilityLabel, 'Search keywords');
  assert.equal(h.input.props.submitBehavior, 'blurAndSubmit');
  h.input.props.onFocus(); h.input.props.onBlur();
  assert.deepEqual(h.states, [true, false]);
  assert.equal(h.values[1].value, 1);
  assert.ok(h.cancelled.includes(h.values[1]));
  for (const cleanup of h.cleanups) cleanup();
  assert.ok(h.cancelled.includes(h.values[0]));
  assert.doesNotMatch(searchSource, /setTimeout|debounce|borderWidth|borderColor/);
});

test('Reduce Motion keeps search feedback immediate without spring or timing animations', () => {
  const h = renderSearch(true);
  h.input.props.onChangeText('book');
  h.input.props.onFocus(); h.input.props.onBlur();
  assert.deepEqual(h.changes, ['book']);
  assert.equal(h.animations.length, 0);
  assert.equal(h.values[1].value, 1);
});

test('Home never presents an Ads setup conclusion while account evidence is pending or failed', () => {
  const home = read('../app/(tabs)/index.tsx');
  const tree = ts.createSourceFile('index.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'setupHomeStep') initializer = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer);
  for (const id of ['ads_connected', 'profile_activated', 'first_sync']) {
    const next = { id };
    for (let mask = 0; mask < 16; mask++) {
      const result = vm.runInNewContext(initializer, {
        profilesLoading: Boolean(mask & 1), profilesFetching: Boolean(mask & 2),
        profilesError: Boolean(mask & 4), adminUsersError: Boolean(mask & 8),
        setupSnapshot: { next },
      });
      assert.equal(Boolean(result), mask === 0, `${id}, mask ${mask}`);
    }
  }
});

test('overview headers retain semantic titles with stronger captions and unframed icons', () => {
  const source = read('../src/components/DashboardSurface.tsx');
  const header = source.slice(source.indexOf('export function OverviewCardHeader'), source.indexOf('export function OverviewTopRow'));
  assert.match(header, /accessibilityRole="header"/);
  assert.match(header, /t\.colors\.text_primary/);
  assert.match(header, /t\.colors\.text_secondary/);
  assert.doesNotMatch(header, /borderColor|backgroundColor/);
  assert.doesNotMatch(source, /letterSpacing:\s*(?!0[,\s])\d/);
});
