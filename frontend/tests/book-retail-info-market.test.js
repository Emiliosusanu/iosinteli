import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as metadata from '../src/lib/bookRetailMetadata.ts';
const require = createRequire(import.meta.url), ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../src/components/BookRetailInfo.tsx', import.meta.url), 'utf8'), {
 compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const context = { exports: {}, require: name => {
 if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props, children }) };
 if (name === 'react-native') return { Text: 'Text', View: 'View' };
 if (name === './ios/Native') return { SFSymbol: 'SFSymbol' };
 if (name === '../lib/bookRetailMetadata') return metadata;
 if (name === '../lib/theme') return { useTheme: () => ({ colors: {tone_good:'#11AA33',tone_danger:'#DD0000'}, typography: {} }) };
 throw new Error(name);
}};
vm.runInNewContext(compiled, context);
const asin='B0ABCDEFGH';
const ca={asin,marketplaceCode:'CA',rating:4.9,reviewCount:400,stockStatus:'OUT_OF_STOCK',checkedAt:'2026-10-01T00:00:00Z'};
const us={asin,marketplaceCode:'US',rating:4.1,reviewCount:100,stockStatus:'IN_STOCK',checkedAt:'2026-10-02T00:00:00Z'};
const snapshot={...ca,marketplaceSnapshots:[us]};
const render=opts=>context.exports.BookRetailInfo({edition:'Paperback',snapshot,...opts});
function text(node){if(Array.isArray(node))return node.map(text).join('');return typeof node==='string'||typeof node==='number'?String(node):node?.children?.map(text).join('')??'';}
function find(node,predicate){if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));return node&&typeof node==='object'?[...(predicate(node)?[node]:[]),...find(node.children,predicate)]:[];}
test('card uses one primary market for both reviews AND stock, never CA stock alongside US reviews',()=>{
 const tree=render({compact:true,activeMarketplaceCodes:['US','CA']});
 assert.match(text(tree),/100/);assert.match(text(tree),/In stock/);assert.doesNotMatch(text(tree),/400|Out of stock|CA|Paperback|B0ABCDEFGH/);
 assert.match(tree.props.accessibilityLabel,/100 reviews in US/);assert.match(tree.props.accessibilityLabel,/Stock In stock in US/);
 assert.equal(find(tree,n=>n.type==='SFSymbol'&&n.props.name.startsWith('star')).length,5);
});
test('detail uses the same single-market summary and keeps actual separate observation dates',()=>{
 const tree=render({activeMarketplaceCodes:['US'],snapshot:{...snapshot,marketplaceSnapshots:[{...us,reviewsCheckedAt:'2026-10-10T00:00:00Z',checkedAt:'2026-10-11T00:00:00Z'}]}});
 assert.match(text(tree),/100/);assert.doesNotMatch(text(tree),/400|CA/);
 assert.match(text(tree),/Reviews 2026-10-10/);assert.match(text(tree),/Stock 2026-10-11/);
});
test('missing primary-market data stays unknown and does not borrow foreign values or invent zero',()=>{
 const tree=render({compact:true,activeMarketplaceCodes:['DE']});
 assert.match(text(tree),/Reviews —/);assert.match(text(tree),/Stock —/);assert.doesNotMatch(text(tree),/400|100|In stock|Out of stock|0 reviews/);
});
test('pending unknown listing has compact placeholders and honest updating VoiceOver',()=>{
 const tree=render({compact:true,activeMarketplaceCodes:['US'],snapshot:{...us,rating:null,reviewCount:null,stockStatus:null,retailPending:true}});
 assert.match(text(tree),/Reviews —/);assert.match(text(tree),/Stock —/);assert.doesNotMatch(text(tree),/Loading|In stock|0 reviews/);
 assert.match(tree.props.accessibilityLabel,/Reviews updating/);assert.match(tree.props.accessibilityLabel,/Stock updating/);
});
test('known stock and explicit zero reviews remain visible during refresh',()=>{
 const tree=render({compact:true,activeMarketplaceCodes:['US'],snapshot:{...us,rating:null,reviewCount:0,stockStatus:'IN_STOCK_SCARCE',retailPending:true}});
 assert.match(text(tree),/0/);assert.match(text(tree),/Limited stock/);assert.doesNotMatch(text(tree),/Loading|IN_STOCK_SCARCE/);
 assert.match(tree.props.accessibilityLabel,/0 reviews in US/);
});
