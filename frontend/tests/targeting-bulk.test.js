import { test } from "node:test";
import assert from "assert/strict";
import { readFileSync } from "node:fs";

import {
  applyPlacementAdjPoints,
  clampPlacementAdj,
  cooldownFnForBulk,
  groupPlacementFieldsByCampaign,
  indexRowsById,
  partitionSelectedByCooldown,
  signedBulkAmount,
} from "../src/lib/targetingBulk.ts";
import { mixedMarketplaceMoneyHint } from "../src/lib/accountsUi.ts";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");

test("placement adj clamps to Amazon 0–900 and adds points from zero", () => {
  assert.equal(clampPlacementAdj(-4), 0);
  assert.equal(clampPlacementAdj(901), 900);
  assert.equal(applyPlacementAdjPoints(0, 10), 10);
  assert.equal(applyPlacementAdjPoints(50, -20), 30);
  assert.equal(applyPlacementAdjPoints(null, 15), 15);
  assert.equal(signedBulkAmount("decrease_pct", 10), -10);
});

test("cooldown partition skips locked ids and keeps ready ones", () => {
  const now = Date.parse("2026-09-06T12:00:00.000Z");
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 100 * 60 * 60 * 1000).toISOString();
  const rows = indexRowsById([
    { id: "ready", bid_last_modified_at: old },
    { id: "cool", bid_last_modified_at: recent, bid_change_source: "manual" },
  ]);
  const part = partitionSelectedByCooldown(["ready", "cool", "gone"], rows, 48, now);
  assert.deepEqual(part.readyIds, ["ready"]);
  assert.deepEqual(part.cooldownIds, ["cool"]);
  assert.deepEqual(part.missingIds, ["gone"]);
});

test("placement bulk cooldown ignores strategy-only rule stamps", () => {
  const now = Date.parse("2026-09-06T12:00:00.000Z");
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const rows = indexRowsById([
    {
      id: "strategy_only",
      rule_last_modified_at: recent,
      placement_adj_last_modified_at: null,
      bid_change_source: "manual",
    },
    {
      id: "placement_locked",
      rule_last_modified_at: recent,
      placement_adj_last_modified_at: recent,
      placement_adj_change_source: "manual",
    },
  ]);
  const bidPart = partitionSelectedByCooldown(
    ["strategy_only", "placement_locked"],
    rows,
    48,
    now,
  );
  assert.deepEqual(bidPart.cooldownIds.sort(), ["placement_locked", "strategy_only"]);
  const placementPart = partitionSelectedByCooldown(
    ["strategy_only", "placement_locked"],
    rows,
    48,
    now,
    cooldownFnForBulk("placement_adj"),
  );
  assert.deepEqual(placementPart.readyIds, ["strategy_only"]);
  assert.deepEqual(placementPart.cooldownIds, ["placement_locked"]);
});

test("Targets placement bulk uses placement_adj cooldown (not entity bid)", () => {
  assert.match(
    readFileSync(new URL("../src/lib/targetingBulk.ts", import.meta.url), "utf8"),
    /cooldownFnForBulk/,
  );
  assert.match(
    readFileSync(new URL("../src/lib/targetingBulk.ts", import.meta.url), "utf8"),
    /getPlacementAdjCooldown/,
  );
  // Placement list bulk edit is gated off in targeting UI (segment !== "placement").
  assert.match(targeting, /canBulkBid = segment !== "placement"/);
});

test("placement bulk groups selected slots on one campaign write", () => {
  const rows = indexRowsById([
    { id: "c1::top_of_search", campaign_id: "c1", placement_key: "top_of_search" },
    { id: "c1::rest_of_search", campaign_id: "c1", placement_key: "rest_of_search" },
    { id: "c2::product_pages", campaign_id: "c2", placement_key: "product_pages" },
  ]);
  const grouped = groupPlacementFieldsByCampaign(
    ["c1::top_of_search", "c1::rest_of_search", "c1::top_of_search", "c2::product_pages"],
    rows,
  );
  assert.deepEqual(grouped.get("c1"), ["top_of_search", "rest_of_search"]);
  assert.deepEqual(grouped.get("c2"), ["product_pages"]);
});

test("Targets keyword/ASIN bulk keeps cooldown skip paths; Placement list is not bulk-bid", () => {
  assert.match(targeting, /canBulkBid = segment !== "placement"/);
  assert.match(targeting, /getEntityBidCooldown/);
  assert.match(
    targeting,
    /Increase \/ decrease bid applies to keywords and targets/,
  );
});

test("mixed-marketplace totals line warns when markets differ (no FX)", () => {
  assert.equal(
    mixedMarketplaceMoneyHint(["USD", "CAD"], "USD"),
    "Totals in USD include CAD converted via market FX (not Amazon).",
  );
  assert.equal(mixedMarketplaceMoneyHint(["USD"], "USD"), null);
  assert.match(
    readFileSync(new URL("../src/lib/accountsUi.ts", import.meta.url), "utf8"),
    /Totals in \$\{display\}\. Other markets not converted/,
  );
});
