import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compareByAcosSpendImpressionsSync,
  keywordsSpendingNoOrders,
  keywordsHighAcos,
  searchTermsSpendNoOrders,
  searchTermsLowAcos,
  booksHighAcos,
  booksLowAcos,
  booksTopRoyalties,
  booksSpendingNoAdSales,
  booksWorstProfit,
  campaignsHighAcos,
  campaignsLowAcos,
  campaignsTopSpend,
  adGroupsHighAcos,
  isPausedForOverviewWidget,
  overviewLowAcosDiffersFromHigh,
  fillOverviewWidgetRows,
  OVERVIEW_SWIPE_ROW_LIMIT,
} from "../src/lib/overviewWidgets.ts";

function eightCampaigns() {
  return [
    { id: "acos-hi", name: "a", sales: 10, acos: 80, spend: 8, clicks: 1, impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "acos-lo", name: "a2", sales: 12, acos: 15, spend: 2, clicks: 1, impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "click-1", name: "b", sales: 0, acos: 0, spend: 0, clicks: 90, impressions: 5, updated_at: "2026-08-01T00:00:00Z" },
    { id: "click-2", name: "c", sales: 0, acos: 0, spend: 0, clicks: 40, impressions: 5, updated_at: "2026-08-01T00:00:00Z" },
    { id: "imp-1", name: "d", sales: 0, acos: 0, spend: 0, clicks: 0, impressions: 500, updated_at: "2026-08-01T00:00:00Z" },
    { id: "imp-2", name: "e", sales: 0, acos: 0, spend: 0, clicks: 0, impressions: 200, updated_at: "2026-08-01T00:00:00Z" },
    { id: "sync-new", name: "f", sales: 0, acos: 0, spend: 0, clicks: 0, impressions: 0, updated_at: "2026-09-01T12:00:00Z" },
    { id: "sync-old", name: "g", sales: 0, acos: 0, spend: 0, clicks: 0, impressions: 0, updated_at: "2026-07-01T00:00:00Z" },
  ];
}

test("matrix: Campaigns High ACoS keeps converting + spend/impressions, never zero-metric pads", () => {
  const high = campaignsHighAcos(eightCampaigns());
  // acos rows + impression pads (no spenders without sales in this set beyond acos)
  assert.deepEqual(
    high.map((row) => row.id),
    ["acos-hi", "acos-lo", "imp-1", "imp-2", "click-1", "click-2"],
  );
  assert.ok(!high.some((row) => row.id === "sync-new"));
});

test("matrix: Campaigns Low ACoS differs order of converting rows", () => {
  const rows = eightCampaigns();
  const high = campaignsHighAcos(rows);
  const low = campaignsLowAcos(rows);
  assert.equal(low[0].id, "acos-lo");
  assert.equal(low[1].id, "acos-hi");
  assert.equal(overviewLowAcosDiffersFromHigh(high, low), false);
});

test("matrix: Campaigns Top spend pads impressions only — never zero-metric sync fillers", () => {
  const padded = campaignsTopSpend([
    { id: "s1", spend: 50, sales: 0, acos: 0, clicks: 0, impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i1", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 400, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i2", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 100, updated_at: "2026-08-01T00:00:00Z" },
    { id: "u1", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "u2", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-08-20T00:00:00Z" },
  ]);
  assert.deepEqual(
    padded.map((row) => row.id),
    ["s1", "i1", "i2"],
  );
});

test("matrix: Ad groups High ACoS cascade without zero-metric sync pad", () => {
  const groups = [
    { id: "g1", name: "hi", total_sales: 20, total_acos: 60, total_spend: 8, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g2", name: "spend", total_sales: 0, total_acos: 0, total_spend: 50, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g3", name: "imp", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 900, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g4", name: "sync", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 0, updated_at: "2026-09-02T00:00:00Z" },
  ];
  assert.deepEqual(adGroupsHighAcos(groups).map((row) => row.id), ["g1", "g2", "g3"]);
});

test("matrix: Keywords/Search no-orders pages never include converters", () => {
  const keywords = [
    { id: "s1", keyword_text: "spent", total_spend: 11, total_orders: 0, total_impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i1", keyword_text: "imps", total_spend: 0, total_orders: 0, total_impressions: 400, updated_at: "2026-08-01T00:00:00Z" },
    { id: "u1", keyword_text: "sync", total_spend: 0, total_orders: 0, total_impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "a1", keyword_text: "acos", total_spend: 8, total_orders: 1, total_sales: 20, total_acos: 45, total_impressions: 2, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(keywordsSpendingNoOrders(keywords).map((row) => row.id), ["s1", "i1"]);
  assert.equal(keywordsHighAcos(keywords)[0].id, "a1");

  const terms = [
    { id: "t1", search_term: "a", total_spend: 7, total_orders: 0, total_impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "t2", search_term: "b", total_spend: 0, total_orders: 0, total_impressions: 80, updated_at: "2026-08-01T00:00:00Z" },
    { id: "t3", search_term: "c", total_spend: 0, total_orders: 0, total_impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "t4", search_term: "d", total_spend: 2, total_orders: 1, total_sales: 10, total_acos: 12, total_impressions: 3, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(searchTermsSpendNoOrders(terms).map((row) => row.id), ["t1", "t2"]);
  assert.equal(searchTermsLowAcos(terms)[0].id, "t4");
});

test("matrix: Books Top royalties stays royalty-only; Ad spend page excludes converters", () => {
  const books = [
    { asin: "A", book_key: "A", sales: 10, acos: 55, spend: 5, royalties: 20, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-08-01T00:00:00Z" },
    { asin: "B", book_key: "B", sales: 8, acos: 22, spend: 4, royalties: 15, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-08-01T00:00:00Z" },
    { asin: "C", book_key: "C", sales: 0, acos: 0, spend: 6, royalties: 27, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-09-01T00:00:00Z" },
    { asin: "D", book_key: "D", sales: 0, acos: 0, spend: 0, royalties: 0, impressions: 300, clicks: 0, kdp_state: "missing", updated_at: "2026-08-15T00:00:00Z" },
    { asin: "E", book_key: "E", sales: 0, acos: 0, spend: 0, royalties: null, impressions: 0, clicks: 40, kdp_state: "missing", updated_at: "2026-08-10T00:00:00Z" },
  ];
  assert.deepEqual(booksTopRoyalties(books).map((row) => row.asin), ["C", "A", "B"]);
  assert.deepEqual(booksHighAcos(books).map((row) => row.asin), ["A", "B", "C", "D"]);
  assert.deepEqual(booksLowAcos(books).map((row) => row.asin), ["B", "A", "C", "D"]);
  assert.deepEqual(booksSpendingNoAdSales(books).map((row) => row.asin), ["C", "D"]);
  assert.ok(booksWorstProfit(books).length >= 3);
});

test("Worst profit excludes books whose KDP or Ads side is unverified", () => {
  const books = [
    { asin: "KNOWN", book_key: "KNOWN", royalties: 20, spend: 5, net: 15, kdp_state: "ready", ads_state: "ready" },
    { asin: "NO_KDP", book_key: "NO_KDP", royalties: null, spend: 100, net: null, kdp_state: "missing", ads_state: "ready" },
    { asin: "PARTIAL_ADS", book_key: "PARTIAL_ADS", royalties: 30, spend: 8, net: null, kdp_state: "ready", ads_state: "pending" },
  ];
  assert.deepEqual(booksWorstProfit(books).map((row) => row.asin), ["KNOWN"]);
});

test("matrix: zero-metric pool stays empty under High ACoS (no fake pads)", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `z${i}`,
    sales: 0,
    acos: 0,
    spend: 0,
    clicks: 0,
    impressions: 0,
    updated_at: `2026-09-${String(10 - i).padStart(2, "0")}T00:00:00Z`,
  }));
  assert.deepEqual(campaignsHighAcos(rows), []);
});

test("keyword-style sort is ACoS then spend then impressions then last sync", () => {
  const rows = [
    { id: "imp", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 400, updated_at: "2026-08-01T00:00:00Z" },
    { id: "sync", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "spend", total_sales: 0, total_acos: 0, total_spend: 12, total_impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "acos", total_sales: 20, total_acos: 48, total_spend: 4, total_impressions: 2, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(
    [...rows].sort(compareByAcosSpendImpressionsSync).map((row) => row.id),
    ["acos", "spend", "imp", "sync"],
  );
});

test("fillOverviewWidgetRows never duplicates ids across tiers", () => {
  const rows = [
    { id: "a", score: 2 },
    { id: "b", score: 9 },
    { id: "c", score: 1 },
  ];
  const filled = fillOverviewWidgetRows(
    rows,
    [
      { pick: (row) => row.score > 5, compare: (a, b) => b.score - a.score },
      { pick: () => true, compare: (a, b) => a.id.localeCompare(b.id) },
    ],
    3,
  );
  assert.deepEqual(filled.map((row) => row.id), ["b", "a", "c"]);
});

test("Overview keyword rows open keyword detail, not product-target detail", () => {
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /`\/keyword\/\$\{row\.id\}`/);
  assert.match(home, /`\/search-term\/\$\{row\.id\}`/);
  assert.doesNotMatch(home, /`\/target\/\$\{row\.id\}`/);
});

test("Format mix widget gated on USD-comparable currency", () => {
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /kdpCurrencyComparable \? \(/);
  assert.match(home, /home-kdp-royalties-format/);
  assert.match(home, /toUpperCase\(\) === "USD"/);
});

test("hero ACoS refuses 0% when sales are 0", () => {
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /heroSales \?\? 0\) > 0/);
  assert.match(home, /acosDisplayAmount == null \? "—"/);
});

test("legacy: basic ACoS direction still holds when all rows convert", () => {
  const campaigns = [
    { id: "1", name: "c1", sales: 10, acos: 40, spend: 5, orders: 1, clicks: 0, impressions: 0 },
    { id: "2", name: "c2", sales: 12, acos: 18, spend: 3, orders: 2, clicks: 0, impressions: 0 },
  ];
  assert.deepEqual(campaignsHighAcos(campaigns).map((row) => row.id), ["1", "2"]);
  assert.deepEqual(campaignsLowAcos(campaigns).map((row) => row.id), ["2", "1"]);
});

test("pause detection: paused / PAUSED only; enabled+active kept", () => {
  assert.equal(isPausedForOverviewWidget("paused"), true);
  assert.equal(isPausedForOverviewWidget("PAUSED"), true);
  assert.equal(isPausedForOverviewWidget("enabled"), false);
  assert.equal(isPausedForOverviewWidget("active"), false);
  assert.equal(isPausedForOverviewWidget(null), false);
  assert.equal(isPausedForOverviewWidget(undefined), false);
});

test("Campaigns widget ranks exclude paused before top-N (High ACoS / Low ACoS / Top spend)", () => {
  const rows = [
    { id: "paused-hi", name: "p", state: "paused", sales: 20, acos: 95, spend: 19, impressions: 50, updated_at: "2026-08-01T00:00:00Z" },
    { id: "enabled-mid", name: "e", state: "enabled", sales: 15, acos: 55, spend: 8, impressions: 40, updated_at: "2026-08-01T00:00:00Z" },
    { id: "active-lo", name: "a", state: "active", sales: 12, acos: 25, spend: 3, impressions: 30, updated_at: "2026-08-01T00:00:00Z" },
    { id: "paused-spend", name: "ps", state: "PAUSED", sales: 0, acos: 0, spend: 200, impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "enabled-spend", name: "es", state: "enabled", sales: 0, acos: 0, spend: 40, impressions: 5, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(campaignsHighAcos(rows).map((row) => row.id), ["enabled-mid", "active-lo", "enabled-spend"]);
  assert.deepEqual(campaignsLowAcos(rows).map((row) => row.id), ["active-lo", "enabled-mid", "enabled-spend"]);
  assert.deepEqual(campaignsTopSpend(rows).map((row) => row.id), ["enabled-spend", "enabled-mid", "active-lo"]);
  assert.ok(!campaignsHighAcos(rows).some((row) => String(row.state || "").toLowerCase() === "paused"));
});

test("Ad groups High ACoS excludes paused ad groups before ranking", () => {
  const groups = [
    { id: "g-paused", name: "hi-paused", state: "paused", total_sales: 20, total_acos: 90, total_spend: 18, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g-enabled", name: "hi", state: "enabled", total_sales: 18, total_acos: 60, total_spend: 10, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g-active", name: "spend", state: "active", total_sales: 0, total_acos: 0, total_spend: 50, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(adGroupsHighAcos(groups).map((row) => row.id), ["g-enabled", "g-active"]);
});
