import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  failureFromUnknown,
  productTargetResubmitBlocked,
  unconfirmedCreateNotice,
} from '../src/lib/productTargetCreateOutcome.ts';

test('a finished Amazon rejection can be submitted again', () => {
  assert.equal(productTargetResubmitBlocked({
    code: 'PRODUCT_TARGET_CREATE_REJECTED',
    statusCode: 400,
    message: 'Amazon rejected these product targets.',
  }), false);
  assert.equal(productTargetResubmitBlocked({ statusCode: 400, message: 'Select at least one verified product target.' }), false);
});

test('an unconfirmed or timed-out create cannot be submitted again', () => {
  const cases = [
    { code: 'PRODUCT_TARGET_CREATE_UNCONFIRMED', statusCode: 409, message: 'Amazon did not confirm these product targets. Refresh the ad group before submitting them again.' },
    { message: 'Amazon did not create any product targets.' },
    { message: 'Amazon did not confirm every requested product target.', statusCode: 500 },
    { statusCode: 408, message: 'The read timed out' },
    { statusCode: 503, message: 'unavailable' },
    { message: 'Amazon did not confirm this.' },
  ];
  for (const failure of cases) assert.equal(productTargetResubmitBlocked(failure), true, JSON.stringify(failure));
  assert.equal(productTargetResubmitBlocked(null), false);
  assert.match(unconfirmedCreateNotice(cases[0]), /Refresh the ad group/);
  assert.equal(unconfirmedCreateNotice({ statusCode: 408, message: 'Couldn\'t add product targets.' }), 'Amazon did not confirm this. It was not submitted again.');
});

test('Nest conflict bodies keep the unconfirmed code', () => {
  const failure = failureFromUnknown({ status: 409, errorCode: 'PRODUCT_TARGET_CREATE_UNCONFIRMED', message: 'Amazon did not confirm these product targets.' });
  assert.equal(failure.code, 'PRODUCT_TARGET_CREATE_UNCONFIRMED');
  assert.equal(productTargetResubmitBlocked(failure), true);
});

test('add products and campaign create hide the same batch after an unconfirmed create', () => {
  for (const path of [
    '../app/adgroup/add-targets.tsx',
    '../app/campaign/create.tsx',
    '../app/campaign/ad-group-create.tsx',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /productTargetResubmitBlocked/);
    assert.match(source, /unconfirmedCreate/);
  }
});
