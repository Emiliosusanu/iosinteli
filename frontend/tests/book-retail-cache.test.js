import assert from 'node:assert/strict';
import test from 'node:test';
import { BookRetailObservationCache } from '../src/lib/bookRetailCache.ts';

test('overlapping viewport reads reuse observed ASINs and request only the new tail', () => {
  const cache = new BookRetailObservationCache();
  cache.write('viewer:customer:US', ['A', 'B'], [{ asin: 'A', amazonReviewCount: 0 }, { asin: 'B', amazonRating: 4 }], 100);
  const result = cache.read('viewer:customer:US', ['B', 'C'], 101);
  assert.equal(result.rows[0].asin, 'B');
  assert.deepEqual(result.missing, ['C']);
});
test('viewer, customer and marketplace profile scopes never share cached observations', () => {
  const cache = new BookRetailObservationCache();
  cache.write('viewer1:customer1:US', ['A'], [{ asin: 'A', amazonReviewCount: 80 }], 100);
  for (const scope of ['viewer2:customer1:US', 'viewer1:customer2:US', 'viewer1:customer1:CA']) {
    assert.deepEqual(cache.read(scope, ['A'], 101), { rows: [], missing: ['A'] });
  }
});
test('unknown observations retry sooner than verified zero and storage stays bounded', () => {
  const cache = new BookRetailObservationCache(2);
  cache.write('s', ['UNKNOWN', 'ZERO'], [{ asin: 'UNKNOWN', amazonReviewCount: null }, { asin: 'ZERO', amazonReviewCount: 0 }], 100);
  assert.deepEqual(cache.read('s', ['UNKNOWN', 'ZERO'], 30_100).missing, ['UNKNOWN']);
  assert.equal(cache.read('s', ['ZERO'], 30_100).rows[0].amazonReviewCount, 0);
  cache.write('s', ['B', 'C'], [{ asin: 'B', amazonReviewCount: 1 }, { asin: 'C', amazonReviewCount: 2 }], 31_000);
  assert.deepEqual(cache.read('s', ['ZERO'], 31_001).missing, ['ZERO']);
  assert.deepEqual(cache.read('s', ['B'], 331_000).missing, ['B']);
});
test('out-of-request ASINs never enter the cache', () => {
  const cache = new BookRetailObservationCache();
  cache.write('s', ['A'], [{ asin: 'OTHER', amazonReviewCount: 900 }], 0);
  assert.deepEqual(cache.read('s', ['OTHER'], 1).missing, ['OTHER']);
  assert.deepEqual(cache.read('s', ['A'], 1).rows, []);
});
