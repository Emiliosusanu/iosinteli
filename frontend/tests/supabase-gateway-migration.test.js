const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { supabaseDestination } = require('../src/lib/supabaseDestination.ts');

test('known hosted origin and existing gateway retain one session/PKCE namespace',()=>{
 for(const url of ['https://sjdlkprlkaweyuiaigix.supabase.co',' https://sjdlkprlkaweyuiaigix.supabase.co/ ','https://api.inteliads.io/db/'])
  assert.deepEqual(supabaseDestination(url),{url:'https://api.inteliads.io/db',storageKey:'sb-sjdlkprlkaweyuiaigix-auth-token'});
});

test('another project, lookalike origin and custom path keep SDK-specific storage',()=>{
 for(const url of ['https://custom.supabase.co','https://sjdlkprlkaweyuiaigix.supabase.co.evil.test','https://sjdlkprlkaweyuiaigix.supabase.co/custom','https://unavailable.supabase.co'])
  assert.deepEqual(supabaseDestination(url),{url});
});

test('actual SDK restores the old persisted session through the new gateway without another login',async()=>{
 const key='sb-sjdlkprlkaweyuiaigix-auth-token';
 const exp=Math.floor(Date.now()/1000)+3600;
 const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',exp})).toString('base64url')+'.synthetic-signature';
 const session={access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user:{id:'00000000-0000-4000-8000-000000000001'}};
 const data=new Map([[key,JSON.stringify(session)],[key+'-code-verifier','existing-pkce-verifier']]);
 const reads=[];
 const storage={getItem:async k=>{reads.push(k);return data.get(k)||null;},setItem:async(k,v)=>data.set(k,v),removeItem:async k=>data.delete(k)};
 const destination=supabaseDestination('https://sjdlkprlkaweyuiaigix.supabase.co');
 const client=createClient(destination.url,'public-fixture',{auth:{storageKey:destination.storageKey,storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:()=>{throw Error('Unexpected login/network request');}}});
 const result=await client.auth.getSession();
 assert.equal(result.error,null);assert.equal(result.data.session.access_token,token);assert.equal(result.data.session.refresh_token,'synthetic-refresh');
 assert.ok(reads.includes(key));assert.equal(data.get(key+'-code-verifier'),'existing-pkce-verifier');
 assert.equal(client.auth.url,'https://api.inteliads.io/db/auth/v1');
 assert.equal(client.rest.url,'https://api.inteliads.io/db/rest/v1');
 assert.ok(client.realtime.endPoint.startsWith('wss://api.inteliads.io/db/realtime/v1'));
 assert.equal(data.has('sb-api-auth-token'),false);
 client.realtime.disconnect();
 client.auth.broadcastChannel?.close();
});
