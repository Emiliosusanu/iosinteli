import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatCampaignDailySummary } from "../src/lib/format.ts";

const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
const entityDetail = readFileSync(new URL("../src/components/EntityDetail.tsx", import.meta.url), "utf8");
const campaignDetail = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");

test("daily chip includes clicks between impressions and spend", () => {
  const chip = formatCampaignDailySummary({
    impressions: 3000,
    clicks: 14,
    spend: 8.5,
    orders: 1,
    acos: 30.4,
    currency: "USD",
  });
  assert.equal(chip, "3.0K impr · 14 clk · $8.50 · 1 ord · 30.4%");
});

test("CampaignDailyChart keeps impr/spend/orders/ACoS series readable", () => {
  assert.match(charts, /CampaignDailyChart/);
  assert.match(charts, /impressionsData/);
  assert.match(charts, /spendData/);
  assert.match(charts, /ordersData/);
  assert.match(charts, /acosData/);
  assert.match(charts, /impr ·/);
});

test("detail screens mount CampaignDailyChart", () => {
  assert.match(entityDetail, /CampaignDailyChart/);
  assert.match(campaignDetail, /CampaignDailyChart/);
});

test("campaign detail waits for ad groups before empty advertised/targets states", () => {
  // Disabled child queries look "not loading" — must not flash permanent empties.
  assert.match(campaignDetail, /awaitingChildScope/);
  assert.match(
    campaignDetail,
    /awaitingChildScope \|\| \(productAdsQ\.isLoading && visibleProductAds\.length === 0\)/,
  );
  assert.match(campaignDetail, /const targetingPending =[\s\S]*awaitingChildScope/);
  // Campaign-wide fetch when no AG ids (avoid empty adGroupIds → [] early return).
  assert.match(campaignDetail, /childAdGroupFilter/);
  assert.match(campaignDetail, /\.\.\.childAdGroupFilter/);
});
