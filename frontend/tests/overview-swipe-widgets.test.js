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

test("matrix: Campaigns High ACoS fills 7 via ACoS → clicks → impressions → sync", () => {
  const high = campaignsHighAcos(eightCampaigns());
  assert.equal(high.length, OVERVIEW_SWIPE_ROW_LIMIT);
  assert.deepEqual(
    high.map((row) => row.id),
    ["acos-hi", "acos-lo", "imp-1", "imp-2", "click-1", "click-2", "sync-new"],
  );
});

test("matrix: Campaigns Low ACoS fills 7 and differs from High when ACoS exists", () => {
  const rows = eightCampaigns();
  const high = campaignsHighAcos(rows);
  const low = campaignsLowAcos(rows);
  assert.equal(low.length, OVERVIEW_SWIPE_ROW_LIMIT);
  assert.equal(low[0].id, "acos-lo");
  assert.equal(low[1].id, "acos-hi");
  assert.equal(overviewLowAcosDiffersFromHigh(high, low), false);
});

test("matrix: Campaigns Top spend fills 7 via spend → impressions → sync", () => {
  const rows = eightCampaigns().map((row, idx) =>
    idx === 0 ? row : { ...row, spend: 0, sales: 0, acos: 0, clicks: 0 },
  );
  // only acos-hi has spend; others need impressions/sync padding
  const padded = campaignsTopSpend([
    { id: "s1", spend: 50, sales: 0, acos: 0, clicks: 0, impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i1", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 400, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i2", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 100, updated_at: "2026-08-01T00:00:00Z" },
    { id: "u1", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "u2", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-08-20T00:00:00Z" },
    { id: "u3", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-08-10T00:00:00Z" },
    { id: "u4", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-08-05T00:00:00Z" },
    { id: "u5", spend: 0, sales: 0, acos: 0, clicks: 0, impressions: 0, updated_at: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(padded.length, OVERVIEW_SWIPE_ROW_LIMIT);
  assert.deepEqual(
    padded.map((row) => row.id),
    ["s1", "i1", "i2", "u1", "u2", "u3", "u4"],
  );
});

test("matrix: Ad groups High ACoS uses same cascade", () => {
  const groups = [
    { id: "g1", name: "hi", total_sales: 20, total_acos: 60, total_spend: 8, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g2", name: "spend", total_sales: 0, total_acos: 0, total_spend: 50, total_impressions: 10, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g3", name: "imp", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 900, updated_at: "2026-08-01T00:00:00Z" },
    { id: "g4", name: "sync", total_sales: 0, total_acos: 0, total_spend: 0, total_impressions: 0, updated_at: "2026-09-02T00:00:00Z" },
  ];
  assert.deepEqual(adGroupsHighAcos(groups).map((row) => row.id), ["g1", "g2", "g3", "g4"]);
});

test("matrix: Keywords spend / High ACoS and Search spend / Best ACoS cascades", () => {
  const keywords = [
    { id: "s1", keyword_text: "spent", total_spend: 11, total_orders: 0, total_impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "i1", keyword_text: "imps", total_spend: 0, total_orders: 0, total_impressions: 400, updated_at: "2026-08-01T00:00:00Z" },
    { id: "u1", keyword_text: "sync", total_spend: 0, total_orders: 0, total_impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "a1", keyword_text: "acos", total_spend: 8, total_orders: 1, total_sales: 20, total_acos: 45, total_impressions: 2, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(keywordsSpendingNoOrders(keywords).map((row) => row.id), ["s1", "i1", "a1", "u1"]);
  assert.equal(keywordsHighAcos(keywords)[0].id, "a1");

  const terms = [
    { id: "t1", search_term: "a", total_spend: 7, total_orders: 0, total_impressions: 1, updated_at: "2026-08-01T00:00:00Z" },
    { id: "t2", search_term: "b", total_spend: 0, total_orders: 0, total_impressions: 80, updated_at: "2026-08-01T00:00:00Z" },
    { id: "t3", search_term: "c", total_spend: 0, total_orders: 0, total_impressions: 0, updated_at: "2026-09-01T00:00:00Z" },
    { id: "t4", search_term: "d", total_spend: 2, total_orders: 1, total_sales: 10, total_acos: 12, total_impressions: 3, updated_at: "2026-08-01T00:00:00Z" },
  ];
  assert.deepEqual(searchTermsSpendNoOrders(terms).map((row) => row.id), ["t1", "t2", "t4", "t3"]);
  assert.equal(searchTermsLowAcos(terms)[0].id, "t4");
});

test("matrix: Books Top royalties stays royalty-only; ACoS/Ad spend use cascade", () => {
  const books = [
    { asin: "A", book_key: "A", sales: 10, acos: 55, spend: 5, royalties: 20, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-08-01T00:00:00Z" },
    { asin: "B", book_key: "B", sales: 8, acos: 22, spend: 4, royalties: 15, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-08-01T00:00:00Z" },
    { asin: "C", book_key: "C", sales: 0, acos: 0, spend: 6, royalties: 27, impressions: 0, clicks: 0, kdp_state: "ready", updated_at: "2026-09-01T00:00:00Z" },
    { asin: "D", book_key: "D", sales: 0, acos: 0, spend: 0, royalties: 0, impressions: 300, clicks: 0, kdp_state: "missing", updated_at: "2026-08-15T00:00:00Z" },
    { asin: "E", book_key: "E", sales: 0, acos: 0, spend: 0, royalties: null, impressions: 0, clicks: 40, kdp_state: "missing", updated_at: "2026-08-10T00:00:00Z" },
  ];
  assert.deepEqual(booksTopRoyalties(books).map((row) => row.asin), ["C", "A", "B"]);
  assert.deepEqual(booksHighAcos(books).map((row) => row.asin), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(booksLowAcos(books).map((row) => row.asin), ["B", "A", "C", "D", "E"]);
  assert.deepEqual(booksSpendingNoAdSales(books).map((row) => row.asin), ["C", "D", "E", "A", "B"]);
  assert.ok(booksWorstProfit(books).length >= 3);
});

test("matrix: zero-metric pool still fills from last sync up to 7", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `z${i}`,
    sales: 0,
    acos: 0,
    spend: 0,
    clicks: 0,
    impressions: 0,
    updated_at: `2026-09-${String(10 - i).padStart(2, "0")}T00:00:00Z`,
  }));
  const filled = campaignsHighAcos(rows);
  assert.equal(filled.length, OVERVIEW_SWIPE_ROW_LIMIT);
  assert.equal(filled[0].id, "z0");
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

test("legacy: basic ACoS direction still holds when all rows convert", () => {
  const campaigns = [
    { id: "1", name: "c1", sales: 10, acos: 40, spend: 5, orders: 1, clicks: 0, impressions: 0 },
    { id: "2", name: "c2", sales: 12, acos: 18, spend: 3, orders: 2, clicks: 0, impressions: 0 },
  ];
  assert.deepEqual(campaignsHighAcos(campaigns).map((row) => row.id), ["1", "2"]);
  assert.deepEqual(campaignsLowAcos(campaigns).map((row) => row.id), ["2", "1"]);
});
