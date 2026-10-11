import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCatalogPage, canResumeKnownLivePricing, emptyPricingCatalog, createPricingCatalogStore, readAllPricingPages, pricingIdentityChunks } from '../src/lib/kdp/pricingCatalog.ts';
import { taskDeadline, taskRequestTimeout, canStartReportDay, KdpTaskBudgetExpired, withKdpTaskRequest, withKdpPreparationBudget } from '../src/lib/kdp/backgroundBudget.ts';

test('expired cloud budget starts no request and active expiry aborts the actual operation before returning', async () => {
  let started = false, settled = false;
  await assert.rejects(withKdpTaskRequest(Date.now(), async () => { started=true; }), KdpTaskBudgetExpired);
  assert.equal(started, false);
  await assert.rejects(withKdpTaskRequest(Date.now()+2100, signal => new Promise((resolve,reject) => {
    started=true;
    signal.addEventListener('abort', () => { settled=true; reject(new Error('Aborted request')); }, {once:true});
  })), KdpTaskBudgetExpired);
  assert.equal(started, true); assert.equal(settled, true);
});

for (const bookCount of [700, 1000]) test(`${bookCount} Bookshelf identities resume beyond page21 after process death and only seal on an authenticated terminal page`, async () => {
  const data = new Map(), storage = { getItem:async key=>data.get(key), setItem:async (key,v)=>{data.set(key,v);return true;} };
  let store = createPricingCatalogStore(storage), state = emptyPricingCatalog();
  for(let page=1;page<=bookCount/10;page++) {
    const rows=Array.from({length:10},(_,i)=>({kdpBookId:`SETUP${page*10+i}`,printAsin:`B0${page*10+i}`,printStatus:'live'}));
    state=acceptCatalogPage(state,page,rows);
    await store.save('a',state);
    if(page%7===0) { store=createPricingCatalogStore(storage);state=await store.load('a'); }
    assert.equal(state.complete,false);
  }
  assert.equal(state.rows.length,bookCount);assert.equal(state.page,bookCount/10+1);
  assert.equal((await store.load('b')).rows.length,0);
  const completed=acceptCatalogPage(state,bookCount/10+1,[]);
  assert.equal(completed.complete,true);assert.equal(completed.rows.length,bookCount);
  await assert.rejects(createPricingCatalogStore({...storage,setItem:async()=>false}).save('a',completed),/checkpoint unavailable/);
});

test('ignored pagination, duplicate pages and missing page ACK cannot report full discovery', () => {
  const rows=[{kdpBookId:'SETUP00001',printAsin:'B0TEST0001',printStatus:'live'}];
  const first=acceptCatalogPage(emptyPricingCatalog(),1,rows);
  const ignored=acceptCatalogPage(first,2,rows);
  assert.equal(ignored.complete,false);assert.equal(ignored.stalled,true);assert.equal(ignored.page,2);
  assert.throws(()=>acceptCatalogPage(first,3,rows),/cursor mismatch/);
  assert.equal(first.page,2); // failed fetch does not advance persisted cursor
});

test('short wakes resume recently verified live retries but refresh stale discovery and reject unknown or unpublished candidates', () => {
  const now=10_000_000, row={kdpBookId:'SETUP00001',printAsin:'B0TEST0001',printStatus:'live',observedAtMs:now};
  const catalog=acceptCatalogPage(emptyPricingCatalog(),1,[row],now);
  const pending=[{kdpBookId:row.kdpBookId}];
  assert.equal(canResumeKnownLivePricing(catalog,pending,now+30*60_000),true);
  assert.equal(canResumeKnownLivePricing(catalog,pending,now+61*60_000),false);
  assert.equal(canResumeKnownLivePricing(catalog,[],now),false);
  assert.equal(canResumeKnownLivePricing({...catalog,rows:[{...row,printStatus:'unpublished'}]},pending,now),false);
  assert.equal(canResumeKnownLivePricing({...catalog,rows:[{...row,printStatus:'unknown'}]},pending,now),false);
  assert.equal(canResumeKnownLivePricing({...catalog,stalled:true},pending,now),false);
});

test('1401 identities and large asin filters use full pagination and bounded URLs', async () => {
  const rows=Array.from({length:1401},(_,i)=>i), offsets=[];
  const result=await readAllPricingPages(async (offset,size)=>{offsets.push(offset);return rows.slice(offset,offset+size);});
  assert.deepEqual(result,rows);assert.deepEqual(offsets,[0,500,1000]);
  assert.equal(pricingIdentityChunks(rows).length,15);
  assert.ok(pricingIdentityChunks(rows).every(chunk=>chunk.length<=100));
  await assert.rejects(readAllPricingPages(async offset=>{if(offset===500)throw Error('offline');return rows.slice(0,500);}),/offline/);
});

test('cold startup and pre-import work consume native delivery budget; expired tasks do not reset it', () => {
  assert.equal(taskDeadline('recent',10_000,22_000),22_000);
  assert.equal(taskRequestTimeout(22_000,10_000),8_000);
  assert.equal(canStartReportDay(22_000,14_000),false);
  assert.throws(()=>taskRequestTimeout(22_000,18_001),KdpTaskBudgetExpired);
  assert.equal(taskDeadline('recent',30_000,22_000),22_000);
  assert.equal(taskDeadline('processing',0,null),120_000);
});


test('incomplete discovery advances after at most two short pricing slices even with 1000 pending books', () => {
  const now=10_000_000;
  const catalog=acceptCatalogPage(emptyPricingCatalog(),1,[{kdpBookId:'SETUP00001',printAsin:'B0TEST0001',printStatus:'live'}],now);
  const pending=Array.from({length:1000},(_,i)=>({kdpBookId:i===999?'SETUP00001':`OLD${i}`}));
  assert.equal(canResumeKnownLivePricing(catalog,pending,now),true);
  assert.equal(canResumeKnownLivePricing({...catalog,discoverySkips:1},pending,now),true);
  assert.equal(canResumeKnownLivePricing({...catalog,discoverySkips:2},pending,now),false);
  assert.equal(acceptCatalogPage({...catalog,discoverySkips:2},2,[{kdpBookId:'SETUP00002',printAsin:'B0TEST0002',printStatus:'live'}],now).discoverySkips,0);
});


test('slow session preparation cannot continue into importer after deadline', async () => {
  let startedImporter=false;
  await assert.rejects(async () => {
    await withKdpPreparationBudget(Date.now()+5100,()=>new Promise(resolve=>setTimeout(resolve,1300)));
    startedImporter=true;
  },KdpTaskBudgetExpired);
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(startedImporter,false);
});


test('actual Amazon rate limit defers before a sleep that exceeds the remaining delivery',async()=>{
  const {readFileSync}=await import('node:fs'), vm=await import('node:vm'), ts=(await import('typescript')).default;
  const source=readFileSync(new URL('../src/lib/kdp/importer.ts',import.meta.url),'utf8');
  const fragment=source.slice(source.indexOf('async function fetchJsonForType('),source.indexOf('async function fetchDayPayloads('));
  const code=ts.transpileModule(fragment,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let sleeps=0,requests=0;
  const context=vm.createContext({Date,Number,Error,KdpTaskBudgetExpired,taskRequestTimeout,RATE_LIMIT_BACKOFF_MS:2500,
    getKdpHelperStatus:()=>({templates:{royalties:{url:'https://kdpreports.amazon.com/reports/royalties',method:'GET'}}}),
    rebuildTemplateForDay:t=>t,kdpPageFetch:async()=>{requests++;return{status:429};},isRateLimited:e=>String(e).includes('429'),sleep:async()=>{sleeps++;},parseKdpJsonOrThrow:r=>r});
  vm.runInContext(code,context);
  await assert.rejects(context.fetchJsonForType('royalties','2026-10-11','USD',null,Date.now()+6000),KdpTaskBudgetExpired);
  assert.equal(requests,1);assert.equal(sleeps,0);
});
