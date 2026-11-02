import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const parse = name => {
  const source = readFileSync(new URL(`../app/(tabs)/${name}.tsx`, import.meta.url), 'utf8');
  return ts.createSourceFile(name + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
const nodes = tree => tree == null ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
function runGate(name, flags = {}) {
  const ast = parse(name);
  const screen = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  const gates = screen.body.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(ast).includes('profilesError'));
  assert.equal(gates.length, 1);
  const env = { exports: {}, React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    selectedProfileIds: [], enabledSelectedIds: [], kdpOnlyBooks: false,
    profilesLoading: false, profilesFetching: false, profilesError: false, adminUsersError: false, ...flags,
    calls: [], refetchProfiles: () => env.calls.push('profiles'),
  };
  for (const name of ['AppScreen', 'TopBar', 'RetryState', 'ScreenSpinner', 'View']) env[name] = name;
  const code = ts.transpileModule(`function render() {${gates[0].getText(ast)}return null;} globalThis.tree = render();`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, env);
  return env;
}

for (const screen of ['products', 'campaigns', 'targeting']) {
  test(`${screen}: unknown account scope is loading/error, never a disconnected-account claim`, () => {
    for (const flag of ['profilesLoading', 'profilesFetching']) {
      const h = runGate(screen, { [flag]: true });
      assert.ok(nodes(h.tree).some(node => node.type === 'ScreenSpinner'));
      assert.ok(nodes(h.tree).some(node => node.type === 'TopBar'));
      assert.equal(h.calls.length, 0);
    }
    const h = runGate(screen, { profilesError: true });
    const retry = nodes(h.tree).find(node => node.type === 'RetryState');
    assert.equal(retry.props.title, "Couldn't load accounts");
    assert.match(retry.props.subtitle, /couldn't be verified/);
    retry.props.onRetry(); assert.deepEqual(h.calls, ['profiles']);
    assert.equal(runGate(screen).tree, null, 'A verified empty scope still reaches the existing empty state');
    assert.equal(runGate(screen, { profilesError: true, selectedProfileIds: ['p'], enabledSelectedIds: ['p'] }).tree, null);
    if (screen === 'products') assert.equal(runGate(screen, { profilesError: true, kdpOnlyBooks: true }).tree, null);
  });
}

test('Home account read error preserves date controls without claiming cached data or a login failure', () => {
  const h = runGate('index', { profilesError: true });
  const header = nodes(h.tree).find(node => node.type === 'TopBar');
  assert.equal(header.props.showProfileSelector, false);
  const retry = nodes(h.tree).find(node => node.type === 'RetryState');
  assert.equal(retry.props.title, "Couldn't load accounts");
  assert.doesNotMatch(retry.props.subtitle, /cached|[Ss]ign (out|in)/);
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /subtitle="Showing cached data"/);
});

test('Home mounts its custom sheet after removal of the separate sticky host', () => {
  const home = parse('index');
  let navigation;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(home) === 'headerNavProps') navigation = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(home);
  const headerSource = readFileSync(new URL('../src/components/OverviewHeaderV3.tsx', import.meta.url), 'utf8');
  const headerAst = ts.createSourceFile('header.tsx', headerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const header = headerAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OverviewHeaderV3');
  const names = new Set(['localCustomOpen', 'customOpen', 'setCustomOpen', 'canCustom', 'ownsSheet']);
  const declarations = header.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => {
    const name = declaration.name;
    return ts.isArrayBindingPattern(name) ? names.has(name.elements[0].name?.text) : names.has(name.text);
  }));
  let expression;
  const findSheet = node => {
    if (ts.isConditionalExpression(node) && node.condition.getText(headerAst).startsWith('ownsSheet &&')) expression = node;
    ts.forEachChild(node, findSheet);
  };
  findSheet(header);
  let open = false;
  const picked = [];
  const env = { React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    CustomRangeSheet: 'CustomRangeSheet', useState: () => [open, value => { open = value; }],
    periodLabel: 'Oct 1-18', periodLoading: false, viewingAsAdmin: false, periodRefreshing: false,
    canGoNextPeriod: false, shiftPeriod() {}, periodMode: 'month', applyPeriodMode() {},
    dateRange: { start: '2026-10-01', end: '2026-10-18' }, applyCustomRange: range => picked.push(range),
  };
  const code = ts.transpileModule(`const props = ${navigation.getText(home)};
    function render() {
      const {dateRange, onCustomRange, customOpen: customOpenProp, onCustomOpenChange} = props;
      ${declarations.map(node => node.getText(headerAst)).join('\n')}
      return {sheet: ${expression.getText(headerAst)}, open: () => setCustomOpen(true)};
    }
    globalThis.props = props; globalThis.render = render;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, env);
  assert.equal(env.props.onCustomOpenChange, undefined, 'Home has no other host to own a controlled sheet');
  let view = env.render();
  assert.equal(view.sheet.type, 'CustomRangeSheet'); assert.equal(view.sheet.props.visible, false);
  view.open(); view = env.render(); assert.equal(view.sheet.props.visible, true);
  view.sheet.props.onClose(); assert.equal(env.render().sheet.props.visible, false); assert.equal(picked.length, 0);
  view.open(); view = env.render(); view.sheet.props.onPick(env.dateRange);
  assert.equal(picked.length, 1); assert.equal(env.render().sheet.props.visible, false);
});
