import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(
  new URL("../app/campaign/create.tsx", import.meta.url),
  "utf8",
);
const stock = readFileSync(new URL("../src/lib/campaignCreationStock.ts", import.meta.url), "utf8");
const mutations = readFileSync(
  new URL("../src/lib/mutations.ts", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../app/campaign/[id].tsx", import.meta.url),
  "utf8",
);
const suggestionRow = readFileSync(
  new URL("../src/components/AmazonProductSuggestionRow.tsx", import.meta.url),
  "utf8",
);
const suggestionsLib = readFileSync(
  new URL("../src/lib/amazonCampaignSuggestions.ts", import.meta.url),
  "utf8",
);

test("campaign creation uses server-verified KDP and Amazon Ads identity", () => {
  assert.match(mutations + stock + readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8"), /book-candidates/);
  assert.match(mutations + stock, /marketplaces/);
  assert.match(mutations + stock, /normalizeCampaignCreationMarketplaces|normalizeCampaignCreationPreview/);
  assert.match(mutations + stock, /creation\/preview|creation\/marketplaces|book-candidates/);
  assert.match(screen, /marketplacesFromBookProfiles/);
  assert.doesNotMatch(screen, /name match/i);
});

test("book-first flow confirms Ads stock and live-gates soft product ads", () => {
  assert.match(screen, /title="Book"/);
  assert.match(screen, /title="Marketplace"/);
  assert.match(screen, /Out of stock/);
  assert.match(screen, /paperbackEditionStockCaption/);
  assert.match(screen, /marketplaceFallbackHint/);
  assert.match(screen, /amazonAdsStockConfirmed/);
  assert.match(screen, /availabilityCheckUnconfirmed/);
  assert.match(screen, /Retry availability check/);
  assert.match(screen, /adsStockSoftListed/);
  // Soft live existing_product_ad must not paint as a failed availability check
  // that blocks Products suggestions (B0FW468FBB).
  assert.doesNotMatch(screen, /Availability check incomplete/);
  assert.match(screen, /searchCreatePaperbacks/);
  assert.match(screen, /createPaperbackSearchEmptyMessage/);
  assert.match(screen, /liveStockByAsin/);
  assert.match(screen, /item\.workKey \|\| item\.asin/);
  assert.match(screen, /Paperback · \{item\.asin\}/);
  assert.match(screen, /searchEmptyMessage/);
  assert.match(screen, /printAsinFromWorkKey/);
  assert.match(screen, /nestBuyable/);
  assert.doesNotMatch(screen, /Checking availability for/);
  assert.doesNotMatch(screen, /stock-verified/i);
  assert.doesNotMatch(screen, /soft-listed/i);
  assert.doesNotMatch(screen, /Kindle DIGITAL/);
  assert.doesNotMatch(screen, /Amazon Ads catalog verified/);
  assert.doesNotMatch(screen, /Stock not verified yet/);
  assert.match(screen, /Show \$\{Math\.min\(BOOK_PAGE_SIZE/);
});

test("suggestions are Amazon-owned and missing suggested bids fall back explicitly", () => {
  assert.match(screen, /\$\{selectedTargetCount\} selected/);
  assert.match(screen, /resolveSuggestionBid/);
  assert.match(screen, /recommendationBidMajorUnits/);
  assert.match(screen, /AmazonKeywordSuggestionRow/);
  assert.match(screen, /AmazonProductSuggestionRow/);
  assert.match(screen, /selectKeywordsByMatchType/);
  assert.match(screen, /sortProductSuggestionsByTitleSimilarity/);
  assert.doesNotMatch(suggestionRow, /suggestionStockCaption/);
  assert.doesNotMatch(suggestionRow, /Stock unknown/);
  assert.match(suggestionsLib, /fetchAmazonRetailTitles/);
  assert.match(suggestionsLib, /titleFromAmazonRetailHtml/);
  assert.doesNotMatch(screen, /Paste ASINs below anytime/);
  assert.doesNotMatch(screen, /Same Ads profile and book ASIN/);
  assert.match(screen, /parseCustomAsins/);
  assert.doesNotMatch(screen, /did not invent targets/);
  assert.doesNotMatch(screen, /rate-limited \/ 503/);
  assert.match(mutations + screen, /products/);
});

test("suggestion meta enrich ignores stale async after book or marketplace change", () => {
  assert.match(screen, /suggestionMetaGenRef/);
  assert.match(screen, /const gen = \+\+suggestionMetaGenRef\.current/);
  assert.match(screen, /if \(gen !== suggestionMetaGenRef\.current\) return/);
  assert.match(screen, /fetchAsinDisplayMeta/);
  assert.match(screen, /fetchAmazonRetailTitles/);
  assert.match(screen, /skipRetail:\s*true/);
  assert.match(screen, /mergeAsinDisplayMeta/);
  assert.match(screen, /applyMetaPatch/);
  // Titles must not wait on the removed activity filter (Promise.all regression).
  assert.doesNotMatch(
    screen,
    /Promise\.all\(\[\s*fetchAsinDisplayMeta[\s\S]*?fetchSuggestionActivityFlags/,
  );
  // selectBook / marketplace reset / drop-effect must bump gen and clear title
  // metadata. Amazon suggestions are no longer silently filtered by activity.
  assert.match(
    screen,
    /function selectBook[\s\S]*?suggestionMetaGenRef\.current \+= 1[\s\S]*?setSuggestionMetaByAsin\(\{\}\)/,
  );
  assert.match(
    screen,
    /function resetAfterMarketplace[\s\S]*?suggestionMetaGenRef\.current \+= 1[\s\S]*?setSuggestionMetaByAsin\(\{\}\)/,
  );
  assert.match(
    screen,
    /if \(selectedMarketplace\) return;[\s\S]*?suggestionMetaGenRef\.current \+= 1[\s\S]*?setSuggestionMetaByAsin\(\{\}\)/,
  );
  assert.doesNotMatch(screen, /setSuggestionActivityByAsin/);
  assert.match(screen, /function selectBook[\s\S]*?setLiveStockByAsin\(\{\}\)/);
  assert.match(screen, /function resetAfterMarketplace[\s\S]*?setLiveStockByAsin/);
  // Deep-link / QA createProfileId must re-bind (live empty or still in flight)
  // and never wipe the deep-linked ASIN+profile pair.
  assert.match(
    screen,
    /if \(prefProfileId\) \{\s*setProfileId\(prefProfileId\);\s*setAdsProfileId\(prefProfileId\);/,
  );
  assert.match(
    screen,
    /QA \/ deep-link: bind prefProfileId[\s\S]*?fromLocal[\s\S]*?resetAfterMarketplace/,
  );
  assert.match(
    screen,
    /deepLinkHold[\s\S]*?prefAsin[\s\S]*?return;/,
  );
  assert.match(
    screen,
    /deepLinkAllow[\s\S]*?isPaperbackFormatCandidate/,
  );
  assert.match(
    screen,
    /function resetAfterMarketplace[\s\S]*?prefTargetingPrefetchRef\.current = false/,
  );
  assert.match(
    screen,
    /if \(prefProfileId\) return;[\s\S]*?displayMarketplaces\.length !== 1/,
  );
  assert.match(
    screen,
    /returnedMarketplaces\.some\(\(marketplace\) => \{\s*const adsId/,
  );
  assert.match(
    screen,
    /adsProfileId \|\| profileId \|\| \(prefProfileId && book\)/,
  );
});

test("format chips keep exclusive Kindle selection while advertising PRINT", () => {
  assert.match(screen, /selectedFormatAsin/);
  assert.match(screen, /setSelectedFormatAsin\(asin\)/);
  assert.match(screen, /advertisedAsinForCreateFormat/);
  assert.match(screen, /campaign-create-format/);
  assert.match(screen, /forceFallback=\{prefillFormats\.length > 2\}/);
  // Chip search uses format ASIN (not silent PRINT) so Kindle/Paperback filters work.
  assert.match(screen, /setBookSearch\(asin\)/);
  assert.match(screen, /DIGITAL=\$\{chip\.asin\}/);
  assert.doesNotMatch(screen, /Always highlight PRINT for SP create/);
});

test("products loading keeps paste-ready shell without over-explaining copy", () => {
  assert.match(screen, /Loading…/);
  assert.doesNotMatch(screen, /Paste ASINs below anytime/);
  assert.doesNotMatch(screen, /you do not have to wait/);
  assert.match(screen, /loading=\{false\}/);
  assert.match(screen, /recommendationsAvailable: false/);
});

test("targeting segmented control uses pressable fallback so labels are not clipped", () => {
  assert.match(screen, /testID="campaign-create-targeting"/);
  assert.match(
    screen,
    /testID="campaign-create-targeting"[\s\S]{0,180}forceFallback/,
  );
  // Your keywords Broad/Phrase/Exact — forceFallback Pressable chips at 44pt.
  assert.match(screen, /Your keywords/);
  assert.match(screen, /testID="campaign-create-your-keywords"/);
  assert.match(screen, /styles\.matchTypeRow/);
  assert.match(
    screen,
    /forceFallback[\s\S]{0,220}key: "broad"/,
  );
  assert.match(screen, /uniqueKeywordPhraseCount/);
  assert.match(screen, /Down only[\s\S]{0,120}forceFallback|forceFallback[\s\S]{0,120}Down only/);
});

test("products targeting loads suggestions without waiting on a second Verify tap", () => {
  assert.match(screen, /previewM\.mutate\(type\)/);
  assert.match(screen, /nextTargeting \?\? targeting/);
  assert.match(screen, /B0… one per line/);
});

test("all Amazon suggestions remain accessible without rendering an unbounded list", () => {
  assert.match(screen, /SUGGESTION_PAGE_SIZE = 50/);
  assert.match(screen, /suggestionRows\.slice\(0, visibleSuggestionCount\)/);
  assert.match(screen, /clusterKeywordSuggestionsByPhrase/);
  assert.match(screen, /keywordSuggestionRows/);
  assert.match(screen, /Select all ·/);
  assert.match(screen, /toggleSelectAllSuggestions/);
  assert.match(screen, /Show \$\{Math\.min\(SUGGESTION_PAGE_SIZE/);
  assert.match(screen, /new Set\(\(result\.keywords \?\? \[\]\)\.map\(\(_, index\) => index\)\)/);
  assert.match(screen, /new Set\(\(result\.productTargets \?\? \[\]\)\.map\(\(_, index\) => index\)\)/);
  assert.doesNotMatch(screen, /100 target limit/);
});

test("manual keywords distinguish Amazon suggestions from explicit pasted keywords", () => {
  assert.match(screen, /Paste keywords, one per line/);
  assert.match(screen, /source: "suggested"/);
  assert.match(screen, /source: "custom"/);
  assert.match(screen, /parseCustomKeywords/);
});

test("manual product targets mark pasted ASINs as custom for Nest create", () => {
  assert.match(screen, /source: "suggested" as const/);
  assert.match(screen, /source: "custom" as const/);
  assert.match(screen, /parseCustomAsins/);
  assert.match(screen, /Couldn't load suggestions/);
  assert.doesNotMatch(screen, /softProductsUnavailable/);
});

test("automatic duplicates are blocked and create defaults paused", () => {
  assert.match(screen, /Automatic campaign already active/);
  assert.match(screen, /duplicateBlocked/);
  assert.match(screen, /useState\(false\)/);
  assert.match(screen, /Starts paused/);
});

test("book picker collapses after selection with Change control", () => {
  assert.match(screen, /bookPickerExpanded/);
  assert.match(screen, /setBookPickerExpanded\(false\)/);
  assert.match(screen, /testID="campaign-create-book-collapsed"/);
  assert.match(screen, /testID="campaign-create-book-change"/);
  assert.match(screen, /accessibilityLabel="Change book"/);
});

test("marketplace-scoped active campaigns use profile+ASIN product_ads fetch", () => {
  assert.match(screen, /fetchActiveCampaignsForBookProfile/);
  assert.match(screen, /testID="campaign-create-existing-campaigns"/);
  assert.match(screen, /Active on this marketplace/);
  assert.doesNotMatch(screen, /Same Ads profile and book ASIN/);
  assert.match(stock, /Manual · Keywords|Products \/ ASINs/);
  assert.match(
    readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8"),
    /fetchActiveCampaignsForBookProfile/,
  );
  assert.match(
    readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8"),
    /\.from\("product_ads"\)[\s\S]*?\.eq\("amazon_profile_id", profileId\)/,
  );
  assert.match(
    stock,
    /classifyCreationCampaignTargeting/,
  );
});

test("Create keeps suggestions visible: sticky chrome off, paste above Amazon list", () => {
  assert.match(screen, /showSuggestionStickyChrome = false/);
  assert.match(screen, /testID="campaign-create-your-keywords"/);
  assert.match(screen, /testID="campaign-create-your-asins"/);
  assert.match(screen, /styles\.matchTypeRow/);
  assert.match(screen, /overflow:\s*"visible"/);
  assert.match(screen, /minHeight:\s*44/);
  assert.match(screen, /height:\s*44/);
  // Your keywords must appear before the Amazon chip list in source order.
  const yourKw = screen.indexOf('testID="campaign-create-your-keywords"');
  const listStart = screen.indexOf("keywordSuggestionRows.length ?", yourKw);
  assert.ok(yourKw >= 0 && listStart > yourKw);
  assert.match(screen, /testID="campaign-create-refresh-suggestions"/);
});

test("Create campaign keeps SubScreen chrome always visible", () => {
  assert.match(screen, /<SubScreen title="Create campaign" chromeVisible>/);
  assert.doesNotMatch(screen, /chromeVisible=\{topChromeVisible\}/);
  assert.doesNotMatch(screen, /onCreateScroll/);
  assert.match(
    readFileSync(new URL("../src/components/SubScreen.tsx", import.meta.url), "utf8"),
    /chromeVisible/,
  );
});

test("Create campaign soft-fails rate limits with retry + paste path", () => {
  assert.match(screen, /suggestionsError/);
  assert.match(screen, /status === 429/);
  assert.match(screen, /Couldn't load suggestions/);
  assert.match(screen, /RetryState/);
  assert.match(
    readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8"),
    /export async function previewCampaignCreation[\s\S]*?status === 429/,
  );
});

test("campaign detail keeps ad-group state writable with rollback", () => {
  assert.match(detail, /EntityStateSwitch|updateCampaignState|ad.group|Ad Group/);
  assert.match(detail, /revertOptimisticEntityState|optimistic/);
});

test("catalog errors distinguish rollout, authorization, and service failure", () => {
  assert.match(screen, /status === 401/);
  assert.match(screen, /status === 403/);
  assert.match(screen, /status === 404/);
  assert.match(screen, /status >= 500/);
  assert.doesNotMatch(
    screen,
    /Reconnect this marketplace if the problem continues/,
  );
});

test("marketplace list is book-scoped and never dumps every Ads profile", () => {
  assert.match(stock, /normalizeCampaignCreationPreview/);
  assert.match(screen, /marketplacesFromBookProfiles/);
  assert.match(screen, /matchLocalProfileForCreationMarketplace/);
  assert.match(screen, /adsProfileId/);
  assert.match(screen, /resolveCreationProfileId/);
  assert.match(screen, /Profile not on this account/);
  assert.match(screen, /parseCustomAsins/);
  assert.match(screen, /Your product ASINs/);
  assert.match(screen, /marketplacesQ\.data\.asin === book\.asin/);
  assert.match(screen, /title="Marketplace"/);
  assert.match(screen, /isPaperbackCreateCandidate/);
  assert.match(screen, /Kindle edition/);
  assert.match(screen, /stickyBar/);
  assert.match(screen, /Load suggestions/);
  assert.match(screen, /prefTargetingPrefetchRef/);
  assert.match(
    screen,
    /Auto-fetch Amazon suggestions \(\+ AI filter\)|initial Keywords default/,
  );
  assert.match(screen, /prefTargeting \?\? "keywords"/);
  assert.doesNotMatch(screen, /selectedProfiles\.filter/);
  assert.doesNotMatch(screen, /fallbackMarketplacesFromProfiles/);
  assert.doesNotMatch(screen, /Availability changed/);
  assert.doesNotMatch(
    screen,
    /profile\.marketplace_id === marketplace\.marketplaceId/,
  );
  assert.doesNotMatch(screen, /Verify & load Amazon suggestions/);
  assert.doesNotMatch(screen, /Pick the Ads profile for this paperback/);
  assert.match(screen, /suggestionMetaGenRef/);
  assert.match(screen, /useFocusEffect/);
});
