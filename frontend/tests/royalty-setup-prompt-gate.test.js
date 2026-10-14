import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoyaltySetupPromptGate } from '../src/lib/royaltySetupPromptGate.ts';

test('two mounted tabs cannot present the same native ask during a pending memory write', () => {
  const gate = createRoyaltySetupPromptGate();
  const release = gate.acquire('owner-a', 'no_importer');
  assert.equal(typeof release, 'function');
  assert.equal(gate.acquire('owner-a', 'no_importer'), null);
  release();
  assert.equal(gate.acquire('owner-a', 'no_importer'), null);
});

test('a source change cannot queue another ask over the active dialog', () => {
  const gate = createRoyaltySetupPromptGate();
  const release = gate.acquire('owner-a', 'no_importer');
  assert.equal(gate.acquire('owner-a', 'helper_needs_signin'), null);
  release();
  assert.equal(typeof gate.acquire('owner-a', 'helper_needs_signin'), 'function');
});

test('account memory stays isolated and stale releases cannot close a newer ask', () => {
  const gate = createRoyaltySetupPromptGate();
  const releaseA = gate.acquire('owner-a', 'no_importer');
  assert.equal(gate.acquire('owner-b', 'no_importer'), null);
  releaseA();
  const releaseB = gate.acquire('owner-b', 'no_importer');
  releaseA();
  assert.equal(gate.acquire('owner-b', 'helper_needs_import'), null);
  releaseB();
  assert.equal(typeof gate.acquire('owner-b', 'helper_needs_import'), 'function');
});

test('an explicit setup action remains available after an automatic prompt was answered', () => {
  const gate = createRoyaltySetupPromptGate();
  assert.equal(gate.acquire(null, 'no_importer'), null);
  const release = gate.acquire('owner', 'no_importer');
  release();
  assert.equal(typeof gate.acquire('owner', 'no_importer', false), 'function');
});
