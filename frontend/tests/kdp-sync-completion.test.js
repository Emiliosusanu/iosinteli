import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const importer = readFileSync(new URL('../src/lib/kdp/importer.ts', import.meta.url), 'utf8');
const start = importer.indexOf('    let pricingMessage = "";');
const end = importer.indexOf('\n  } catch (e) {', start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(
  `export async function finish() { ${importer.slice(start, end)} }`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function finish({ pricingError = false, pending = 0, authRequired = false, reportError = null } = {}) {
  const exports = {}, snapshots = [], activity = [];
  vm.runInNewContext(compiled, {
    exports, Boolean, Number, String, Error, Date, Promise,
    require: () => ({ scheduleNativeMetronome: async () => {} }),
    accountId: 'account-a', titlesJson: {}, pricingBooksObj: {}, pricingFormatRows: [],
    state: { onboardingDone: true }, wakeMode: 'recent', totalDays: 2,
    leftover: false, reportsMessage: 'Imported 2 days', lastSoftError: reportError,
    isKdpHelperScreenFocused: () => false,
    syncKdpPaperbackPricing: async () => {
      if (pricingError) throw new Error('kdp_titles: Network request failed');
      return { synced: pending || authRequired ? 0 : 10, pending, authRequired };
    },
    setKdpHelperRunning: () => {}, setKdpHelperError: () => {},
    appendKdpActivity: async (message, kind) => activity.push({ message, kind }),
    publishKdpSyncSnapshot: async value => snapshots.push(value),
  });
  const result = await exports.finish();
  return { result, snapshot: snapshots.at(-1), activity };
}

test('pricing transport failure preserves report success but remains retrying without a full completion stamp', async () => {
  const h = await finish({ pricingError: true });
  assert.equal(h.result.days, 2);
  assert.equal(h.result.reason, 'synced_leftover');
  assert.equal(h.snapshot.status, 'Retrying');
  assert.equal(h.snapshot.completedAtMs, undefined);
  assert.equal(h.activity.at(-1).kind, 'info');
  assert.match(h.snapshot.detail, /pricing retry queued/);
});

test('only completed report and price work advances the full completion stamp', async () => {
  const h = await finish();
  assert.equal(h.result.reason, 'synced');
  assert.equal(h.snapshot.status, 'Updated');
  assert.ok(h.snapshot.completedAtMs > 0);
});

test('pricing gate and pending work cannot paint full completion', async () => {
  for (const options of [{ pending: 1 }, { authRequired: true }, { reportError: 'A storefront failed' }]) {
    const h = await finish(options);
    assert.equal(h.snapshot.status, options.authRequired ? 'Action required' : 'Retrying');
    assert.equal(h.snapshot.completedAtMs, undefined);
    assert.notEqual(h.result.reason, 'synced');
  }
});
