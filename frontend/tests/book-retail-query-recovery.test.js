import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
    bookRetailAsins, readBookRetailRequests, indexProfileBookRetailSnapshots,
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
