import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKdpFromJsons } from '../src/lib/kdp/vendor/kdpVendor.generated.js';
import { allKdpMarketplaceTargets } from '../src/lib/kdp/marketplace.ts';
import { mapKdpMarketplacesSettled } from '../src/lib/kdp/vendor/kdp-report-scheduler.js';
import { createInitialSyncState, planSync } from '../src/lib/kdp/planner.ts';
import { eachYmd, addDaysYmd } from '../src/lib/kdp/dates.ts';
import { journalDeferredDays, acknowledgeDeferredDays, takeDeferredDays } from '../src/lib/kdp/deferred.ts';

const asins = Array.from({length:1000}, (_,i)=>`B0CAT${String(i).padStart(5,'0')}`);
const titlesJson = { reportsMetadata: {books:Object.fromEntries(asins.map(asin=>[asin,{asins:{digital:asin}}]))}};
function reports(day, amount=1) {
  const histogram = values=>({nestedHistogram:{histogramList:[{title:day,data:asins.map(bin=>({bin,values}))}]}});
  return {royaltiesJson:histogram({TotalRoyalties:amount,DigitalRoyalties:amount}),
    ordersJson:histogram({TotalOrders:1,DigitalOrders:1}),kenpJson:histogram({TotalKENP:0})};
}
test('1000-book 90-day onboarding and 28-day correction replay retain every day, native store and failed ACK across restart',async()=>{
  const started=performance.now(), now=new Date('2026-10-11T12:00:00Z'), targets=allKdpMarketplaceTargets();
  let state=createInitialSyncState(), journal=[], plan;
  do {
    plan=planSync(now,state,{timeZone:'UTC',wakeMode:'processing'});state=plan.nextState;
    journal=journalDeferredDays(journal,plan.ranges.flatMap(r=>eachYmd(r.from,r.to)));
  } while(plan.continueSoon);
  assert.equal(journal.length,90);
  let active=0,maxActive=0,failedAck=true;
  const accepted=new Map();
  async function capture(day,amount) {
    const all=buildKdpFromJsons({ymd:day,titlesJson,...reports(day,amount)});
    assert.equal(all.rowsBookDaily.length,1000);assert.ok(Math.abs(all.rowDaily.royalties-amount*1000)<.00001);
    const native=await mapKdpMarketplacesSettled(targets,async target=>{
      active++;maxActive=Math.max(maxActive,active);await Promise.resolve();
      const built=buildKdpFromJsons({ymd:day,titlesJson,...reports(day,amount)});active--;
      return built.facts.map(f=>({...f,marketplace:target.key,currency:target.currency}));
    },{concurrency:3,pauseMs:0,stopOnFailure:true});
    assert.ok(native.every(r=>r.status==='fulfilled'));
    const facts=native.flatMap(r=>r.value);
    assert.equal(facts.length,34000);
    assert.equal(new Set(facts.map(f=>`${f.asin}:${f.format}:${f.marketplace}`)).size,34000);
    for(const target of targets) assert.equal(facts.filter(f=>f.marketplace===target.key&&f.currency===target.currency).length,2000);
    // Store ACK loss must retain the day even if the server committed already.
    accepted.set(day,all.rowDaily.royalties);
    if(failedAck){failedAck=false;return false;}return true;
  }
  while(journal.length){
    const batch=takeDeferredDays(journal,14);
    for(const day of batch) if(await capture(day,1)) journal=acknowledgeDeferredDays(journal,[day]);
    journal=JSON.parse(JSON.stringify(journal)); // durable process restart
  }
  assert.equal(accepted.size,90);assert.equal(maxActive,3);
  const correctionDays=eachYmd(addDaysYmd('2026-10-11',-27),'2026-10-11');
  journal=journalDeferredDays([],correctionDays);
  for(const day of takeDeferredDays(journal,30)) {
    if(await capture(day,.53)) journal=acknowledgeDeferredDays(journal,[day]);
  }
  assert.equal(journal.length,0);
  for(const day of correctionDays) assert.ok(Math.abs(accepted.get(day)-530)<.00001);
  console.log(`1000-book backfill replay: ${Math.round(performance.now()-started)}ms; 90 days +28 corrected,17 stores/day; excludes network, SQL and iOS wake scheduling`);
});
