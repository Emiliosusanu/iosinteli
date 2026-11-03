import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveApnsEnvironment } from '../src/lib/apnsEnvironment.ts';

const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('notifications.ts', source, ts.ScriptTarget.Latest, true);
const names = ['pushTokenQueue', 'pushRegistrationFlights', 'pendingPushToken', 'PUSH_TOKEN_REQUEST_BUDGET_MS',
  'withPushTokenQueue', 'retirePushToken', 'registerCurrentPushToken', 'registerForPushAsync',
  'clearNotificationIdentity', 'clearSavedNotificationIdentity'];
function harness(options = {}) {
  let owner = 'owner', stored = options.previous ?? {};
  const upserts = [], updates = [], requests = [], writes = [], signals = [], timers = [];
  const env = { exports: {}, process: {env: {}}, __DEV__: false, Platform: {OS: 'ios'},
    AbortController, setTimeout, clearTimeout, resolveApnsEnvironment,
    notificationIdentityRevision: 0, pendingPushRefresh: false, pendingSilentRefresh: false,
    DEVICE_PUSH_TOKEN_KEY: 'token', ALERT_STATE_KEY: 'ledger', ALERT_CHECK_LAST_RUN_KEY: 'cooldown',
    devWarn: () => {}, resetSyncedTimeZone: () => {}, getNativeApnsEnvironment: async () => 'sandbox',
    currentPermissionGranted: async () => true, ensureNotificationPermission: async () => true,
    readJson: async () => stored,
    storage: { setItem: async (key, value) => {
      writes.push({key, value: JSON.parse(value)});
      if (options.storageFails) return false;
      stored = JSON.parse(value); return true;
    }, removeItem: async key => { if (key === 'token') stored = {}; return true; } },
    Notifications: { getDevicePushTokenAsync: async () => ({data: 'new-device-token', type: 'ios'}),
      cancelAllScheduledNotificationsAsync: async () => {}, dismissAllNotificationsAsync: async () => {},
      clearLastNotificationResponseAsync: async () => {} },
    notificationNestJson: async (path, init) => {
      requests.push({path, method: init.method, body: JSON.parse(init.body), signal: init.signal});
      if (options.nestThrows) throw Error('offline');
      return options.nestReply ?? {success: false};
    },
    supabase: {auth: {
      getSession: async () => ({data: {session: owner ? {user: {id: owner}} : null}}),
      getUser: async () => ({data: {user: owner ? {id: owner} : null}, error: null}),
    }, from: table => {
      assert.equal(table, 'device_push_tokens');
      const query = (kind, row) => {
        const filters = {};
        let promise;
        const builder = {
          eq: (key, value) => { filters[key] = value; return builder; },
          abortSignal: signal => { signals.push(signal); return builder; },
          then: (resolve, reject) => {
            promise ??= (async () => {
              if (kind === 'upsert') {
                upserts.push(row);
                if (options.upsert) return options.upsert(row, signals.at(-1));
                return {error: options.supabaseFails ? {code: '42501'} : null};
              }
              updates.push({...filters, row});
              return {error: options.retireFails ? {code: '42501'} : null};
            })();
            return promise.then(resolve, reject);
          },
        };
        return builder;
      };
      return {upsert: row => query('upsert', row), update: row => query('update', row)};
    }},
  };
  if (options.manualTimers) {
    env.setTimeout = callback => { timers.push(callback); return timers.length; };
    env.clearTimeout = () => {};
  }
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) ? names.includes(node.name?.text) :
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))));
  vm.runInNewContext(ts.transpileModule(nodes.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText, env);
  return {env, upserts, updates, requests, writes, signals, timers, stored: () => stored,
    setOwner: value => { owner = value; }, register: opts => env.exports.registerForPushAsync(opts)};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('failed Supabase and HTTP200 success:false never claim push registration or overwrite the last known token', async () => {
  const h = harness({supabaseFails: true, previous: {token: 'previous', userId: 'owner'}});
  assert.equal((await h.register()).token, null);
  assert.equal(h.stored().token, 'previous');
  assert.equal(h.writes.length, 0);
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 1);
});

test('a confirmed direct registration avoids the duplicate Nest write and persists the signed environment', async () => {
  const h = harness();
  assert.equal((await h.register()).token, 'new-device-token');
  assert.equal(h.upserts.length, 1);
  assert.equal(h.upserts[0].environment, 'sandbox');
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 0);
  assert.equal(h.stored().userId, 'owner');
});

test('only an explicit successful fallback acknowledgement can register after RLS failure', async () => {
  const h = harness({supabaseFails: true, nestReply: {success: true}});
  assert.equal((await h.register()).token, 'new-device-token');
  assert.equal(h.requests.filter(r => r.method === 'PUT').length, 1);
  assert.equal(h.stored().token, 'new-device-token');
});

test('same-account rotation retires only this installation previous token after replacement acknowledgement', async () => {
  const h = harness({previous: {token: 'old-this-phone', userId: 'owner'}});
  await h.register();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].token, 'old-this-phone');
  assert.equal(h.updates[0].user_id, 'owner');
  assert.ok(h.updates[0].row.disabled_at);
  assert.ok(h.updates.every(row => row.token !== 'other-phone'));
});

test('concurrent registration calls share the same device-token write', async () => {
  let release;
  const h = harness({upsert: () => new Promise(resolve => {release = resolve;})});
  const a = h.register(), b = h.register(); await tick();
  assert.equal(h.upserts.length, 1);
  release({error: null});
  assert.equal((await a).token, 'new-device-token');
  assert.equal((await b).token, 'new-device-token');
});

test('logout waits for the outstanding write, then retires it without recording a late successful registration', async () => {
  let release;
  const h = harness({upsert: () => new Promise(resolve => {release = resolve;})});
  const pending = h.register(); await tick();
  const cleanup = h.env.clearNotificationIdentity(); await tick();
  release({error: null});
  assert.equal((await pending).token, null);
  await cleanup;
  assert.equal(h.writes.length, 0);
  assert.ok(h.updates.some(row => row.token === 'new-device-token' && row.user_id === 'owner'));
  assert.equal(h.stored().token, undefined);
});

test('a signed-out registration does not persist a token or call the server', async () => {
  const h = harness(); h.setOwner(null);
  assert.equal((await h.register()).token, null);
  assert.equal(h.upserts.length, 0); assert.equal(h.writes.length, 0);
});

test('storage failure cannot present registration as complete or retire the previous working token', async () => {
  const h = harness({storageFails: true, previous: {token: 'old-this-phone', userId: 'owner'}});
  assert.equal((await h.register()).token, null);
  assert.equal(h.stored().token, 'old-this-phone');
  assert.ok(h.updates.every(row => row.token !== 'old-this-phone'));
});

test('the metadata transport budget aborts the Supabase request and never starts an expired fallback', async () => {
  const h = harness({manualTimers: true, upsert: (_row, signal) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({error: {code: 'AbortError'}}));
  })});
  const pending = h.register(); await tick();
  assert.equal(h.signals.length, 1);
  assert.equal(h.signals[0].aborted, false);
  h.timers[0]();
  assert.equal((await pending).token, null);
  assert.equal(h.signals[0].aborted, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a failed replacement never disables a working previous token', async () => {
  const h = harness({supabaseFails: true, nestThrows: true, previous: {token: 'old-this-phone', userId: 'owner'}});
  assert.equal((await h.register()).token, null);
  assert.equal(h.updates.length, 0);
  assert.equal(h.stored().token, 'old-this-phone');
});

test('failed retirement is retried before any further registration can create another active token', async () => {
  const options = {retireFails: true, previous: {token: 'old-this-phone', userId: 'owner'}};
  const h = harness(options);
  assert.equal((await h.register()).token, null);
  assert.equal(h.upserts.length, 1);
  assert.equal((await h.register()).token, null);
  assert.equal(h.upserts.length, 1, 'do not register again while the old local token remains active');
  options.retireFails = false;
  assert.equal((await h.register()).token, 'new-device-token');
  assert.equal(h.upserts.length, 2);
});

test('detach fallback cannot use the new account bearer to disable another account token', async () => {
  const h = harness({retireFails: true, previous: {token: 'old-this-phone', userId: 'previous-owner'}});
  await h.env.clearNotificationIdentity();
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].user_id, 'previous-owner');
  assert.equal(h.requests.filter(r => r.method === 'DELETE').length, 0);
});

test('an interrupted rotation retains the previous token cleanup across an app restart', async () => {
  const old = harness({retireFails: true, previous: {token: 'old-this-phone', userId: 'owner'}});
  assert.equal((await old.register()).token, null);
  assert.equal(old.stored().retiringToken.token, 'old-this-phone');
  const restarted = harness({previous: structuredClone(old.stored())});
  assert.equal((await restarted.register()).token, 'new-device-token');
  assert.equal(restarted.updates[0].token, 'old-this-phone');
  assert.equal(restarted.stored().retiringToken, undefined);
});

test('a rejected write does not poison the next account registration queue', async () => {
  const options = {supabaseFails: true, nestThrows: true};
  const h = harness(options);
  assert.equal((await h.register()).token, null);
  options.supabaseFails = false;
  assert.equal((await h.register()).token, 'new-device-token');
});
