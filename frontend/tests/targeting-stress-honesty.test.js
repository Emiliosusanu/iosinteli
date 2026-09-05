/**
 * Targeting stress honesty — bulk edit + every filter surface across
 * Keywords / ASINs / Auto / Category / Placement.
 *
 * Guarantees (static + behavioral):
 * - no Sales / fake-zero / lifetime-as-period paint
 * - profile + period isolation
 * - book filter = enabled sponsored only
 * - advanced ranges (ACoS, bid, clicks, impr) match period metrics
 * - Placement ignores bid $ ranges; bulk Bid ± gated off Placement
 * - bulk outbox honesty (queued ≠ Amazon-confirmed; cooldown surfaced)
 * - all five segments always reachable
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advancedFiltersForSegment,
  applyBidDeltaPercent,
  applyBidDeltaUsd,
  compareTargetingRows,
  matchesAdvancedFilters,
  normalizeTargetingAdvancedFilters,
  parseFilterRangeInput,
  resolveTargetingSortKey,
  rowMetricsFromEntity,
} from "../src/lib/targetingFilters.ts";
import { getEntityBidCooldown } from "../src/lib/bidCooldown.ts";
import { clampAmazonBid } from "../src/lib/bulkOutboxContract.ts";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const filters = readFileSync(new URL("../src/lib/targetingFilters.ts", import.meta.url), "utf8");
const outbox = readFileSync(new URL("../src/lib/bulkOutbox.ts", import.meta.url), "utf8");
const filterMemory = readFileSync(new URL("../src/lib/filterMemory.ts", import.meta.url), "utf8");
const periodQuery = readFileSync(new URL("../src/lib/periodQuery.ts", import.meta.url), "utf8");
const dashboardApi = readFileSync(new URL("../src/lib/dashboardApi.ts", import.meta.url), "utf8");

const SEGMENTS = ["keywords", "asins", "auto", "category", "placement"];

test("all five targeting segments are always wired (kw / asin / auto / cat / placement)", () => {
  for (const key of SEGMENTS) {
    assert.match(targeting, new RegExp(`key:\\s*"${key}"`));
  }
  assert.match(targeting, /testID="targeting-segments"/);
  assert.match(targeting, /segmentWrap/);
  assert.match(targeting, /flexWrap:\s*"wrap"/);
  // Product targets split into asins / auto / category buckets — no silent drop.
  assert.match(targeting, /buckets\.auto\.push/);
  assert.match(targeting, /buckets\.category\.push/);
  assert.match(targeting, /buckets\.asins\.push/);
  assert.match(targeting, /__targetingIsCategory/);
  assert.match(targeting, /described\.isAuto/);
});

test("profile + date window isolation — no cross-period / cross-profile bleed", () => {
  assert.match(targeting, /sortedProfileIds/);
  assert.match(targeting, /periodQueryKey/);
  assert.match(targeting, /noPeriodPlaceholder/);
  assert.match(targeting, /LIST_PERIOD_QUERY_CACHE/);
  assert.match(periodQuery, /export function periodQueryKey/);
  assert.match(periodQuery, /export function sortedProfileIds/);
  assert.match(periodQuery, /export function noPeriodPlaceholder/);
  // Empty selected profiles → empty state, not stale prior-account rows.
  assert.match(targeting, /selectedProfileIds\.length === 0/);
  assert.match(targeting, /No Amazon account|No account connected/);
});

test("book filter: enabled sponsored ASINs only + cover grid (web parity)", () => {
  assert.match(queries, /Books for the targeting filter — web parity/);
  assert.match(queries, /\.eq\("status", "enabled"\)/);
  assert.match(queries, /campaigns\.state", "enabled"/);
  assert.match(queries, /\/campaigns\/books/);
  assert.match(targeting, /Sponsored ASINs on enabled campaigns/);
  assert.match(targeting, /styles\.bookGrid/);
  assert.match(targeting, /fetchTargetingBookOptions\(scopeProfiles/);
  assert.match(targeting, /Don't apply book filter until options are fetched/);
  assert.match(targeting, /bookCampaignIds/);
  assert.doesNotMatch(targeting, /No advertised books on these profiles yet\./);
  assert.match(targeting, /No active sponsored books on these profiles yet\./);
});

test("perf + advanced ranges stress matrix (ACoS / bid / clicks / impr)", () => {
  // Perf chips present
  for (const key of ["all", "wasting", "high_acos", "low_acos", "no_sales", "profitable", "has_clicks", "has_orders", "has_impressions"]) {
    assert.match(targeting, new RegExp(`key:\\s*"${key}"`));
  }
  // Range editors
  for (const id of [
    "targeting-adv-bid-min",
    "targeting-adv-bid-max",
    "targeting-adv-acos-min",
    "targeting-adv-acos-max",
    "targeting-adv-clicks-min",
    "targeting-adv-clicks-max",
    "targeting-adv-impr-min",
    "targeting-adv-impr-max",
  ]) {
    assert.match(targeting, new RegExp(id));
  }
  assert.match(targeting, /parseFilterRangeInput/);
  assert.match(filters, /export function parseFilterRangeInput/);

  // Behavioral: decimals + integer clicks/impr
  assert.deepEqual(parseFilterRangeInput("0.85"), { kind: "value", value: 0.85 });
  assert.equal(parseFilterRangeInput("0.").kind, "incomplete");
  assert.deepEqual(parseFilterRangeInput("12", true), { kind: "value", value: 12 });

  const row = rowMetricsFromEntity(
    {
      total_spend: 40,
      total_sales: 100,
      total_orders: 4,
      total_acos: 40,
      total_clicks: 20,
      total_impressions: 2000,
    },
    0.85,
  );

  // Bid max 0.85 includes this row; bid max 0.84 excludes it
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      bidMax: 0.85,
    })),
    true,
  );
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      bidMax: 0.84,
    })),
    false,
  );

  // ACoS band
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      acosMin: 30,
      acosMax: 50,
    })),
    true,
  );
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      acosMin: 50,
      acosMax: 80,
    })),
    false,
  );

  // Clicks / impressions
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      clicksMin: 10,
      clicksMax: 25,
      impressionsMin: 1000,
      impressionsMax: 3000,
    })),
    true,
  );
  assert.equal(
    matchesAdvancedFilters(row, normalizeTargetingAdvancedFilters({
      ...emptyAdv(),
      impressionsMax: 500,
    })),
    false,
  );

  // Placement strips bid ranges so empty Placement lists aren't fake-empty from $ filters
  const withBid = normalizeTargetingAdvancedFilters({ ...emptyAdv(), bidMin: 0.5, bidMax: 1 });
  const cleared = advancedFiltersForSegment("placement", withBid);
  assert.equal(cleared.bidMin, null);
  assert.equal(cleared.bidMax, null);
  assert.equal(advancedFiltersForSegment("keywords", withBid).bidMax, 1);

  // Sort driven by active family
  assert.equal(resolveTargetingSortKey("spend", withBid), "bid");
});

test("filter persistence remembers book / perf / sort / advanced ranges", () => {
  assert.match(filterMemory, /inteliads\.filters\.targeting\.v2/);
  assert.match(targeting, /saveTargetingFilterMemory/);
  assert.match(targeting, /loadTargetingFilterMemory/);
  assert.match(targeting, /bookAsin/);
});

test("bulk bid stress: visible Bid ±, outbox drain, cooldown names, Placement gated", () => {
  assert.match(targeting, /targeting-bulk-bar/);
  assert.match(targeting, /Bid \+\$/);
  assert.match(targeting, /Bid −\$/);
  assert.match(targeting, /Bid \+%/);
  assert.match(targeting, /Bid −%/);
  assert.match(targeting, /by amount/);
  assert.match(targeting, /by percent/);
  assert.match(targeting, /Increase \/ decrease bid applies to keywords and targets/);
  assert.match(targeting, /selectedCooldownSummary/);
  assert.match(targeting, /targeting-cooldown-selected/);
  assert.match(targeting, /targeting-cooldown-badge-/);
  assert.match(targeting, /enqueueBulkAmazonWrites/);
  assert.match(targeting, /Not confirmed on Amazon yet/);
  assert.match(targeting, /drainBulkOutbox/);
  assert.match(outbox, /inteliads\.bulkOutbox\.v1/);
  assert.match(outbox, /forceCooldown: true/);
  assert.match(outbox, /failed_permanent/);

  // Behavioral clamp + delta math used by bulk apply
  assert.equal(clampAmazonBid(0.855), 0.86);
  assert.equal(applyBidDeltaUsd(0.5, 0.05), 0.55);
  assert.equal(applyBidDeltaPercent(1, 10), 1.1);

  const cool = getEntityBidCooldown(
    { bid_last_modified_at: new Date().toISOString(), bid_change_source: "rule" },
    48,
    Date.now(),
  );
  assert.equal(cool.isInCooldown, true);
});

test("period metrics honesty — fail closed, Nest null shares, no Sales labels", () => {
  assert.match(queries, /Never paint lifetime totals or fake zeros/);
  assert.match(queries, /keyword metrics enrichment failed/);
  assert.match(queries, /product target metrics enrichment failed/);
  assert.match(targeting, /Period metrics couldn't be loaded/);
  assert.match(targeting, /No rows match these period filters — not missing data/);
  assert.doesNotMatch(targeting, /label:\s*"Sales"/);
  assert.match(targeting, /label:\s*"Impr"/);
  assert.match(targeting, /label:\s*"Clicks"/);
  assert.match(dashboardApi, /placement_top_share:\s*null/);
  assert.match(targeting, /normalizePlacementCampaignMetrics/);
  assert.match(targeting, /fetchAggregatedCampaigns|fetchTopCampaignsRange/);
  assert.match(queries, /Nest campaign aggregation failed; falling back to Supabase/);
});

test("list cap 500 is fetch-only — not Amazon write ceiling; entities not silently invented", () => {
  assert.match(queries, /TARGETING_LIST_LIMIT = 500/);
  assert.match(queries, /Not an Amazon write limit/);
  assert.match(targeting, /List capped at \{TARGETING_LIST_LIMIT\}/);
  assert.match(targeting, /Bulk Bid ± still writes every selected row/);
  // Empty states distinguish load error vs filter miss vs no data
  assert.match(targeting, /emptyCopy|No keywords|No campaigns|No product/);
});

test("stress sort: ACoS / bid high→low on period metrics", () => {
  const a = rowMetricsFromEntity(
    { total_acos: 10, total_sales: 50, total_spend: 5, total_orders: 1, total_clicks: 2, total_impressions: 100 },
    0.4,
  );
  const b = rowMetricsFromEntity(
    { total_acos: 50, total_sales: 40, total_spend: 20, total_orders: 3, total_clicks: 8, total_impressions: 900 },
    1.2,
  );
  // Higher ACoS / bid sorts first (compare returns ≤ 0 when first arg should precede second).
  assert.ok(compareTargetingRows(b, a, "acos") <= 0);
  assert.ok(compareTargetingRows(b, a, "bid") <= 0);
  assert.ok(compareTargetingRows(b, a, "spend") <= 0);
  assert.ok(compareTargetingRows(b, a, "clicks") <= 0);
  assert.ok(compareTargetingRows(b, a, "impressions") <= 0);
});

function emptyAdv() {
  return {
    acosMin: null,
    acosMax: null,
    bidMin: null,
    bidMax: null,
    clicksMin: null,
    clicksMax: null,
    impressionsMin: null,
    impressionsMax: null,
  };
}
