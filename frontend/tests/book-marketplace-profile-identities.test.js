import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActiveMarketplaceIndexFromProfileBooks,countriesForSponsoredBook,countriesForActiveSponsoredBook} from '../src/lib/bookMarketplaces.ts';
test('verified server campaign profiles supply US/CA flags through exact format identities without name matching',()=>{
 const profiles=[{id:'us',country_code:'US'},{id:'ca',country_code:'CA'}];
 const index=buildActiveMarketplaceIndexFromProfileBooks(profiles,[{asin:'1807973751',amazonProfileIds:['us','ca','foreign'],campaignIds:['real-campaign']}]);
 const book={asin:'B000000001',book_key:'B000000001',format_asins:['1807973751']};
 assert.deepEqual(countriesForSponsoredBook(index,book,true),['US','CA']);assert.deepEqual(countriesForActiveSponsoredBook(index,book),['US','CA']);
 assert.deepEqual(countriesForSponsoredBook(index,{asin:'B000000002',title:'same title'},true),[]);
});
test('missing campaign identity, unknown profile or invalid ASIN never manufactures an active marketplace',()=>{
 const index=buildActiveMarketplaceIndexFromProfileBooks([{id:'us',country_code:'US'}],[
 {asin:'B000000001',amazonProfileIds:['us'],campaignIds:[]},
 {asin:'B000000002',amazonProfileIds:['foreign'],campaignIds:['real']},
 {asin:'invalid',amazonProfileIds:['us'],campaignIds:['real']},
 ]);assert.equal(index.countriesByKey.size,0);
});
