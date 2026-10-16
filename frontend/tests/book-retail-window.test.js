import assert from 'node:assert/strict';
import test from 'node:test';
import { bookRetailWindow, canReadBookRetailMetadata, mergeScopedRetailCache } from '../src/lib/bookRetailWindow.ts';

test('a thousand-book shelf starts with twelve metadata lookups and follows the viewport', () => {
  const books = Array.from({ length: 1000 }, (_, i) => ({ book_key: `book-${i}`, asin: `B${String(i).padStart(9, '0')}` }));
  assert.equal(bookRetailWindow(books, []).length, 12);
  assert.deepEqual(bookRetailWindow(books, ['book-500', 'book-501']).map(row => row.book_key), books.slice(498, 510).map(row => row.book_key));
  assert.deepEqual(bookRetailWindow(books, ['book-499', 'book-500']), bookRetailWindow(books, ['book-500', 'book-501']));
  assert.equal(bookRetailWindow(books, books.map(row => row.book_key)).length, 24);
  assert.equal(bookRetailWindow(books.slice(800), ['book-500'])[0].book_key, 'book-800');
});
test('scrolling keeps already-read listing metadata, but changing user/profile scope clears it', () => {
  const first = { scope: 'user-a:US', data: { first: { asin: 'B000000001', reviewCount: 30 } } };
  const merged = mergeScopedRetailCache(first, first.scope, { second: { asin: 'B000000002', reviewCount: null } });
  assert.equal(merged.data.first.reviewCount, 30);
  assert.equal(merged.data.second.reviewCount, null);
  assert.deepEqual(Object.keys(mergeScopedRetailCache(merged, 'user-b:CA', { second: { asin: 'B000000002', reviewCount: 1 } }).data), ['second']);
});

test('customer and authorized admin previews can load reviews; invalid scope cannot', () => {
  const scope = { userId: 'admin', filterUserId: 'customer', isAdminViewer: true, profileIds: ['owned-profile'], asins: ['B000000001'] };
  assert.equal(canReadBookRetailMetadata(scope), true);
  assert.equal(canReadBookRetailMetadata({ ...scope, filterUserId: null, isAdminViewer: false }), true);
  assert.equal(canReadBookRetailMetadata({ ...scope, isAdminViewer: false }), false);
  assert.equal(canReadBookRetailMetadata({ ...scope, userId: null }), false);
  assert.equal(canReadBookRetailMetadata({ ...scope, profileIds: [] }), false);
  assert.equal(canReadBookRetailMetadata({ ...scope, asins: [] }), false);
});

 test('progress from another market preserves earlier exact-ASIN observations, including explicit reductions', () => {
  const us = { asin: 'B0ABCDEFGH', marketplaceCode: 'US', rating: 4.5, reviewCount: 100, stockStatus: null, checkedAt: null };
  const ca = { ...us, marketplaceCode: 'CA', reviewCount: 400 };
  const first = { scope: 'customer-one', data: { B0ABCDEFGH: us } };
  const merged = mergeScopedRetailCache(first, first.scope, { B0ABCDEFGH: ca });
  assert.equal(merged.data.B0ABCDEFGH.marketplaceSnapshots[0].reviewCount, 100);
  const corrected = mergeScopedRetailCache(merged, first.scope, { B0ABCDEFGH: { ...us, reviewCount: 0, rating: null } });
  assert.equal(corrected.data.B0ABCDEFGH.reviewCount, 0);
  assert.equal(corrected.data.B0ABCDEFGH.rating, null);
  assert.equal(corrected.data.B0ABCDEFGH.marketplaceSnapshots[0].reviewCount, 400);
  const other = mergeScopedRetailCache(corrected, 'customer-two', { B0ABCDEFGH: ca });
  assert.equal(other.data.B0ABCDEFGH.marketplaceSnapshots, undefined);
});
