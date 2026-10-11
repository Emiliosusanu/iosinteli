import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKdpFromJsons } from '../src/lib/kdp/vendor/kdpVendor.generated.js';
const digital='B0DJV9DVVT',print='B0PRNT1234',other='B0DHHDY3Y6';
const report=rows=>({histogram:{data:rows.map(([bin,values])=>({bin,values}))}});
const capture=({books={},royalties=[],orders=[],pages=[]}={})=>buildKdpFromJsons({ymd:'2026-10-11',titlesJson:{reportsMetadata:{books}},
 royaltiesJson:report(royalties),ordersJson:report(orders),kenpJson:report(pages.map(([bin,n])=>[bin,{TotalKENP:n}]))});
test('positive book-level KENP is retained with absent metadata and totals reconcile',()=>{
 const r=capture({pages:[[digital,254],[other,151]]});
 assert.equal(r.rowDaily.kenp,405);assert.equal(r.rowsBookDaily.reduce((n,r)=>n+r.kenp,0),405);
 assert.equal(r.facts.filter(r=>r.format==='ku').reduce((n,r)=>n+r.kenp,0),405);
 assert.equal(r.facts.find(r=>r.asin===digital&&r.format==='ku').kenp,254);
 assert.equal(Object.keys(r.booksObj).length,0); // No invented title or print sibling.
});
test('missing metadata reuses an explicit royalty ebook identity without counting twice',()=>{
 const group=`DIGITAL=${digital}:PRINT=${print}::`;
 const r=capture({royalties:[[group,{TotalRoyalties:7,PaperbackRoyalties:5,DigitalRoyalties:2}]],pages:[[digital,64]]});
 assert.equal(r.rowDaily.kenp,64);assert.equal(r.rowDaily.royalties,7);
 assert.equal(r.facts.filter(r=>r.asin===digital&&r.format==='ku').length,1);
});
test('non-KU titles and all explicit zero KENP aliases do not block paid sales',()=>{
 const group=`DIGITAL=${digital}:PRINT=${print}::`;
 const r=capture({books:{[group]:{asins:{digital,print}}},royalties:[[group,{TotalRoyalties:7,PaperbackRoyalties:5,DigitalRoyalties:2}]],pages:[[digital,0],[print,0],[other,0]]});
 assert.equal(r.rowDaily.kenp,0);assert.equal(r.rowDaily.royalties,7);
});
test('a duplicate unknown positive ASIN and non-book aggregate remain rejected',()=>{
 assert.throws(()=>capture({pages:[[digital,518],[digital,518]]}),/repeated positive/);
 assert.throws(()=>capture({pages:[['Amazon.com',518]]}),/missing book-level histogram/);
});
