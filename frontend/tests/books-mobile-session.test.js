import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/lib/rulesApi.ts',import.meta.url),'utf8');
const start=source.indexOf('export async function hasMobileApiSession('),end=source.indexOf('export async function nestApiFetch(',start);
const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('Books API session follows the existing unified bearer resolver, including Supabase Amazon login',async()=>{
 for(const picked of [null,{token:'private-test',source:'supabase'},{token:'private-test',source:'nest'}]){
  let calls=0;const ctx={exports:{},resolveMobileApiToken:async()=>{calls++;return picked;}};vm.runInNewContext(js,ctx);
  assert.equal(typeof ctx.exports.hasMobileApiSession,'function');assert.equal(await ctx.exports.hasMobileApiSession(),!!picked);assert.equal(calls,1);
 }
});
