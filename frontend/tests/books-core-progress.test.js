import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function fetchTopBooksRange(');
const end = source.indexOf('// ---------- Optimization Rules ----------', start);
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('actual Books query publishes the authenticated web rows before slower catalog assembly', async () => {
  const core = [{ asin: 'B0ABCDEFGH', royalties: 19, spend: 4, ads_state: 'ready' }];
  const failure = new Error('catalog unavailable');
  let published;
  const context = { exports: {},
    fetchKdpAccountIdsForRoyaltyQuery: async () => [],
    hasNestToken: async () => true,
    fetchNestTopBooks: async opts => { assert.equal(opts.filterUserId, undefined); return core; },
    nestShelfCatalogRows: () => { assert.equal(published, core); throw failure; },
  };
  vm.runInNewContext(compiled, context);
  await assert.rejects(context.exports.fetchTopBooksRange({ profileIds: ['owned-us'], start: '2026-10-01', end: '2026-10-16',
    limit: 0, activityDays: 0, onCoreRows: rows => { published = rows; } }), e => e === failure);
  assert.equal(published, core);
});
