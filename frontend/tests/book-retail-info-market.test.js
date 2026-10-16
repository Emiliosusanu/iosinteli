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
