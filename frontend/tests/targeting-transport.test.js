import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const modules=new Map();
function load(name) {
  if(modules.has(name)) return modules.get(name);
  const exports={}; modules.set(name,exports);
  const source=readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:key=>load(key.replace('./','')),AbortController,Promise,Error,setTimeout,clearTimeout});
  return exports;
}
const {targetingPageQueryKey,targetingPageQueryOptions,targetingCanAutoRefresh}=load('targetingTransport');
const {withAbortableQueryTimeout}=load('queryTimeout');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const scope=['mobile-targeting-page-v1','transport-v2','customer','actor','view','dates','profiles','book','campaigns','keywords','enabled','','all','acos','{}','page-size-100'];
const client=()=>new QueryClient({defaultOptions:{queries:{gcTime:0,retryDelay:1}}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('observed head and imperative identical reads share one transport; tail pages also deduplicate',async()=>{
  const q=client();
  try {
    for(const [page,snapshot] of [[1,null],[2,'snapshot-a']]) {
      const response=deferred();let calls=0;
      const options=targetingPageQueryOptions(scope,page,snapshot,async()=>{calls++;return response.promise;});
      const observer=new QueryObserver(q,options);
      const unsubscribe=observer.subscribe(()=>{});
      const a=q.fetchQuery(options),b=q.fetchQuery(options);
      await tick();assert.equal(calls,1);
      response.resolve({rows:['real fixture'],page,snapshot});
      assert.deepEqual(await a,await b); unsubscribe();
    }
  } finally {q.clear();}
});

test('page and immutable snapshot are distinct cache identities',()=>{
  const keys=[[1,null],[2,'a'],[2,'b'],[3,'a']].map(([p,s])=>JSON.stringify(targetingPageQueryKey(scope,p,s)));
  assert.equal(new Set(keys).size,keys.length);
});

test('production scope separates actor, viewed customer, profiles, dates and every RPC filter',()=>{
  const source=readFileSync(new URL('../app/(tabs)/targeting.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  const mobilePageScopeKey = [');
  const end=source.indexOf('  const mobilePageQueryKey',start);
  const script=ts.transpileModule(source.slice(start,end)+'\nglobalThis.key=mobilePageScopeKey;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const values={adminFilterUserId:'customer',user:{id:'actor'},viewAsOtherUser:true,periodKey:'dates',profileScopeKey:'profiles',
    bookAsin:'book',bookCampaignIdList:['campaign'],segment:'keywords',stateFilter:'enabled',searchNeedle:'',perf:'all',serverSort:'acos',advancedScopeKey:'{}',TARGETING_PAGE_SIZE:100};
  const key=overrides=>{const context={...values,...overrides};vm.runInNewContext(script,context);return JSON.stringify(context.key);};
  const baseline=key({});
  for(const overrides of [{adminFilterUserId:'other'},{user:{id:'other-actor'}},{viewAsOtherUser:false},{periodKey:'other-dates'},
    {profileScopeKey:'other-profile'},{bookAsin:'other-book'},{bookCampaignIdList:['other-campaign']},{segment:'auto'},
    {stateFilter:'paused'},{searchNeedle:'needle'},{perf:'has_sales'},{serverSort:'spend'},{advancedScopeKey:'{"acosMax":20}'}])
    assert.notEqual(key(overrides),baseline,JSON.stringify(overrides));
});

test('scope cancellation rejects head and tail, aborts their signals and rejects late cache commits',async()=>{
  const q=client();const releases=[];const signals=[];
  try {
    const tasks=[1,2].map(page=>q.fetchQuery(targetingPageQueryOptions(scope,page,page===1?null:'a',signal=>{
      signals.push(signal);return new Promise(resolve=>releases.push(resolve));
    })));
    const rejected=tasks.map(task=>assert.rejects(task));
    await tick();await q.cancelQueries({queryKey:scope});await Promise.all(rejected);
    assert.ok(signals.every(signal=>signal.aborted));
    releases.forEach(resolve=>resolve({rows:['obsolete']}));await tick();
    assert.ok(q.getQueriesData({queryKey:scope}).every(([,data])=>data===undefined));
    const next=await q.fetchQuery(targetingPageQueryOptions([...scope,'next-customer'],1,null,async()=>({rows:['new']})));
    assert.deepEqual(next.rows,['new']);
  } finally {q.clear();}
});

test('SQL 57014 is never retried automatically; manual retry keeps the same key and filters',async()=>{
  const q=client();let calls=0;
  const options=targetingPageQueryOptions(scope,1,null,async()=>{calls++;throw {code:'57014'};});
  try {
    await assert.rejects(q.fetchQuery(options));assert.equal(calls,1);
    await assert.rejects(q.fetchQuery(options));assert.equal(calls,2);
    assert.equal(q.getQueryCache().getAll().length,1);
  } finally {q.clear();}
});

test('timeout disables polling, reconnect and focus refresh without disabling manual Retry',async()=>{
  const q=client();let calls=0;
  const options=targetingPageQueryOptions(scope,1,null,async()=>{calls++;throw {code:'57014'};});
  try {
    await assert.rejects(q.fetchQuery(options));
    const query=q.getQueryCache().find({queryKey:options.queryKey});
    assert.equal(targetingCanAutoRefresh(query.state.error),false);
    assert.equal(options.refetchOnReconnect(query),false);
    assert.equal(options.refetchOnWindowFocus(query),false);
    assert.equal(targetingCanAutoRefresh(new Error('HOME_QUERY_TIMEOUT')),false);
    assert.equal(targetingCanAutoRefresh(null),true);
    assert.equal(targetingCanAutoRefresh(new TypeError('Network request failed')),true);
    const source=readFileSync(new URL('../app/(tabs)/targeting.tsx',import.meta.url),'utf8');
    assert.match(source,/refetchInterval: \(query\) =>[^\n]*targetingCanAutoRefresh\(query.state.error\)/);
    await assert.rejects(q.fetchQuery(options));assert.equal(calls,2);
  } finally {q.clear();}
});

test('the screen cleanup cancels old filters, blur and logout, and releases the tail spinner',async()=>{
  const source=readFileSync(new URL('../app/(tabs)/targeting.tsx',import.meta.url),'utf8');
  const start=source.lastIndexOf('  useEffect(() => {',source.indexOf('const queryKey = JSON.parse(mobilePageScopeIdentity)'));
  const end=source.indexOf('  const catalogIdentity',start);
  const script=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const reason of ['new filters','blur','logout']) {
    const q=client();let effect;const response=deferred();let signal;let loading=true;
    const generation={current:3},request={current:'old-request'};
    try {
      const pending=q.fetchQuery(targetingPageQueryOptions(scope,2,'snapshot',s=>{signal=s;return response.promise;}));
      const rejected=assert.rejects(pending);await tick();
      vm.runInNewContext(script,{useEffect:fn=>{effect=fn;},mobilePageScopeIdentity:JSON.stringify(scope),
        canReadPage:true,queryClient:q,catalogGenerationRef:generation,catalogPageRequestRef:request,setCatalogTailLoading:value=>{loading=value;}});
      const cleanup=effect();cleanup();await rejected;
      assert.equal(signal.aborted,true,reason);assert.equal(loading,false,reason);
      assert.equal(generation.current,4);assert.equal(request.current,null);
      response.resolve('obsolete');await tick();
      assert.equal(q.getQueryData(targetingPageQueryKey(scope,2,'snapshot')),undefined);
    } finally {q.clear();}
  }
});

test('deadline and navigation cancellation reach the actual Supabase SDK HTTP transport',async()=>{
  const requests=[];
  const server=http.createServer((req,res)=>{
    const item={closed:false};requests.push(item);
    res.on('close',()=>{item.closed=true;});req.resume();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const sb=createClient(`http://127.0.0.1:${server.address().port}`,'local-test-public-key',
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  // Compile the actual app RPC function, not a test replacement for abortSignal.
  const source=readFileSync(new URL('../src/lib/queries.ts',import.meta.url),'utf8');
  const start=source.indexOf('export async function fetchMobileTargetingPage(');
  const end=source.indexOf('\nexport ',start+10);
  const context={exports:{},supabase:sb,uniqueStrings:xs=>[...new Set(xs)],isMobileTargetingSnapshotChanged:()=>false};
  vm.runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  const input={segment:'keywords',sort:'acos',page:1,start:'2026-10-01',end:'2026-10-17',profiles:['US'],skipDisplayEnrich:true};
  try {
    for(const cancel of [false,true]) {
      const upstream=new AbortController();
      const read=withAbortableQueryTimeout(signal=>context.exports.fetchMobileTargetingPage({...input,signal}),cancel?2000:250,upstream.signal);
      const rejected=assert.rejects(read);
      for(let i=0;i<100&&requests.length<(cancel?2:1);i++) await new Promise(resolve=>setTimeout(resolve,5));
      if(cancel) upstream.abort();
      await rejected;
      for(let i=0;i<100&&!requests.at(-1)?.closed;i++) await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(requests.length,cancel?2:1);
      assert.equal(requests.at(-1).closed,true,'HTTP socket must close, not merely stop awaiting');
    }
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('an already abandoned context never starts the task',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(withAbortableQueryTimeout(async()=>{calls++;},50,controller.signal),{name:'AbortError'});
  assert.equal(calls,0);
});

test('a deadline retains only the previous cache timestamp, never promotes a late response to fresh',async()=>{
  const q=client();const response=deferred();let signal;
  const key=targetingPageQueryKey(scope,1,null);
  q.setQueryData(key,{rows:['cached']},{updatedAt:100});
  try {
    await assert.rejects(q.fetchQuery(targetingPageQueryOptions(scope,1,null,s=>{signal=s;return response.promise;},10)));
    assert.equal(signal.aborted,true);
    response.resolve({rows:['late']});await tick();
    assert.deepEqual(q.getQueryData(key),{rows:['cached']});
    assert.equal(q.getQueryState(key).dataUpdatedAt,100);
    assert.equal(q.getQueryState(key).status,'error');
  } finally {q.clear();}
});
