import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { userLookupProvesSessionInvalid } from '../src/lib/authRestore.ts';
import { isPermanentSessionError } from '../src/lib/sessionRefresh.ts';
import { supabaseSessionIsUsable } from '../src/lib/supabaseSession.ts';

const source=readFileSync(new URL('../src/contexts/AuthContext.tsx',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const valid=id=>({access_token:'fixture',refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,user:{id}});
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness() {
  const values=[],effects=[],pending=[],timers=new Map();let cursor=0,listener,seq=0,cleared=0,signouts=0;
  const initial=deferred(),verified=deferred();
  const auth={getSession:()=>initial.promise,getUser:()=>verified.promise,onAuthStateChange:fn=>{listener=fn;return {data:{listener:undefined,subscription:{unsubscribe(){}}}};},signOut:async()=>{signouts++;listener('SIGNED_OUT',null);return {};}};
  const React={createContext:()=>({Provider:'Provider'}),useContext(){},useCallback:fn=>fn,
    useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
    useRef(initial){const [r]=React.useState({current:initial});return r;},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>d!==effects[i].deps[j]))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    createElement:(_type,props)=>props};
  const noop=async()=>{};
  const queryClient={clear(){cleared++;},invalidateQueries:noop};
  const modules={react:{...React,default:React},'@tanstack/react-query':{useQueryClient:()=>queryClient},
    '../lib/supabase':{supabase:{auth},ensureFreshSupabaseSession:async()=> (await initial.promise).data.session},
    '@/src/utils/storage':{storage:{getItem:async()=>false,setItem:noop,removeItem:noop}},
    '@/src/lib/authRestore':{userLookupProvesSessionInvalid},'@/src/lib/sessionRefresh':{isPermanentSessionError},
    '@/src/lib/supabaseSession':{supabaseSessionIsUsable},'@/src/lib/queryTimeout':{withQueryTimeout:p=>p},
    '@/src/lib/rulesApi':{nestLogin:async()=>true,nestLogout:noop},'@/src/lib/notifications':{clearNotificationIdentity:noop},
    '@/src/lib/queryPersist':{clearPersistedQueryCache:noop},'@/src/lib/perf':{markPerf(){}},'@/src/lib/debugIngest':{debugIngest(){}}};
  const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:n=>modules[n]||{},console,setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)});
  return {initial,verified,render(){cursor=0;const result=exports.AuthProvider({children:null});while(pending.length)pending.shift()();return result.value;},
    event:(event,s)=>listener(event,s),deadline(){for(const fn of [...timers.values()])fn();},get cleared(){return cleared;},get signouts(){return signouts;}};
}

test('slow startup deadline never becomes a logout and late verification can recover',async()=>{
  const h=harness();h.render();await tick();h.deadline();
  let v=h.render();assert.equal(v.state,'loading');assert.equal(v.restoreError,true);assert.equal(h.signouts,0);
  h.initial.resolve({data:{session:valid('a')}});h.verified.resolve({data:{user:{id:'a'}},error:null});await tick();
  v=h.render();assert.equal(v.state,'authenticated');assert.equal(v.user.id,'a');assert.equal(v.restoreError,false);
});
test('temporary session/storage failure offers retry, never sign-in or cache deletion',async()=>{
  const h=harness();h.render();h.initial.reject(new TypeError('Network request failed'));await tick();
  const v=h.render();assert.equal(v.state,'loading');assert.equal(v.restoreError,true);assert.equal(h.cleared,0);assert.equal(h.signouts,0);
  v.retryRestore();assert.equal(h.render().restoreError,false);
});
test('sign-out supersedes a delayed startup response',async()=>{
  const h=harness();h.render();await tick();await h.render().signOut();
  h.initial.resolve({data:{session:valid('old')}});h.verified.resolve({data:{user:{id:'old'}}});await tick();
  const v=h.render();assert.equal(v.state,'unauthenticated');assert.equal(v.user,null);
});
test('account switch cannot be overwritten by the previous getUser result',async()=>{
  const h=harness();h.render();h.initial.resolve({data:{session:valid('old')}});await tick();
  h.event('SIGNED_IN',valid('new'));h.verified.resolve({data:{user:{id:'old'}}});await tick();h.deadline();
  const v=h.render();assert.equal(v.user.id,'new');assert.equal(v.state,'authenticated');assert.equal(v.restoreError,false);
});
test('empty persisted session reaches sign-in without inventing authenticated access',async()=>{
  const h=harness();h.render();h.initial.resolve({data:{session:null},error:null});await tick();
  assert.equal(h.render().state,'unauthenticated');
});
test('verified invalid user clears the session rather than bypassing authentication',async()=>{
  const h=harness();h.render();h.initial.resolve({data:{session:valid('old')}});h.verified.resolve({data:{user:null},error:{status:401}});await tick();
  assert.equal(h.render().state,'unauthenticated');assert.equal(h.signouts,1);assert.equal(h.cleared,1);
});
