import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const src=readFileSync(new URL('../src/lib/kdp/runtime.ts',import.meta.url),'utf8');
const active=src.slice(src.indexOf('export function isKdpWebViewActive'),src.indexOf('export function setKdpHelperPricingAuth'));
const fetch=src.slice(src.indexOf('export async function kdpPageFetch'),src.indexOf('export function kdpTemplatesReady'));
const nativeHtml={status:200,text:'<html>native bookshelf</html>',url:'https://kdp.amazon.com/en_US/bookshelf'};
function harness(state,{native=nativeHtml,fail=false,cookies=true,transition=null}={}) {
 const calls=[];const app={currentState:state};const waiters=new Map();
 const ctx={exports:{},AppState:app,waiters,reqSeq:0,FETCH_TIMEOUT_MS:20,setTimeout,clearTimeout,
  refreshKdpWebSessionFromNativeCookies:async()=>cookies?{cookies:'mock=1'}:null,
  loadKdpWebSession:async()=>null,applySessionToHeaders:h=>h,
  kdpNativeFetch:async()=>{if(transition)app.currentState=transition;if(fail)throw Error('transport unavailable');return native;},
  looksLoggedOut:r=>r.status===401,looksLikeHtmlDocument:r=>r.text.startsWith('<html>'),
  invalidateSavedKdpSession:()=>calls.push('invalidate'),
  injectFn:js=>{calls.push('webview');const payload=JSON.parse(js.match(/__inteliadsKdpFetch\((.*?)\);/)[1]);const w=waiters.get(payload.reqId);clearTimeout(w.timer);waiters.delete(payload.reqId);w.resolve({...nativeHtml,text:'<html>interactive bookshelf</html>'});}
 };
 vm.runInNewContext(ts.transpileModule(active+'\n'+fetch,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {calls,fetch:()=>ctx.exports.kdpPageFetch({url:nativeHtml.url,method:'GET',headers:{},body:null,authScope:'pricing'})};
}
for(const state of ['background','inactive'])test(`pricing returns native HTML without a suspended WebView while ${state}`,async()=>{
 const h=harness(state);assert.equal((await h.fetch()).text,nativeHtml.text);assert.deepEqual(h.calls,[]);
});
test('foreground pricing retains its authenticated WebView fallback',async()=>{
 const h=harness('active');assert.equal((await h.fetch()).text,'<html>interactive bookshelf</html>');assert.deepEqual(h.calls,['webview']);
});
test('locking during the native request rechecks current app state before fallback',async()=>{
 const h=harness('active',{transition:'background'});assert.equal((await h.fetch()).text,nativeHtml.text);assert.deepEqual(h.calls,[]);
});
test('background transport failure rejects for retry without waiting on a WebView',async()=>{
 const h=harness('background',{fail:true});await assert.rejects(h.fetch(),/transport unavailable/);assert.deepEqual(h.calls,[]);
});
test('background pricing login response preserves reports session',async()=>{
 const h=harness('background',{native:{...nativeHtml,status:401}});assert.equal((await h.fetch()).status,401);assert.deepEqual(h.calls,[]);
});
test('background without saved cookies does not inject into a suspended helper',async()=>{
 const h=harness('background',{cookies:false});await assert.rejects(h.fetch(),/WebView is not attached/);assert.deepEqual(h.calls,[]);
});
