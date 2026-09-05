import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const campaigns = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");

test("period metric enrichment never paints fake zeros — fails closed", () => {
  assert.match(queries, /keyword metrics enrichment failed/);
  assert.match(queries, /Never paint lifetime totals or fake zeros as the selected period/);
  assert.match(queries, /Couldn't load period metrics for keywords/);
  assert.match(queries, /product target metrics enrichment failed/);
  assert.match(queries, /Couldn't load period metrics for targets/);
  assert.match(targeting, /Period metrics couldn't be loaded/);
});

test("multi-profile lists use fair per-profile quota so one profile cannot hide others", () => {
  assert.match(queries, /fair per-profile quota/);
  assert.match(queries, /Math\.max\(80, Math\.ceil\(opts\.limit \/ profileIds\.length\)\)/);
  assert.match(queries, /fairSlice/);
  assert.match(targeting, /fair per-profile fetch/);
  assert.match(campaigns, /fair per-profile fetch/);
});

test("stale book filter clears when the ASIN is not in the current profile set", () => {
  assert.match(targeting, /Drop a remembered book filter/);
  assert.match(targeting, /setBookAsin\(null\)/);
  assert.match(targeting, /booksQ\.isFetched/);
});

test("book filter UI uses covers for enabled sponsored books like web", () => {
  assert.match(targeting, /Sponsored ASINs on enabled campaigns/);
  assert.match(targeting, /styles\.bookGrid/);
  assert.match(targeting, /parseFilterRangeInput/);
  assert.match(queries, /Books for the targeting filter — web parity/);
  assert.match(queries, /\.eq\("status", "enabled"\)/);
  assert.match(queries, /\.eq\("campaigns\.state", "enabled"\)/);
  assert.match(queries, /\/campaigns\/books/);
});

test("filters sort and perf against period row metrics, not lifetime placeholders", () => {
  assert.match(targeting, /matchesPerf\(row, perf\)/);
  assert.match(targeting, /matchesAdvancedFilters/);
  assert.match(targeting, /resolveTargetingSortKey/);
  assert.match(targeting, /compareTargetingRows/);
  assert.match(targeting, /rowMetricsFromEntity/);
  assert.match(targeting, /noPeriodPlaceholder/);
  assert.match(targeting, /label: "Impr"/);
  assert.match(targeting, /label: "Clicks"/);
  assert.match(targeting, /targeting-bulk-increase-pct/);
  assert.doesNotMatch(targeting, /label: "Sales"/);
  assert.match(campaigns, /label: "Impr"/);
  assert.match(campaigns, /label: "Clicks"/);
  assert.doesNotMatch(campaigns, /label: "Sales"/);
  const adGroups = readFileSync(new URL("../app/more/ad-groups.tsx", import.meta.url), "utf8");
  const searchTerms = readFileSync(new URL("../app/more/search-terms.tsx", import.meta.url), "utf8");
  const entityDetail = readFileSync(new URL("../src/components/EntityDetail.tsx", import.meta.url), "utf8");
  const campaignDetail = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  const adGroupDetail = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
  const productAsin = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
  const surfaces = [
    ["ad-groups", adGroups],
    ["search-terms", searchTerms],
    ["EntityDetail", entityDetail],
    ["campaign detail", campaignDetail],
    ["ad-group detail", adGroupDetail],
    ["product asin", productAsin],
  ];
  for (const [name, src] of surfaces) {
    assert.doesNotMatch(src, /label: "Sales"/, `${name} still shows Sales label`);
  }
  assert.match(adGroups, /label: "Impr"/);
  assert.match(adGroups, /label: "Clicks"/);
  assert.match(searchTerms, /label: "Impr"/);
  assert.match(searchTerms, /label: "Clicks"/);
  assert.match(productAsin, /label: "Impr"/);
  assert.match(productAsin, /label: "Clicks"/);
  assert.match(campaignDetail, />Impr</);
  assert.match(campaignDetail, />Clicks</);
  assert.match(searchTerms, /key: "clicks"/);
  assert.match(searchTerms, /key: "impressions"/);
  assert.doesNotMatch(searchTerms, /key: "sales"/);
  assert.match(campaigns, /prefetchCampaignPlacementAdjustments/);
  assert.match(targeting, /prefetchCampaignPlacementAdjustments/);
  assert.match(campaigns, /sameScopeWarmPlaceholder/);
  assert.doesNotMatch(campaigns, /placeholderData:\s*\(previous\)/);
});

test("targeting placement uses honest Nest-first data and visible segment chips", () => {
  assert.match(queries, /Nest campaign aggregation failed; falling back to Supabase/);
  assert.match(queries, /fetchAggregatedCampaigns\(\{/);
  assert.doesNotMatch(queries, /if \(filterUserId && \(await hasNestToken\(\)\)\) \{\n\s+\/\/ Nest rows often omit amazon_profile_id/);
  assert.match(targeting, /normalizePlacementCampaignMetrics/);
  assert.match(targeting, /enrichPlacementRowWithBook/);
  assert.match(targeting, /buildCampaignBookMap/);
  assert.match(targeting, /No linked book/);
  assert.match(targeting, /placeholder=\{hasBook \? "book" : "cube"\}/);
  assert.match(targeting, /total_spend: row\.total_spend \?\? row\.spend/);
  assert.match(targeting, /testID="targeting-segments"/);
  assert.match(targeting, /style=\{styles\.segmentWrap\}/);
  assert.match(targeting, /flexWrap: "wrap"/);
  assert.match(targeting, /concurrency: 8/);
  assert.match(targeting, /formatPlacementAdjustmentValue/);
  assert.doesNotMatch(targeting, /adjustments \? formatPercent\(Number\(adjustments\[field\.key\] \?\? 0\), 0\) : "…"/);
  assert.doesNotMatch(targeting, /Math\.min\(80, rows\.length\)/);
  const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
  assert.match(mutations, /Never invent 0%/);
  assert.doesNotMatch(
    mutations,
    /out\[id\] = api\.placementAdjustments \?\? \{\s*top_of_search: 0/,
  );
  assert.match(targeting, /Patch only the edited field/);
  assert.match(queries, /Paginate product_ads so Nest placement rows/);
  const dashboardApi = readFileSync(new URL("../src/lib/dashboardApi.ts", import.meta.url), "utf8");
  assert.match(dashboardApi, /placement_top_share: null/);
  assert.doesNotMatch(
    dashboardApi,
    /placement_top_share: 0,\s*\n\s*placement_product_share: 0,\s*\n\s*placement_rest_share: 0,\s*\n\s*impressions:/,
  );
});

test("placement book filter waits for book options and prefers filter ASIN covers", () => {
  assert.match(targeting, /Don't apply book filter until options are fetched/);
  assert.match(targeting, /booksQ\.isFetched/);
  assert.match(targeting, /buildCampaignBookMap\(bookOptions, bookAsin\)/);
  assert.match(targeting, /Preferred book first so multi-book campaigns/);
  const bookCover = readFileSync(new URL("../src/components/BookCover.tsx", import.meta.url), "utf8");
  assert.match(bookCover, /Recycled list rows change uri\/asin/);
  assert.match(bookCover, /setFailedPrimary\(false\)/);
});

test("targeting persists advanced ranges and skips heavy KDP enrich on list", () => {
  assert.match(targeting, /skipKdpEnrich:\s*true/);
  assert.match(targeting, /targeting-adv-bid-max/);
  assert.match(targeting, /EMPTY_TARGETING_ADVANCED_FILTERS/);
  const filterMemory = readFileSync(new URL("../src/lib/filterMemory.ts", import.meta.url), "utf8");
  assert.match(filterMemory, /inteliads\.filters\.targeting\.v2/);
  assert.match(queries, /skipKdp/);
});

test("placement book filter matches Nest campaigns via bookCampaignIds (not only book_asin)", () => {
  assert.match(targeting, /Nest aggregated campaigns often omit book_asin/);
  assert.match(targeting, /bookCampaignIds\.has\(String\(row\.id/);
});

test("campaigns clear-sort chip restores ACoS default, not ROAS/top", () => {
  assert.match(campaigns, /const \[sortKey, setSortKey\] = useState<SortKey>\("acos"\)/);
  assert.match(campaigns, /const sortActive = sortKey !== "acos"/);
  assert.match(campaigns, /onPress=\{\(\) => applySort\("acos"\)\}/);
  assert.doesNotMatch(campaigns, /onPress=\{\(\) => applySort\("top"\)\}/);
});

test("bulk and filter UI never imply Amazon-confirmed or fake empty from bid ranges on Placement", () => {
  assert.match(targeting, /Not confirmed on Amazon yet/);
  assert.match(targeting, /advancedFiltersForSegment/);
  assert.match(targeting, /Sort: \$\{effectiveSortLabel\} · range/);
  assert.match(targeting, /No rows match these period filters — not missing data/);
  assert.match(targeting, /Bid min\/max ignored on Placement/);
  assert.match(targeting, /Bid \+\$/);
  assert.match(targeting, /by amount/);
  assert.match(targeting, /selectedCooldownSummary/);
  assert.match(targeting, /\$\{cooldown\.count\} on cooldown/);
  assert.match(targeting, /\$\{cooldownSelected\.count\} cooldown/);
  assert.match(targeting, /List capped at \{TARGETING_LIST_LIMIT\}/);
  assert.match(queries, /Not an Amazon write limit/);
  const mutations = readFileSync(new URL("../src/components/Mutations.tsx", import.meta.url), "utf8");
  assert.match(mutations, /Queues a write to Amazon Ads — not confirmed until Amazon accepts/);
  // BidBudgetEditor prompt/sheet must not claim a confirmed Amazon write.
  assert.match(mutations, /Shown value \$\{formatCurrency\(value, currency\)\}\. Minimum/);
  assert.doesNotMatch(
    mutations,
    /Current \$\{formatCurrency\(value, currency\)\}\. Minimum \$\{formatCurrency\(min, currency\)\}\. This writes to Amazon Ads\./,
  );
});
