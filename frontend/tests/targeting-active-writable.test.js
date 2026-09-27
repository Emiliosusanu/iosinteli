import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  biddingStrategyLabel,
  DEFAULT_TARGETING_STATE_FILTER,
  isDynamicBiddingStrategy,
  matchesEntityStateFilter,
  matchesLiveTargetingRow,
  normalizeBiddingStrategyCode,
  resolveTargetingStateFilter,
  shouldShowActiveOrPausedWithData,
} from "../src/lib/campaigns.ts";
import {
  getCampaignStrategyCooldown,
  getPlacementAdjCooldown,
  getEntityBidCooldown,
  resolveBidChangeAt,
} from "../src/lib/bidCooldown.ts";

const targetingSource = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const campaignsSource = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
const queriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const outboxSource = readFileSync(new URL("../src/lib/bulkOutbox.ts", import.meta.url), "utf8");

test("active filter hides paused parents and entities by default helpers", () => {
  assert.equal(DEFAULT_TARGETING_STATE_FILTER, "enabled");
  assert.equal(resolveTargetingStateFilter(undefined), "enabled");
  assert.equal(resolveTargetingStateFilter(null), "enabled");
  assert.equal(resolveTargetingStateFilter("bogus"), "enabled");
  assert.equal(resolveTargetingStateFilter("all"), "all");
  assert.equal(resolveTargetingStateFilter("paused"), "paused");
  assert.equal(matchesEntityStateFilter("enabled", "enabled"), true);
  assert.equal(matchesEntityStateFilter("paused", "enabled"), false);
  assert.equal(matchesEntityStateFilter("paused", "paused"), true);
  assert.equal(matchesEntityStateFilter("archived", "all"), false);
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "paused",
      filter: "enabled",
    }),
    false,
  );
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      adGroupState: "enabled",
      filter: "enabled",
    }),
    true,
  );
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: null,
      adGroupState: "enabled",
      filter: "enabled",
    }),
    false,
  );
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      adGroupState: null,
      filter: "enabled",
    }),
    false,
  );
  // Placement-style: no adGroupState key → only campaign must be enabled.
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      filter: "enabled",
    }),
    true,
  );
  // Legacy helper still shows paused entities (lists that opt into it).
  assert.equal(shouldShowActiveOrPausedWithData({ total_spend: 0 }, "paused"), true);
});

test("bidding strategy labels and nest codes cover up/down", () => {
  assert.equal(biddingStrategyLabel("autoForSales"), "Up & Down");
  assert.equal(normalizeBiddingStrategyCode("AUTO_FOR_SALES"), "AUTO_FOR_SALES");
  assert.equal(normalizeBiddingStrategyCode("legacyForSales"), "LEGACY_FOR_SALES");
  assert.equal(isDynamicBiddingStrategy("autoForSales"), true);
  assert.equal(isDynamicBiddingStrategy("manual"), false);
});

test("campaign strategy and placement cooldowns are independent", () => {
  const now = Date.parse("2026-09-05T12:00:00.000Z");
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(
    resolveBidChangeAt({
      placement_adj_last_modified_at: recent,
      rule_last_modified_at: null,
    }),
    recent,
  );
  const info = getPlacementAdjCooldown(
    { placement_adj_last_modified_at: recent, placement_adj_change_source: "manual" },
    48,
    now,
  );
  assert.equal(info.isInCooldown, true);
  assert.equal(
    getCampaignStrategyCooldown(
      { placement_adj_last_modified_at: recent, placement_adj_change_source: "manual" },
      48,
      now,
    ).isInCooldown,
    false,
  );
  assert.equal(getEntityBidCooldown({ rule_last_modified_at: recent }, 48, now).isInCooldown, true);
});

test("targeting defaults to Active across all segments with parent-chain matching", () => {
  assert.match(targetingSource, /useState<EntityStateFilter>\(DEFAULT_TARGETING_STATE_FILTER\)/);
  assert.match(targetingSource, /DEFAULT_TARGETING_STATE_FILTER/);
  assert.match(targetingSource, /resolveTargetingStateFilter/);
  // Parent-chain Active is enforced server-side via mobile_targeting_page_v1 (not client matchesLiveTargetingRow).
  assert.match(targetingSource, /fetchMobileTargetingPage/);
  assert.match(targetingSource, /state: stateFilter/);
  assert.match(targetingSource, /RPC mobile_targeting_page_v1 enforces the same parent-chain/);
  assert.match(targetingSource, /\/\/ Active = keyword enabled \+ ad group enabled \+ campaign enabled/);
  assert.match(targetingSource, /ASINs \/ Auto \/ Category: Active = target \+ ad group \+ campaign enabled/);
  assert.match(targetingSource, /Placement rows are campaigns — Active = campaign enabled/);
  assert.match(
    targetingSource,
    /Paused = entity paused AND live parents \(ad group \+ campaign enabled\) — use All to see paused-under-paused/,
  );
  assert.doesNotMatch(targetingSource, /Paused[\s\S]{0,80}no parent-chain/);
  assert.match(targetingSource, /subtitle: "Try All"/);
  // Shared stateFilter — segment switch must not reset Active → All.
  assert.match(targetingSource, /onPress=\{\(\) => \{\s*setSegment\(s\.key\);\s*setSelectedIds\(\[\]\);/);
  assert.doesNotMatch(targetingSource, /setSegment\(s\.key\);\s*setStateFilter/);
  assert.match(targetingSource, /PLACEMENT_FIELDS\.find/);
  assert.match(targetingSource, /placement_key/);
  assert.match(targetingSource, /getPlacementAdjCooldown/);
  assert.match(targetingSource, /ownerId:/);
  assert.match(targetingSource, /requeuePermanentBulkFailures/);
  assert.match(targetingSource, /dismissPermanentBulkFailures/);
  assert.match(targetingSource, /viewAsOtherUser/);
});

test("Active hierarchy fail-closed covers keywords, product targets, and placement shapes", () => {
  const live = {
    entityState: "enabled",
    campaignState: "enabled",
    adGroupState: "enabled",
    filter: "enabled",
  };
  assert.equal(matchesLiveTargetingRow(live), true);
  // Keywords / ASINs / Auto / Category: paused or unknown parents hide.
  assert.equal(matchesLiveTargetingRow({ ...live, campaignState: "paused" }), false);
  assert.equal(matchesLiveTargetingRow({ ...live, adGroupState: "paused" }), false);
  assert.equal(matchesLiveTargetingRow({ ...live, campaignState: null }), false);
  assert.equal(matchesLiveTargetingRow({ ...live, adGroupState: null }), false);
  assert.equal(matchesLiveTargetingRow({ ...live, entityState: "paused" }), false);
  // Placement-style (omit adGroupState key): only campaign chain.
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      filter: "enabled",
    }),
    true,
  );
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: null,
      filter: "enabled",
    }),
    false,
  );
  // All / Paused do not require parent chain.
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "enabled",
      campaignState: "paused",
      adGroupState: "paused",
      filter: "all",
    }),
    true,
  );
  assert.equal(
    matchesLiveTargetingRow({
      entityState: "paused",
      campaignState: "paused",
      adGroupState: null,
      filter: "paused",
    }),
    true,
  );
});

test("campaigns default Active and expose bidding strategy sheet", () => {
  assert.match(campaignsSource, /useState<StateFilter>\("enabled"\)/);
  assert.match(campaignsSource, /BiddingStrategySheet/);
  assert.match(campaignsSource, /onLongPress/);
  assert.match(campaignsSource, /getCampaignStrategyCooldown/);
  assert.match(campaignsSource, /getPlacementAdjCooldown/);
  assert.match(campaignsSource, /settingsCooldown\.isInCooldown/);
  assert.match(campaignsSource, /cooldown=\{placementCooldown\}/);
});

test("list fetch restricts to owned campaigns before Nest not-found writes", () => {
  assert.match(queriesSource, /fetchOwnedCampaignIds/);
  assert.match(queriesSource, /restrictRowsToOwnedCampaigns/);
  assert.match(queriesSource, /ownerUserId/);
  assert.match(queriesSource, /attachParentEntityStates/);
});

test("bulk outbox retry helpers remain intact", () => {
  assert.match(outboxSource, /requeuePermanentBulkFailures/);
  assert.match(outboxSource, /dismissPermanentBulkFailures/);
  assert.match(outboxSource, /retryPermanentBulkFailures/);
  assert.match(outboxSource, /dismissNotFoundPermanentBulkFailures/);
  assert.match(outboxSource, /isPermanentNotFoundBulkError/);
});
