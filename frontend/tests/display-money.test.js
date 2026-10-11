import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateDailyMetricsForDisplay } from "../src/lib/dailyMetrics.ts";
import { formatCurrency } from "../src/lib/format.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");

test("USD money isolation drops CAD spend/sales and counts (web S match)", () => {
  const daily = aggregateDailyMetricsForDisplay(
    [
      {
        id: "1",
        campaign_id: "c-us",
        date: "2026-08-26",
        impressions: 100,
        clicks: 10,
        orders: 1,
        spend: 10,
        sales: 20,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
        amazon_profile_id: "us",
      },
      {
        id: "2",
        campaign_id: "c-ca",
        date: "2026-08-26",
        impressions: 50,
        clicks: 5,
        orders: 2,
        spend: 8,
        sales: 4,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
        amazon_profile_id: "ca",
      },
    ],
    { moneyProfileIds: ["us"] },
  );
  assert.deepEqual(daily, [
    { date: "2026-08-26", spend: 10, sales: 20, orders: 1, clicks: 10, impressions: 100 },
  ]);
});

test("untagged rows keep the old all-money sum so missing profile tags do not zero spend", () => {
  const daily = aggregateDailyMetricsForDisplay(
    [
      {
        id: "1",
        campaign_id: "c1",
        date: "2026-08-26",
        impressions: 10,
        clicks: 1,
        orders: 0,
        spend: 5,
        sales: 0,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
      },
    ],
    { moneyProfileIds: ["us"] },
  );
  assert.equal(daily[0].spend, 5);
});

test("empty moneyProfileIds withholds all tagged metrics — disabled Ads must not roll into hero", () => {
  const daily = aggregateDailyMetricsForDisplay(
    [
      {
        id: "1",
        campaign_id: "c-us",
        date: "2026-08-26",
        impressions: 100,
        clicks: 10,
        orders: 1,
        spend: 10,
        sales: 20,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
        amazon_profile_id: "us",
      },
      {
        id: "2",
        campaign_id: "c-ca",
        date: "2026-08-26",
        impressions: 50,
        clicks: 5,
        orders: 2,
        spend: 8,
        sales: 4,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
        amazon_profile_id: "ca",
      },
    ],
    { moneyProfileIds: [] },
  );
  assert.deepEqual(daily, [
    { date: "2026-08-26", spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  ]);
});

test("omitted moneyProfileIds keeps legacy all-money sum for tagged rows", () => {
  const daily = aggregateDailyMetricsForDisplay([
    {
      id: "1",
      campaign_id: "c-us",
      date: "2026-08-26",
      impressions: 10,
      clicks: 1,
      orders: 0,
      spend: 5,
      sales: 10,
      ctr: null,
      acos: null,
      roas: null,
      cpc: null,
      conversion_rate: null,
      amazon_profile_id: "us",
    },
  ]);
  assert.equal(daily[0].spend, 5);
});

test("Overview wires money isolation and campaign metrics carry profile ids", () => {
  assert.match(home, /booksMoneyProfileIds/);
  assert.match(home, /scopeProfiles = moneyProfileIds/);
  assert.match(
    home,
    /aggregateDailyMetricsForDisplay\(metricRows, \{\s*moneyProfileIds,\s*displayCurrency: primaryCurrency,\s*profileCurrencyById,\s*fxRates,\s*\}\)/,
  );
  assert.match(queries, /select\("id, amazon_profile_id"\)/);
  assert.match(queries, /amazon_profile_id: profileId/);
});

test("list rows stay native while Ads Engine funnels receive the full FX context", () => {
  const campaigns = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
  const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
  const campaignDetail = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  const adGroupDetail = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
  assert.match(campaigns, /rowCurrencyOfProfile\(profiles, item\.amazon_profile_id, primaryCurrency\)/);
  assert.match(campaigns, /formatCurrency\(item\.spend, rowCurrency/);
  assert.match(targeting, /rowCurrencyOfProfile\(profiles, item\.amazon_profile_id, primaryCurrency\)/);
  assert.match(targeting, /currency: rowCurrency/);
  assert.match(targeting, /currency=\{moneyEditor\?\.currency \?\? primaryCurrency\}/);
  assert.match(targeting, /selectedBidCurrencies\.length > 1/);
  assert.match(targeting, /Choose one country in the Markets filter/);
  assert.match(targeting, /currency=\{rowCurrency\}/);
  assert.match(campaignDetail, /rowCurrencyOfProfile\(profiles, c\?\.amazon_profile_id, primaryCurrency\)/);
  assert.match(campaignDetail, /formatCurrency\(Number\(displayBudget\), campaignCurrency\)/);
  assert.match(campaignDetail, /currency: campaignCurrency/);
  assert.match(campaignDetail, /formatCurrency\(Number\(ag\.total_spend\), campaignCurrency\)/);
  assert.match(campaignDetail, /campaignTargetMetricItems\(kw, campaignCurrency, t\)/);
  assert.match(campaignDetail, /currency=\{campaignCurrency\}/);
  assert.match(adGroupDetail, /rowCurrencyOfProfile\(\s*profiles,\s*group\?\.amazon_profile_id,/);
  assert.match(adGroupDetail, /paramId\(params\.currency\) \|\| primaryCurrency/);
  assert.match(adGroupDetail, /formatCurrency\(spendN, groupCurrency\)/);
  assert.match(adGroupDetail, /currency=\{groupCurrency\}/);
  assert.match(
    queries,
    /aggregateDailyMetricsForDisplay\(rows, \{\s*moneyProfileIds: opts\.moneyProfileIds,\s*displayCurrency: opts\.displayCurrency,\s*profileCurrencyById: opts\.profileCurrencyById,\s*fxRates: opts\.fxRates,\s*\}\)/,
  );
  assert.match(queries, /amazon_profile_id: profileByEntity\.get\(entityId\)/);
  assert.match(home, /moneyProfileIds=\{adsWidgetProfileIds\}/);
  assert.match(home, /displayCurrency=\{primaryCurrency\}/);
  assert.match(home, /profileCurrencyById=\{profileCurrencyById\}/);
  assert.match(home, /fxRates=\{fxRates\}/);
});

test("CAD money uses C$ not bare dollar", () => {
  assert.equal(formatCurrency(20, "CAD"), "C$20.00");
  assert.equal(formatCurrency(20, "USD"), "$20.00");
  assert.equal(formatCurrency(20, "EUR"), "€20.00");
});
