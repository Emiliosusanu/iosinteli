import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/OverviewOpsCards.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('cards.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['OverviewBudgetArc', 'OverviewBudgetTodayCard']);
const fragment = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name?.text)).map(n => n.getText(ast)).join('\n');
const element = (type, props, ...children) => typeof type === 'function'
  ? type({ ...props, children }) : { type, props: props ?? {}, children };
const context = { exports: {}, React: { createElement: element },
  useTheme: () => ({ colors: {}, typography: {}, scheme: 'dark' }), useReduceMotion: () => true,
  useMemo: fn => fn(), useEffect() {}, useSharedValue: n => ({ get: () => n, set() {} }),
  useAnimatedStyle: fn => fn(), Animated: { View: 'AnimatedView' },
  StyleSheet: { absoluteFill: {} }, View: 'View', Text: 'Text', styles: {},
  Svg: 'Svg', Defs: 'Defs', SvgGradient: 'Gradient', Stop: 'Stop', Path: 'Path', Circle: 'Circle',
  VerifiedValue: 'VerifiedValue', OpsCardShell: 'Shell', OverviewCardHeader: 'Header', StatusChip: 'Chip',
  formatCurrency: n => '$' + n.toFixed(2),
};
vm.runInNewContext(ts.transpileModule(fragment, { compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, context);
const flatten = n => n == null ? [] : Array.isArray(n) ? n.flatMap(flatten) : typeof n === 'object'
  ? [n, ...n.children.flatMap(flatten)] : [n];
function render(extra = {}) {
  const tree = context.exports.OverviewBudgetTodayCard({ spent: 0, budget: 100, usedPct: 0, danger: false, ...extra });
  const nodes = flatten(tree);
  return { value: nodes.find(n => n?.type === 'VerifiedValue').props.value,
    text: nodes.filter(n => typeof n === 'string').join(' '),
    chips: nodes.filter(n => n?.type === 'Chip').map(n => n.props.label) };
}

test('actual budget card and nested gauge do not render invented zero spend/percent before a verified read', () => {
  for (const todayFailed of [false, true]) {
    const result = render({ spent: 40, todaySynced: false, todayFailed });
    assert.equal(result.value, '—');
    assert.doesNotMatch(result.text, /0%|\$0\.00|\$40\.00/);
    assert.ok(result.text.includes(todayFailed ? 'Spend unavailable' : 'Checking spend'));
    assert.deepEqual(result.chips, [todayFailed ? 'Update unavailable' : 'Waiting for server']);
  }
});

test('actual budget card preserves verified zero and refuses a ratio when the budget is unknown', () => {
  const zero = render();
  assert.equal(zero.value, '$0.00');
  assert.match(zero.text, /0%/);
  const unknownBudget = render({ spent: 40, budgetKnown: false });
  assert.equal(unknownBudget.value, '$40.00');
  assert.doesNotMatch(unknownBudget.text, /40%|\$100\.00|0%/);
  assert.deepEqual(unknownBudget.chips, ['Budget unavailable']);
});

test('Home passes independent query evidence, not only a fallback amount', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(home, /budgetKnown=\{allBudgetsQ\.isSuccess\}/);
  assert.match(home, /todayFailed=\{viewingAsAdmin \? bootstrapQ\.isError : todayMetricsQ\.isError\}/);
});
