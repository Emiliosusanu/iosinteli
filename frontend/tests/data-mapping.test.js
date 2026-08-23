import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatCurrency,
  normalizeDateRange,
  previousRange,
  rangePresets,
  safeDivide,
  toDateString,
} from "../src/lib/format.ts";
import { biddingStrategyLabel, shouldShowActiveOrPausedWithData, statusLabel } from "../src/lib/campaigns.ts";
import { describeProductTarget, extractTargetAsin, fallbackAsinCoverUrl } from "../src/lib/targeting.ts";

const queriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const campaignsSource = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
const campaignDetailSource = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
const searchTermsSource = readFileSync(new URL("../app/more/search-terms.tsx", import.meta.url), "utf8");
const targetingSource = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const adGroupDetailSource = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
const dynamicIslandSource = readFileSync(new URL("../src/components/DynamicIsland.tsx", import.meta.url), "utf8");

test("critical calculation helpers handle safe division and money formatting", () => {
  assert.equal(safeDivide(10, 2), 5);
  assert.equal(safeDivide(10, 0), 0);
  assert.equal(formatCurrency(1234.5, "EUR"), "€1,234.50");
  assert.equal(formatCurrency(Number.NaN, "USD"), "$—");
});

test("date range helpers produce stable inclusive previous ranges", () => {
  assert.deepEqual(previousRange("2026-05-01", "2026-05-07"), {
    start: "2026-04-24",
    end: "2026-04-30",
  });
  assert.equal(toDateString(new Date("2026-05-31T12:00:00Z")), "2026-05-31");
});

test("dynamic date range labels are refreshed against today's real window", () => {
  const juneFirst = new Date("2026-06-01T12:00:00");
  assert.deepEqual(rangePresets(juneFirst).thisMonth, {
    start: "2026-06-01",
    end: "2026-06-01",
    label: "This month",
  });
  assert.deepEqual(
    normalizeDateRange({ start: "2026-05-01", end: "2026-05-31", label: "This month" }, juneFirst),
    {
      start: "2026-06-01",
      end: "2026-06-01",
      label: "This month",
    },
  );
});

test("frontend data layer remains read-only for business tables", () => {
  const mutablePreferenceTables = new Set(["user_amazon_profiles", "user_settings"]);
  const businessTables = [
    "campaigns",
    "campaign_metrics",
    "ad_groups",
    "ad_group_metrics",
    "keywords",
    "keyword_metrics",
    "product_ads",
    "product_ad_metrics",
    "product_targets",
    "product_target_metrics",
    "search_terms",
    "search_term_metrics",
    "negative_keywords",
    "negative_product_targets",
    "rule_execution_history",
    "rule_execution_entities",
  ];
  for (const table of businessTables) {
    assert.equal(mutablePreferenceTables.has(table), false);
    const tableRef = `from("${table}")`;
    const tableIndex = queriesSource.indexOf(tableRef);
    if (tableIndex === -1) continue;
    const nearby = queriesSource.slice(tableIndex, tableIndex + 800);
    for (const mutation of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      assert.equal(nearby.includes(mutation), false, `${mutation} should not mutate ${table}`);
    }
  }
});

test("profile ownership is resolved through every supported link path", () => {
  for (const table of [
    "user_amazon_profiles",
    "user_user_profiles",
    "user_profiles_amazon_profiles",
    "user_campaigns",
  ]) {
    assert.equal(queriesSource.includes(`from("${table}")`), true);
  }
});

test("direct campaign reads and automation reads are selected-profile scoped", () => {
  assert.equal(queriesSource.includes("fetchCampaignById(id: string, profileIds?: string[])"), true);
  assert.equal(queriesSource.includes('.in("amazon_profile_id", profileIds)'), true);
  assert.equal(queriesSource.includes("fetchRuleExecutions(opts: { ruleId?: string; userId?: string; profileIds?: string[] }"), true);
  assert.equal(queriesSource.includes("fetchRuleIdsForUser(userId, profileIds)"), true);
  assert.equal(queriesSource.includes("fetchTodayExecutionStats(userId: string, profileIds?: string[])"), true);
});

test("kdp royalties prefer explicit profile links over legacy profile fields", () => {
  assert.equal(queriesSource.includes("explicitlyLinkedProfileIds"), true);
  assert.equal(queriesSource.includes("legacyProfileIds"), true);
  assert.equal(queriesSource.includes("if (!legacyProfileIds.length) return activeLinkedIds"), true);
  assert.equal(queriesSource.includes('from("kdp_daily_data")'), true);
  assert.equal(queriesSource.includes('from("kdp_entries")'), true);
});

test("dashboard finance widgets use imported KDP data instead of a manual royalty-rate fallback", () => {
  assert.equal(overviewSource.includes("const fallbackRoyalties = (_sales: number) => 0"), true);
  assert.equal(overviewSource.includes("royaltyRate: 0"), true);
  assert.equal(overviewSource.includes("royaltyRate,"), false);
});

test("top book profit includes campaign-level spend when ASIN-level product ad metrics are missing", () => {
  assert.equal(queriesSource.includes("inferTopBookGroupFromCampaignName"), true);
  assert.equal(queriesSource.includes('from("campaign_metrics")'), true);
  assert.equal(queriesSource.includes("group.spend += totals.spend"), true);
  assert.equal(queriesSource.includes("campaignsWithProductAdMetrics"), true);
});

test("product target helper resolves auto subtypes and ASIN expressions", () => {
  assert.deepEqual(describeProductTarget([{ type: "queryHighRelMatches" }], "auto"), {
    label: "Close Match",
    tone: "primary",
    isAuto: true,
    asin: "",
  });
  assert.deepEqual(describeProductTarget([{ type: "queryBroadRelMatches" }], null), {
    label: "Loose Match",
    tone: "warning",
    isAuto: true,
    asin: "",
  });
  assert.deepEqual(describeProductTarget([{ type: "asinAccessoryRelated" }], null), {
    label: "Complements",
    tone: "good",
    isAuto: true,
    asin: "",
  });
  assert.deepEqual(describeProductTarget([{ type: "asinSubstituteRelated" }], null), {
    label: "Substitutes",
    tone: "warning",
    isAuto: true,
    asin: "",
  });
  assert.equal(extractTargetAsin([{ type: "asinSameAs", value: "b0abc12345" }]), "B0ABC12345");
  assert.equal(
    fallbackAsinCoverUrl("b0abc12345"),
    "https://images-na.ssl-images-amazon.com/images/P/B0ABC12345.01._SCLZZZZZZZ_.jpg",
  );
  assert.equal(fallbackAsinCoverUrl("not-an-asin"), null);
});

test("campaign helpers label bidding strategy and hide only paused rows without data", () => {
  assert.equal(biddingStrategyLabel("autoForSales"), "Up & Down");
  assert.equal(biddingStrategyLabel("legacyForSales"), "Down Only");
  assert.equal(biddingStrategyLabel("manual"), "Fixed");
  assert.equal(statusLabel("enabled"), "Active");
  assert.equal(statusLabel("paused"), "Paused");
  assert.equal(shouldShowActiveOrPausedWithData({ total_spend: 0 }, "enabled"), true);
  assert.equal(shouldShowActiveOrPausedWithData({ total_spend: 0 }, "paused"), false);
  assert.equal(shouldShowActiveOrPausedWithData({ total_spend: 3 }, "paused"), true);
  assert.equal(shouldShowActiveOrPausedWithData({ total_spend: 3 }, "archived"), false);
});

test("campaign screens surface imported placement, strategy, and product target identity", () => {
  assert.equal(queriesSource.includes("fetchCampaignPlacementShares"), true);
  assert.equal(queriesSource.includes("placement_top_share"), true);
  assert.equal(queriesSource.includes("shouldShowActiveOrPausedWithData"), true);
  assert.equal(campaignsSource.includes("PlacementSharePills"), true);
  assert.equal(campaignsSource.includes("biddingStrategyLabel(item.bidding_strategy)"), true);
  assert.equal(campaignDetailSource.includes("describeProductTarget(pt.expression, pt.expression_type)"), true);
  assert.equal(campaignDetailSource.includes("fallbackAsinCoverUrl(target.asin)"), true);
  assert.equal(campaignDetailSource.includes('pathname: "/product/[asin]"'), true);
});

test("overview charts use real derived series without advisory filler copy", () => {
  assert.equal(overviewSource.includes("adsEngineAcos"), true);
  assert.equal(overviewSource.includes("btOrganicOrders"), true);
  assert.equal(overviewSource.includes("Low CTR: check creatives"), false);
  assert.equal(campaignDetailSource.includes("AutoTargetSummaryRow"), true);
  assert.equal(campaignDetailSource.includes('SectionCard title="Auto Targeting"'), true);
  assert.equal(queriesSource.includes("breakEvenFromKdpTitle"), true);
});

test("search terms and ad group detail avoid fixed pagination gaps", () => {
  assert.equal(queriesSource.includes("fetchAllPages<SearchTerm>"), true);
  assert.equal(queriesSource.includes("fetchAllPages<Keyword>"), true);
  assert.equal(queriesSource.includes("fetchAllPages<ProductTarget>"), true);
  assert.equal(queriesSource.includes("adGroupId?: string"), true);
  assert.equal(searchTermsSource.includes("limit: 200"), false);
  assert.equal(targetingSource.includes("limit: 200"), false);
  assert.equal(searchTermsSource.includes("removeClippedSubviews"), true);
  assert.equal(targetingSource.includes("maxToRenderPerBatch"), true);
  assert.equal(adGroupDetailSource.includes('type TabKey = "targets" | "searchTerms" | "history"'), true);
  assert.equal(adGroupDetailSource.includes("fetchAdGroupAutomationHistory"), true);
  assert.equal(dynamicIslandSource.includes("DynamicIsland"), true);
});

test("overview presents royalties minus spend without implying a full pnl", () => {
  assert.equal(overviewSource.includes("Royalties − spend"), true);
  assert.equal(overviewSource.includes("Spending without orders"), true);
  assert.equal(overviewSource.includes("vs previous period"), true);
  assert.equal(overviewSource.includes("Ad spend"), true);
});

test("overview does not present missing KDP royalties as a verified zero profit", () => {
  assert.equal(overviewSource.includes("const kdpReady = !!royaltyRange?.hasKdpData"), true);
  assert.equal(overviewSource.includes("const financeComplete = kdpReady && adsReady"), true);
  assert.equal(overviewSource.includes("const fallbackRoyalties = (_sales: number) => 0"), true);
  assert.equal(
    overviewSource.includes('loading || !financeComplete ? "—" : formatCurrency(totals.net, primaryCurrency)'),
    true,
  );
  assert.equal(
    overviewSource.includes('loading || !kdpReady ? "—" : formatCurrency(totals.royalties, primaryCurrency, { compact: true })'),
    true,
  );
  assert.equal(overviewSource.includes("kdpReady && netSeries.length > 1"), true);
});

test("book campaign drilldown remains read-only and uses all link paths", () => {
  assert.equal(queriesSource.includes("fetchBookCampaignsRange"), true);
  assert.equal(queriesSource.includes('from("product_ads")'), true);
  assert.equal(queriesSource.includes('from("product_targets")'), true);
  assert.equal(queriesSource.includes("inferTopBookGroupFromCampaignName"), true);
});
