import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/lib/queries.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('queries.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='finalizeCatalogBooksList');
function runtime(metrics,fail=false){
 const calls=[];
 const env={exports:{},Set,Map,
  nestShelfCatalogRows:async()=>[],fetchEnabledSponsoredBooksForProfiles:async()=>[{asin:'B000000001',title:'Advertised book',image_url:null}],
  fetchNestBookAdsMetrics:async options=>{calls.push(options);if(fail)throw Error('unavailable');return metrics;},
  identityAsinsForBookRow:r=>r.format_asins??[r.asin],
  mergeTopBookCatalogRows:(s,p)=>[...s,...p],annotateBooksListVisibility:r=>r,
  collapseTopBooksByFormatGroup:r=>r,filterBooksListVisibility:r=>r,finalizeTopBooksList:async r=>r};
 vm.runInNewContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,env);
 return {read:env.finalizeCatalogBooksList,calls};
}
test('campaign-only Books uses actual scoped Ads metrics, never fabricated ready zeros',async()=>{
 const h=runtime([{asin:'B000000001',spend:7,sales:20,clicks:13,impressions:400,orders:2}]);
 const rows=await h.read([],['owned'],[],0,[],'2026-11-01','2026-11-02');
 assert.equal(rows[0].spend,7);assert.equal(rows[0].sales,20);assert.equal(rows[0].clicks,13);assert.equal(rows[0].orders,2);
 assert.equal(rows[0].royalties,null);assert.equal(rows[0].net,null);assert.equal(rows[0].ads_state,'ready');
 assert.equal(h.calls[0].startDate,'2026-11-01');assert.equal(h.calls[0].endDate,'2026-11-02');
});
test('failed or missing Ads response is unavailable, never a measured zero',async()=>{
 for(const [metrics,fail]of [[[],false],[[],true]]){
  const h=runtime(metrics,fail),rows=await h.read([],['owned'],[],0,[],'2026-11-01','2026-11-02');
  assert.equal(rows[0].ads_state,'missing');assert.equal(rows[0].orders_state,'missing');
 }
});
