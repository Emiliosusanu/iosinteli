import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adsEnginePeriodLabel,
  dailyToAdsEngineSeries,
} from "../src/lib/adsEngineSeries.ts";
import {
  aggregateKdpFormatRoyalties,
  bookDailyRoyaltiesTotal,
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

test("bookDailyRoyaltiesTotal prefers format sum so KU is not dropped", () => {
  // Legacy total undercounts KU that lives only in kenp_royalties.
  assert.equal(
    bookDailyRoyaltiesTotal({
      royalties: 70,
      ebook_royalties: 50,
      paperback_royalties: 0,
      kenp_royalties: 40,
    }),
    90,
  );
  // Format columns empty → keep royalties total.
  assert.equal(
    bookDailyRoyaltiesTotal({
      royalties: 55,
      ebook_royalties: 0,
      paperback_royalties: 0,
      kenp_royalties: 0,
    }),
    55,
  );
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

test("dailyToAdsEngineSeries refuses fake 0% ACoS when sales are 0", () => {
  const series = dailyToAdsEngineSeries([
    { date: "2026-09-01", impressions: 900, clicks: 30, orders: 0, spend: 55, sales: 0 },
    { date: "2026-09-02", impressions: 100, clicks: 5, orders: 0, spend: 10, sales: 0 },
  ]);
  assert.equal(series.totals.acos, null);
  assert.equal(series.totals.impressions, 1000);
  assert.equal(series.acos[0].sales, 0);
  assert.equal(series.acos[0].value, 0);
  assert.equal(series.acos[1].sales, 0);
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
  assert.match(charts, /Swipe a day to inspect/);
  assert.match(charts, /blocksExternalGesture/);
  assert.match(charts, /periodTotals/);
  assert.match(overview, /GROSS_ROYALTIES_LABEL/);
  assert.match(overview, /home-hero-gross/);
});

test("Gross KDP uses known totals only and widens when all enabled Ads are covered", () => {
  assert.match(overview, /knownKdpRoyaltyTotal\(royaltyRange\)/);
  assert.match(overview, /booksRoyaltyScopeForSelection\(profiles, moneyProfileIds\)/);
  assert.match(overview, /overviewKdpQueryScope\(profiles, enabledPortfolioIds, royaltyScope\)/);
  assert.match(overview, /allowLegacyProfileLinks: false/);
  assert.match(overview, /kdpCurrencyComparable/);
  assert.match(overview, /kdpRoyaltiesAreKnown/);
  // Format mix shares the same royalty account scope as Gross — never a separate invented total.
  assert.match(overview, /fetchKdpFormatRoyaltiesRange\(royaltyProfiles/);
  assert.match(overview, /kdpScope: kdpQueryScope/);
  assert.match(charts, /selectedAcos == null \? "—"/);
});

test("Ads Engine + Format Mix charts never call hooks after empty early returns", () => {
  // Cold launch / pending metrics must not trip Rules of Hooks when data arrives.
  const adsBlock = charts.slice(charts.indexOf("export function AdsEngineChart"));
  const adsFn = adsBlock.slice(0, adsBlock.indexOf("export function") > 0 ? adsBlock.indexOf("\nexport function", 1) : undefined);
  // useEffect must appear before the empty impressions early return in source order.
  const adsEffect = adsFn.indexOf("React.useEffect");
  const adsEmpty = adsFn.indexOf("if (!hasImpressions)");
  assert.ok(adsEffect >= 0 && adsEmpty >= 0 && adsEffect < adsEmpty, "AdsEngineChart useEffect must precede empty return");

  const fmtBlock = charts.slice(charts.indexOf("export function KdpFormatRoyaltiesChart"));
  const fmtFn = fmtBlock.slice(0, 2500);
  const fmtEffect = fmtFn.indexOf("React.useEffect");
  const fmtEmpty = fmtFn.indexOf("if (!hasDays)");
  assert.ok(fmtEffect >= 0 && fmtEmpty >= 0 && fmtEffect < fmtEmpty, "KdpFormatRoyaltiesChart useEffect must precede empty return");
});

test("Ads Engine readout keeps Impr / Clicks / Orders / ACoS tags", () => {
  const adsBlock = charts.slice(charts.indexOf("export function AdsEngineChart"));
  assert.match(adsBlock, /Impr \$\{formatCompact\(selectedImpr\)\}/);
  assert.match(adsBlock, /Clicks \$\{formatCompact\(selectedClicks\)\}/);
  assert.match(adsBlock, /Orders \$\{formatInt\(selectedOrders\)\}/);
  assert.match(adsBlock, /ACoS \$\{/);
});

test("Campaign / search-term widget rows keep Spend · Orders · ACoS labels", () => {
  const rows = readFileSync(new URL("../src/components/OverviewWidgetRows.tsx", import.meta.url), "utf8");
  assert.match(rows, /spend · \{formatInt\(campaign\.orders\)\} orders/);
  assert.match(rows, /spend · \{formatInt\(Number\(row\.total_orders\)\)\} orders/);
  assert.match(rows, />ACoS</);
});
