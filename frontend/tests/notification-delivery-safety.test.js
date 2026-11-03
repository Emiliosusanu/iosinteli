import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../src/lib/notificationContract.ts';
import * as digest from '../src/lib/notificationDigest.ts';
import { kdpStallAlertCopy } from '../src/lib/kdpIngestFreshness.ts';

const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('notifications.ts', source, ts.ScriptTarget.Latest, true);
function load(names, env) {
  const nodes = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) ? names.includes(node.name?.text) :
      ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))));
  vm.runInNewContext(ts.transpileModule(nodes.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, env);
}
function localTestHarness() {
  const shown = [], remote = [];
  const env = { exports: {}, notificationIdentityRevision: 0, devWarn: () => {},
    ensureNotificationPermission: async () => true,
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } },
    requestServerTestPush: async () => { remote.push('push'); return true; },
    toDateString: () => '2026-11-03', notificationIdentifier: contract.notificationIdentifier,
    NOTIFICATION_EVENTS: contract.NOTIFICATION_EVENTS,
    TEST_NOTIFICATION_TITLE: 'Test alert', TEST_NOTIFICATION_BODY: 'Local test',
    scheduleLocalAlert: async input => { shown.push(input); },
  };
  load(['localTestInFlight', 'sendLocalTest', 'sendTestNotification'], env);
  return { env, shown, remote, send: id => env.exports.sendTestNotification(id) };
}

test('one explicit iPhone test never broadcasts another push to the account devices', async () => {
  const h = localTestHarness();
  assert.equal(await h.send('owner'), 'local');
  assert.equal(h.shown.length, 1);
  assert.equal(h.remote.length, 0);
});

test('overlapping test taps share a single local notification', async () => {
  const h = localTestHarness();
  assert.deepEqual(await Promise.all([h.send('owner'), h.send('owner')]), ['local', 'local']);
  assert.equal(h.shown.length, 1);
  assert.equal(h.remote.length, 0);
});

test('test failures distinguish permission denial from scheduling or account errors', async () => {
  const h = localTestHarness();
  h.env.ensureNotificationPermission = async () => false;
  assert.equal(await h.send('owner'), 'blocked');
  h.env.ensureNotificationPermission = async () => true;
  h.env.scheduleLocalAlert = async () => { throw Error('native scheduling failed'); };
  assert.equal(await h.send('owner'), 'failed');
  h.env.supabase.auth.getSession = async () => ({ data: { session: null } });
  assert.equal(await h.send(), 'failed');
  assert.equal(h.remote.length, 0);
});

test('an old account test cannot be reused by a new account or report success after logout', async () => {
  const h = localTestHarness();
  let release;
  h.env.ensureNotificationPermission = () => new Promise(resolve => { release = resolve; });
  const old = h.send('owner');
  await new Promise(resolve => setImmediate(resolve));
  const oldPermission = release;
  h.env.notificationIdentityRevision++;
  h.env.supabase.auth.getSession = async () => ({ data: { session: { user: { id: 'new-owner' } } } });
  h.env.ensureNotificationPermission = async () => true;
  assert.equal(await h.send('new-owner'), 'local');
  oldPermission(true);
  assert.equal(await old, 'failed');
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].userId, 'new-owner');
});

test('logout and login to the same account still invalidates an unfinished test', async () => {
  const h = localTestHarness(); let release;
  h.env.ensureNotificationPermission = () => new Promise(resolve => { release = resolve; });
  const pending = h.send('owner');
  await new Promise(resolve => setImmediate(resolve));
  h.env.notificationIdentityRevision++;
  release(true);
  assert.equal(await pending, 'failed');
  assert.equal(h.shown.length, 0);
});

function evaluationHarness(options = {}) {
  let ledger = {}, now = new Date(2026, 10, 3, 12, 0).getTime();
  const shown = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const snapshot = { scope: { currency: 'USD' }, today: { date: '2026-11-03', spend: 10, orders: 2, sales: 30, state: 'verified' } };
  const modules = {
    './dashboardApi': { fetchMobileOverview: async () => {
      if (options.readDelay) now += options.readDelay;
      return snapshot;
    } },
    './backgroundFinancialSync': { resolveBackgroundScope: async () => ({ profileIds: ['profile'], currency: 'USD' }) },
    './queries': { fetchAmazonProfiles: async () => [{ id: 'profile' }], fetchProfileSyncLogs: async () => [],
      fetchTopBooksRange: async () => {
        if (options.books) return options.books;
        throw Error('later book read failed');
      }, fetchAllCampaignBudgets: async () => 1 },
    './kdpIngestMonitor': { loadScopedKdpFreshness: async () => options.stalls ?? [] },
    './kdpRoyaltyScope': { selectKdpRoyaltyScopeForSelection: () => ({ profileIds: [] }) },
  };
  const env = { exports: {}, ...contract, ...digest, kdpStallAlertCopy, Date: Clock, notificationIdentityRevision: 0,
    currentPermissionGranted: async () => true, ALERT_CHECK_COOLDOWN_MS: 900000,
    ALERT_CHECK_LAST_RUN_KEY: 'cooldown', ALERT_STATE_KEY: 'ledger', PREFS_KEY: 'prefs',
    readJson: async key => key === 'prefs' ? (options.prefs ?? { dailyDigest: true, bookAttention: true }) : key === 'ledger' ? ledger : 0,
    writeAlertState: async state => { ledger = structuredClone(state); }, storage: { setItem: async () => {} },
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) } },
    toDateString: date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`, devWarn: () => {},
    digestMoneyAdsProfileIds: () => ['profile'], activatedProfileIds: () => ['profile'],
    filterToEnabledProfileSelection: ids => ids,
    digestFetchGroupsForMoney: () => [{ currency: 'USD', adsIds: ['profile'], selectionIds: ['profile'] }],
    nestMoneyHiddenForDigest: () => false, countFreshCompletedProfiles: () => 1, digestCoverageLine: () => null,
    scheduleLocalAlert: async input => {
      if (options.rejectEntity && (input.asin === options.rejectEntity || input.identifier.endsWith(options.rejectEntity))) throw Error('later schedule failed');
      shown.push(input);
    },
    require: name => { assert.ok(modules[name], `unexpected import ${name}`); return modules[name]; },
  };
  load(['evaluateLocalAlerts'], env);
  return { env, shown, ledger: () => ledger, advance: ms => { now += ms; } };
}

test('a later alert read failure cannot replay an already delivered digest after the cooldown', async () => {
  const h = evaluationHarness();
  assert.equal(await h.env.evaluateLocalAlerts(), 1);
  assert.equal(h.ledger().lastDigestHour, 12, 'record the successful digest before the failing book read');
  h.advance(16 * 60000);
  await h.env.evaluateLocalAlerts();
  assert.equal(h.shown.length, 1, 'same-hour digest must not be shown twice');
});

test('an overspend alert survives a later book read failure without replay', async () => {
  const h = evaluationHarness({ prefs: { campaignSpend: true, bookAttention: true } });
  assert.equal(await h.env.evaluateLocalAlerts(), 1);
  h.advance(16 * 60000);
  await h.env.evaluateLocalAlerts();
  assert.equal(h.shown.length, 1);
  assert.equal(h.ledger().spendAlertDays['2026-11-03'], true);
});

test('successful book and KDP alerts are saved even when the next entity fails to schedule', async () => {
  const cases = [
    { prefs: { bookAttention: true }, books: ['B000000001','B000000002'].map(asin => ({asin, sales: 10, acos: 80, breakEvenAcos: 30})), rejectEntity: 'B000000002' },
    { prefs: { kdpDataStale: true }, stalls: ['first','second'].map(accountId => ({accountId, stale: true, name: accountId})), rejectEntity: 'second' },
  ];
  for (const options of cases) {
    const h = evaluationHarness(options);
    assert.equal(await h.env.evaluateLocalAlerts(), 1);
    h.advance(16 * 60000);
    await h.env.evaluateLocalAlerts();
    assert.equal(h.shown.length, 1);
  }
});

test('a digest that finishes reading outside its intended hour is not delivered late', async () => {
  const h = evaluationHarness({ prefs: { dailyDigest: true }, readDelay: 60 * 60000 });
  assert.equal(await h.env.evaluateLocalAlerts(), 0);
  assert.equal(h.shown.length, 0);
});

test('a read crossing midnight cannot deliver yesterday totals as today', async () => {
  const h = evaluationHarness({ prefs: { dailyDigest: true, campaignSpend: true }, readDelay: 24 * 60 * 60000 });
  assert.equal(await h.env.evaluateLocalAlerts(), 0);
  assert.equal(h.shown.length, 0);
});
