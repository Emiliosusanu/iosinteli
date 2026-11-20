import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../src/lib/notificationContract.ts';

const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('notifications.ts', source, ts.ScriptTarget.Latest, true);
const direct = (payload, data = null) => ({content: {data}, trigger: {type: 'push', payload}});
function actualHandler(owner = 'owner', prefs = {newOrder:true, dailyDigest:true}) {
  let handle;
  const statement = ast.statements.find(node => ts.isTryStatement(node) && node.getText(ast).includes('setNotificationHandler'));
  const env = {...contract, exports:{}, PREFS_KEY:'prefs', devWarn:()=>{},
    supabase:{auth:{getSession:async()=>({data:{session:owner?{user:{id:owner}}:null}})}},
    readJson:async()=>prefs,
    Notifications:{setNotificationHandler: value => {handle = value.handleNotification;}},
  };
  vm.runInNewContext(ts.transpileModule(statement.getText(ast), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText, env);
  return request => handle({request});
}

test('direct APNs test and order payloads survive the installed Expo iOS serializer', async () => {
  const serializer = readFileSync(new URL('../node_modules/expo-notifications/ios/EXNotifications/Notifications/EXNotificationSerializer.m',import.meta.url),'utf8');
  assert.match(serializer, /return isRemote \? request\.content\.userInfo\[@"body"\] : request\.content\.userInfo/);
  assert.match(serializer, /serializedTrigger\[@"payload"\] = request\.content\.userInfo/);
  const handle = actualHandler();
  for (const event of ['smart_notification_transport_test','ads_new_orders','daily_ads_summary']) {
    const result = await handle(direct({aps:{alert:{title:'Actual sender'}},event,userId:'owner'}));
    assert.equal(result.shouldShowBanner,true,event);
    assert.equal(result.shouldShowList,true);
  }
});

test('raw APNs payload extraction never bypasses owner, preference or silent checks', async () => {
  const handle = actualHandler('owner',{newOrder:false});
  for (const payload of [
    {event:'ads_new_orders',userId:'other'},
    {event:'ads_new_orders',userId:'owner'},
    {event:'smart_notification_transport_test',userId:'other'},
    {event:'kdp-wake',silent:true,userId:'owner'},
    {event:'smart_notification_transport_test',userId:'owner',silent:true},
  ]) assert.equal((await handle(direct(payload))).shouldShowBanner,false);
  assert.equal((await actualHandler(null)(direct({event:'test',userId:'owner'}))).shouldShowBanner,false);
});

test('response navigation uses the same normalized request as presentation and refresh', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx',import.meta.url),'utf8');
  assert.match(layout,/parseNotificationPayload\(notificationDataFromRequest\(response\.notification\.request\)\)/);
});

test('wire envelopes remain separate and conflicting identity/event claims fail closed', () => {
  const extract = contract.notificationDataFromRequest;
  assert.equal(typeof extract,'function');
  const own = {event:'ads_new_orders',userId:'owner',asin:'B000000001'};
  assert.deepEqual(extract(direct(own)),own);
  assert.deepEqual(extract({content:{data:own},trigger:null}),own);
  assert.deepEqual(extract(direct({body:own},own)),own);
  assert.deepEqual(extract(direct({...own,event:'new-orders'},own)),{...own,event:'new-orders'});
  for (const request of [
    direct({...own,userId:'other'},own),
    direct({...own,event:'daily_ads_summary'},own),
    direct({event:'ads_new_orders',body:own}),
    direct({body:{...own,userId:'other'}},own),
  ]) {
    const data = extract(request);
    assert.equal(contract.shouldPresentNotification(data,'owner',{newOrder:true,dailyDigest:true}),false);
  }
  for (const request of [null,{},[],{content:{data:'not JSON'}},direct([]),direct('not JSON')]) {
    assert.deepEqual(extract(request),{});
  }
});

test('transport silence is preserved rather than overwritten by an alert-shaped inner body', () => {
  const extract = contract.notificationDataFromRequest;
  assert.equal(typeof extract,'function');
  const own={event:'test',userId:'owner'};
  for(const request of [direct({silent:true,body:own},own),direct({aps:{'content-available':1},body:own},own)]) {
    assert.equal(contract.shouldPresentNotification(extract(request),'owner',{}),false);
  }
});

test('the actual receipt listener refreshes an owned direct APNs event but ignores another account', async () => {
  let receive;
  const refreshes = [];
  const env = {...contract, exports:{}, notificationIdentityRevision:0, backgroundWakeInstalled:false,
    pendingPushRefresh:false, pendingSilentRefresh:false,
    Platform:{OS:'ios'}, AppState:{currentState:'active'}, devWarn:()=>{},
    supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}}})}},
    Notifications:{addNotificationReceivedListener: callback => {receive = callback;}},
    emitNotificationRefresh: reason => {refreshes.push(reason);}, drainPushRefresh:async()=>{},
  };
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'installBackgroundSyncWakeHandlers');
  vm.runInNewContext(ts.transpileModule(fn.getText(ast), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText,env);
  env.installBackgroundSyncWakeHandlers();
  receive({request:direct({event:'ads_new_orders',userId:'owner'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(refreshes,['push-visible']);
  receive({request:direct({event:'ads_new_orders',userId:'other'})});
  receive({request:direct({event:'smart_notification_transport_test',userId:'owner'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(refreshes.length,1);
});
