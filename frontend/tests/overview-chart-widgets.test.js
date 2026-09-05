import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adsEnginePeriodLabel,
  dailyToAdsEngineSeries,
} from "../src/lib/adsEngineSeries.ts";
import {
  aggregateKdpFormatRoyalties,
  formatKdpChartDate,
  formatSharePct,
} from "../src/lib/kdpFormatRoyalties.ts";

const overview = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
const widgets = readFileSync(new URL("../src/components/OverviewChartWidgets.tsx", import.meta.url), "utf8");

test("aggregateKdpFormatRoyalties sums paperback / KU / Kindle by day", () => {
  const range = aggregateKdpFormatRoyalties([
    {
      date: "2026-08-01",
      royalties: 100,
      paperback_royalties: 80,
      kenp_royalties: 5,
      ebook_royalties: 15,
    },
    {
      date: "2026-08-01",
      royalties: 50,
      paperback_royalties: 40,
      kenp_royalties: 2,
      ebook_royalties: 8,
    },
    {
      date: "2026-08-02",
      royalties: 20,
      paperback_royalties: 10,
      kenp_royalties: 4,
      ebook_royalties: 6,
    },
  ]);
  assert.equal(range.hasFormatData, true);
  assert.equal(range.paperback, 130);
  assert.equal(range.ku, 11);
  assert.equal(range.kindle, 29);
  assert.equal(range.daily.length, 2);
  assert.equal(range.daily[0].total, 150);
  assert.equal(Math.round(formatSharePct(130, 170)), 76);
  assert.equal(formatKdpChartDate("2026-08-31"), "08-31");
});

test("aggregateKdpFormatRoyalties marks totals-only rows as no format data", () => {
  const range = aggregateKdpFormatRoyalties([
    { date: "2026-08-01", royalties: 40 },
    { date: "2026-08-02", royalties: 10 },
  ]);
  assert.equal(range.hasKdpData, true);
  assert.equal(range.hasFormatData, false);
  assert.equal(range.total, 50);
});

test("Ads Engine keyword/search-term funnel caps at the server page, not a silent full-table walk", () => {
  const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
  const persist = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
  const fn = queries.slice(
    queries.indexOf("search_terms inherit profile via campaigns"),
    queries.indexOf("export async function fetchKeywordDailyAggregate"),
  );
  assert.match(fn, /\.limit\(ADS_ENGINE_ENTITY_CAP\)/);
  assert.match(fn, /if \(error\) throw error/);
  assert.match(fn, /search_terms inherit profile via campaigns/);
  assert.match(fn, /\.in\("campaign_id"/);
  assert.doesNotMatch(fn, /from\(opts\.entityTable\)[\s\S]*amazon_profile_id/);
  assert.match(persist, /ads-engine-keywords-daily/);
  assert.match(persist, /ads-engine-search-terms-daily/);
});

test("dailyToAdsEngineSeries totals are the period sum, not a missing day", () => {
  const series = dailyToAdsEngineSeries([
    { date: "2026-09-01", impressions: 1000, clicks: 20, orders: 2, spend: 40, sales: 80 },
    { date: "2026-09-02", impressions: 500, clicks: 10, orders: 1, spend: 20, sales: 40 },
    { date: "2026-09-05", impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
  ]);
  assert.equal(series.totals.impressions, 1500);
  assert.equal(series.totals.clicks, 30);
  assert.equal(series.totals.orders, 3);
  assert.equal(series.totals.acos, 50);
  assert.equal(adsEnginePeriodLabel(series), "09-01–09-05");
});

test("Overview wires Ads Engine + KDP Royalties swipe widgets", () => {
  assert.match(overview, /testID="home-ads-engine"/);
  assert.match(overview, /testID="home-kdp-royalties-format"/);
  assert.match(overview, /AdsEngineCampaignsPage/);
  assert.match(overview, /AdsEngineKeywordsPage/);
  assert.match(overview, /AdsEngineSearchTermsPage/);
  assert.match(overview, /KdpRoyaltiesFormatPage/);
  assert.match(overview, /fetchKdpFormatRoyaltiesRange/);
  assert.match(overview, /adsEngineSeries/);
  assert.match(overview, /adsEngineAcos/);
  assert.match(charts, /breakEvenAcos/);
  assert.match(overview, /computeOverallBreakEvenAcos/);
  assert.match(overview, /activityDays: 0/);
  assert.doesNotMatch(overview, /royaltyPerBookOrder/);
  assert.doesNotMatch(overview, /adSalePerOrder/);
  assert.doesNotMatch(overview, /catalogBooksQ\.data \?\.length \? catalogBooksQ\.data : topBooksRaw/);
  assert.match(charts, /KdpFormatRoyaltiesChart/);
  assert.match(widgets, /Paperback/);
  assert.match(widgets, /onImportRoyalties/);
  assert.match(overview, /royaltySetup\.openCollection/);
  assert.match(overview, /ads-engine-keywords-daily/);
  assert.match(overview, /ads-engine-search-terms-daily/);
  assert.match(charts, /Hold a day to inspect/);
  assert.match(charts, /periodTotals/);
  assert.match(overview, /GROSS_ROYALTIES_LABEL/);
  assert.match(overview, /home-hero-gross/);
});
