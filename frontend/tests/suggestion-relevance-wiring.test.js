/**
 * Static wiring: book relevance filter is applied in mutations after normalize,
 * and targeting Paused comment no longer claims "no parent-chain".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mutations = readFileSync(join(root, "src/lib/mutations.ts"), "utf8");
const suggestions = readFileSync(
  join(root, "src/lib/amazonCampaignSuggestions.ts"),
  "utf8",
);
const targeting = readFileSync(
  join(root, "app/(tabs)/targeting.tsx"),
  "utf8",
);
const addTargets = readFileSync(
  join(root, "app/adgroup/add-targets.tsx"),
  "utf8",
);

test("amazonCampaignSuggestions exports filterSuggestionsForBookRelevance scaffolding", () => {
  assert.match(suggestions, /export type BookRelevanceContext/);
  assert.match(suggestions, /export type SuggestionRelevanceMode/);
  assert.match(
    suggestions,
    /export const SUGGESTION_RELEVANCE_DEFAULT_MODE: SuggestionRelevanceMode =\s*"grok"/,
  );
  assert.match(suggestions, /export async function filterSuggestionsForBookRelevance/);
  assert.match(suggestions, /export function safeFilterProductTargets/);
  assert.match(suggestions, /finalizeProductRelevanceKeep|enrichProductTargetsForRelevanceFilter/);
  assert.match(suggestions, /buildProductSuggestionCountStats/);
  assert.match(suggestions, /productHasCorrelatedTheme|CORRELATED_PRODUCT_THEME_KEYS/);
  assert.match(suggestions, /PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO\s*=\s*0\.6/);
  assert.match(suggestions, /KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO\s*=\s*0/);
  assert.match(suggestions, /expandKeptKeywordsWithMatchCompanions|finalizeKeywordRelevanceKeep/);
  assert.match(suggestions, /formatKeywordSuggestionCountLabel/);
  assert.match(suggestions, /buildKeywordSuggestionCountStats/);
  assert.match(mutations, /buildProductSuggestionCountStats|buildKeywordSuggestionCountStats/);
  assert.match(mutations, /amazonKeywordApi/);
  assert.match(mutations, /onAmazonReady/);
  assert.match(
    mutations,
    /Wrong\/stale B0 ASIN|omit asin|recommendationsAvailable/,
  );
  assert.match(mutations, /onAmazonReady/);
  assert.match(mutations, /grokPending:\s*true/);
  assert.match(suggestions, /Ranking…|Ranking\.\.\./);
  assert.match(suggestions, /mode === "identity"/);
  assert.match(suggestions, /mode === "grok"/);
  assert.match(suggestions, /mode === "openai"/);
  assert.match(suggestions, /openaiFilter|grokFilter/);
  assert.match(suggestions, /bookSubtitle|bookAuthor|bookTopic/);
  assert.doesNotMatch(suggestions, /api\.openai\.com|OPENAI_API_KEY|sk-/);
});

test("mutations.ts wires filterSuggestionsForBookRelevance in preview + ad group paths", () => {
  assert.match(mutations, /filterSuggestionsForBookRelevance/);
  assert.match(
    mutations,
    /export async function previewCampaignCreation[\s\S]*?filterSuggestionsForBookRelevance[\s\S]*?return \{[\s\S]*?keywords: filtered\.keywords/,
  );
  assert.match(
    mutations,
    /export async function fetchAdGroupSuggestions[\s\S]*?filterSuggestionsForBookRelevance[\s\S]*?book: preview\.book[\s\S]*?profile: preview\.profile/,
  );
  // Empty Nest book.asin ("") must not block input fallback — use || not ??.
  assert.match(
    mutations,
    /advertisedAsin:\s*\n?\s*String\(preview\.book\?\.asin \?\? ""\)\.trim\(\)\s*\|\|/,
  );
  assert.match(mutations, /String\(input\.advertisedAsin \?\? ""\)\.trim\(\)/);
  assert.match(mutations, /String\(input\.asin \?\? ""\)\.trim\(\)/);
  // AGC / add-targets: prefer creation preview (book + titles) when asin+profile known.
  assert.match(
    mutations,
    /Prefer Create preview when we already know profile \+ ASIN/,
  );
  assert.match(
    mutations,
    /loadCreationPreviewRaw/,
  );
  assert.match(mutations, /countryCode: preview\.profile\?\.countryCode/);
  assert.match(mutations, /currencyCode: preview\.profile\?\.currencyCode/);
  assert.match(mutations, /bookSubtitle: preview\.book\?\.subtitle/);
  assert.match(mutations, /bookAuthor: preview\.book\?\.author/);
  assert.match(mutations, /bookTopic: preview\.book\?\.topic/);
});

test("targeting.tsx Paused comment no longer claims no parent-chain", () => {
  assert.doesNotMatch(targeting, /Paused[\s\S]{0,120}no parent-chain/);
  assert.match(
    targeting,
    /Paused = entity paused AND live parents \(ad group \+ campaign enabled\) — use All to see paused-under-paused/,
  );
});

test("add-targets notes mutations book relevance filter (not Future AI TODO)", () => {
  assert.match(addTargets, /filterSuggestionsForBookRelevance/);
  assert.doesNotMatch(addTargets, /Future AI filters/);
  assert.doesNotMatch(addTargets, /TODO\(AI filters\)/);
  assert.match(addTargets, /SuggestionAiFilterChrome/);
  assert.match(addTargets, /aiFilterPending/);
  assert.match(addTargets, /aiFilterNeedsConfirm|suggestionRelevanceNeedsUserConfirm/);
  assert.match(addTargets, /AI filtering…/);
  assert.match(addTargets, /acceptAmazonUnfiltered|Use Amazon unfiltered/);
});

test("create + ad-group flows block submit while AI filter pending", () => {
  const create = readFileSync(join(root, "app/campaign/create.tsx"), "utf8");
  const adGroupCreate = readFileSync(
    join(root, "app/campaign/ad-group-create.tsx"),
    "utf8",
  );
  assert.match(create, /campaign-create-ai-filter/);
  assert.match(create, /SuggestionAiFilterChrome/);
  assert.match(create, /aiFilterPending/);
  assert.match(create, /aiFilterNeedsConfirm|suggestionRelevanceNeedsUserConfirm/);
  assert.match(create, /setSelectedKeywords\(new Set\(\)\)/);
  assert.match(create, /in-stock, currently published|eligibility check can flake/);
  assert.match(create, /usingFallbackMarketplaces|softLinked/);
  assert.match(create, /!aiFilterPending/);
  assert.match(create, /!aiFilterNeedsConfirm/);
  assert.match(adGroupCreate, /SuggestionAiFilterChrome/);
  assert.match(adGroupCreate, /aiFilterPending/);
  assert.match(adGroupCreate, /AI filtering…/);
  assert.match(adGroupCreate, /acceptAmazonUnfiltered/);
});

test("mutations pass relevanceOutcome into keywordCounts", () => {
  assert.match(mutations, /relevanceOutcome:\s*filtered\.relevanceOutcome/);
  assert.match(mutations, /relevanceError:\s*filtered\.relevanceError/);
  assert.match(mutations, /AI filter done keywords=/);
  assert.match(suggestions, /failed_unfiltered/);
  assert.match(suggestions, /restored_empty/);
  assert.match(suggestions, /suggestionRelevanceNeedsUserConfirm/);
});

test("Create / ad-group / add-targets soft-recover failed_unfiltered without waiting for tap", () => {
  const create = readFileSync(join(root, "app/campaign/create.tsx"), "utf8");
  const adGroupCreate = readFileSync(
    join(root, "app/campaign/ad-group-create.tsx"),
    "utf8",
  );
  assert.match(create, /aiFailedSoftRecoverAttemptRef/);
  assert.match(create, /AI_FAILED_SOFT_RECOVER_DELAYS_MS/);
  assert.match(create, /AI_FAILED_SOFT_RECOVER_MAX/);
  assert.match(create, /acceptAmazonUnfiltered/);
  assert.match(create, /relevanceOutcome !== "failed_unfiltered"/);
  assert.match(create, /grokPending:\s*true/);
  assert.match(adGroupCreate, /aiFailedSoftRecoverAttemptRef/);
  assert.match(adGroupCreate, /AI_FAILED_SOFT_RECOVER_DELAYS_MS/);
  assert.match(addTargets, /aiFailedSoftRecoverAttemptRef/);
  assert.match(addTargets, /AI_FAILED_SOFT_RECOVER_MAX/);
  // Must not gate recover on isFetching (that cancelled timers mid-flight).
  assert.doesNotMatch(
    adGroupCreate,
    /failed_unfiltered[\s\S]{0,200}if \(suggestionsQ\.isFetching\) return/,
  );
});

test("filterSuggestionsForBookRelevance soft-retries transient relevance errors", () => {
  assert.match(suggestions, /isTransientRelevanceError/);
  assert.match(suggestions, /withRelevanceSoftRetry|RELEVANCE_SOFT_RETRY_GAPS_MS/);
  assert.match(suggestions, /AI_FAILED_SOFT_RECOVER_DELAYS_MS/);
  assert.match(suggestions, /soft-retry up to 3/);
});

test("ad-group suggestions fall through when creation preview returns 0 keywords", () => {
  assert.match(
    mutations,
    /Creation preview can return 0 keywords[\s\S]*?\/ad-groups\/suggestions|fall through \+ ASIN-omit/,
  );
  assert.match(
    mutations,
    /usedCreationPreview &&\s*\n?\s*input\.targeting === "keywords"/,
  );
});

test("ad-group suggestions do not repeat the same failed creation preview", () => {
  assert.match(mutations, /let creationPreviewUnavailable = false/);
  assert.match(
    mutations,
    /if \(asin && profileId && thinMeta && !creationPreviewUnavailable\)/,
  );
  assert.match(
    mutations,
    /catch \{[\s\S]{0,100}usedCreationPreview = false;[\s\S]{0,100}creationPreviewUnavailable = true/,
  );
});

test("Nest-first product chunks stay serial unless preferGroq", () => {
  const grok = readFileSync(
    join(root, "src/lib/suggestionRelevanceGrok.ts"),
    "utf8",
  );
  assert.match(grok, /Boolean\(opts\?\.preferGroq\) &&/);
  assert.doesNotMatch(
    grok,
    /Boolean\(opts\?\.preferGroq \|\| keys\.length > 0\)/,
  );
  assert.match(grok, /product chunk \$\{index\} soft-failed after retry|soft-failed after retry/);
});

test("Groq chunk failures rethrow (no silent keep-all → AI kept all)", () => {
  const grok = readFileSync(
    join(root, "src/lib/suggestionRelevanceGrok.ts"),
    "utf8",
  );
  assert.match(grok, /Never silent keep-all|must surface — silent keep-all/);
  assert.match(grok, /Groq product relevance filter unavailable/);
  assert.match(grok, /Groq keyword relevance filter unavailable/);
  assert.match(grok, /planRelevanceChunks|relevanceChunksCoverAll/);
  assert.match(grok, /analyzing ALL \(not UI page size\)/);
  // Old bug: catch returned every index with source "groq".
  assert.doesNotMatch(
    grok,
    /indexes:\s*entry\.slice\.map\(\(_,\s*i\)\s*=>\s*entry\.offset\s*\+\s*i\)/,
  );
});
