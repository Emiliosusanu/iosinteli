import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NOTIFICATION_EVENTS, parseNotificationPayload, shouldRefreshForNotification,
  shouldPresentNotification, rollAlertState } from '../src/lib/notificationContract.ts';

const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('notifications.ts', source, ts.ScriptTarget.Latest, true);
function harness() {
  let receive;
  const writes = [], removed = [], shown = [], refreshed = [];
  const env = {
    exports: {},
    notificationIdentityRevision: 0, backgroundWakeInstalled: false,
    withPushTokenQueue: async run => run(), pendingPushToken: null,
    pendingPushRefresh: false, pendingSilentRefresh: false,
    Platform: { OS: 'ios' }, AppState: { currentState: 'active' },
    NOTIFICATION_EVENTS, parseNotificationPayload, shouldRefreshForNotification, shouldPresentNotification, rollAlertState,
    ALERT_STATE_KEY: 'state', ALERT_CHECK_LAST_RUN_KEY: 'cooldown', DEVICE_PUSH_TOKEN_KEY: 'token', PREFS_KEY: 'prefs',
    toDateString: () => '2026-11-03', buildNotificationPayload: (event, userId) => ({event, userId}),
    devWarn: () => {}, resetSyncedTimeZone: () => {},
    readJson: async key => key === 'prefs' ? { dailyDigest: true } : {},
    writeAlertState: async state => writes.push(state),
    emitNotificationRefresh: reason => refreshed.push(reason), drainPushRefresh: async () => {},
    storage: { removeItem: async key => removed.push(key) },
    supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'current' } } } }) } },
    Notifications: {
      addNotificationReceivedListener: callback => { receive = callback; },
      scheduleNotificationAsync: async value => { shown.push(value); },
      cancelAllScheduledNotificationsAsync: async () => {}, dismissAllNotificationsAsync: async () => {},
      clearLastNotificationResponseAsync: async () => {},
    },
  };
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ['installBackgroundSyncWakeHandlers', 'clearNotificationIdentity', 'clearSavedNotificationIdentity', 'scheduleLocalAlert'].includes(node.name?.text));
  vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, env);
  env.installBackgroundSyncWakeHandlers();
  return { env, writes, removed, shown, refreshed,
    receive: data => receive({ request: { content: { data } } }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('foreign and local digest receipts cannot suppress the current account digest', async () => {
  for (const data of [
    { event: 'daily_ads_summary', userId: 'previous' },
    { event: 'period-compare', userId: 'current', origin: 'local' },
  ]) {
    const h = harness(); h.receive(data); await flush();
    assert.equal(h.writes.length, 0);
    assert.equal(h.refreshed.length, 0);
  }
  const h = harness(); h.receive({ event: 'daily_ads_summary', userId: 'current' }); await flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.refreshed.length, 1);
});

test('logout clears local cooldown and discards a queued receipt before it writes state', async () => {
  const h = harness(); let release;
  h.env.readJson = key => key === 'state' ? new Promise(resolve => { release = resolve; }) : Promise.resolve({});
  h.receive({ event: 'daily_ads_summary', userId: 'current' }); await flush();
  assert.equal(typeof release, 'function');
  h.env.pendingPushRefresh = true; h.env.pendingSilentRefresh = true;
  await h.env.clearNotificationIdentity();
  release({}); await flush();
  assert.equal(h.writes.length, 0);
  assert.equal(h.refreshed.length, 0);
  assert.ok(h.removed.includes('cooldown'));
  assert.equal(h.env.pendingPushRefresh, false);
  assert.equal(h.env.pendingSilentRefresh, false);
});

test('late local alert refuses a changed account or a preference disabled during its read', async () => {
  const input = { identifier: 'qa', event: 'period-compare', userId: 'previous', title: 'private', body: 'private' };
  const h = harness();
  await assert.rejects(h.env.scheduleLocalAlert(input));
  assert.equal(h.shown.length, 0);
  h.env.readJson = async () => ({ dailyDigest: false });
  await assert.rejects(h.env.scheduleLocalAlert({ ...input, userId: 'current' }));
  assert.equal(h.shown.length, 0);
  await h.env.scheduleLocalAlert({ ...input, event: 'test', userId: 'current' });
  assert.equal(h.shown.length, 1, 'Explicit local test remains available without enabling alerts');
});

test('logout invalidates a local alert while permission-independent preference read is pending', async () => {
  const h = harness(); let release;
  h.env.readJson = key => key === 'prefs' ? new Promise(resolve => { release = resolve; }) : Promise.resolve({});
  const pending = h.env.scheduleLocalAlert({ identifier: 'qa', event: 'period-compare', userId: 'current', title: 'private', body: 'private' });
  await h.env.clearNotificationIdentity();
  release({ dailyDigest: true });
  await assert.rejects(pending);
  assert.equal(h.shown.length, 0);
});

test('local scheduling refuses expired data even if it expires while preferences are being read', async () => {
  const h = harness(); let release;
  let now = Date.now();
  h.env.Date = class extends Date { static now() { return now; } };
  h.env.readJson = () => new Promise(resolve => { release = resolve; });
  const pending = h.env.scheduleLocalAlert({ identifier: 'expired', event: 'period-compare', userId: 'current',
    title: 'old totals', body: 'old totals', expiresAtMs: now + 1000 });
  now += 1001;
  release({ dailyDigest: true });
  await assert.rejects(pending);
  assert.equal(h.shown.length, 0);
});
