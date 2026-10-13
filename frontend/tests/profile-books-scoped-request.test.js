import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/mutations.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function fetchAmazonProfileBooks(');
const end = source.indexOf('\nexport ', start + 1);
const compiled = ts.transpileModule(source.slice(start, end < 0 ? undefined : end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function runtime() {
  const requests = [];
  const context = { exports: {}, URLSearchParams, nestApiJson: async path => { requests.push(path); return { books: [] }; } };
  vm.runInNewContext(compiled, context);
  return { fetch: context.exports.fetchAmazonProfileBooks, requests };
}
test('real profile-books request is exact-ASIN scoped and retains the view-as owner parameter', async () => {
  const { fetch, requests } = runtime();
  await fetch('profile-1', { filterUserId: 'owner & one', asins: ['b000000001', 'B000000001', 'B000000002'] });
  const url = new URL(requests[0], 'https://example.test');
  assert.equal(url.searchParams.get('asins'), 'B000000001,B000000002');
  assert.equal(url.searchParams.get('filterUserId'), 'owner & one');
});
test('an empty/invalid/oversized scope never falls back to an entire profile request', async () => {
  const { fetch, requests } = runtime();
  await fetch('profile-1', { asins: [] });
  await assert.rejects(fetch('profile-1', { asins: ['invalid'] }));
  await assert.rejects(fetch('profile-1', { asins: Array.from({ length: 81 }, (_, i) => `B${String(i).padStart(9, '0')}`) }));
  assert.equal(requests.length, 0);
});
