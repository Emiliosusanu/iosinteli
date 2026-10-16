import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { BookRetailObservationCache } from '../src/lib/bookRetailCache.ts';
import { readBookRetailRequests } from '../src/lib/bookRetailRequests.ts';
import { bookRetailAsins, indexProfileBookRetailSnapshots } from '../src/lib/bookRetailMetadata.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function fetchBookRetailMetadata(');
const end = source.indexOf('/** Book keys', start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('real retail query retains working marketplace data and forwards exact admin/customer ASIN scope', async () => {
  const calls = [];
  const context = { exports: {},
    require: name => {
      assert.equal(name, './kdp/shelfHeal.ts');
      return { isQuarantined: () => false };
    },
    bookRetailAsins, readBookRetailRequests, indexProfileBookRetailSnapshots, retailObservationCache: new BookRetailObservationCache(),
    chunkArray: (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n)),
    fetchAmazonProfileBooks: async (profile, opts) => {
      calls.push({ profile, ...opts });
      if (profile === 'GB') throw Object.assign(new Error('temporary outage'), { status: 503 });
      return opts.asins.map(asin => ({ asin, amazonReviewCount: 210, amazonRating: 4.5, amazonStockStatus: 'IN_STOCK' }));
    },
    loadShelfHealQuarantineEntries: async () => [],
  };
  // The quarantine module is independently covered. Keep its filter active in
  // this isolated query evaluation without importing the React Native store.
  vm.runInNewContext(compiled, context);
  const result = await context.exports.fetchBookRetailMetadata({
    books: [{ asin: 'B0ABCDEFGH', book_key: 'B0ABCDEFGH' }],
    adsProfileIds: ['US', 'GB'], filterUserId: 'customer-one', marketplaceCodes: { US: 'US', GB: 'GB' },
  });
  assert.equal(result.failedRequests, 1);
  assert.equal(result.snapshots.B0ABCDEFGH.reviewCount, 210);
  assert.equal(result.snapshots.B0ABCDEFGH.stockStatus, 'IN_STOCK');
  assert.equal(result.snapshots.B0ABCDEFGH.marketplaceCode, 'US');
  assert.ok(calls.every(call => call.filterUserId === 'customer-one' && call.asins.join(',') === 'B0ABCDEFGH'));
});

test('real retail query streams fast markets before a stalled one and reuses overlapping ASIN reads', async () => {
  const calls = [], progress = [];
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const cache = new BookRetailObservationCache();
  const context = { exports: {},
    require: () => ({ isQuarantined: () => false }),
    bookRetailAsins, readBookRetailRequests, indexProfileBookRetailSnapshots, retailObservationCache: cache,
    chunkArray: (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n)),
    fetchAmazonProfileBooks: async (profile, opts) => {
      calls.push({ profile, ...opts });
      if (profile === 'CA') await slow;
      return opts.asins.map(asin => ({ asin, amazonReviewCount: 100, amazonRating: 4.1, amazonStockStatus: 'IN_STOCK' }));
    }, loadShelfHealQuarantineEntries: async () => [],
  };
  vm.runInNewContext(compiled, context);
  const args = { books: [{ asin: 'B0ABCDEFGH', book_key: 'B0ABCDEFGH' }], userId: 'viewer', filterUserId: 'customer',
    adsProfileIds: ['US', 'CA'], marketplaceCodes: { US: 'US', CA: 'CA' }, onProgress: data => progress.push(data) };
  const pending = context.exports.fetchBookRetailMetadata(args);
  try {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.ok(progress.some(data => data.B0ABCDEFGH?.marketplaceCode === 'US'));
  } finally { release(); await pending; }
  const initialCalls = calls.length;
  await context.exports.fetchBookRetailMetadata(args);
  assert.equal(calls.length, initialCalls);
  await context.exports.fetchBookRetailMetadata({ ...args, forceRefresh: true });
  assert.equal(calls.length, initialCalls + 2);
  await context.exports.fetchBookRetailMetadata({ ...args, filterUserId: 'other-customer' });
  assert.equal(calls.length, initialCalls + 4);
  assert.ok(calls.every(call => call.asins.join(',') === 'B0ABCDEFGH' && call.signal instanceof AbortSignal));
});

test('large catalogs keep review reads small enough for the server deadline and visit every exact ASIN', async () => {
  const calls = [];
  const context = { exports: {}, require: () => ({ isQuarantined: () => false }),
    bookRetailAsins, readBookRetailRequests, indexProfileBookRetailSnapshots, retailObservationCache: new BookRetailObservationCache(),
    chunkArray: (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n)),
    fetchAmazonProfileBooks: async (profile, opts) => {
      calls.push({ profile, ...opts });
      // Existing scoped endpoint has a 9s deadline and three review workers;
      // 20 cold ASINs cannot all get an attempt within that deadline.
      assert.ok(opts.asins.length <= 6);
      return opts.asins.map(asin => ({ asin, amazonReviewCount: 1 }));
    }, loadShelfHealQuarantineEntries: async () => [],
  };
  vm.runInNewContext(compiled, context);
  const books = Array.from({ length: 700 }, (_, i) => ({ asin: `B0${String(i).padStart(8, '0')}`, book_key: `b-${i}` }));
  const result = await context.exports.fetchBookRetailMetadata({ books: books.slice(300, 312), userId: 'viewer', adsProfileIds: ['US', 'CA'], marketplaceCodes: { US: 'US', CA: 'CA' } });
  assert.equal(Object.keys(result.snapshots).length, 12);
  assert.deepEqual(calls.slice(0, 2).map(call => call.profile), ['US', 'CA']);
  for (const profile of ['US', 'CA']) assert.deepEqual([...new Set(calls.filter(c => c.profile === profile).flatMap(c => c.asins))].sort(), books.slice(300, 312).map(b => b.asin).sort());
});
