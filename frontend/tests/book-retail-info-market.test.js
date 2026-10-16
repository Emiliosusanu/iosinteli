import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as metadata from '../src/lib/bookRetailMetadata.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/components/BookRetailInfo.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const context = { exports: {}, require: name => {
  if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) };
  if (name === 'react-native') return { Text: 'Text', View: 'View' };
  if (name === './ios/Native') return { SFSymbol: 'SFSymbol' };
  if (name === '../lib/bookRetailMetadata') return metadata;
  if (name === '../lib/theme') return { useTheme: () => ({ colors: {}, typography: {} }) };
  throw new Error(`Unexpected dependency: ${name}`);
} };
vm.runInNewContext(compiled, context);
const snapshot = { asin: 'B0ABCDEFGH', marketplaceCode: 'CA', rating: 4.9, reviewCount: 400,
  stockStatus: 'OUT_OF_STOCK', checkedAt: '2026-10-01T00:00:00Z', marketplaceSnapshots: [
    { asin: 'B0ABCDEFGH', marketplaceCode: 'US', rating: 4.1, reviewCount: 100,
      stockStatus: 'IN_STOCK', checkedAt: '2026-10-02T00:00:00Z' },
  ] };
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node?.children?.map(textOf).join('') ?? '';
}
test('actual compact retail component renders US campaign reviews alongside CA stock, including VoiceOver provenance', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot, compact: true, activeMarketplaceCodes: ['US'] });
  const text = textOf(tree);
  assert.match(text, /4\.1 \(100 reviews\) · US/);
  assert.match(text, /Out of stock · CA/);
  assert.doesNotMatch(text, /400 reviews/);
  assert.match(tree.props.accessibilityLabel, /100 reviews\) in US, checked 2026-10-02/);
  assert.match(tree.props.accessibilityLabel, /stock Out of stock in CA, checked 2026-10-01/);
});
test('active market without observation displays unavailable, never zero or another market count', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot, compact: true, activeMarketplaceCodes: ['DE'] });
  assert.match(textOf(tree), /Reviews unavailable/);
  assert.doesNotMatch(textOf(tree), /400 reviews|0 reviews/);
});
test('expanded marketplace rows keep their own exact rating, count and stock', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot, activeMarketplaceCodes: ['US'] });
  assert.match(textOf(tree), /4\.9 \(400 reviews\) · CA/);
});

test('pending observations render loading rather than a false unavailable or zero status', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot: { ...snapshot, rating: null, reviewCount: null, stockStatus: null, marketplaceSnapshots: [] }, compact: true, loading: true });
  assert.match(textOf(tree), /Loading reviews…/);
  assert.match(textOf(tree), /Loading stock…/);
  assert.doesNotMatch(textOf(tree), /unavailable|0 reviews/);
  assert.match(tree.props.accessibilityLabel, /Reviews loading/);
});
test('a completed unknown listing does not inherit loading from other marketplace requests', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot: { ...snapshot, rating: null, reviewCount: null,
    stockStatus: null, retailPending: false, marketplaceSnapshots: [] }, compact: true, loading: true });
  assert.match(textOf(tree), /Reviews unavailable/);
  assert.match(textOf(tree), /Stock unknown/);
  assert.doesNotMatch(textOf(tree), /Loading/);
});
test('only the selected US listing controls its loading status', () => {
  const us = { ...snapshot.marketplaceSnapshots[0], rating: null, reviewCount: null, stockStatus: null, retailPending: true };
  const primary = metadata.primaryBookRetailEdition({ asin: us.asin, book_key: us.asin }, {
    [us.asin]: { ...snapshot, retailPending: false, marketplaceSnapshots: [us] },
  }, ['US']);
  assert.equal(primary.snapshot.marketplaceCode, 'US');
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot: primary.snapshot, compact: true, activeMarketplaceCodes: ['US'], loading: false });
  assert.match(textOf(tree), /Loading reviews…/);
  assert.match(textOf(tree), /Loading stock…/);
  assert.doesNotMatch(textOf(tree), /400 reviews/);
});
test('review and stock observations display their actual separate dates', () => {
  const tree = context.exports.BookRetailInfo({ edition: 'Kindle', snapshot: { ...snapshot.marketplaceSnapshots[0],
    checkedAt: '2026-10-11T08:00:00Z', reviewsCheckedAt: '2026-10-10T10:00:00Z' }, compact: true, activeMarketplaceCodes: ['US'] });
  assert.match(textOf(tree), /100 reviews\) · US · 2026-10-10/);
  assert.match(textOf(tree), /In stock · US · 2026-10-11/);
  assert.match(tree.props.accessibilityLabel, /reviews\) in US, checked 2026-10-10/);
});
