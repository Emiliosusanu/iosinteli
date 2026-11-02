import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
const colors = { tone_good: '#00AA00', tone_danger: '#DD0000', text_tertiary: '#777777' };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/Primitives.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports,
  require(name) {
    if (name === 'react') return { default: { createElement: (type, props, ...children) => ({ type, props, children }) } };
    if (name === 'react-native') return { View: 'View', Text: 'Text', StyleSheet: { create: x => x, hairlineWidth: 0.5 } };
    if (name.endsWith('/theme')) return { useTheme: () => ({ typography: { caption1: {} }, colors }) };
    if (name.endsWith('/ios/Native')) return { SFSymbol: 'Symbol' };
    return {};
  },
});

test('positive and negative trend use identical geometry and explicit arrow/spoken direction', () => {
  const up = exports.StatBadge({ delta: 19 });
  const down = exports.StatBadge({ delta: -19 });
  for (const key of ['paddingHorizontal', 'paddingVertical', 'borderRadius', 'borderWidth', 'gap']) assert.equal(up.props.style[key], down.props.style[key]);
  assert.equal(up.children[0].props.name, 'arrow.up.right');
  assert.equal(down.children[0].props.name, 'arrow.down.right');
  assert.equal(up.props.accessibilityLabel, 'Up 19.0 percent');
  assert.equal(down.props.accessibilityLabel, 'Down 19.0 percent');
  assert.equal(up.children[1].props.style[1].fontWeight, '600');
});

test('inverse/neutral meaning and invalid/zero suppression remain intact', () => {
  assert.equal(exports.StatBadge({ delta: -19, inverse: true }).children[0].props.color, colors.tone_good);
  assert.equal(exports.StatBadge({ delta: 19, neutral: true }).children[0].props.color, colors.text_tertiary);
  for (const delta of [0, NaN, Infinity, -Infinity]) assert.equal(exports.StatBadge({ delta }), null);
});
