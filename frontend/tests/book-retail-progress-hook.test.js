import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as metadata from '../src/lib/bookRetailMetadata.ts';
import * as windowing from '../src/lib/bookRetailWindow.ts';
import * as recovery from '../src/lib/booksReadRecovery.ts';
const require = createRequire(import.meta.url), ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/hooks/useBookRetailMetadata.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  let cursor = 0, queryOptions, fetchOptions;
  const slots = [];
  const session = { user: { id: 'viewer' } };
  const app = { profiles: [{ id: 'us', profile_id: 'ads-us', country_code: 'US' }], selectedProfileIds: ['us'], adminFilterUserId: 'one', isAdminViewer: true };
  const query = { data: undefined, error: null, refetch: async () => queryOptions.queryFn({ signal: new AbortController().signal }) };
  const react = {
    useMemo: fn => fn(),
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: value => { const i = cursor++; slots[i] ??= value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
  };
  const dependencies = { react, '@tanstack/react-query': { useQuery: opts => { queryOptions = opts; return query; } },
    '@/src/contexts/AuthContext': { useAuth: () => session }, '@/src/contexts/AppContext': { useApp: () => app },
    '@/src/lib/queries': { fetchBookRetailMetadata: async opts => { fetchOptions = opts; return { snapshots: {}, failedRequests: 0 }; } },
    '@/src/lib/booksReadRecovery': recovery, '@/src/lib/bookRetailMetadata': metadata, '@/src/lib/bookRetailWindow': windowing };
  const context = { exports: {}, require: name => { assert.ok(dependencies[name], name); return dependencies[name]; } };
  vm.runInNewContext(compiled, context);
  const render = (books = [{ asin: 'B0ABCDEFGH', book_key: 'B0ABCDEFGH' }], plan = {}) => { cursor = 0; return context.exports.useBookRetailMetadata(books, ['ads-us'], 'retail', [], plan); };
  return { render, app, query, start: async signal => queryOptions.queryFn({ signal }), options: () => fetchOptions, queryOptions: () => queryOptions };
}
const row = { asin: 'B0ABCDEFGH', rating: 4.1, reviewCount: 100, stockStatus: 'IN_STOCK', checkedAt: null, marketplaceCode: 'US' };
test('actual hook renders progress before final query data arrives, then retains both marketplaces', async () => {
  const h = harness(); h.render(); await h.start(new AbortController().signal);
  h.options().onProgress({ B0ABCDEFGH: row });
  assert.equal(h.render().snapshots.B0ABCDEFGH.reviewCount, 100);
  h.query.data = { snapshots: { B0ABCDEFGH: { ...row, marketplaceCode: 'CA', reviewCount: 400 } } };
  const merged = h.render().snapshots.B0ABCDEFGH;
  assert.equal(metadata.highestBookRetailReviewSnapshot(merged, ['US']).reviewCount, 100);
});
test('customer changes and viewport cancellation reject late progress', async () => {
  const h = harness(); h.render(); const controller = new AbortController(); await h.start(controller.signal);
  const previous = h.options(); h.app.adminFilterUserId = 'two'; h.render();
  previous.onProgress({ B0ABCDEFGH: row });
  assert.equal(Object.keys(h.render().snapshots).length, 0);
  await h.start(controller.signal); controller.abort(); h.options().onProgress({ B0ABCDEFGH: row });
  assert.equal(Object.keys(h.render().snapshots).length, 0);
});
test('explicit retry bypasses per-ASIN cache and access denial hides metadata', async () => {
  const h = harness(); const result = h.render(); await result.refresh();
  assert.equal(h.options().forceRefresh, true);
  assert.equal(h.options().userId, 'viewer');
  assert.equal(h.options().filterUserId, 'one');
  h.options().onProgress({ B0ABCDEFGH: row });
  h.query.error = { status: 403 };
  assert.equal(Object.keys(h.render().snapshots).length, 0);
});

test('fresh US progress is visible immediately while an old query response is still cached', async () => {
  const h = harness(); h.query.isFetching = true;
  h.query.data = { snapshots: { B0ABCDEFGH: { ...row, reviewCount: 20 } } };
  h.render(); await h.start(new AbortController().signal);
  h.options().onProgress({ B0ABCDEFGH: { ...row, reviewCount: 101 } });
  assert.equal(h.render().snapshots.B0ABCDEFGH.reviewCount, 101);
  h.query.isFetching = false;
  h.query.data = { snapshots: { B0ABCDEFGH: { ...row, reviewCount: 102 } } };
  assert.equal(h.render().snapshots.B0ABCDEFGH.reviewCount, 102);
});
test('only server-pending cache reads poll and background polling stays disabled', () => {
  const h = harness(); h.render(); const opts = h.queryOptions();
  assert.equal(opts.refetchInterval({ state: { data: { pendingRequests: 1 } } }), 2000);
  assert.equal(opts.refetchInterval({ state: { data: { pendingRequests: 0 } } }), false);
  assert.equal(opts.refetchInterval({ state: {} }), false);
  assert.equal(opts.refetchIntervalInBackground, false);
});


test('scrolling the viewport keeps completed observations while rejecting late old-window progress', async () => {
  const h = harness();
  h.render([{ asin: 'B0ABCDEFGH', book_key: 'a' }], { B0ABCDEFGH: 'US' });
  await h.start(new AbortController().signal);
  const oldRead = h.options();
  oldRead.onProgress({ B0ABCDEFGH: row });
  assert.equal(h.render([{ asin: 'B0ABCDEFGI', book_key: 'b' }], { B0ABCDEFGI: 'US' }).snapshots.B0ABCDEFGH.reviewCount, 100);
  oldRead.onProgress({ B0ABCDEFGH: { ...row, reviewCount: 999 } });
  assert.equal(h.render([{ asin: 'B0ABCDEFGI', book_key: 'b' }], { B0ABCDEFGI: 'US' }).snapshots.B0ABCDEFGH.reviewCount, 100);
});
