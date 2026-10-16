import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {netRoyaltiesKnown} from '../src/lib/netRoyalties.ts';
import {resolveAuthoritativeBreakEvenAcos} from '../src/lib/kdpTitlePresentation.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/dashboardApi.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('dashboardApi.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['qs','n','bootstrapToTopBooks','fetchNestTopBooks']);
const fragment=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const js=ts.transpileModule(fragment,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function runtime(payload){
 class NestApiError extends Error{constructor(message,status){super(message);this.status=status;}}
 const calls=[],context={exports:{},URLSearchParams,netRoyaltiesKnown,resolveAuthoritativeBreakEvenAcos,NestApiError,nestApiJson:async(path,init)=>{calls.push({path,init});return payload;}};
 vm.runInNewContext(js,context);return {fetch:context.exports.fetchNestTopBooks,calls};
}
test('server unavailable marker cannot turn into a complete empty Books result',async()=>{
 const {fetch}=runtime({unavailable:true,data:[]});
 await assert.rejects(fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us']}),e=>e.status===503);
});
test('verified format identities survive financial mapping for exact edition review and stock reads',async()=>{
 const {fetch,calls}=runtime({data:[{asin:'B0ABCDEFGH',formatAsins:['B0ABCDEFGH','1807973751'],title:'Book',royalties:19,adSpend:4,adSales:20,orders:2}]});
 const [row]=await fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us'],filterUserId:'owned customer'});
 assert.deepEqual(Array.from(row.format_asins),['B0ABCDEFGH','1807973751']);assert.equal(row.net,15);assert.equal(row.ads_state,'ready');
 const url=new URL(calls[0].path,'https://example.test');assert.equal(url.searchParams.get('filterUserId'),'owned customer');assert.equal(url.searchParams.get('profileIds'),'owned-us');
});
test('successful empty server result remains empty',async()=>{
 const {fetch}=runtime({data:[]});const rows=await fetch({startDate:'2026-10-01',endDate:'2026-10-16',profileIds:['owned-us']});assert.equal(rows.length,0);
});
