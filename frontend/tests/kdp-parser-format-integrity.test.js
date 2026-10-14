import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKdpFromJsons } from '../src/lib/kdp/vendor/kdpVendor.generated.js';
const asins={digital:'B0DIGI1234',print:'B0PRNT1234',hardcover:'B0HARD1234',audiobook:'B0AUDI1234'};
const group=`DIGITAL=${asins.digital}:PRINT=${asins.print}:HARDCOVER=${asins.hardcover}:AUDIOBOOK=${asins.audiobook}`;
const report=values=>({histogram:{props:{filterBy:{MARKETPLACE:['US']}},data:[{bin:group,values}]}});
function capture(royalties,orders={TotalOrders:4,DigitalOrders:0,PaperbackOrders:2,HardcoverOrders:1,AudiobookOrders:1}) {
 return buildKdpFromJsons({ymd:'2026-10-14',titlesJson:{reportsMetadata:{books:{[group]:{asins}}}},royaltiesJson:report(royalties),ordersJson:report(orders),kenpJson:report({TotalKENP:0})});
}
const base={PaperbackRoyalties:12,DigitalRoyalties:0,HardcoverRoyalties:0,AudiobookRoyalties:0,TotalRoyalties:12};
test('iOS preserves explicit zero and negative format royalties instead of reallocating paperback income',()=>{
 for(const hardcover of [0,-5]) {
  const r=capture({...base,HardcoverRoyalties:hardcover,TotalRoyalties:12+hardcover});
  assert.equal(r.facts.find(f=>f.format==='hardcover').royalties,hardcover);
  assert.equal(r.facts.find(f=>f.format==='paperback').royalties,12);
  assert.equal(r.rowDaily.royalties,12+hardcover);
 }
});
test('iOS preserves signed net quantities through the actual vendored report parser',()=>{
 const r=capture({...base,HardcoverRoyalties:-5,TotalRoyalties:7},{TotalOrders:1,DigitalOrders:0,PaperbackOrders:2,HardcoverOrders:-1,AudiobookOrders:0});
 assert.equal(r.facts.find(f=>f.format==='hardcover').units,-1);
 assert.equal(r.rowDaily.orders,1);assert.equal(r.rowsBookDaily.reduce((n,r)=>n+r.orders,0),1);
});
test('an explicit zero is not replaced by a secondary audio alias or an unexplained total remainder',()=>{
 const r=capture({...base,AudibleRoyalties:7});
 assert.equal(r.facts.find(f=>f.format==='audiobook').royalties,0);
 assert.throws(()=>capture({...base,TotalRoyalties:19,AudibleRoyalties:7}),e=>e.code==='KDP_CAPTURE_INCOMPLETE');
});
test('day royalties use the requested day while a larger period summary is present',()=>{
 const royalties=report({...base,TotalRoyalties:24,PaperbackRoyalties:24});
 royalties.nestedHistogram={histogramList:[{title:'2026-10-14',data:[{bin:group,values:base}]}]};
 const r=buildKdpFromJsons({ymd:'2026-10-14',titlesJson:{reportsMetadata:{books:{[group]:{asins}}}},royaltiesJson:royalties,ordersJson:report({TotalOrders:2,PaperbackOrders:2,DigitalOrders:0}),kenpJson:report({TotalKENP:0})});
 assert.equal(r.rowDaily.royalties,12);
});
test('normal minor-unit estimate rounding retains explicit format values',()=>{
 const r=capture({...base,TotalRoyalties:12.01});
 assert.equal(r.facts.find(f=>f.format==='hardcover').royalties,0);
 assert.equal(r.facts.find(f=>f.format==='audiobook').royalties,0);
});

test('a positive total cannot inflate an explicit paperback quantity',()=>{
 assert.throws(()=>capture(base,{TotalOrders:5,DigitalOrders:0,PaperbackOrders:3,HardcoverOrders:0,AudiobookOrders:0}),e=>e.code==='KDP_CAPTURE_INCOMPLETE');
});
test('a positive total cannot overwrite explicit zero format quantities',()=>{
 assert.throws(()=>capture(base,{TotalOrders:2,DigitalOrders:0,PaperbackOrders:0,HardcoverOrders:0,AudiobookOrders:0}),e=>e.code==='KDP_CAPTURE_INCOMPLETE');
});
test('a legacy total can fill one missing identified format metric',()=>{
 const r=capture(base,{TotalOrders:5,DigitalOrders:0,HardcoverOrders:0,AudiobookOrders:0});
 assert.equal(r.facts.find(f=>f.format==='paperback').units,5);
});
test('a legacy total cannot guess between two missing identified formats',()=>{
 assert.throws(()=>capture(base,{TotalOrders:5,DigitalOrders:0,HardcoverOrders:0}),e=>e.code==='KDP_CAPTURE_INCOMPLETE');
});
test('matching explicit format quantities remain accepted without reallocating paperback orders',()=>{
 const r=capture(base,{TotalOrders:5,DigitalOrders:2,PaperbackOrders:3,HardcoverOrders:0,AudiobookOrders:0});
 assert.equal(r.rowDaily.orders,5);assert.equal(r.facts.find(f=>f.format==='paperback').units,3);
 assert.equal(r.facts.find(f=>f.format==='ebook').units,2);
});
test('a zero tandem metric does not hide a missing paperback metric',()=>{
 const r=capture(base,{TotalOrders:5,DigitalOrders:0,HardcoverOrders:0,AudiobookOrders:0,TandemOrders:0});
 assert.equal(r.facts.find(f=>f.format==='paperback').units,5);
});
