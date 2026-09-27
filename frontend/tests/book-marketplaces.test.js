import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildSponsoredMarketplaceIndex,
  buildSponsoredMarketplaceIndexFromCampaignBooks,
  campaignBookFamilyKey,
  countriesForSponsoredBook,
  countriesForSponsoredCampaign,
  emptySponsoredMarketplaceIndex,
  isWeakSponsoredFamilyKey,
  marketplaceFlagEmojis,
  marketplaceFlagsA11y,
  multiMarketplaceCountries,
  productAdsForVisibleCampaigns,
} from "../src/lib/bookMarketplaces.ts";

const campaignsUi = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
const productsUi = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const overviewRows = readFileSync(new URL("../src/components/OverviewWidgetRows.tsx", import.meta.url), "utf8");

const US = { id: "p-us", profile_id: "ads-us", country_code: "US" };
const CA = { id: "p-ca", profile_id: "ads-ca", country_code: "CA" };
const UK = { id: "p-uk", profile_id: "ads-uk", country_code: "GB" };

test("campaign family key strips marketplace and targeting suffixes", () => {
  assert.equal(campaignBookFamilyKey("NC - Auto"), "nc");
  assert.equal(campaignBookFamilyKey("NC - ASIN"), "nc");
  assert.equal(campaignBookFamilyKey("NC - Auto - CA"), "nc");
  assert.equal(campaignBookFamilyKey("Night City - US - Keyword"), "night city");
  assert.equal(campaignBookFamilyKey("Auto"), "");
});

test("flags stay hidden for a single marketplace", () => {
  assert.deepEqual(multiMarketplaceCountries(["US"]), []);
  assert.deepEqual(marketplaceFlagEmojis(["US"]), []);
  assert.equal(marketplaceFlagsA11y(["CA"]), null);
});

test("US + CA shows both flags, United States first", () => {
  assert.deepEqual(multiMarketplaceCountries(["CA", "US", "US"]), ["US", "CA"]);
  assert.deepEqual(marketplaceFlagEmojis(["CA", "US"]), ["🇺🇸", "🇨🇦"]);
  assert.equal(marketplaceFlagsA11y(["CA", "US"]), "Sponsored in United States and Canada");
});

test("each campaign in an exact multi-market book family receives its own marketplace identity", () => {
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA],
    campaigns: [
      { id: "us-campaign", state: "enabled", amazon_profile_id: "p-us" },
      { id: "ca-campaign", state: "enabled", amazon_profile_id: "p-ca" },
    ],
    productAds: [
      { campaign_id: "us-campaign", asin: "B0HFKCDPVG", amazon_profile_id: "p-us" },
      { campaign_id: "ca-campaign", asin: "B0HFKCDPVG", amazon_profile_id: "p-ca" },
    ],
  });
  assert.deepEqual(countriesForSponsoredCampaign(index, { id: "us-campaign" }), ["US", "CA"]);
  assert.deepEqual(countriesForSponsoredCampaign(index, { id: "ca-campaign" }), ["US", "CA"]);
});

test("ownership-checked campaign book ids build exact admin-view flags", () => {
  const index = buildSponsoredMarketplaceIndexFromCampaignBooks({
    profiles: [US, CA],
    campaigns: [
      { id: "us-campaign", amazon_profile_id: "ads-us" },
      { id: "ca-campaign", amazon_profile_id: "ads-ca" },
    ],
    books: [
      { asin: "B0HFKCDPVG", campaignIds: ["us-campaign", "ca-campaign"] },
    ],
  });
  assert.deepEqual(countriesForSponsoredCampaign(index, { id: "us-campaign" }), ["US", "CA"]);
  assert.deepEqual(countriesForSponsoredCampaign(index, { id: "ca-campaign" }), ["US", "CA"]);
  assert.deepEqual(countriesForSponsoredBook(index, { asin: "B0HFKCDPVG" }), ["US", "CA"]);
});

test("multi-market flags only use product ads from active or paused campaigns", () => {
  const campaigns = [
    { id: "us-live", state: "enabled" },
    { id: "ca-paused", state: "PAUSED" },
    { id: "uk-old", state: "archived" },
  ];
  const ads = [
    { campaign_id: "us-live", asin: "B0PAPER001" },
    { campaign_id: "ca-paused", asin: "B0PAPER001" },
    { campaign_id: "uk-old", asin: "B0PAPER001" },
    { campaign_id: "missing", asin: "B0PAPER001" },
  ];
  assert.deepEqual(
    productAdsForVisibleCampaigns(campaigns, ads).map((row) => row.campaign_id),
    ["us-live", "ca-paused"],
  );
});

test("KDP work format siblings inherit exact paperback multi-market flags", () => {
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA],
    productAds: [
      { asin: "B0PAPER001", amazon_profile_id: "p-us" },
      { asin: "B0PAPER001", amazon_profile_id: "p-ca" },
    ],
  });
  assert.deepEqual(
    countriesForSponsoredBook(index, {
      asin: "B0KINDLE01",
      book_key: "DIGITAL=B0KINDLE01:PRINT=B0PAPER001",
    }),
    ["US", "CA"],
  );
});

test("campaign names alone never create cross-market book identity", () => {
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA],
    campaigns: [
      { name: "NC - Auto", amazon_profile_id: "p-us" },
      { name: "NC - ASIN", amazon_profile_id: "p-us" },
      { name: "NC - Auto", amazon_profile_id: "p-ca" },
    ],
  });
  assert.deepEqual(countriesForSponsoredCampaign(index, { name: "NC - Auto", amazon_profile_id: "p-us" }), []);
  assert.deepEqual(countriesForSponsoredBook(index, { title: "NC" }), []);
});

test("different books do not inherit another title's countries", () => {
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA],
    campaigns: [
      { name: "NC - Auto", amazon_profile_id: "p-us" },
      { name: "NC - Auto", amazon_profile_id: "p-ca" },
      { name: "VP Guide - Auto", amazon_profile_id: "p-us" },
    ],
  });
  assert.deepEqual(countriesForSponsoredCampaign(index, { name: "VP Guide - Auto" }), []);
  assert.deepEqual(countriesForSponsoredBook(index, { title: "VP Guide" }), []);
});

test("product-ad titles never link different ASINs across marketplaces", () => {
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA, UK],
    productAds: [
      { asin: "B0USBOOK01", title: "Night City", amazon_profile_id: "p-us" },
      { asin: "B0CABOOK01", title: "Night City", amazon_profile_id: "ads-ca" },
    ],
  });
  assert.deepEqual(countriesForSponsoredBook(index, { title: "Night City", asin: "B0USBOOK01" }), []);
  assert.deepEqual(countriesForSponsoredBook(index, { asin: "B0USBOOK01" }), []);
});

test("generic SKUs and targeting leftovers do not create false flags", () => {
  assert.equal(isWeakSponsoredFamilyKey("broad"), true);
  assert.equal(isWeakSponsoredFamilyKey("ebook"), true);
  assert.equal(isWeakSponsoredFamilyKey("nc"), false);
  const first = emptySponsoredMarketplaceIndex();
  const second = emptySponsoredMarketplaceIndex();
  assert.notEqual(first.countriesByKey, second.countriesByKey);
  const index = buildSponsoredMarketplaceIndex({
    profiles: [US, CA],
    productAds: [
      { sku: "ebook", title: "Paperback", amazon_profile_id: "p-us" },
      { sku: "ebook", title: "Kindle", amazon_profile_id: "p-ca" },
    ],
    campaigns: [
      { name: "Broad - Auto", amazon_profile_id: "p-us" },
      { name: "Broad - Auto", amazon_profile_id: "p-ca" },
    ],
  });
  assert.deepEqual(countriesForSponsoredBook(index, { title: "Paperback", sku: "ebook" }), []);
  assert.deepEqual(countriesForSponsoredCampaign(index, { name: "Broad - Auto" }), []);
});

test("campaign and book screens render marketplace flags", () => {
  assert.match(campaignsUi, /CampaignMarketplaceFlags|useSponsoredMarketplaceIndex/);
  assert.match(productsUi, /BookMarketplaceFlags|useSponsoredMarketplaceIndex/);
  assert.match(overviewRows, /BookMarketplaceFlags|marketplaceFlags|countriesForSponsoredBook/);
});
