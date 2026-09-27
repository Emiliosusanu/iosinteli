const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReadQueue, shouldRetryRead } = require('../src/lib/readRequest.ts');

test('bounds parallel reads and does not start a cancelled queued request', async () => {
  const run = createReadQueue(2);
  let active = 0, peak = 0, starts = 0;
  const releases = [];
  const task = () => new Promise(resolve => { starts++; active++; peak = Math.max(peak, active); releases.push(() => { active--; resolve('real-response-placeholder'); }); });
  const a = run(task), b = run(task);
  const controller = new AbortController();
  const c = run(task, controller.signal);
  controller.abort();
  await assert.rejects(c, { name: 'AbortError' });
  await new Promise(r => setImmediate(r));
  releases.forEach(r => r()); await Promise.all([a, b]);
  assert.equal(starts, 2); assert.equal(peak, 2);
});

test('times out waiting reads without firing a late request', async () => {
  const run = createReadQueue(1);
  let release, starts = 0;
  const first = run(() => new Promise(r => { release = r; }));
  const second = run(async () => { starts++; }, null, 10);
  await assert.rejects(second, { name: 'AbortError' });
  release(); await first;
  assert.equal(starts, 0);
});

test('aborts active network work at the deadline and frees a slot', async () => {
  const run = createReadQueue(1);
  await assert.rejects(run(signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))), null, 10), { name: 'AbortError' });
  assert.equal(await run(async () => 'next'), 'next');
});

test('does not retry auth, schema or database timeout failures', () => {
  for (const code of ['57014', '42501', '42703', 'SESSION_UNAVAILABLE']) assert.equal(shouldRetryRead(0, { code }), false);
  for (const status of [400, 401, 403, 404]) assert.equal(shouldRetryRead(0, { status }), false);
  assert.equal(shouldRetryRead(0, { status: 503 }), true);
  assert.equal(shouldRetryRead(1, { status: 503 }), false);
  assert.equal(shouldRetryRead(0, new Error('HOME_QUERY_TIMEOUT')), false);
});

test('a transport ignoring abort cannot hang the caller or exceed the concurrency limit', async () => {
  const run = createReadQueue(1);
  let release, signal;
  let secondStarted = false;
  const first = run(s => { signal = s; return new Promise(r => { release = r; }); }, null, 10);
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  const second = run(async () => { secondStarted = true; return 'next'; });
  await new Promise(r => setImmediate(r));
  assert.equal(secondStarted, false);
  release('late result');
  assert.equal(await second, 'next');
});

test('scope cancellation rejects active work even when transport resolves late', async () => {
  const run = createReadQueue(1);
  const upstream = new AbortController();
  let release, signal;
  const first = run(s => { signal = s; return new Promise(r => { release = r; }); }, upstream.signal);
  await new Promise(r => setImmediate(r));
  upstream.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(signal.aborted, true);
  release('obsolete scope');
  assert.equal(await run(async () => 'current scope'), 'current scope');
});
