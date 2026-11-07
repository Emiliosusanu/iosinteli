import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveBookNet } from '../src/lib/netRoyalties.ts';

const source = readFileSync(new URL('../app/(tabs)/products.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('products.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['bookAdsReady', 'bookKdpAvailable', 'bookStatus', 'bookA11yLabel'].includes(node.name?.text));
const context = { resolveBookNet };
vm.runInNewContext(ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, context);

test('Books never claims no sales from zero KDP units when attributed Ads sales exist', () => {
  const row = { royalties: 0, spend: 20.48, orders: 0, orders_source: 'kdp', sales: 31.96,
    ads_state: 'ready', kdp_state: 'ready', acos: 64.1, breakeven_acos: 43.98 };
  assert.equal(context.bookStatus(row, true).label, 'Net negative');
  assert.equal(context.bookStatus({ ...row, sales: 0 }, true).label, 'Spending without sales');
  for (const sales of [null, undefined, NaN]) {
    assert.equal(context.bookStatus({ ...row, sales }, true).label, 'Net negative');
  }
  assert.equal(context.bookStatus({ ...row, royalties: 30 }, true).label, 'Net positive');
});

test('unavailable campaign-only Ads are not announced as measured zero spend or orders',()=>{
 Object.assign(context,{formatCurrency:n=>`$${n}`,formatPercent:n=>`${n}%`,formatInt:String,
  bookNetIsKnown:r=>resolveBookNet(r)!=null,formatBreakEvenAcos:String,
  netRoyaltiesVoiceOver:r=>`Spend ${r.adsSpend}; net ${r.netRoyalties}`});
 const row={title:'Advertised book',spend:0,sales:0,orders:0,orders_source:'ads',orders_state:'missing',
  royalties:null,ads_state:'missing',kdp_state:'missing',breakeven_acos:0};
 assert.equal(context.bookStatus(row,false).label,'Ads unavailable');
 const label=context.bookA11yLabel(row,context.bookStatus(row,false),'USD');
 assert.match(label,/Spend unavailable/);assert.match(label,/unavailable ads orders/);assert.doesNotMatch(label,/Spend \$0|0 ads orders/);
});

test('the Books row VoiceOver preserves unknown reviews even with an observation date', () => {
  let label, pending;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'accessibilityLabel' &&
        node.initializer?.getText(ast).includes('bookA11yLabel(')) label = node.initializer.expression;
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'retailPending') pending = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(label);
  const render = (snapshot, retailLoading) => {
    const env = { retailEdition: { format: 'Edition', snapshot }, reviews: snapshot, retailLoading,
      bookA11yLabel: () => 'Book', item: {}, status: {}, currency: 'USD', marketplaceIndex: {},
      marketplaceFlagsA11y: () => '', countriesForSponsoredBook: () => [], bookRetailStockLabel: value => value };
    if (pending) env.retailPending = vm.runInNewContext(pending.getText(ast), env);
    return vm.runInNewContext(label.getText(ast), env);
  };
  const snapshot = { asin: 'B0ABCDEFGH', rating: null, reviewCount: null, marketplaceCode: 'US',
    reviewsCheckedAt: '2026-11-02T00:00:00Z', stockStatus: null, retailPending: false };
  assert.match(render(snapshot, false), /Reviews not listed in US/);
  assert.doesNotMatch(render(snapshot, false), /No reviews yet|reviews 0/);
  assert.match(render({ ...snapshot, retailPending: true }, false), /Reviews updating in US/);
  assert.match(render(snapshot, true), /Reviews not listed in US/, 'An explicit completed snapshot overrides other in-flight reads');
  assert.match(render({ ...snapshot, reviewCount: 0 }, false), /reviews 0 in US/);
});
