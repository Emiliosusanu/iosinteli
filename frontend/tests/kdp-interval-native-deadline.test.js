import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveKdpDeliveryDeadline } from '../src/lib/kdp/deliveryDeadline.ts';
import { taskRequestTimeout, KdpTaskBudgetExpired } from '../src/lib/kdp/backgroundBudget.ts';

// Replay the two possible cached lifecycle states at the observed wake:
// timer/planner says processing, but the actual native refresh has 22 seconds.
for (const appState of ['active', 'background', 'inactive', null]) {
  test(`an interval-first processing plan inherits the shorter native refresh clock while ${appState}`, async () => {
    const enteredAtMs = Date.now(), native = enteredAtMs + 22_000;
    const deadline = await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
      appState, readNativeDeadline: async () => native });
    assert.equal(deadline, native);
    assert.throws(() => taskRequestTimeout(deadline, native), KdpTaskBudgetExpired);
  });
}
test('a stricter existing delivery limit cannot be extended by another wake or a processing plan', async () => {
  const enteredAtMs = Date.now();
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
    appState: 'background', requestedDeadlineAtMs: enteredAtMs + 8_000,
    readNativeDeadline: async () => enteredAtMs + 22_000 }), enteredAtMs + 8_000);
});
test('native lookup survives startup overhead without resetting the original task clock', async () => {
  const enteredAtMs = Date.now() - 1_500, native = enteredAtMs + 22_000;
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'recent', enteredAtMs,
    appState: 'background', readNativeDeadline: async () => native }), native);
});
test('an already expired native delivery cannot start a new request even with cached active AppState', async () => {
  const enteredAtMs = Date.now();
  const deadline = await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
    appState: 'active', readNativeDeadline: async () => enteredAtMs - 1 });
  assert.throws(() => taskRequestTimeout(deadline), KdpTaskBudgetExpired);
});
test('real foreground manual work without a native delivery retains its foreground behavior', async () => {
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs: Date.now(),
    appState: 'active', readNativeDeadline: async () => null }), undefined);
});
test('a planner alone cannot grant 120 seconds to a background processing pass', async () => {
  const enteredAtMs = Date.now();
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
    appState: 'background', readNativeDeadline: async () => null }), enteredAtMs + 22_000);
});
test('an actual long native processing delivery retains its delivered budget', async () => {
  const enteredAtMs = Date.now();
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
    appState: 'background', readNativeDeadline: async () => enteredAtMs + 120_000 }), enteredAtMs + 120_000);
});
test('locking during the native deadline read rechecks lifecycle before selecting an unlimited foreground pass', async () => {
  const enteredAtMs = Date.now();
  let state = 'active';
  assert.equal(await resolveKdpDeliveryDeadline({ mode: 'processing', enteredAtMs,
    appState: state, readAppState: () => state,
    readNativeDeadline: async () => { state = 'background'; return null; } }), enteredAtMs + 22_000);
});
test('native bridge preparation cannot hang until iOS expires the whole delivery or start work after a late result', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  let started = false;
  await assert.rejects(async () => {
    await resolveKdpDeliveryDeadline({ mode: 'recent', enteredAtMs: Date.now(),
      appState: 'background', readNativeDeadline: () => pending });
    started = true;
  }, KdpTaskBudgetExpired);
  resolve(Date.now() + 22_000);
  await Promise.resolve();
  assert.equal(started, false);
});

// Execute the actual timer callback, including its second lifecycle check.
const source = readFileSync(new URL('../src/contexts/AppContext.tsx', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('AppContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const timers = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'id'
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(syntax) === 'setInterval'
    && node.initializer.arguments[1]?.getText(syntax).replace(/[\s_]/g, '') === '15*60000') timers.push(node);
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.equal(timers.length, 1, 'Expected one actual fifteen-minute KDP interval');
const effectBody = timers[0].parent.parent.parent;
assert.ok(ts.isBlock(effectBody), 'KDP interval must be declared inside its effect');
// Include the timer's actual local guards/closure, whether its callback is
// inline or delegates to tick. The separate foreground invocation is outside
// this interval contract and is deliberately not executed by the harness.
const timerStatements = effectBody.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => ['active', 'tick', 'id'].includes(declaration.name.getText(syntax))));
const callbackSource = ts.transpileModule(timerStatements.map(statement => statement.getFullText(syntax)).join('\n').replace(
  /import\("([^"]+)"\)/g, (_, name) => `imports[${JSON.stringify(name)}]()`,
), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function timerHarness(state, load) {
  const appState = { currentState: state }, calls = [], imported = [];
  let callback;
  const imports = new Proxy({ '../lib/kdp/importer': async () => {
    imported.push('importer');
    if (load) await load();
    return { runKdpIosHelperTick: async (reason, opts) => calls.push({ reason, opts }) };
  } }, { get(target, name) {
    assert.ok(name in target, `UI timer must not consume a native wake via ${String(name)}`);
    return target[name];
  } });
  vm.runInNewContext(callbackSource, { AppState: appState, imports,
    selectedProfileIds: ['profile'], setInterval: cb => { callback = cb; } });
  return { appState, calls, imported, fire: () => callback() };
}
for (const state of ['background', 'inactive', null]) test(`the actual UI timer does not take the native wake's slot while ${state}`, async () => {
  const h = timerHarness(state); h.fire(); await Promise.resolve();
  assert.deepEqual(h.imported, []); assert.deepEqual(h.calls, []);
});
test('the foreground interval retains auto sync without consuming native wake kind or selecting an ungranted processing mode', async () => {
  const h = timerHarness('active'); h.fire(); await new Promise(r => setImmediate(r));
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].reason, 'interval');
  assert.equal(h.calls[0].opts.wakeMode, undefined);
});
test('locking while the interval imports its module prevents a background timer from starting the importer', async () => {
  let release;
  const h = timerHarness('active', () => new Promise(r => { release = r; }));
  h.fire(); h.appState.currentState = 'background'; release();
  await new Promise(r => setImmediate(r)); assert.deepEqual(h.calls, []);
});
