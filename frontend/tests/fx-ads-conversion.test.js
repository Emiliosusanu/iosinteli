import assert from "node:assert/strict";
import test from "node:test";
import { adsFxCoveredForDisplay, aggregateDailyMetricsForDisplay } from "../src/lib/dailyMetrics.ts";
import { buildFxRateMap, convertAdsAmount } from "../src/lib/fxRates.ts";
import {
  enabledMoneyProfileIdsForSelection,
  moneyProfileIdsForSelection,
  nativeCurrencyMoneyProfileIdsForSelection,
} from "../src/lib/accountsUi.ts";

test("disabled marketplace never contributes to a Books finance scope", () => {
  const profiles = [
    { id: "us", profile_id: "us-ads", currency_code: "USD", is_enabled: true },
    { id: "ca", profile_id: "ca-ads", currency_code: "CAD", is_enabled: false },
  ];
  assert.deepEqual(enabledMoneyProfileIdsForSelection(profiles, ["us", "ca"]).sort(), ["us", "us-ads"].sort());
});

test("CA spend day converts to USD via market FX rate", () => {
  const rates = buildFxRateMap([
    { rate_date: "2026-09-20", from_currency: "CAD", to_currency: "USD", rate: 0.74 },
  ]);
  const usd = convertAdsAmount(55.93, "2026-09-20", "CAD", "USD", rates);
  assert.ok(usd != null);
  assert.ok(Math.abs(usd - 55.93 * 0.74) < 1e-9);
  // Not Amazon's ~39.85-style figure for this fixture rate
  assert.ok(Math.abs(usd - 39.85) > 1);
});

test("multi CA+US daily rollup sums converted Ads", () => {
  const rates = buildFxRateMap([
    { rate_date: "2026-09-20", from_currency: "CAD", to_currency: "USD", rate: 0.74 },
  ]);
  const daily = aggregateDailyMetricsForDisplay(
    [
      {
        id: "1",
        campaign_id: "c1",
        date: "2026-09-20",
        spend: 10,
        sales: 50,
        orders: 1,
        clicks: 2,
        impressions: 10,
        amazon_profile_id: "us",
      },
      {
        id: "2",
        campaign_id: "c2",
        date: "2026-09-20",
        spend: 55.93,
        sales: 100,
        orders: 2,
        clicks: 3,
        impressions: 20,
        amazon_profile_id: "ca",
      },
    ],
    {
      moneyProfileIds: ["us", "ca"],
      displayCurrency: "USD",
      profileCurrencyById: { us: "USD", ca: "CAD" },
      fxRates: rates,
    },
  );
  assert.equal(daily.length, 1);
  assert.ok(Math.abs(daily[0].spend - (10 + 55.93 * 0.74)) < 1e-6);
  assert.ok(Math.abs(daily[0].sales - (50 + 100 * 0.74)) < 1e-6);
});

test("USD portfolio never adds a CAD amount before its daily FX rate loads", () => {
  const rows = [
    { id: "us", campaign_id: "c1", date: "2026-09-22", spend: 100, sales: 0, orders: 0, clicks: 0, impressions: 0, amazon_profile_id: "us" },
    { id: "ca", campaign_id: "c2", date: "2026-09-22", spend: 100, sales: 0, orders: 0, clicks: 0, impressions: 0, amazon_profile_id: "ca" },
  ];
  const options = {
    moneyProfileIds: ["us", "ca"],
    displayCurrency: "USD",
    profileCurrencyById: { us: "USD", ca: "CAD" },
  };
  assert.equal(adsFxCoveredForDisplay(rows, options), false);
  assert.deepEqual(aggregateDailyMetricsForDisplay(rows, options), []);
});

test("USD portfolio rejects an untagged money row when marketplaces are mixed", () => {
  const rows = [
    { id: "unknown", campaign_id: "c1", date: "2026-09-22", spend: 25, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  ];
  const options = {
    moneyProfileIds: ["us", "ca"],
    displayCurrency: "USD",
    profileCurrencyById: { us: "USD", ca: "CAD" },
    fxRates: buildFxRateMap([{ rate_date: "2026-09-22", from_currency: "CAD", to_currency: "USD", rate: 0.74 }]),
  };
  assert.equal(adsFxCoveredForDisplay(rows, options), false);
  assert.deepEqual(aggregateDailyMetricsForDisplay(rows, options), []);
});

test("USD chip includes CA in money profiles; native helper keeps USD-only for KDP", () => {
  const profiles = [
    {
      id: "us",
      profile_id: "us-ads",
      name: "US",
      nickname: null,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
    {
      id: "ca",
      profile_id: "ca-ads",
      name: "CA",
      nickname: null,
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
  ];
  assert.deepEqual(
    moneyProfileIdsForSelection(profiles, ["us", "ca"]).sort(),
    ["ca", "ca-ads", "us", "us-ads"].sort(),
  );
  assert.deepEqual(
    nativeCurrencyMoneyProfileIdsForSelection(profiles, ["us", "ca"]).sort(),
    ["us", "us-ads"].sort(),
  );
});

test("single CA selection stays CAD-native in money ids", () => {
  const profiles = [
    {
      id: "ca",
      profile_id: "ca-ads",
      name: "CA",
      nickname: null,
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: null,
      account_type: null,
      is_enabled: true,
      campaigns_enabled_count: 1,
      created_at: "",
      updated_at: "",
    },
  ];
  assert.deepEqual(
    moneyProfileIdsForSelection(profiles, ["ca"]).sort(),
    ["ca", "ca-ads"].sort(),
  );
});
