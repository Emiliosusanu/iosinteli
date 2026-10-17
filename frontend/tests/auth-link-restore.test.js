import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {authRedirectTarget} from '../src/lib/authContract.ts';
import {resolveDeepLinkHref} from '../src/lib/deepLinkContract.ts';

test('a deep link received during session verification waits for auth and wins over the default Home redirect',async()=>{
  const source=readFileSync(new URL('../app/_layout.tsx',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function RouteGuard('),source.indexOf('// Shows the animated logo'));
  const states=[],effects=[],queued=[],navigation=[];let cursor=0,state='loading',segments=['index'],receive;
  const router={replace:href=>navigation.push(['replace',href]),push:href=>navigation.push(['push',href])};
  const context={React:{createElement:()=>null},View:'View',RetryState:'Retry',ScreenSpinner:'Spinner',
    useAuth:()=>({state,user:state==='authenticated'?{id:'owner'}:null}),useTheme:()=>({colors:{}}),useRouter:()=>router,useSegments:()=>segments,
    useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=v;}];},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>d!==effects[i].deps[j]))queued.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
    Linking:{getInitialURL:async()=>null,addEventListener:(_type,fn)=>{receive=fn;return {remove(){}};}},
    Notifications:{getLastNotificationResponseAsync:async()=>null,clearLastNotificationResponseAsync:async()=>{},addNotificationResponseReceivedListener:()=>({remove(){}})},
    authRedirectTarget,resolveDeepLinkHref,handledNotificationIds:new Set(),isSafeNotificationHref:()=>false,parseNotificationPayload:()=>null,routeForNotification:()=>null,
  };
  vm.createContext(context);vm.runInContext(ts.transpileModule(fn,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const render=()=>{cursor=0;context.RouteGuard({children:null});while(queued.length)queued.shift()();};
  render();receive({url:'inteliads://targeting?ownerId=foreign&profiles=foreign'});render();
  assert.equal(navigation.length,0);
  state='authenticated';render();
  assert.deepEqual(navigation,[['replace','/(tabs)'],['push','/(tabs)/targeting']]);
  navigation.length=0;segments=['(tabs)','targeting'];render();assert.equal(navigation.length,0);
});
