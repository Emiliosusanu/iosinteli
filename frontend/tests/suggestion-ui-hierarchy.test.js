/**
 * Create Campaign sticky chrome must stay compact so suggestions stay visible.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const create = readFileSync(join(root, "app/campaign/create.tsx"), "utf8");
const kwRow = readFileSync(
  join(root, "src/components/AmazonKeywordSuggestionRow.tsx"),
  "utf8",
);
const asinRow = readFileSync(
  join(root, "src/components/AmazonProductSuggestionRow.tsx"),
  "utf8",
);
const adGroupCreate = readFileSync(
  join(root, "app/campaign/ad-group-create.tsx"),
  "utf8",
);
const addTargets = readFileSync(
  join(root, "app/adgroup/add-targets.tsx"),
  "utf8",
);

test("Create Campaign keeps Amazon suggestions + paste UI visible (no sticky eat)", () => {
  // Sticky book chrome was eating ScrollView height on phones — keep it off.
  assert.match(create, /showSuggestionStickyChrome = false/);
  assert.match(create, /Amazon suggestions/);
  assert.match(create, /campaign-create-refresh-suggestions/);
  assert.match(create, /testID="campaign-create-your-keywords"/);
  assert.match(create, /matchTypeRow/);
  assert.match(create, /forceFallback/);
  // If sticky branch is re-enabled later, it must stay compact (no full step cards).
  const stickyStart = create.indexOf('testID="campaign-create-sticky-chrome"');
  assert.ok(stickyStart >= 0);
  const stickyEnd = create.indexOf("showSuggestionStickyChrome ? null", stickyStart);
  assert.ok(stickyEnd > stickyStart);
  const stickyBlock = create.slice(stickyStart, stickyEnd);
  assert.doesNotMatch(stickyBlock, /StepHeader step=\{1\}/);
  assert.doesNotMatch(stickyBlock, /StepHeader step=\{2\}/);
  assert.doesNotMatch(stickyBlock, /StepHeader step=\{3\}/);
  assert.match(stickyBlock, /stickyCompactCard/);
});

test("suggestion rows expose clear select mark + title hierarchy", () => {
  assert.match(kwRow, /SelectMark/);
  assert.match(kwRow, /fontWeight:\s*"700"/);
  assert.match(asinRow, /SelectMark/);
  assert.match(asinRow, /fontWeight:\s*"700"/);
});

test("ad group flows keep suggestion controls + enrichment", () => {
  assert.match(adGroupCreate, /AdGroupSuggestionControls/);
  assert.match(addTargets, /AdGroupSuggestionControls/);
  assert.match(adGroupCreate, /SuggestionAiFilterChrome|Amazon raw/);
  assert.match(addTargets, /SuggestionAiFilterChrome|Amazon raw|AI search-intent|AI relevance/);
});

test("Create Campaign defaults to Amazon suggested bids like ad-group flows", () => {
  assert.match(
    create,
    /const \[useSuggestedBids, setUseSuggestedBids\] = useState\(true\)/,
  );
});

test("Create Campaign clusters keywords and exposes select-all", () => {
  assert.match(create, /clusterKeywordSuggestionsByPhrase/);
  assert.match(create, /keywordSuggestionRows/);
  assert.match(create, /Select all ·/);
  assert.match(create, /Deselect all ·/);
  assert.match(create, /toggleSelectAllSuggestions/);
  // ASIN match-type fast bid is gated on productMatchKeys, not reasons.
  assert.match(
    create,
    /targeting === "products" && productMatchKeys\.length[\s\S]*?productMatchKeys\.map\(\(key\) => \([\s\S]*?Set/,
  );
});
