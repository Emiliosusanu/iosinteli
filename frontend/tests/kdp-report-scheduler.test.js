import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mapKdpMarketplacesSettled } from '../src/lib/kdp/vendor/kdp-report-scheduler.js';

test('native sweep stops unstarted stores after a failure and drains active requests', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const started = [];
  let finished = false;
  const pending = mapKdpMarketplacesSettled(['US','CA','GB','DE','FR','IT'], async market => {
    started.push(market);
    if (market === 'CA') throw new Error('HTTP 500');
    await slow;
    return market;
  }, { stopOnFailure: true, pauseMs: 0 }).then(value => { finished = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false);
  release();
  const results = await pending;
  assert.deepEqual(started, ['US','CA','GB']);
  assert.equal(results[1].status, 'rejected');
  assert.ok(results.slice(3).every(row => row.status === 'rejected' && row.skipped));
});

test('native report siblings finish before an error escapes to the deferred-day retry', async () => {
  const source = readFileSync(new URL('../src/lib/kdp/importer.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function fetchDayPayloads(');
  const end = source.indexOf('async function syncOneDay(', start);
  const exports = {};
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  vm.runInNewContext(ts.transpileModule(source.slice(start,end).replace('async function','export async function'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports, fetchJsonForType: async type => {
      if (type === 'orders') throw new Error('HTTP 500');
      if (type === 'kenp') await slow;
      return {};
    }});
  let rejected = false;
  const pending = exports.fetchDayPayloads('2026-10-10','USD',null).catch(error => {
    rejected = true; return error;
  });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(rejected,false);
  release();
  assert.equal((await pending).message,'HTTP 500');
});
