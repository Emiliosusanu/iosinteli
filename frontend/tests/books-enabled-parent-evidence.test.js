import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/lib/queries.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('queries.ts',source,ts.ScriptTarget.Latest,true);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fetchEnabledSponsoredBooksForProfiles');
const ad=(asin,group,campaign='c')=>({asin,title:asin,status:'enabled',campaign_id:campaign,ad_group_id:group,
 campaigns:{state:'enabled'},ad_groups:{state:'enabled',campaign_id:campaign}});
function harness(fallback){
 const rows=[ad('B000000001','live'),ad('B000000002','paused'),ad('B000000003','wrong')];
 rows[1].ad_groups.state='paused';rows[2].ad_groups.campaign_id='another';
 const groups=[{id:'live',campaign_id:'c',state:'enabled'},{id:'paused',campaign_id:'c',state:'paused'},{id:'wrong',campaign_id:'another',state:'enabled'}];
 const calls=[];
 const supabase={from:table=>{
  let selection='',filters=[];
  const q={select:cols=>{selection=cols;return q;},in:(key,values)=>{filters.push([key,values]);return q;},order:()=>q,range:()=>q,
   then:(resolve,reject)=>{
    calls.push({table,selection,filters});
    if(fallback&&selection.includes('!inner'))return Promise.reject(Error('join unavailable')).then(resolve,reject);
    let data=table==='product_ads'?rows:table==='campaigns'?[{id:'c',state:'enabled'}]:groups;
    for(const[key,values]of filters){
     if(key==='amazon_profile_id')continue;
     data=data.filter(r=>values.includes(key.split('.').reduce((value,k)=>value?.[k],r)));
    }
    return Promise.resolve({data,error:null}).then(resolve,reject);
   }};return q;
 }};
 const context={Set,Map,supabase,fetchLinkedKdpAccountIds:async()=>[],sponsoredBookAsin:r=>r.asin,
  fetchAllPages:async build=>{const result=await build(0,999);if(result.error)throw result.error;return result.data;}};
 vm.runInNewContext(ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {read:context.fetchEnabledSponsoredBooksForProfiles,calls};
}
for(const fallback of [false,true])test(`Books enabled identities require enabled matching ad groups (${fallback?'fallback':'join'})`,async()=>{
 const h=harness(fallback),rows=await h.read(['owned']);
 assert.deepEqual(Array.from(rows,r=>r.asin),['B000000001']);
 assert(h.calls.some(c=>c.table==='ad_groups'||c.filters.some(([key])=>key==='ad_groups.state')));
});
