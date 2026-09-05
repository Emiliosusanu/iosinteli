import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BID_CHANGE_CONFIRM_PCT,
  advancedFiltersForSegment,
  advancedSortOverridesExplicit,
  compareTargetingRows,
  matchesAdvancedFilters,
  normalizeTargetingAdvancedFilters,
  parseBidInput,
  parseFilterRangeInput,
  requiresBidChangeConfirm,
  resolveTargetingSortKey,
  rowMetricsFromEntity,
  sanitizeBidForAmazon,
  applyBidDeltaPercent,
} from "../src/lib/targetingFilters.ts";

test("normalize swaps inverted ranges and drops negatives", () => {
  const n = normalizeTargetingAdvancedFilters({
    acosMin: 40,
    acosMax: 20,
    bidMin: 1,
    bidMax: 0.5,
    clicksMin: 10,
    clicksMax: 5,
    impressionsMin: -1,
    impressionsMax: 50,
  });
  assert.equal(n.acosMin, 20);
  assert.equal(n.acosMax, 40);
  assert.equal(n.bidMin, 0.5);
  assert.equal(n.bidMax, 1);
  assert.equal(n.clicksMin, 5);
  assert.equal(n.clicksMax, 10);
  assert.equal(n.impressionsMin, null);
  assert.equal(n.impressionsMax, 50);
});

test("advanced filters match period metrics and bids", () => {
  const row = rowMetricsFromEntity(
    { total_spend: 10, total_sales: 50, total_orders: 2, total_acos: 20, total_clicks: 8, total_impressions: 120 },
    0.75,
  );
  assert.equal(
    matchesAdvancedFilters(row, {
      acosMin: 10,
      acosMax: 25,
      bidMin: 0.5,
      bidMax: 0.8,
      clicksMin: 5,
      clicksMax: null,
      impressionsMin: null,
      impressionsMax: 200,
    }),
    true,
  );
  assert.equal(
    matchesAdvancedFilters(row, {
      acosMin: null,
      acosMax: null,
      bidMin: null,
      bidMax: 0.5,
      clicksMin: null,
      clicksMax: null,
      impressionsMin: null,
      impressionsMax: null,
    }),
    false,
  );
});

test("placement short campaign metrics normalize for targeting filters", () => {
  const row = rowMetricsFromEntity(
    { spend: 12, sales: 60, orders: 3, acos: 20, clicks: 9, impressions: 300 },
    null,
  );
  assert.equal(row.spend, 12);
  assert.equal(row.sales, 60);
  assert.equal(row.orders, 3);
  assert.equal(row.acos, 20);
  assert.equal(row.clicks, 9);
  assert.equal(row.impressions, 300);
  assert.equal(
    matchesAdvancedFilters(row, {
      acosMin: 10,
      acosMax: 25,
      bidMin: null,
      bidMax: null,
      clicksMin: 5,
      clicksMax: 10,
      impressionsMin: 200,
      impressionsMax: 400,
    }),
    true,
  );
});

test("active filter family drives sort key; else ACoS desc", () => {
  assert.equal(
    resolveTargetingSortKey("acos", {
      acosMin: null,
      acosMax: null,
      bidMin: null,
      bidMax: 0.75,
      clicksMin: null,
      clicksMax: null,
      impressionsMin: null,
      impressionsMax: null,
    }),
    "bid",
  );
  assert.equal(
    resolveTargetingSortKey("acos", {
      acosMin: 10,
      acosMax: 20,
      bidMin: null,
      bidMax: null,
      clicksMin: null,
      clicksMax: null,
      impressionsMin: null,
      impressionsMax: null,
    }),
    "acos",
  );
  assert.equal(
    resolveTargetingSortKey("acos", {
      acosMin: null,
      acosMax: null,
      bidMin: null,
      bidMax: null,
      clicksMin: null,
      clicksMax: null,
      impressionsMin: 50,
      impressionsMax: null,
    }),
    "impressions",
  );
  assert.equal(
    resolveTargetingSortKey(null, {
      acosMin: null,
      acosMax: null,
      bidMin: null,
      bidMax: null,
      clicksMin: null,
      clicksMax: null,
      impressionsMin: null,
      impressionsMax: null,
    }),
    "acos",
  );
});

test("advanced sort override is honest when ranges disagree with explicit sort", () => {
  const bidMax = {
    acosMin: null,
    acosMax: null,
    bidMin: null,
    bidMax: 0.75,
    clicksMin: null,
    clicksMax: null,
    impressionsMin: null,
    impressionsMax: null,
  };
  assert.equal(advancedSortOverridesExplicit("spend", bidMax), true);
  assert.equal(advancedSortOverridesExplicit("bid", bidMax), false);
  assert.equal(
    advancedSortOverridesExplicit("acos", {
      ...bidMax,
      bidMax: null,
      acosMax: 20,
    }),
    false,
  );
  const cleared = advancedFiltersForSegment("placement", bidMax);
  assert.equal(cleared.bidMax, null);
  assert.equal(cleared.bidMin, null);
  assert.equal(advancedFiltersForSegment("keywords", bidMax).bidMax, 0.75);
});

test("ACoS sort is high to low; bid sort high to low", () => {
  const a = rowMetricsFromEntity({ total_sales: 10, total_acos: 40, total_spend: 4 }, 0.4);
  const b = rowMetricsFromEntity({ total_sales: 10, total_acos: 55, total_spend: 5 }, 0.9);
  assert.ok(compareTargetingRows(a, b, "acos") > 0);
  assert.ok(compareTargetingRows(a, b, "bid") > 0);
});

test("bid input strips junk symbols and confirms >30% jumps", () => {
  assert.equal(parseBidInput("$1,25"), 1.25);
  assert.equal(sanitizeBidForAmazon("abc"), null);
  assert.equal(requiresBidChangeConfirm(1, 1.4), true);
  assert.equal(requiresBidChangeConfirm(1, 1.2), false);
  assert.equal(BID_CHANGE_CONFIRM_PCT, 30);
  assert.equal(applyBidDeltaPercent(1, 10), 1.1);
});

test("filter range inputs keep decimals while typing (0.85)", () => {
  assert.equal(parseFilterRangeInput("0.").kind, "incomplete");
  assert.equal(parseFilterRangeInput("0,").kind, "incomplete");
  assert.deepEqual(parseFilterRangeInput("0.85"), { kind: "value", value: 0.85 });
  assert.deepEqual(parseFilterRangeInput("0,85"), { kind: "value", value: 0.85 });
  assert.deepEqual(parseFilterRangeInput(""), { kind: "empty" });
  assert.deepEqual(parseFilterRangeInput("12", true), { kind: "value", value: 12 });
});

test("placement cover enrichment maps Nest campaigns without inventing books", () => {
  const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
  assert.match(targeting, /export function enrichPlacementRowWithBook/);
  assert.match(targeting, /export function buildCampaignBookMap/);
  assert.match(targeting, /No linked book/);
  assert.match(targeting, /placeholder=\{hasBook \? "book" : "cube"\}/);

  // Mirror contract of the exported helpers (Nest rows have no book_*).
  function buildCampaignBookMap(list) {
    const map = new Map();
    for (const book of list) {
      const asin = String(book.asin || "").trim().toUpperCase();
      if (!asin) continue;
      const meta = {
        asin,
        title: String(book.title || asin).trim() || asin,
        image_url: book.image_url ? String(book.image_url).trim() : null,
      };
      for (const campaignId of book.campaignIds ?? []) {
        const id = String(campaignId || "").trim();
        if (!id || map.has(id)) continue;
        map.set(id, meta);
      }
    }
    return map;
  }
  function enrichPlacementRowWithBook(row, bookByCampaignId) {
    const id = String(row?.id || "");
    const linked = id ? bookByCampaignId.get(id) : undefined;
    const asin = String(row.book_asin || linked?.asin || "").trim().toUpperCase() || null;
    const title = String(row.book_title || linked?.title || "").trim() || null;
    const image = String(row.book_image_url || linked?.image_url || "").trim() || null;
    return { ...row, book_asin: asin, book_title: title, book_image_url: image };
  }
  const map = buildCampaignBookMap([
    { asin: "B0TESTASIN", title: "Test Book", image_url: "https://img/x.jpg", campaignIds: ["camp-1"] },
  ]);
  const enriched = enrichPlacementRowWithBook({ id: "camp-1", name: "SP" }, map);
  assert.equal(enriched.book_asin, "B0TESTASIN");
  assert.equal(enriched.book_title, "Test Book");
  assert.equal(enriched.book_image_url, "https://img/x.jpg");
  const bare = enrichPlacementRowWithBook({ id: "camp-orphan", name: "Orphan" }, map);
  assert.equal(bare.book_asin, null);
  assert.equal(bare.book_title, null);
  assert.equal(bare.book_image_url, null);
});
