import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as quarantine from '../src/lib/kdp/shelfHeal.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/kdp/shelfHealStore.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const entry={account_id:'quarantined',asin:'B0ABCDEFGH',canonical_account_id:'owned',reason:'cross_account_duplicate',rule:'ads_overlap'};
function harness(remote){
 let signal,uid;const local=new Map([['inteliads.kdpAsinQuarantine.v1:one',JSON.stringify(quarantine.makeQuarantineDoc([entry],'2026-10-16T00:00:00Z'))]]);
 const builder={select(){return this;},eq(field,value){if(field==='user_id')uid=value;return this;},abortSignal(s){signal=s;return this;},maybeSingle(){return remote(uid);}};
 const storage={getItem:async(key,fallback)=>local.get(key)??fallback,setItem:async(key,value)=>{local.set(key,value);return true;}};
 const deps={'@/src/utils/storage':{storage},'./shelfHeal.ts':quarantine,'../supabase.ts':{supabase:{from:()=>builder}}};
 const ctx={exports:{},AbortController,setTimeout:(fn,ms)=>setTimeout(fn,ms===3000?5:ms),clearTimeout,require:name=>{assert.ok(deps[name],name);return deps[name];}};
 vm.runInNewContext(js,ctx);return {load:ctx.exports.loadKdpAsinQuarantineEntries,signal:()=>signal};
}
test('stalled remote settings read cannot block metadata indefinitely and retains same-user quarantine',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const h=harness(()=>pending);
 const watchdog=new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('unbounded preflight')),100);t.unref();});
 const rows=await Promise.race([h.load('one'),watchdog]);assert.equal(rows.length,1);assert.equal(rows[0].account_id,'quarantined');assert.equal(h.signal().aborted,true);
 release({data:{value:quarantine.makeQuarantineDoc([],'2026-10-16T00:01:00Z')},error:null});
 assert.equal((await h.load('one')).length,1,'late response must not overwrite retained local protection');
 assert.equal((await h.load('two')).length,0,'another user must not inherit the first user quarantine');
});
test('explicit current remote quarantine replaces stale local entries without fabricating marks',async()=>{
 const h=harness(()=>Promise.resolve({data:{value:quarantine.makeQuarantineDoc([],'2026-10-16T00:02:00Z')},error:null}));
 assert.equal((await h.load('one')).length,0);assert.equal(h.signal()?.aborted??false,false);
});
