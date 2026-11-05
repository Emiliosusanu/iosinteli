import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { profileSelectionMustReset } from '../src/lib/profileSelectionIdentity.ts';
import { withAbortableQueryTimeout } from '../src/lib/queryTimeout.ts';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('../src/lib/queries.ts');
const tree = ts.createSourceFile('queries.ts', source, ts.ScriptTarget.Latest, true);
const fetchSource = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'fetchAmazonProfiles').getText(tree);

function harness(rows = [], error = null) {
  const calls = [], fallback = [];
  const env = {
    exports: {}, withAbortableQueryTimeout, POSTGREST_PAGE_SIZE: 1000,
    supabase: { rpc(name) {
      calls.push({ name });
      let first, last, signal;
      return {
        range(a,b) { first=a; last=b; return this; },
        abortSignal(s) { signal=s; return this; },
        then(resolve, reject) {
          calls.at(-1).signal=signal;
          return Promise.resolve({ data: rows.slice(first,last+1), error }).then(resolve,reject);
        },
      };
    } },
    fetchAllPages: async (query, size) => {
      const out=[];
      for(let start=0;;start+=size) {
        const result=await query(start,start+size-1);
        if(result.error) throw result.error;
        out.push(...result.data);
        if(result.data.length<size) return out;
      }
    },
    fetchNestAmazonProfiles: async (customer, signal) => { fallback.push({customer,signal}); return []; },
    attachKdpAccountCountsFromBridge: async list => list,
  };
  vm.runInNewContext(ts.transpileModule(fetchSource, {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText, env);
  return { calls, fallback, fetch:env.exports.fetchAmazonProfiles };
}

test('cold identity hydration preserves a selection; only a real switch or confirmed logout resets it',()=>{
  for(const previous of [undefined,null,'owner']) {
    assert.equal(profileSelectionMustReset(previous,null,'loading'),false);
    assert.equal(profileSelectionMustReset(previous,'owner','authenticated'),false);
    assert.equal(profileSelectionMustReset(previous,null,'unauthenticated'),true);
  }
  assert.equal(profileSelectionMustReset('owner','other','authenticated'),true);
});

test('self profile rows preserve disabled state, nickname, campaign totals and KDP count without a second enrichment read',async()=>{
  const h=harness([{profile:{id:'p',profile_id:'p',nickname:'US',is_enabled:false,
    campaigns_enabled_count:3,campaigns_paused_count:2,kdp_account_count:4}}]);
  const rows=await h.fetch('owner');
  assert.equal(rows.length,1);assert.equal(rows[0].is_enabled,false);
  assert.equal(rows[0].nickname,'US');assert.equal(rows[0].campaign_count,5);
  assert.equal(rows[0].kdp_account_count,4);assert.equal(h.fallback.length,0);
  assert.equal(h.calls[0].name,'mobile_amazon_profiles_v1');
  assert.equal(h.calls[0].signal.aborted,true);
});

test('profile fast path paginates without dropping profiles and never runs for guest or view-as',async()=>{
  const h=harness(Array.from({length:1001},(_,i)=>({profile:{id:String(i),is_enabled:true}})));
  assert.equal((await h.fetch('owner')).length,1001);assert.equal(h.calls.length,2);
  const other=harness();await other.fetch(null);assert.equal(other.calls.length,0);
  await other.fetch('admin','customer');assert.equal(other.calls.length,0);
  assert.equal(other.fallback[0].customer,'customer');
});

test('only a missing deployment allows the compatibility fallback, not a timeout, denial or pool exhaustion',async()=>{
  for(const code of ['57014','PGRST002','42501']) {
    const h=harness([],{code});
    await assert.rejects(h.fetch('owner'),e=>e.code===code);
    assert.equal(h.fallback.length,0);
  }
  const missing=harness([],{code:'PGRST202'});await missing.fetch('owner');
  assert.equal(missing.fallback.length,1);
  assert.equal(missing.fallback[0].signal.aborted,true);
});

test('an already abandoned profile context starts neither Supabase nor Nest',async()=>{
  const h=harness();const abort=new AbortController();abort.abort();
  await assert.rejects(h.fetch('owner',null,abort.signal),{name:'AbortError'});
  assert.equal(h.calls.length,0);assert.equal(h.fallback.length,0);
});

test('seller profile hydration is independent of admin-users and passes the query cancellation signal',()=>{
  const app=read('../src/contexts/AppContext.tsx');
  assert.match(app,/const waitingForCustomer\s*=\s*!!adminFilterUserId/);
  assert.match(app,/queryFn: \(\{ signal \}\) => fetchAmazonProfiles\(user\?\.id, isAdminViewer \? adminFilterUserId : null, signal\)/);
  assert.match(app,/profileSelectionMustReset\(prevId, currId, authState\)/);
  assert.match(app,/const scopeLoading = authState === "loading" \|\| !hydrated \|\| profilesLoading \|\| waitingForCustomer;/);
});

function tokenHarness(responses) {
  const source=read('../src/lib/rulesApi.ts');
  const ast=ts.createSourceFile('rulesApi.ts',source,ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='nestApiFetch').getText(ast);
  const calls=[],refreshes=[];
  const env={exports:{},API_BASE:'https://fixture',Response,
    resolveMobileApiToken:async()=>({source:'nest',token:'old'}),
    shouldRefreshNestToken:()=>true,
    refreshNestToken:async()=>{refreshes.push('nest');return 'fresh';},
    readSupabaseAccessToken:async()=>null,
    fetch:async(url,init)=>{calls.push({url,init});return responses.shift();},
  };
  vm.runInNewContext(ts.transpileModule(fn,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,env);
  return {calls,refreshes,fetch:env.exports.nestApiFetch};
}

test('seller-only auth/users denial does not refresh tokens and leaves its response body readable',async()=>{
  const h=tokenHarness([new Response(JSON.stringify({message:'Only admins can view all users'}),{status:401})]);
  const response=await h.fetch('/auth/users');
  assert.equal(h.calls.length,1);assert.equal(h.refreshes.length,0);
  assert.equal((await response.json()).message,'Only admins can view all users');
});

test('expired admin and malformed auth/users responses still use normal token recovery',async()=>{
  for(const body of [JSON.stringify({message:'Invalid or expired token'}),'not-json']) {
    const h=tokenHarness([new Response(body,{status:401}),new Response('{}',{status:200})]);
    const response=await h.fetch('/auth/users?limit=1');
    assert.equal(response.status,200);assert.equal(h.calls.length,2);assert.equal(h.refreshes.length,1);
    assert.equal(h.calls[1].init.headers.Authorization,'Bearer fresh');
  }
});
