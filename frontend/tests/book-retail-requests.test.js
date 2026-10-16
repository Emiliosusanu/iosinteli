import test from 'node:test';
import assert from 'node:assert/strict';
import { readBookRetailRequests } from '../src/lib/bookRetailRequests.ts';
import { indexProfileBookRetailSnapshots, highestBookRetailReviewSnapshot } from '../src/lib/bookRetailMetadata.ts';

test('a failed marketplace does not erase successful reviews and stock', async () => {
  const asin = 'B0ABCDEFGH';
  const result = await readBookRetailRequests(['CA', 'US', 'GB'], async market => {
    if (market === 'GB') throw Object.assign(new Error('temporarily unavailable'), { status: 503 });
    return [{ asin, marketplaceCode: market, amazonReviewCount: market === 'US' ? 210 : 68,
      amazonRating: market === 'US' ? 4.5 : 4.2, amazonStockStatus: 'IN_STOCK' }];
  });
  assert.equal(result.failedRequests, 1);
  const snapshot = indexProfileBookRetailSnapshots(result.rows, [asin], 'CA')[asin];
  assert.equal(snapshot.stockStatus, 'IN_STOCK');
  assert.equal(snapshot.marketplaceCode, 'CA');
  assert.equal(highestBookRetailReviewSnapshot(snapshot).reviewCount, 210);
  assert.equal(highestBookRetailReviewSnapshot(snapshot).rating, 4.5);
});

test('all failed requests preserve the original failure instead of returning an empty success', async () => {
  const error = Object.assign(new Error('network timeout'), { status: 503 });
  await assert.rejects(readBookRetailRequests(['US', 'CA'], async () => { throw error; }), e => e === error);
});

test('authentication and ownership failures remain errors even if another request succeeds', async () => {
  for (const status of [401, 403]) {
    const error = Object.assign(new Error('access rejected'), { status });
    await assert.rejects(readBookRetailRequests(['US', 'CA'], async market => {
      if (market === 'CA') throw error;
      return [{ asin: 'B0ABCDEFGH' }];
    }), e => e === error);
  }
});

test('large viewport requests remain bounded and preserve successful empty results and later chunks', async () => {
  let active = 0, peak = 0;
  const result = await readBookRetailRequests(Array.from({ length: 9 }, (_, i) => i), async i => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    if (i === 1) throw new Error('unavailable');
    return i === 0 ? [] : [{ index: i }];
  });
  assert.equal(peak, 3);
  assert.equal(result.failedRequests, 1);
  assert.deepEqual(result.rows.map(row => row.index), [2, 3, 4, 5, 6, 7, 8]);
});

test('a successful empty marketplace remains distinct from a request failure', async () => {
  assert.deepEqual(await readBookRetailRequests(['US'], async () => []), { rows: [], failedRequests: 0 });
  assert.deepEqual(await readBookRetailRequests([], async () => { throw Error('must not request'); }), { rows: [], failedRequests: 0 });
});
