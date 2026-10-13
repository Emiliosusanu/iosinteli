import assert from 'node:assert/strict';
import test from 'node:test';
import { bookRetailWindow, mergeScopedRetailCache } from '../src/lib/bookRetailWindow.ts';

test('a thousand-book shelf starts with twelve metadata lookups and follows the viewport', () => {
  const books = Array.from({ length: 1000 }, (_, i) => ({ book_key: `book-${i}`, asin: `B${String(i).padStart(9, '0')}` }));
  assert.equal(bookRetailWindow(books, []).length, 12);
  assert.deepEqual(bookRetailWindow(books, ['book-500', 'book-501']).map(row => row.book_key), ['book-500', 'book-501']);
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
