import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { allKdpMarketplaceTargets } from '../src/lib/kdp/marketplace.ts';
import { hasVerifiedNativeCoverage, kdpFactSnapshotsMatch, hasTransactionalNativeCoverage } from '../src/lib/kdp/marketplaceCoverage.ts';
import { mapKdpMarketplacesSettled } from '../src/lib/kdp/vendor/kdp-report-scheduler.js';
import { withKdpTaskRequest } from '../src/lib/kdp/backgroundBudget.ts';

const importer = readFileSync(new URL('../src/lib/kdp/importer.ts', import.meta.url), 'utf8');
const writer = readFileSync(new URL('../src/lib/kdp/upsert.ts', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const targets = allKdpMarketplaceTargets();
const date = '2026-10-09';
const accountId = '11111111-1111-4111-8111-111111111111';

test('native report scope includes all 17 stores independently of Ads selection', () => {
  assert.equal(targets.length, 17);
  assert.equal(new Set(targets.map(t => t.key)).size, 17);
  assert.deepEqual(targets.find(t => t.key === 'BR'), {key:'BR',filterToken:'Amazon.com.br',currency:'BRL'});
  assert.deepEqual(targets.find(t => t.key === 'CA'), {key:'CA',filterToken:'Amazon.ca',currency:'CAD'});
  assert.match(importer, /const marketplaceTargets = allKdpMarketplaceTargets\(\)/);
  assert.doesNotMatch(importer, /marketplaceTargetsFromProfiles|fetchAmazonProfiles/);
});

async function runDay(failedMarket = null, writes = [], options = {}) {
  const exports = {}, reads = [];
  const start = importer.indexOf('async function syncOneDay(');
  const end = importer.indexOf('async function resolveAccountId(', start);
  vm.runInNewContext(compile(importer.slice(start, end).replace('async function', 'export async function')), {
    exports, Date, Number, String, Math, Promise,
    fetchDayPayloads: async (_, currency, target) => {
      reads.push({currency,market:target?.key || 'ALL'});
      if (target?.key === failedMarket) throw new Error('native response unavailable');
      return {royaltiesJson:{market:target?.key || 'ALL'},ordersJson:{},kenpJson:{}};
    },
    buildKdpFromJsons: ({royaltiesJson}) => ({rowDaily:{date,royalties:17*(options.royalties??1),orders:17*(options.units??1),kenp:0},
      rowEntry:{date,income:17*(options.royalties??1)},rowsBookDaily:[],facts:[{asin:'B0GS27WQBZ',format:'paperback',units:options.units??1,royalties:options.royalties??1,kenp:0}]}),
    supabase:{from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})})},
    evaluateRoyaltyOverwriteSafety:()=>({safe:options.safe??true}),
    allKdpMarketplaceTargets,
    appendKdpActivity:async()=>{},writeKdpDay:async value=>writes.push(value),
    mapKdpMarketplacesSettled, withKdpTaskRequest, taskRequestTimeout: () => undefined,
  });
  await exports.syncOneDay(accountId,date,{},options.targets??targets);
  return {reads,writes};
}
test('actual importer writes one USD All day and 17 native market facts', async () => {
  const {reads,writes} = await runDay();
  assert.equal(reads.length,18);
  assert.equal(writes.length,1);
  assert.equal(writes[0].rowEntry.income_currency,'USD');
  assert.deepEqual(Array.from(writes[0].marketplaces),targets.map(t=>t.key));
  for (const target of targets) {
    const fact = writes[0].factRows.find(f=>f.marketplace===target.key);
    assert.equal(fact.currency,target.currency);
  }
});
test('actual importer never replaces a day when any native store fails', async () => {
  const writes=[];
  await assert.rejects(runDay('BR',writes),/native response unavailable/);
  assert.equal(writes.length,0);
});

test('signed native units reach the actual atomic writer without clamping', async()=>{
 const {writes}=await runDay(null,[],{units:-1,royalties:-1});
 assert.equal(writes[0].rowDaily.orders,-17);
 assert.equal(writes[0].factRows.reduce((n,f)=>n+f.units,0),-17);
 assert.ok(writes[0].factRows.every(f=>f.units===-1));
});
test('complete native zero corrections are decided by the server rather than a legacy client heuristic', async()=>{
 const {writes}=await runDay(null,[],{units:0,royalties:0,safe:false});
 assert.equal(writes.length,1);assert.notEqual(writes[0].reviewOnly,true);
 assert.equal(writes[0].marketplaces.length,17);
});
test('a partial marketplace selection cannot bypass the legacy overwrite protection', async()=>{
 const writes=[];await assert.rejects(runDay(null,writes,{units:0,royalties:0,safe:false,targets:targets.slice(0,1)}),/existing verified royalties/);
 assert.equal(writes.length,1);assert.equal(writes[0].reviewOnly,true);
});

function coverageWriter({wrongRevision=false, missingFact=false, markerError=false, changedDay=false, review=false, empty=false, wrongAck=false, transaction=false, badTransaction=false} = {}) {
  const exports={}, calls=[], markerWrites=[];
  let body, marker, dayReads=0;
  const updated='2026-10-09T20:45:00.000Z';
  const fact={asin:'B0GS27WQBZ',format:'paperback',marketplace:'CA',currency:'CAD',units:1,royalties:7.5,kenp:0};
  const supabase={from: table => {
    const chain = {
      select:()=>chain,eq:()=>chain,order:()=>chain,
      maybeSingle:async()=>{
        if(table==='kdp_marketplace_day_coverage') return {data:marker,error:null};
        dayReads++;
        return {data:{updated_at:changedDay&&dayReads>1?'changed':updated},error:null};
      },
      range:async()=>({data:missingFact||empty?[]:[{...fact,revision_id:wrongRevision?'wrong':body.revisionId}],error:null}),
      upsert:async value=>{markerWrites.push(value);marker=value;return {error:markerError?{message:'refused'}:null};},
    };return chain;
  }};
  const modules={
    '../supabase.ts':{supabase},
    'expo-constants':{default:{expoConfig:{version:'1.0.1',ios:{buildNumber:'384'}}}},
    './marketplaceCoverage.ts':{hasVerifiedNativeCoverage,kdpFactSnapshotsMatch,hasTransactionalNativeCoverage},
    './backgroundBudget.ts':{withKdpTaskRequest},
    '../rulesApi.ts':{nestApiJson:async(url,request)=>{
      body=JSON.parse(request.body);calls.push({url,body});
      return review?{ok:false,staged:true,quarantined:true,candidateId:'44444444-4444-4444-8444-444444444444',
        accountId,date,revisionId:body.revisionId}
        :{ok:true,accountId:wrongAck?'wrong':accountId,date,revisionId:body.revisionId,factRows:empty?0:1,submittedBookDailyRows:0, ...(transaction ? {coverageVerified:true,coverageVersion:1,coverageMarketplaces:targets.map(t=>t.key),verifiedFactRows:badTransaction?2:empty?0:1,dailyUpdatedAt:updated}: {})};
    }},
  };
  vm.runInNewContext(compile(writer),{exports,require:path=>modules[path],Math});
  return {calls,markerWrites,write:()=>exports.writeKdpDay({accountId,rowDaily:{date},rowEntry:{date},
    rowsBookDaily:[],factRows:empty?[]:[fact],marketplaces:targets.map(t=>t.key),reviewOnly:review})};
}
test('actual writer seals full native coverage only after matching cloud readback', async()=>{
  const h=coverageWriter();await h.write();
  assert.equal(h.markerWrites.length,1);
  assert.equal(h.markerWrites[0].producer_version,'ios-1.0.1+384');
  assert.equal(h.markerWrites[0].marketplaces.length,17);
  assert.equal(h.markerWrites[0].revision_id,h.calls[0].body.revisionId);
});
test('actual writer leaves failed, incomplete or superseded coverage pending',async()=>{
  for(const options of [{wrongRevision:true},{missingFact:true},{markerError:true},{changedDay:true}]) {
    await assert.rejects(coverageWriter(options).write(),/coverage unverified/);
  }
});
test('staged refund candidates never seal marketplace coverage',async()=>{
  const h=coverageWriter({review:true});await h.write();assert.equal(h.markerWrites.length,0);
});
test('confirmed zero activity still seals all 17 native storefronts without inventing facts',async()=>{
  const h=coverageWriter({empty:true});await h.write();
  assert.equal(h.markerWrites[0].fact_count,0);
  assert.equal(h.markerWrites[0].marketplaces.length,17);
});
test('a success acknowledgement for another account cannot seal this account',async()=>{
  const h=coverageWriter({wrongAck:true});
  await assert.rejects(h.write(),/acknowledgement mismatch/);
  assert.equal(h.markerWrites.length,0);
});
test('older partial coverage and changed snapshots cannot seal backfill',()=>{
  const updated='2026-10-09T20:45:00.000Z';
  assert.equal(hasVerifiedNativeCoverage(updated,{daily_updated_at:updated,marketplaces:['US','CA','GB','AU']}),false);
  assert.equal(hasVerifiedNativeCoverage(updated,{daily_updated_at:updated,marketplaces:targets.map(t=>t.key)}),true);
  assert.equal(hasVerifiedNativeCoverage('newer',{daily_updated_at:updated,marketplaces:targets.map(t=>t.key)}),false);
  assert.equal(kdpFactSnapshotsMatch([],[]),true);
});

test('transaction-verified receipt avoids full mobile readback while an invalid receipt stays pending', async () => {
  const h=coverageWriter({transaction:true});await h.write();
  assert.equal(h.markerWrites.length,0);
  await assert.rejects(coverageWriter({transaction:true,badTransaction:true}).write(), /receipt mismatch/);
});
