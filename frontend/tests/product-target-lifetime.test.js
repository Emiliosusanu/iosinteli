import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAllTimeProductTargetWindow } from '../src/lib/productTargetLifetime.ts';

const today = '2026-10-25';
test('All Time detection stays a date helper and does not authorize a stored-row bypass', () => {
  assert.equal(isAllTimeProductTargetWindow('2018-01-01', today, today), true);
  assert.equal(isAllTimeProductTargetWindow('2026-10-01', today, today), false);
  assert.equal(isAllTimeProductTargetWindow('2018-01-01', '2026-10-24', today), false);
  const source = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /readStoredLifetimeProductTargetPage|storedLifetimeProductTargetQuery/);
  assert.match(source, /!isAllTimeProductTargetWindow\(opts\.start, opts\.end\)/);
});
