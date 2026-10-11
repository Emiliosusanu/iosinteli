import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewAdsProfileIdsForMarket, overviewMarketplaceLabel } from "../src/lib/overviewMarketplace.ts";

const profiles = [
  { id: "row-us", profile_id: "ads-us", country_code: "US" },
  { id: "row-ca", profile_id: "ads-ca", country_code: "ca" },
];

test("market scope preserves the caller ID namespace", () => {
  assert.deepEqual(overviewAdsProfileIdsForMarket(["ads-us", "ads-ca"], profiles, "CA"), ["ads-ca"]);
  assert.deepEqual(overviewAdsProfileIdsForMarket(["row-us", "row-ca"], profiles, "US"), ["row-us"]);
});

test("all markets preserves the authorized scope", () => {
  assert.deepEqual(overviewAdsProfileIdsForMarket(["ads-us", "ads-ca"], profiles, null), ["ads-us", "ads-ca"]);
  assert.equal(overviewMarketplaceLabel(null), "All markets");
});
