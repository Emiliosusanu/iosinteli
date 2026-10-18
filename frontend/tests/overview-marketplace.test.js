import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewAdsProfileIdsForMarket, overviewMarketplaceLabel, sharedMarketProfileIds } from "../src/lib/overviewMarketplace.ts";
import { multiCountryCodes } from "../src/lib/accountsUi.ts";
import { aggregateDailyMetricsForDisplay } from "../src/lib/dailyMetrics.ts";

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

test("UK and GB share one data scope without adding unselected or disabled profiles", () => {
  const rows = [
    { id: "uk", profile_id: "ads-uk", country_code: " UK ", is_enabled: true },
    { id: "gb", profile_id: "ads-gb", country_code: "gb", is_enabled: true },
    { id: "disabled", profile_id: "ads-disabled", country_code: "UK", is_enabled: false },
    { id: "other", profile_id: "ads-other", country_code: "US", is_enabled: true },
  ];
  for (const market of ["UK", "GB", " gb "]) {
    assert.deepEqual(sharedMarketProfileIds(rows, market), ["uk", "gb"]);
    assert.deepEqual(overviewAdsProfileIdsForMarket(["ads-uk", "other"], rows, market), ["ads-uk"]);
    assert.deepEqual(overviewAdsProfileIdsForMarket(["gb", "uk"], rows, market), ["gb", "uk"]);
    assert.deepEqual(overviewAdsProfileIdsForMarket([], rows, market), []);
    assert.equal(overviewMarketplaceLabel(market), "GB");
  }
  assert.deepEqual(sharedMarketProfileIds(rows, "invalid"), []);
});

test("marketplace sums reconcile with the same All daily metrics including UK aliases", () => {
  const rows = [
    { id: "us", profile_id: "ads-us", country_code: "US", is_enabled: true },
    { id: "uk", profile_id: "ads-uk", country_code: "UK", is_enabled: true },
    { id: "gb", profile_id: "ads-gb", country_code: "GB", is_enabled: true },
    { id: "foreign", profile_id: "ads-foreign", country_code: "UK", is_enabled: true },
  ];
  const scope = ["us", "uk", "gb"];
  const metrics = rows.map((row, i) => ({
    amazon_profile_id: row.id, date: "2026-10-18", spend: i + 1,
    sales: (i + 1) * 4, clicks: [1516, 13, 5, 9999][i], orders: i + 1, impressions: (i + 1) * 100,
  }));
  const total = (ids) => aggregateDailyMetricsForDisplay(metrics, { moneyProfileIds: ids,
    displayCurrency: "USD", profileCurrencyById: new Map(rows.map(row => [row.id, "USD"]))
  }).reduce((sum, row) => {
    for (const key of Object.keys(sum)) sum[key] += row[key];
    return sum;
  }, { clicks: 0, orders: 0, impressions: 0, spend: 0, sales: 0 });
  const markets = multiCountryCodes(rows.filter(row => scope.includes(row.id)));
  assert.deepEqual(markets, ["US", "GB"]);
  const byMarket = markets.map(market => total(overviewAdsProfileIdsForMarket(scope, rows, market)));
  const sum = Object.fromEntries(Object.keys(byMarket[0]).map(key => [key, byMarket.reduce((n, row) => n + row[key], 0)]));
  assert.deepEqual(sum, total(scope));
  assert.equal(sum.clicks, 1534);
});
