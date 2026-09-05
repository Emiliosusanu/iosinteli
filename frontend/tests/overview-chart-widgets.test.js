import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  assert.match(charts, /KdpFormatRoyaltiesChart/);
  assert.match(widgets, /Paperback/);
});
