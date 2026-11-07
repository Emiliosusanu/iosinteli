import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {netRoyaltiesKnown} from '../src/lib/netRoyalties.ts';
import {optionalMetric} from '../src/lib/metricEvidence.ts';
import {resolveAuthoritativeBreakEvenAcos} from '../src/lib/kdpTitlePresentation.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/dashboardApi.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('dashboardApi.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['qs','n','bootstrapToTopBooks','fetchNestTopBooks','fetchNestBookAdsMetrics']);
const fragment=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const js=ts.transpileModule(fragment,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function runtime(payload){
 class NestApiError extends Error{constructor(message,status){super(message);this.status=status;}}
 const calls=[],context={exports:{},URLSearchParams,optionalMetric,netRoyaltiesKnown,resolveAuthoritativeBreakEvenAcos,NestApiError,nestApiJson:async(path,init)=>{calls.push({path,init});return payload;}};
 vm.runInNewContext(js,context);return {fetch:context.exports.fetchNestTopBooks,ads:context.exports.fetchNestBookAdsMetrics,calls};
}
test('server unavailable marker cannot turn into a complete empty Books result',async()=>{
 const {fetch}=runtime({unavailable:true,data:[]});
 await assert.rejects(fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us']}),e=>e.status===503);
});
test('verified format identities survive financial mapping for exact edition review and stock reads',async()=>{
 const {fetch,calls}=runtime({data:[{asin:'B0ABCDEFGH',formatAsins:['B0ABCDEFGH','1807973751'],title:'Book',royalties:19,adSpend:4,adSales:20,orders:2}]});
 const [row]=await fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us'],filterUserId:'owned customer'});
 assert.deepEqual(Array.from(row.format_asins),['B0ABCDEFGH','1807973751']);assert.equal(row.net,15);assert.equal(row.ads_state,'ready');
 assert.equal(row.clicks,null);assert.equal(row.impressions,null);assert.equal(row.orders_source,'kdp');
 const url=new URL(calls[0].path,'https://example.test');assert.equal(url.searchParams.get('filterUserId'),'owned customer');assert.equal(url.searchParams.get('profileIds'),'owned-us');assert.equal(url.searchParams.get('listingCacheOnly'),'true');
});
test('successful empty server result remains empty',async()=>{
 const {fetch}=runtime({data:[]});const rows=await fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us']});assert.equal(rows.length,0);
});
test('actual counts survive, absent royalties never become a zero net',async()=>{
 const {fetch}=runtime({data:[{asin:'B0ABCDEFGH',title:'Book',royalties:null,adSpend:4,adSales:20,orders:2,clicks:18,impressions:500}]});
 const [row]=await fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us']});
 assert.equal(row.clicks,18);assert.equal(row.impressions,500);assert.equal(row.royalties,null);assert.equal(row.net,null);assert.equal(row.kdp_state,'missing');
});

test('Ads-only batch requires complete unique finite response and sends the exact profile/date/ASIN scope',async()=>{
 const row={asin:'B000000001',spend:7,sales:20,clicks:13,impressions:null,orders:2};
 const options={startDate:'2026-11-01',endDate:'2026-11-02',profileIds:['owned'],asins:[row.asin]};
 const h=runtime({data:[row]});const [read]=await h.ads(options);assert.equal(read.spend,7);assert.equal(read.impressions,null);
 const url=new URL(h.calls[0].path,'https://example.test');assert.equal(url.pathname,'/dashboard/book-ads-metrics');
 assert.equal(url.searchParams.get('profileIds'),'owned');assert.equal(url.searchParams.get('startDate'),options.startDate);
 assert.equal(url.searchParams.get('endDate'),options.endDate);assert.equal(url.searchParams.get('asins'),row.asin);
 for(const payload of [{},{data:[]},{data:[row,row]},{data:[{...row,asin:'B000000002'}]},
  {data:[{...row,spend:NaN}]},{data:[{...row,clicks:undefined}]},{data:[{...row,orders:-1}]}]){
  await assert.rejects(runtime(payload).ads(options),e=>e.status===503);
 }
});
