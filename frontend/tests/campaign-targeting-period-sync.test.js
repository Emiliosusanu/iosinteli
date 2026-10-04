import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
const adGroup = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
const visibleTitleHook = readFileSync(
  new URL("../src/lib/useVisibleProductTargetTitles.ts", import.meta.url),
  "utf8",
);

test("campaign and ad-group targeting use the same exact-period RPC as Targets", () => {
  assert.match(queries, /fetchExactCampaignTargetingCatalog/);
  assert.match(queries, /fetchMobileTargetingPage/);
  assert.match(queries, /fetchMobileTargetingCatalogTail/);
  assert.match(queries, /campaignIds: \[campaignId\]/);
  assert.match(queries, /sort: "acos"/);
  assert.match(campaign, /fetchExactCampaignTargetingCatalog/);
  assert.match(adGroup, /fetchExactCampaignTargetingCatalog/);
});

test("campaign previews top 200 while ad-group detail can reveal the full ranked snapshot", () => {
  assert.match(campaign, /CAMPAIGN_TARGET_DISPLAY_LIMIT = 200/);
  assert.match(campaign, /visibleKeywords\.slice\(0, CAMPAIGN_TARGET_DISPLAY_LIMIT\)/);
  assert.match(campaign, /Top \$\{displayedKeywords\.length\} of \$\{visibleKeywords\.length\}/);
  assert.match(adGroup, /AD_GROUP_TARGET_PAGE_SIZE = 200/);
  assert.match(adGroup, /catalog\.keywords\.filter/);
  assert.match(adGroup, /keywords\.slice\(0, keywordLimit\)/);
  assert.match(adGroup, /keywordCount=\{keywords\.length\}/);
  assert.match(adGroup, /Show more keywords/);
});

test("ad-group rows stay scoped to their own Amazon ad group", () => {
  assert.match(adGroup, /String\(row\.ad_group_id \?\? ""\) === id/);
  assert.match(adGroup, /group\?\.campaign_id/);
  assert.match(adGroup, /dateRange\.start/);
  assert.match(adGroup, /dateRange\.end/);
  assert.match(adGroup, /targetStateFilter === "all" \|\| String\(kw\.status \?\? ""\)\.toLowerCase\(\) === "enabled"/);
  assert.match(adGroup, /testID="ad-group-target-state"/);
});

test("campaign and ad-group product titles fill after paint without changing rank", () => {
  assert.match(campaign, /useVisibleProductTargetTitles\(/);
  assert.match(adGroup, /useVisibleProductTargetTitles\(/);
  assert.match(visibleTitleHook, /fillMissingProductTargetTitlesFromRetail/);
  assert.match(visibleTitleHook, /rows\.map\(\(row\)/);
  assert.doesNotMatch(visibleTitleHook, /\.sort\(/);
});
