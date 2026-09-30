/**
 * Ad group suggestion picker: clustering + controls wired on create/add screens.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { clusterKeywordSuggestionsByPhrase } from "../src/lib/amazonCampaignSuggestions.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adGroupCreate = readFileSync(
  join(root, "app/campaign/ad-group-create.tsx"),
  "utf8",
);
const addTargets = readFileSync(
  join(root, "app/adgroup/add-targets.tsx"),
  "utf8",
);

test("clusterKeywordSuggestionsByPhrase keeps phrase groups adjacent Broad→Phrase→Exact", () => {
  const rows = [
    { keyword: "vagus nerve", matchType: "exact" },
    { keyword: "breath work", matchType: "broad" },
    { keyword: "vagus nerve", matchType: "broad" },
    { keyword: "breath work", matchType: "exact" },
    { keyword: "vagus nerve", matchType: "phrase" },
    { keyword: "breath work", matchType: "phrase" },
  ];
  const clustered = clusterKeywordSuggestionsByPhrase(rows);
  assert.deepEqual(
    clustered.map((r) => `${r.keyword}:${r.matchType}`),
    [
      "vagus nerve:broad",
      "vagus nerve:phrase",
      "vagus nerve:exact",
      "breath work:broad",
      "breath work:phrase",
      "breath work:exact",
    ],
  );
});

test("New Ad Group wires select-all controls + suggested bids default on", () => {
  assert.match(adGroupCreate, /AdGroupSuggestionControls/);
  assert.match(adGroupCreate, /clusterKeywordSuggestionsByPhrase/);
  assert.match(adGroupCreate, /formatKeywordSuggestionCountLabel/);
  assert.match(adGroupCreate, /new-adgroup-amazon-keyword-counts/);
  assert.match(adGroupCreate, /useState\(true\)/);
  assert.match(adGroupCreate, /!asinResolving/);
  assert.match(adGroupCreate, /useSuggestedBids/);
});

test("Add targets wires honest Amazon keyword count label", () => {
  assert.match(addTargets, /formatKeywordSuggestionCountLabel/);
  assert.match(addTargets, /adgroup-amazon-keyword-counts/);
  assert.match(addTargets, /keywordCounts/);
  assert.match(addTargets, /onAmazonReady/);
  assert.match(addTargets, /grokPending/);
  assert.match(addTargets, /SuggestionAiFilterChrome/);
  assert.match(adGroupCreate, /onAmazonReady/);
  assert.match(adGroupCreate, /grokPending/);
  assert.match(adGroupCreate, /SuggestionAiFilterChrome/);
});

test("SuggestionAiFilterChrome handles empty Amazon set honestly", () => {
  const chrome = readFileSync(
    join(root, "src/components/SuggestionAiFilterChrome.tsx"),
    "utf8",
  );
  assert.match(chrome, /No Amazon suggestions/);
  assert.match(chrome, /amazonEmpty/);
  assert.doesNotMatch(chrome, /1\) Amazon raw/);
  assert.doesNotMatch(chrome, /Step 2 — AI search-intent/);
});

test("Add targets wires select-all controls + suggested bids default on", () => {
  assert.match(addTargets, /AdGroupSuggestionControls/);
  assert.match(addTargets, /clusterKeywordSuggestionsByPhrase/);
  assert.match(addTargets, /useState\(true\)/);
  assert.match(addTargets, /!asinResolving/);
});

test("suggestion screens keep one bounded retry owner", () => {
  assert.match(adGroupCreate, /retry:\s*false/);
  assert.match(addTargets, /retry:\s*false/);
  assert.doesNotMatch(adGroupCreate, /retry:\s*2/);
  assert.doesNotMatch(addTargets, /retry:\s*2/);
});

test("ad-group create reads targeting from URL params", () => {
  assert.match(adGroupCreate, /targeting:\s*targetingParam|targetingParam/);
  assert.match(adGroupCreate, /targetingFromRoute/);
  assert.match(adGroupCreate, /v === "keywords" \|\| v === "products"/);
});
