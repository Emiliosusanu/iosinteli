import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeAmazonAsin, looksLikeKdpSetupBookId, extractAsinFromSetupPageJson, extractBookshelfPrintRowsFromHtml } from '../src/lib/kdp/vendor/kdpPricingCapture.js';

test('iOS pricing accepts validated ISBN ASINs without confusing setup ids', () => {
  for (const asin of ['1807973794', '080442957X', 'B0H9M11FM7']) {
    assert.equal(looksLikeAmazonAsin(asin), true);
    assert.equal(looksLikeKdpSetupBookId(asin), false);
  }
  assert.equal(looksLikeAmazonAsin('1807973795'), false);
  assert.equal(looksLikeAmazonAsin('0000000000'), false);
  assert.equal(looksLikeKdpSetupBookId('MT02FVSE645'), true);
});

test('iOS Bookshelf pairs the exact numeric paperback ASIN with its setup', () => {
  const html = '<div id="zme-indie-bookshelf-dual-print-price-asin-MT02FVSE645">ASIN: 1807973794</div>'
    + '<div id="zme-indie-bookshelf-dual-print-price-list-price-MT02FVSE645">$15.99 USD</div>';
  assert.ok(extractBookshelfPrintRowsFromHtml(html).some(row => row.printAsin === '1807973794' && row.kdpBookId === 'MT02FVSE645'));
});

test('iOS response identity ignores category IDs that also pass ISBN validation', () => {
  const categoryId = '5496754011';
  assert.equal(looksLikeAmazonAsin(categoryId), true);
  assert.equal(extractAsinFromSetupPageJson({ book: { selectedBrowseNodes: [{ id: categoryId }] } }), null);
  assert.equal(extractAsinFromSetupPageJson({ book: { selectedBrowseNodes: [{ id: categoryId }], metadata: { printAsin: 'B0HB5MB9L9' } } }), 'B0HB5MB9L9');
  assert.equal(extractAsinFromSetupPageJson({ book: { metadata: { notAnAsin: categoryId } } }), null);
});
