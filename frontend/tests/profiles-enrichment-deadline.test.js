import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {kdpAccountCountsByAmazonProfileId} from '../src/lib/kdpAccountLinks.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/queries.ts',import.meta.url),'utf8');
const a=source.indexOf('async function attachKdpAccountCountsFromBridge('),b=source.indexOf('export async function setUserAmazonProfileEnabled',a);
const compiled=ts.transpileModule(source.slice(a,b)+'\nexports.load=attachKdpAccountCountsFromBridge;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(read){let signal;const builder={select(){return this;},in(){return this;},order(){return this;},range(){return this;},abortSignal(s){signal=s;return this;}};
const context={exports:{},AbortController,POSTGREST_PAGE_SIZE:1000,BOOKS_IN_CHUNK:100,
setTimeout:(fn,ms)=>setTimeout(fn,ms===3000?5:ms),clearTimeout,
uniqueStrings:xs=>[...new Set(xs)],chunkArray:xs=>[xs],kdpAccountCountsByAmazonProfileId,
supabase:{from:()=>builder},fetchAllPages:async build=>{build(0,999);return read();}};
vm.runInNewContext(compiled,context);return {load:context.exports.load,signal:()=>signal};}
const rows=[{id:'owned',profile_id:'owned',is_enabled:true,kdp_account_count:3,nickname:'Original'}];
test('stalled optional KDP counts cannot hide already-authorized Ads profiles',async()=>{
 const h=harness(()=>new Promise(()=>{}));const watchdog=new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('unbounded profile enrichment')),100);t.unref();});
 assert.equal(await Promise.race([h.load(rows),watchdog]),rows);assert.equal(h.signal().aborted,true);
});
test('available bridge counts update counts without changing profile authorization or identity',async()=>{
 const h=harness(async()=>[{amazon_profile_id:'owned',kdp_account_id:'a',is_paused:false},{amazon_profile_id:'owned',kdp_account_id:'b',is_paused:false}]);
 const result=await h.load(rows);assert.equal(result[0].kdp_account_count,2);assert.equal(result[0].id,'owned');assert.equal(result[0].is_enabled,true);assert.equal(rows[0].kdp_account_count,3);
});
