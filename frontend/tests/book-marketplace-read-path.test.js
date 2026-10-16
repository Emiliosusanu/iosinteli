import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { emptySponsoredMarketplaceIndex, mergeSponsoredMarketplaceIndexes } from '../src/lib/bookMarketplaces.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/bookMarketplacesQuery.ts',import.meta.url),'utf8');
const start=source.indexOf('export async function fetchSponsoredMarketplaceIndex('),end=source.indexOf('export function sponsoredMarketplaceIndexQueryKey(',start);
const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function run(direct,server){
 const calls={direct:0,server:0};const context={exports:{},profileQueryIds:p=>p.map(x=>x.id),emptySponsoredMarketplaceIndex,mergeSponsoredMarketplaceIndexes,
 fetchDirectSponsoredMarketplaceIndex:async()=>{calls.direct++;return direct();},fetchServerSponsoredMarketplaceIndex:async()=>{calls.server++;return server();}};
 vm.runInNewContext(compiled,context);return{calls,fetch:opts=>context.exports.fetchSponsoredMarketplaceIndex([{id:'owned-us'}],opts)};
}
const known=()=>({ ...emptySponsoredMarketplaceIndex(),countriesByKey:new Map([['B0ABCDEFGH',new Set(['US'])]]) });
test('verified seller campaign index does not start a second per-profile metrics scan',async()=>{
 const h=run(known,()=>{throw new Error('duplicate metrics scan');});
 assert.equal((await h.fetch()).countriesByKey.size,1);assert.equal(h.calls.server,0);
});
test('empty seller RLS data still falls back to the authorized server index',async()=>{
 const h=run(emptySponsoredMarketplaceIndex,known);assert.equal((await h.fetch()).countriesByKey.size,1);assert.equal(h.calls.server,1);
});
test('direct read failure falls back and admin preview never reads local seller scope',async()=>{
 const h=run(()=>{throw new Error('RLS unavailable');},known);assert.equal((await h.fetch()).countriesByKey.size,1);
 const a=run(()=>{throw new Error('must not read admin own scope');},known);assert.equal((await a.fetch({filterUserId:'customer'})).countriesByKey.size,1);assert.equal(a.calls.direct,0);
});
test('an empty seller index survives a server outage but two failed sources do not report success',async()=>{
 const h=run(emptySponsoredMarketplaceIndex,()=>{throw new Error('server offline');});assert.equal((await h.fetch()).countriesByKey.size,0);
 const bad=run(()=>{throw new Error('RLS offline');},()=>{throw new Error('server offline');});await assert.rejects(bad.fetch());
});


test('a full pagination limit is incomplete and must not suppress the server fallback', async () => {
 const a=source.indexOf('async function fetchPages<'),b=source.indexOf('async function fetchDirectSponsoredMarketplaceIndex',a);
 const js=ts.transpileModule('export '+source.slice(a,b),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const c={exports:{},PAGE_SIZE:2,MAX_PAGES:2};vm.runInNewContext(js,c);
 await assert.rejects(c.exports.fetchPages(async()=>({data:[{id:1},{id:2}],error:null})),/incomplete/);
 let calls=0;const rows=await c.exports.fetchPages(async()=>({data:++calls===1?[{id:1},{id:2}]:[{id:3}],error:null}));
 assert.equal(rows.length,3);
});
