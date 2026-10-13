import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookKdpCoverage } from '../src/lib/bookKdpCoverage.ts';
const book = asin => ({ asin, book_key: asin, format_asins: [asin] });
const range = { start: '2026-10-11', end: '2026-10-12' };
const full = [{ account_id: 'vps', date: range.start }, { account_id: 'vps', date: range.end }];

test('Mary missing a day does not mark a VPS book partial', () => {
  const state = createBookKdpCoverage([...full, { account_id: 'mary', date: range.start }],
    [{ account_id: 'vps', asin: 'B000000001' }, { account_id: 'mary', asin: 'B000000002' }], ['vps', 'mary'], range);
  assert.equal(state(book('B000000001')), 'ready');
  assert.equal(state(book('B000000002')), 'partial');
});
test('a shared edition needs coverage from both owning accounts', () => {
  const state = createBookKdpCoverage(full,
    [{ account_id: 'vps', asin: 'B000000001' }, { account_id: 'mary', asin: 'B000000001' }], ['vps', 'mary'], range);
  assert.equal(state(book('B000000001')), 'partial');
});
test('duplicate dates and out-of-range rows cannot hide a missing day', () => {
  const state = createBookKdpCoverage([full[0], full[0], { account_id: 'vps', date: '2026-10-13' }],
    [{ account_id: 'vps', asin: 'B000000001' }], ['vps'], range);
  assert.equal(state(book('B000000001')), 'partial');
});
test('failed reads and unknown ownership remain partial; an unselected account cannot affect another book', () => {
  const identities = [{ account_id: 'vps', asin: 'B000000001' }, { account_id: 'foreign', asin: 'B000000001' }];
  assert.equal(createBookKdpCoverage(null, identities, ['vps'], range)(book('B000000001')), 'partial');
  const state = createBookKdpCoverage(full, identities, ['vps'], range);
  assert.equal(state(book('B000000001')), 'ready');
  assert.equal(state(book('B000000002')), 'partial');
});
test('zero-sales coverage counts and sibling editions use the actual owning accounts', () => {
  const state = createBookKdpCoverage(full, [{ account_id: 'vps', asin: 'B000000002' }], ['vps'], range);
  assert.equal(state({ asin: 'B000000001', book_key: 'DIGITAL=B000000001:PRINT=B000000002::', format_asins: ['B000000002'] }), 'ready');
});
