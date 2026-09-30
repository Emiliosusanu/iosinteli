const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionRefresh, createSessionIdentityBoundary, createTokenRefreshSingleFlight } = require('../src/lib/sessionRefresh.ts');
const session = (seconds) => ({ access_token: 'unit-token', refresh_token: 'unit-refresh', expires_at: Date.now() / 1000 + seconds, user: { id: 'unit-user' } });
const response = (s, error = null) => ({ data: { session: s }, error });

test('token refresh single-flight shares one request and permits the next generation', async () => {
  const run = createTokenRefreshSingleFlight();
  let calls = 0;
  let release;
  const first = run(async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return 'fresh';
  });
  const second = run(async () => {
    calls++;
    return 'duplicate';
  });
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.equal(await first, 'fresh');
  assert.equal(await second, 'fresh');
  await Promise.resolve();
  assert.equal(await run(async () => { calls++; return 'next'; }), 'next');
  assert.equal(calls, 2);
});

test('20 simultaneous callers share one refresh and receive the fresh session', async () => {
  let reads = 0, refreshes = 0;
  const fresh = session(3600);
  const refresh = createSessionRefresh({
    getSession: async () => { reads++; return response(session(10)); },
    refreshSession: async () => { refreshes++; await new Promise(r => setTimeout(r, 10)); return response(fresh); },
  });
  const all = await Promise.all(Array.from({ length: 20 }, () => refresh.ensure()));
  assert.equal(reads, 1); assert.equal(refreshes, 1);
  assert.ok(all.every(s => s === fresh));
});

test('invalid refresh token is not retried until a new sign-in resets recovery', async () => {
  let attempts = 0;
  const error = { code: 'refresh_token_already_used', status: 400 };
  const refresh = createSessionRefresh({
    getSession: async () => response(session(-1)),
    refreshSession: async () => { attempts++; return response(null, error); },
  });
  for (let i = 0; i < 5; i++) await assert.rejects(refresh.ensure(), e => e === error);
  assert.equal(attempts, 1);
  refresh.reset();
  await assert.rejects(refresh.ensure()); assert.equal(attempts, 2);
});

test('transient failure never releases an expired token and retries after cooldown', async () => {
  let clock = Date.now(), attempts = 0;
  const refresh = createSessionRefresh({
    getSession: async () => response(session(-1)),
    refreshSession: async () => { attempts++; return response(null, { status: 504 }); },
  }, () => clock);
  await assert.rejects(refresh.ensure()); await assert.rejects(refresh.ensure());
  assert.equal(attempts, 1);
  clock += 10001; await assert.rejects(refresh.ensure()); assert.equal(attempts, 2);
});

test('proactive refresh outage preserves still-valid access without a retry storm', async () => {
  let attempts = 0;
  const live = session(600);
  const refresh = createSessionRefresh({
    getSession: async () => response(live),
    refreshSession: async () => { attempts++; return response(null, { status: 504 }); },
  });
  for (let i = 0; i < 5; i++) assert.equal(await refresh.ensure(), live);
  assert.equal(attempts, 1);
});

test('sign-out during recovery cannot return the previous account session', async () => {
  let resolve;
  const refresh = createSessionRefresh({
    getSession: async () => response(session(-1)),
    refreshSession: () => new Promise(r => { resolve = r; }),
  });
  const pending = refresh.ensure();
  await new Promise(r => setImmediate(r));
  refresh.reset(); resolve(response(session(3600)));
  await assert.rejects(pending, /session is unavailable/);
});

test('sign-out also blocks the still-valid fallback when a proactive refresh fails', async () => {
  let resolve;
  const refresh = createSessionRefresh({
    getSession: async () => response(session(600)),
    refreshSession: () => new Promise(r => { resolve = r; }),
  });
  const pending = refresh.ensure();
  await new Promise(r => setImmediate(r));
  refresh.reset(); resolve(response(null, { status: 504 }));
  await assert.rejects(pending, /session is unavailable/);
});

test('SDK hydration SIGNED_IN does not cancel the session restore it is completing', async () => {
  const boundary = createSessionIdentityBoundary();
  const fresh = session(3600);
  const refresh = createSessionRefresh({
    getSession: async () => {
      if (boundary('SIGNED_IN', fresh)) refresh.reset();
      return response(fresh);
    },
    refreshSession: async () => { throw new Error('No extra refresh needed'); },
  });
  assert.equal(await refresh.ensure(), fresh);
  assert.equal(boundary('SIGNED_IN', fresh), false);
  assert.equal(boundary('TOKEN_REFRESHED', fresh), false);
  assert.equal(boundary('SIGNED_IN', { ...fresh, user: { id: 'other' } }), true);
  assert.equal(boundary('SIGNED_OUT', null), true);
  assert.equal(boundary('SIGNED_IN', fresh), true);
});
