const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readKdpFormatRows } = require('../src/lib/kdpFormatRoyalties.ts');

test('does not repeat timeout/auth reads or convert failures to empty data', async () => {
  for (const code of ['57014', '42501', 'SESSION_UNAVAILABLE', '42703']) {
    const error = { code, message: 'unrelated failure' };
    let fallbackCalls = 0;
    await assert.rejects(readKdpFormatRows(async () => { throw error; }, async () => { fallbackCalls++; return []; }), e => e === error);
    assert.equal(fallbackCalls, 0);
  }
});

test('supports schemas missing format columns and preserves fallback failures', async () => {
  const missing = { code: '42703', message: 'column ebook_royalties does not exist' };
  const rows = [{ royalties: 12 }];
  assert.equal(await readKdpFormatRows(async () => { throw missing; }, async () => rows), rows);
  const timeout = { code: '57014' };
  await assert.rejects(readKdpFormatRows(async () => { throw missing; }, async () => { throw timeout; }), e => e === timeout);
});

test('does not use compatibility fallback after a successful read', async () => {
  const rows = [];
  assert.equal(await readKdpFormatRows(async () => rows, async () => { throw new Error('unexpected fallback'); }), rows);
});
