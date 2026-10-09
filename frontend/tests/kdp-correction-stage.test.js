import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/kdp/upsert.ts', import.meta.url), 'utf8');
function harness(patch = {}) {
  const calls = [];
  const modules = {
    '../supabase.ts': { supabase: {} },
    '../rulesApi.ts': { nestApiJson: async (url, request) => {
      const body = JSON.parse(request.body); calls.push({ url, body });
      return { ok: false, quarantined: true, staged: true, candidateId: '44444444-4444-4444-8444-444444444444',
        accountId: body.accountId, date: body.date, revisionId: body.revisionId, ...patch };
    } },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: path => modules[path], Math });
  return { calls, write: (reviewOnly = true) => exports.writeKdpDay({
    accountId: '11111111-1111-4111-8111-111111111111', reviewOnly,
    rowDaily: { date: '2026-10-09', royalties: 0, orders: 0, kenp: 0 },
    rowEntry: { date: '2026-10-09', income: 0, income_currency: 'USD' }, rowsBookDaily: [], factRows: [],
  }) };
}
test('iOS blocked corrections stage the complete capture without any table write', async () => {
  const h = harness(); await h.write();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/kdp-sync/stage-correction');
  assert.equal(h.calls[0].body.dailyData.account_id, h.calls[0].body.accountId);
});
test('iOS never accepts a candidate as sync success or a mismatched stage acknowledgement', async () => {
  await assert.rejects(harness().write(false));
  for (const patch of [{ accountId: 'wrong' }, { candidateId: null }, { ok: true, factRows: 0, submittedBookDailyRows: 0 }]) {
    await assert.rejects(harness(patch).write());
  }
});
test('incomplete native source reports stop before staging a correction', () => {
  const importer = readFileSync(new URL('../src/lib/kdp/importer.ts', import.meta.url), 'utf8');
  const start = importer.indexOf('async function syncOneDay');
  const end = importer.indexOf('async function resolveAccountId', start);
  const flow = importer.slice(start, end);
  assert.ok(flow.indexOf('await fetchDayPayloads(ymd, target.currency, target)') < flow.indexOf('reviewOnly: true'));
  assert.ok(flow.indexOf('reviewOnly: true') < flow.indexOf('throw new Error(`Protected'));
});
