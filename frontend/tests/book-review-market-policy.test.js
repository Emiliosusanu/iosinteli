import test from 'node:test';
import assert from 'node:assert/strict';
import * as markets from '../src/lib/bookMarketplaces.ts';
import { highestBookRetailReviewSnapshot } from '../src/lib/bookRetailMetadata.ts';

const profiles = [
  { id: 'us', profile_id: 'ads-us', country_code: 'US' },
  { id: 'ca', profile_id: 'ads-ca', country_code: 'CA' },
  { id: 'gb', profile_id: 'ads-gb', country_code: 'GB' },
];
const asin = 'B0ABCDEFGH';
const row = (marketplaceCode, reviewCount, rating = 4.5) => ({
  asin, marketplaceCode, reviewCount, rating, stockStatus: 'IN_STOCK', checkedAt: null,
});
const snapshot = { ...row('CA', 400, 4.9), marketplaceSnapshots: [row('US', 100, 4.1), row('GB', 900, 4.8)] };

test('one active campaign market wins even when CA and GB have higher counts', () => {
  const result = highestBookRetailReviewSnapshot(snapshot, ['US']);
  assert.equal(result.marketplaceCode, 'US');
  assert.equal(result.reviewCount, 100);
  assert.equal(result.rating, 4.1);
  assert.equal(snapshot.marketplaceCode, 'CA');
  assert.equal(snapshot.stockStatus, 'IN_STOCK');
});
test('several active markets choose the highest count only within those markets', () => {
  assert.equal(highestBookRetailReviewSnapshot(snapshot, ['US', 'CA']).marketplaceCode, 'CA');
  assert.equal(highestBookRetailReviewSnapshot(snapshot, ['US', 'UK']).marketplaceCode, 'GB');
});
test('no active campaigns chooses highest observed count, independent of preferred stock market', () => {
  assert.equal(highestBookRetailReviewSnapshot(snapshot, []).marketplaceCode, 'GB');
});
test('missing active-market observation is unavailable instead of borrowing CA reviews', () => {
  const result = highestBookRetailReviewSnapshot(snapshot, ['DE']);
  assert.equal(result.reviewCount, null);
  assert.equal(result.rating, null);
  assert.equal(result.marketplaceCode, 'DE');
});
test('explicit zero and missing reviews remain distinct; sibling editions never supply counts', () => {
  const source = { ...row('CA', 400), marketplaceSnapshots: [row('US', 0, null),
    { ...row('US', 1000, 5), asin: '1803014466' }] };
  assert.equal(highestBookRetailReviewSnapshot(source, ['US']).reviewCount, 0);
  assert.equal(highestBookRetailReviewSnapshot({ ...source, marketplaceSnapshots: [] }, ['US']).reviewCount, null);
});
for (const mode of ['direct', 'server']) {
  test(`${mode} campaign identity: active US, paused CA, archived GB do not mix review scope`, () => {
    const campaigns = [
      { id: 'c-us', state: 'ENABLED', amazon_profile_id: 'us', book_asin: asin },
      { id: 'c-ca', state: 'PAUSED', amazon_profile_id: 'ca', book_asin: asin },
      { id: 'c-gb', state: 'archived', amazon_profile_id: 'gb', book_asin: asin },
      { id: 'c-other', state: 'enabled', amazon_profile_id: 'ca', book_asin: 'B0OTHER001' },
    ];
    const index = mode === 'direct' ? markets.buildSponsoredMarketplaceIndex({ profiles, campaigns,
      productAds: campaigns.map(c => ({ campaign_id: c.id, asin: c.book_asin, amazon_profile_id: c.amazon_profile_id }))
    }) : markets.buildSponsoredMarketplaceIndexFromCampaignBooks({ profiles, campaigns,
      books: [{ asin, campaignIds: ['c-us', 'c-ca', 'c-gb', 'missing'] }, { asin: 'B0OTHER001', campaignIds: ['c-other'] }]
    });
    assert.deepEqual(markets.countriesForActiveSponsoredBook(index, { asin }), ['US']);
    assert.deepEqual(markets.countriesForActiveSponsoredBook(index, { title: 'same title' }), []);
    assert.equal(highestBookRetailReviewSnapshot(snapshot, markets.countriesForActiveSponsoredBook(index, { asin })).marketplaceCode, 'US');
  });
}
test('active marketplace merging preserves seller scope and requires a known active campaign', () => {
  const first = markets.buildSponsoredMarketplaceIndex({ profiles, campaigns: [{ id: 'c', state: 'enabled', amazon_profile_id: 'ads-us' }],
    productAds: [{ campaign_id: 'c', asin, amazon_profile_id: 'ads-us' }, { campaign_id: 'unknown', asin, amazon_profile_id: 'ca' }] });
  const second = markets.buildSponsoredMarketplaceIndex({ profiles: [profiles[1]],
    campaigns: [{ id: 'foreign', state: 'enabled', amazon_profile_id: 'gb', book_asin: asin }] });
  const merged = markets.mergeSponsoredMarketplaceIndexes(first, second);
  assert.deepEqual(markets.countriesForActiveSponsoredBook(merged, { asin }), ['US']);
  assert.notEqual(merged.activeCountriesByKey, first.activeCountriesByKey);
});
