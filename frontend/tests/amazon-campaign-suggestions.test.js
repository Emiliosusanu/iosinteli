import assert from "node:assert/strict";
import test from "node:test";
import {
  amazonRetailHostForCountry,
  decodeHtmlEntities,
  displaySuggestionTitle,
  expandProductSuggestionsWithMatchTypes,
  filterSuggestionsForBookRelevance,
  offerExpandedCompanionsForExactOnly,
  offerKeywordMatchCompanions,
  uniqueKeywordPhraseCount,
  safeFilterProductTargets,
  withRelevanceSafetyRestore,
  productHasCorrelatedTheme,
  classifyTheme,
  PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO,
  KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO,
  expandKeptKeywordsWithMatchCompanions,
  buildKeywordSuggestionCountStats,
  formatKeywordSuggestionCountLabel,
  formatSuggestionBidDisplay,
  humanizeAmazonTheme,
  isAsinAsTitle,
  productTitleNeedsEnrichment,
  isIsbn10Asin,
  isStaleDeadSuggestionTarget,
  mergeAsinDisplayMeta,
  normalizeKeywordMatchType,
  normalizeProductMatchType,
  normalizeSuggestionStockStatus,
  parseProductMatchTypeOrNull,
  publicationYearFromTitle,
  recommendationBidMajorUnits,
  resolveSuggestionBid,
  selectedEligibleSuggestionIndexes,
  sortProductSuggestionsByTitleSimilarity,
  SUGGESTION_RELEVANCE_DEFAULT_MODE,
  suggestionRelevanceNeedsUserConfirm,
  suggestionAgeMonths,
  suggestionStockCaption,
  titleFromAmazonRetailHtml,
  titleSimilarityScore,
  tokenizeTitle,
} from "../src/lib/amazonCampaignSuggestions.ts";
import { paperbackEditionStockCaption } from "../src/lib/campaignCreationStock.ts";

test("amazonRetailHostForCountry maps marketplace country to exact retail host", () => {
  assert.equal(amazonRetailHostForCountry("US"), "www.amazon.com");
  assert.equal(amazonRetailHostForCountry("CA"), "www.amazon.ca");
  assert.equal(amazonRetailHostForCountry("GB"), "www.amazon.co.uk");
  assert.equal(amazonRetailHostForCountry("UK"), "www.amazon.co.uk");
  assert.equal(amazonRetailHostForCountry("DE"), "www.amazon.de");
  assert.equal(amazonRetailHostForCountry(null), "www.amazon.com");
});

test("failed or empty AI filtering requires explicit user choice", () => {
  assert.equal(suggestionRelevanceNeedsUserConfirm({ grokPending: true }), false);
  assert.equal(suggestionRelevanceNeedsUserConfirm({ relevanceOutcome: "filtered" }), false);
  assert.equal(suggestionRelevanceNeedsUserConfirm({ relevanceOutcome: "failed_unfiltered" }), true);
  assert.equal(suggestionRelevanceNeedsUserConfirm({ relevanceOutcome: "restored_empty" }), true);
  assert.equal(suggestionRelevanceNeedsUserConfirm({ relevanceOutcome: "user_accepted_unfiltered" }), false);
});

test("selected suggestion indexes keep only current eligible rows in display order", () => {
  const selected = new Set([0, 2, 4, 99]);
  assert.deepEqual(
    selectedEligibleSuggestionIndexes(selected, [4, 2, 2, 1]),
    [4, 2],
  );
  assert.deepEqual(selectedEligibleSuggestionIndexes(new Set(), [0, 1]), []);
});

test("tokenizeTitle drops stop words and punctuation", () => {
  assert.deepEqual(tokenizeTitle("The Greece Travel Guide: Edition Two"), [
    "greece",
    "travel",
    "guide",
    "two",
  ]);
});

test("titleSimilarityScore ranks overlapping titles higher", () => {
  const selected = "Croatia Travel Guide 2025";
  const close = titleSimilarityScore("Croatia Travel Guide Pocket", selected);
  const far = titleSimilarityScore("Baking Sourdough Bread", selected);
  assert.ok(close > far);
  assert.ok(close > 0.3);
  assert.equal(far, 0);
});

test("sortProductSuggestionsByTitleSimilarity puts similar titles first", () => {
  const selected = "Iceland Road Trip Guide";
  const rows = [
    {
      asin: "B0FAR00001",
      themes: ["Top clicks targets"],
      suggestedBid: null,
    },
    {
      asin: "B0SIM00002",
      themes: ["Similar items (frequently viewed together)"],
      suggestedBid: null,
    },
    {
      asin: "B0CONV0003",
      themes: ["Top converting targets"],
      suggestedBid: 0.4,
    },
  ];
  const titles = new Map([
    ["B0FAR00001", "Sourdough Starter Kit"],
    ["B0SIM00002", "Iceland Road Trip Planner"],
    ["B0CONV0003", "Reykjavik Walking Tour"],
  ]);
  const sorted = sortProductSuggestionsByTitleSimilarity(
    rows,
    selected,
    titles,
  );
  assert.equal(sorted[0].asin, "B0SIM00002");
  assert.ok(sorted[0].similarity > sorted[1].similarity);
});

test("humanizeAmazonTheme explains frequently viewed together", () => {
  const h = humanizeAmazonTheme(
    "Similar items (frequently viewed together)",
  );
  assert.equal(h.reasonKey, "frequently_viewed");
  assert.match(h.label, /viewed together/i);
  assert.match(String(h.subtitle), /Shoppers often view/i);
});

test("classifyTheme maps similar readership / substitutes / complements", () => {
  assert.equal(classifyTheme("Books with similar readership"), "similar_readership");
  assert.equal(classifyTheme("Complementary books"), "complements");
  assert.equal(classifyTheme("Substitute products"), "substitutes");
  assert.ok(productHasCorrelatedTheme(["Books with similar readership"]));
  assert.ok(productHasCorrelatedTheme(["Complements"]));
  assert.ok(!productHasCorrelatedTheme(["Random Amazon junk"]));
  assert.ok(!productHasCorrelatedTheme([]));
  assert.ok(PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO >= 0.6);
});

test("formatSuggestionBidDisplay shows numeric default", () => {
  assert.equal(
    formatSuggestionBidDisplay({
      mode: "default",
      customBid: null,
      suggestedBid: null,
      defaultBid: 0.75,
      currency: "USD",
    }),
    "Default $0.75",
  );
  assert.equal(
    formatSuggestionBidDisplay({
      mode: "default",
      customBid: null,
      suggestedBid: 1.2,
      defaultBid: 0.75,
      currency: "USD",
    }),
    "Amazon suggested $1.20",
  );
});

test("recommendationBidMajorUnits converts Amazon cents", () => {
  assert.equal(recommendationBidMajorUnits(111), 1.11);
  assert.equal(recommendationBidMajorUnits(97), 0.97);
  assert.equal(recommendationBidMajorUnits(0.75), 0.75);
  assert.equal(recommendationBidMajorUnits(1.11), 1.11);
  assert.equal(recommendationBidMajorUnits(1), 1);
});

test("resolveSuggestionBid prefers custom then suggested then default", () => {
  assert.equal(
    resolveSuggestionBid({
      mode: "custom",
      customBid: 0.55,
      suggestedBid: 1.1,
      defaultBid: 0.75,
      useSuggestedBids: true,
    }),
    0.55,
  );
  assert.equal(
    resolveSuggestionBid({
      mode: "default",
      customBid: null,
      suggestedBid: 1.1,
      defaultBid: 0.75,
      useSuggestedBids: true,
    }),
    1.1,
  );
  assert.equal(
    resolveSuggestionBid({
      mode: "default",
      customBid: null,
      suggestedBid: null,
      defaultBid: 0.75,
      useSuggestedBids: true,
    }),
    0.75,
  );
});

test("displaySuggestionTitle never uses ASIN/ISBN as the title", () => {
  assert.equal(displaySuggestionTitle(null, "B0GS27WQBZ"), "Title unavailable");
  assert.equal(
    displaySuggestionTitle("B0GS27WQBZ", "B0GS27WQBZ"),
    "Title unavailable",
  );
  assert.equal(
    displaySuggestionTitle("1640499717", "1640499717"),
    "Title unavailable",
  );
  assert.equal(
    displaySuggestionTitle("Ireland Travel Guide 2026", "B0GS27WQBZ"),
    "Ireland Travel Guide 2026",
  );
  assert.equal(isAsinAsTitle("B0GS27WQBZ", "B0GS27WQBZ"), true);
  assert.equal(isIsbn10Asin("1640499717"), true);
  assert.equal(isIsbn10Asin("B0GS27WQBZ"), false);
});

test("productTitleNeedsEnrichment treats Title unavailable as missing", () => {
  assert.equal(productTitleNeedsEnrichment(null, "B0CWMB1JC6"), true);
  assert.equal(productTitleNeedsEnrichment("", "B0CWMB1JC6"), true);
  assert.equal(productTitleNeedsEnrichment("B0CWMB1JC6", "B0CWMB1JC6"), true);
  assert.equal(
    productTitleNeedsEnrichment("Title unavailable", "B0CWMB1JC6"),
    true,
  );
  assert.equal(
    productTitleNeedsEnrichment("DK New England", "B0CWMB1JC6"),
    false,
  );
});

test("product suggestions preserve Amazon entities without synthetic twins", () => {
  const rows = expandProductSuggestionsWithMatchTypes(
    [
      { asin: "b0target001", matchType: null, themes: ["Similar"] },
      { asin: "B0TARGET002", matchType: "asinExpandedFrom", themes: ["Complements"] },
      { asin: "B0TARGET002", matchType: "asinExpandedFrom", themes: ["Complements"] },
    ],
    { matchTypeWasExplicit: (row) => Boolean(row.matchType) },
  );
  assert.deepEqual(
    rows.map((row) => `${row.asin}:${row.matchType}`),
    ["B0TARGET001:exact", "B0TARGET002:expanded"],
  );
});

test("create UX offers Expanded companions when Amazon only returned Exact", () => {
  const onlyExact = offerExpandedCompanionsForExactOnly([
    { asin: "B0ONLYEXACT", matchType: "exact", themes: ["Similar"] },
  ]);
  assert.deepEqual(
    onlyExact.map((row) => `${row.asin}:${row.matchType}`),
    ["B0ONLYEXACT:exact", "B0ONLYEXACT:expanded"],
  );
  const alreadyHasExpanded = offerExpandedCompanionsForExactOnly([
    { asin: "B0BOTH", matchType: "exact", themes: ["Similar"] },
    { asin: "B0BOTH", matchType: "expanded", themes: ["Similar"] },
  ]);
  assert.deepEqual(
    alreadyHasExpanded.map((row) => `${row.asin}:${row.matchType}`),
    ["B0BOTH:exact", "B0BOTH:expanded"],
  );
});

test("create UX offers Broad/Phrase/Exact companions for thin CA keyword phrases", () => {
  const rows = offerKeywordMatchCompanions([
    { keyword: "alaska cruise", matchType: "exact", suggestedBid: 0.75 },
    { keyword: "alaska travel guide", matchType: "broad", suggestedBid: 0.6 },
  ]);
  assert.equal(uniqueKeywordPhraseCount(rows), 2);
  assert.equal(rows.length, 6);
  assert.ok(rows.some((row) => row.keyword === "alaska cruise" && row.matchType === "broad"));
  assert.ok(rows.some((row) => row.keyword === "alaska cruise" && row.matchType === "phrase"));
  assert.ok(
    rows.some((row) => row.keyword === "alaska travel guide" && row.matchType === "exact"),
  );
});

test("keyword companion expansion removes duplicate keyword-match identities", () => {
  const rows = offerKeywordMatchCompanions([
    { keyword: "rome guide", matchType: "broad", suggestedBid: 0.4 },
    { keyword: " Rome Guide ", matchType: "broad", suggestedBid: 0.5 },
  ]);
  assert.deepEqual(
    rows.map((row) => `${row.keyword.trim().toLowerCase()}:${row.matchType}`),
    ["rome guide:broad", "rome guide:phrase", "rome guide:exact"],
  );
});

test("keyword safety restore only undoes empty AI keeps", () => {
  assert.equal(KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO, 0);
  const input = Array.from({ length: 10 }, (_, i) => ({
    keyword: `alaska tip ${i}`,
    matchType: "broad",
  }));
  const kept = input.slice(0, 3);
  // Non-empty curated keep sticks (AI search-intent shortlist).
  assert.deepEqual(
    withRelevanceSafetyRestore(input, kept, { preferAmazonOnThin: true }),
    kept,
  );
  // Empty keep restores full Amazon set.
  assert.deepEqual(
    withRelevanceSafetyRestore(input, [], { preferAmazonOnThin: true }),
    input,
  );
  // Without preferAmazonOnThin, default 30% floor still applies (products path).
  assert.deepEqual(withRelevanceSafetyRestore(input, kept), kept);
});

test("rich US keyword lists allow aggressive AI thinning", () => {
  const input = Array.from({ length: 156 }, (_, i) => ({
    keyword: `new england phrase ${i}`,
    matchType: "broad",
  }));
  const curated = input.slice(0, 40);
  assert.deepEqual(
    withRelevanceSafetyRestore(input, curated, { preferAmazonOnThin: true }),
    curated,
  );
});

test("expandKeptKeywordsWithMatchCompanions restores Broad/Phrase/Exact siblings", () => {
  const input = offerKeywordMatchCompanions([
    { keyword: "maine travel guide", matchType: "broad" },
    { keyword: "harry potter", matchType: "broad" },
  ]);
  assert.equal(input.length, 6);
  const kept = input.filter(
    (row) =>
      row.keyword === "maine travel guide" && row.matchType === "broad",
  );
  const expanded = expandKeptKeywordsWithMatchCompanions(input, kept);
  assert.equal(expanded.length, 3);
  assert.ok(expanded.every((row) => row.keyword === "maine travel guide"));
  assert.deepEqual(
    expanded.map((row) => row.matchType).sort(),
    ["broad", "exact", "phrase"],
  );
});

test("New England US: companions + Grok over-filter safety-restores Amazon list", async () => {
  // Console: Suggested → Broad only ≈156; Broad+Phrase+Exact ≈468.
  const seedPhrases = [
    "harry potter",
    "advent calendar",
    "maine travel guide",
    "red sox",
    "boston travel guide 2026",
    "route 66 travel guide",
    "new england travel",
    "cape cod travel guide",
    "vermont travel guide",
    "new hampshire hiking",
    "rhode island travel",
    "connecticut road trip",
    "boston red sox",
    "acadia national park",
    "portland maine guide",
  ];
  while (seedPhrases.length < 156) {
    seedPhrases.push(`new england travel tip ${seedPhrases.length}`);
  }
  const amazonBroad = seedPhrases.map((keyword) => ({
    keyword,
    matchType: "broad",
    suggestedBid: 0.75,
  }));
  const withCompanions = offerKeywordMatchCompanions(amazonBroad);
  assert.equal(uniqueKeywordPhraseCount(withCompanions), 156);
  assert.equal(withCompanions.length, 468);

  // AI returns a curated high-intent subset — must stick (not restore full Amazon dump).
  const curatedPhrases = [
    "maine travel guide",
    "boston travel guide 2026",
    "new england travel",
    "cape cod travel guide",
    "vermont travel guide",
  ];
  const curated = withCompanions.filter((row) =>
    curatedPhrases.includes(row.keyword),
  );
  const out = await filterSuggestionsForBookRelevance(
    { keywords: withCompanions, productTargets: [] },
    {
      bookTitle: "New England Travel Guide 2026",
      bookTopic: "Travel / New England",
      advertisedAsin: "B0NEWENGLAND",
      countryCode: "US",
      currencyCode: "USD",
    },
    {
      mode: "grok",
      grokFilter: async () => ({
        keywords: curated.filter((row) => row.matchType === "broad"),
        productTargets: [],
      }),
    },
  );
  assert.equal(out.keywords.length, curatedPhrases.length * 3);
  assert.equal(uniqueKeywordPhraseCount(out.keywords), curatedPhrases.length);
  assert.ok(
    out.keywords.some(
      (row) =>
        row.keyword === "maine travel guide" && row.matchType === "phrase",
    ),
  );
  assert.ok(!out.keywords.some((row) => row.keyword === "harry potter"));
});

test("New England US: light off-topic drop keeps companions for kept phrases", async () => {
  const related = [
    "maine travel guide",
    "boston travel guide 2026",
    "red sox",
    "new england travel",
    "cape cod travel guide",
  ];
  const noise = ["harry potter", "advent calendar"];
  const amazonBroad = [...related, ...noise].map((keyword) => ({
    keyword,
    matchType: "broad",
  }));
  while (amazonBroad.length < 20) {
    amazonBroad.push({
      keyword: `new england guide ${amazonBroad.length}`,
      matchType: "broad",
    });
  }
  const withCompanions = offerKeywordMatchCompanions(amazonBroad);
  const keepPhrases = new Set(
    withCompanions
      .map((row) => row.keyword)
      .filter((k) => !noise.includes(k)),
  );
  const grokKept = withCompanions.filter(
    (row) =>
      keepPhrases.has(row.keyword) && row.matchType === "broad",
  );
  // Only Broad of related phrases — companion expand brings Phrase/Exact back.
  const out = await filterSuggestionsForBookRelevance(
    { keywords: withCompanions, productTargets: [] },
    {
      bookTitle: "New England Travel Guide 2026",
      advertisedAsin: "B0NEWENGLAND",
      countryCode: "US",
    },
    {
      mode: "grok",
      grokFilter: async () => ({
        keywords: grokKept,
        productTargets: [],
      }),
    },
  );
  // After companion expand: all match types for kept phrases; noise dropped.
  for (const phrase of related) {
    assert.equal(
      out.keywords.filter((row) => row.keyword === phrase).length,
      3,
      `expected Broad+Phrase+Exact for ${phrase}`,
    );
  }
  assert.ok(!out.keywords.some((row) => row.keyword === "harry potter"));
  assert.ok(!out.keywords.some((row) => row.keyword === "advent calendar"));
  assert.equal(out.keywords.length, keepPhrases.size * 3);
});

test("buildKeywordSuggestionCountStats + label: New England 156→468 fixture (example only)", () => {
  // Fixture sizes from one New England US cert run — not production constants.
  const apiRows = Array.from({ length: 156 }, (_, i) => ({
    keyword: `new england kw ${i}`,
    matchType: "broad",
  }));
  const amazonRows = offerKeywordMatchCompanions(apiRows);
  assert.equal(amazonRows.length, 468);
  const kept = amazonRows.slice(0, 312);
  const stats = buildKeywordSuggestionCountStats({
    amazonApiRowCount: apiRows.length,
    amazonApiPhraseCount: uniqueKeywordPhraseCount(apiRows),
    amazonRows,
    keptRows: kept,
  });
  assert.equal(stats.amazonApiPhraseCount, 156);
  assert.equal(stats.amazonApiRowCount, 156);
  assert.equal(stats.amazonRowCount, 468);
  assert.equal(stats.amazonPhraseCount, 156);
  assert.equal(stats.keptRowCount, 312);
  assert.equal(stats.grokFiltered, true);
  const label = formatKeywordSuggestionCountLabel(stats);
  assert.match(label, /Amazon · 156 · 468/);
  assert.match(label, /Kept 312/);
  const fullKeep = buildKeywordSuggestionCountStats({
    amazonApiRowCount: 156,
    amazonApiPhraseCount: 156,
    amazonRows,
    keptRows: amazonRows,
  });
  assert.equal(fullKeep.grokFiltered, false);
  assert.equal(
    formatKeywordSuggestionCountLabel(fullKeep),
    "Amazon · 156 · 468 · AI kept all",
  );
  const pending = { ...fullKeep, grokPending: true, relevanceOutcome: "pending" };
  assert.match(
    formatKeywordSuggestionCountLabel(pending),
    /Amazon · 156 · 468 · Ranking/,
  );
  assert.doesNotMatch(
    formatKeywordSuggestionCountLabel(pending),
    /Kept/,
  );
  const failed = {
    ...fullKeep,
    relevanceOutcome: "failed_unfiltered",
    relevanceError: "Grok down",
  };
  assert.match(
    formatKeywordSuggestionCountLabel(failed),
    /Amazon suggestions/,
  );
  assert.doesNotMatch(formatKeywordSuggestionCountLabel(failed), /AI kept all/);
  const restored = {
    ...fullKeep,
    relevanceOutcome: "restored_empty",
  };
  assert.match(
    formatKeywordSuggestionCountLabel(restored),
    /Amazon restored \(AI empty\)/,
  );
  assert.doesNotMatch(
    formatKeywordSuggestionCountLabel(restored),
    /AI kept all|Kept/,
  );
});

test("empty Amazon set does not claim AI kept all", () => {
  const empty = buildKeywordSuggestionCountStats({
    amazonApiRowCount: 0,
    amazonApiPhraseCount: 0,
    amazonRows: [],
    keptRows: [],
    relevanceOutcome: "kept_all",
  });
  assert.equal(formatKeywordSuggestionCountLabel(empty), "Amazon · 0");
  assert.doesNotMatch(formatKeywordSuggestionCountLabel(empty), /AI kept all/);
});

test("buildKeywordSuggestionCountStats + label: live counts for any list size", () => {
  const phraseN = 7;
  const apiRows = Array.from({ length: phraseN }, (_, i) => ({
    keyword: `other book kw ${i}`,
    matchType: "broad",
  }));
  const amazonRows = offerKeywordMatchCompanions(apiRows);
  assert.equal(amazonRows.length, phraseN * 3);
  const kept = amazonRows.slice(0, 12);
  const stats = buildKeywordSuggestionCountStats({
    amazonApiRowCount: apiRows.length,
    amazonApiPhraseCount: uniqueKeywordPhraseCount(apiRows),
    amazonRows,
    keptRows: kept,
  });
  assert.equal(stats.amazonPhraseCount, phraseN);
  assert.equal(stats.amazonRowCount, 21);
  assert.equal(stats.keptRowCount, 12);
  assert.equal(stats.grokFiltered, true);
  assert.equal(
    formatKeywordSuggestionCountLabel(stats),
    "Amazon · 7 · 21 · Kept 12",
  );
  assert.equal(
    formatKeywordSuggestionCountLabel({
      ...stats,
      keptRowCount: 21,
      keptPhraseCount: phraseN,
      grokFiltered: false,
      relevanceOutcome: "kept_all",
    }),
    "Amazon · 7 · 21 · AI kept all",
  );
});

test("grok filter path keeps thin CA curated shortlist", async () => {
  const keywords = Array.from({ length: 10 }, (_, i) => ({
    keyword: `alaska cruise ${i}`,
    matchType: "broad",
  }));
  const suggestions = { keywords, productTargets: [] };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Alaska Travel Guide 2027",
      advertisedAsin: "180797376X",
      countryCode: "CA",
      currencyCode: "CAD",
    },
    {
      mode: "grok",
      grokFilter: async () => ({
        keywords: keywords.slice(0, 4),
        productTargets: [],
      }),
    },
  );
  assert.equal(out.keywords.length, 4);
});

test("titleFromAmazonRetailHtml extracts competitor titles from product pages", () => {
  assert.equal(
    titleFromAmazonRetailHtml(
      "<html>" +
        "x".repeat(9000) +
        "<head><title>Split, Croatia Travel Guide 2025/26: Hvar &amp; Brač : Amazon.com: Books</title></head></html>",
      "B0FKZWBY12",
    ),
    "Split, Croatia Travel Guide 2025/26: Hvar & Brač",
  );
  assert.equal(
    titleFromAmazonRetailHtml(
      "<html>" +
        "x".repeat(9000) +
        '<span id="productTitle"> Croatia Travel Guide 2024 </span></html>',
      "B0H3WHQ6TP",
    ),
    "Croatia Travel Guide 2024",
  );
  assert.equal(
    titleFromAmazonRetailHtml(
      "<html>" + "x".repeat(9000) + "<title>B0FKZWBY12</title></html>",
      "B0FKZWBY12",
    ),
    null,
  );
  assert.equal(
    titleFromAmazonRetailHtml("<html><title>Amazon.com</title></html>", "B0H7NLT5G1"),
    null,
  );
  assert.equal(
    titleFromAmazonRetailHtml(
      "<html>" +
        "x".repeat(9000) +
        "<title>Guide: Bevill, Leon V.: 9798296254559</title></html>",
      "B0FKZWBY12",
    ),
    "Guide",
  );
  assert.equal(decodeHtmlEntities("A &amp; B"), "A & B");
});

test("titleSimilarityScore boosts shared place/topic tokens", () => {
  const selected = "Croatia Travel Guide 2026: A Clear and Practical Resource";
  const croatia = titleSimilarityScore(
    "Split, Croatia Travel Guide 2025/26",
    selected,
  );
  const lonely = titleSimilarityScore("Lonely Planet Croatia", selected);
  const unrelated = titleSimilarityScore("Baking Sourdough Bread", selected);
  assert.ok(croatia > unrelated);
  assert.ok(lonely > unrelated);
  assert.ok(croatia >= lonely);
});

test("sort prefers titled related rows over Title unavailable", () => {
  const selected = "Croatia Travel Guide 2026";
  const rows = [
    {
      asin: "B0NOTITLE1",
      themes: ["Similar items (frequently viewed together)"],
      suggestedBid: null,
      title: null,
    },
    {
      asin: "B0CROATIA1",
      themes: ["Top clicks targets"],
      suggestedBid: null,
      title: "Croatia Travel Guide Pocket Edition",
    },
  ];
  const sorted = sortProductSuggestionsByTitleSimilarity(rows, selected);
  assert.equal(sorted[0].asin, "B0CROATIA1");
  assert.ok(sorted[0].similarity > sorted[1].similarity);
});

test("suggestion stock caption + normalize", () => {
  assert.equal(normalizeSuggestionStockStatus("IN_STOCK"), "in_stock");
  assert.equal(normalizeSuggestionStockStatus("ELIGIBLE"), "in_stock");
  assert.equal(normalizeSuggestionStockStatus("OUT_OF_STOCK"), "out_of_stock");
  assert.equal(normalizeSuggestionStockStatus(null), "unknown");
  assert.equal(suggestionStockCaption("in_stock"), "In stock");
  assert.equal(suggestionStockCaption("out_of_stock"), "Out of stock");
  assert.equal(suggestionStockCaption("unknown"), "Stock unknown");
});

test("stale dead target filter: >6 months + no royalties + no ads", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  assert.equal(
    isStaleDeadSuggestionTarget({
      publishedAt: "2024-01-01",
      title: "Old Guide 2024",
      hasRoyaltyActivity: false,
      hasAdsActivity: false,
      now,
    }),
    true,
  );
  assert.equal(
    isStaleDeadSuggestionTarget({
      publishedAt: "2024-01-01",
      title: "Old Guide 2024",
      hasRoyaltyActivity: true,
      hasAdsActivity: false,
      now,
    }),
    false,
  );
  assert.equal(
    isStaleDeadSuggestionTarget({
      publishedAt: "2024-01-01",
      title: "Old Guide 2024",
      hasRoyaltyActivity: false,
      hasAdsActivity: true,
      now,
    }),
    false,
  );
  assert.equal(
    isStaleDeadSuggestionTarget({
      title: "New England Travel Guide 2026",
      hasRoyaltyActivity: false,
      hasAdsActivity: false,
      now,
    }),
    false,
  );
  assert.equal(
    isStaleDeadSuggestionTarget({
      title: "Mystery Book",
      hasRoyaltyActivity: false,
      hasAdsActivity: false,
      now,
    }),
    false,
  );
  assert.equal(publicationYearFromTitle("Guide 2024"), 2024);
  assert.ok(suggestionAgeMonths({ title: "Guide 2024", now }) > 6);
});

test("paperbackEditionStockCaption shows Nest stock before select", () => {
  assert.equal(
    paperbackEditionStockCaption({
      book: { availabilityEvidence: "in_stock", stockStatus: "IN_STOCK" },
      selected: false,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
    }),
    "In stock",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: { availabilityEvidence: "existing_product_ad" },
      selected: false,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
    }),
    "Linked · not reconfirmed",
  );
});

test("filterSuggestionsForBookRelevance identity returns unchanged", async () => {
  assert.equal(SUGGESTION_RELEVANCE_DEFAULT_MODE, "grok");
  const suggestions = {
    keywords: [
      { keyword: "croatia travel", matchType: "broad" },
      { keyword: "sourdough starter", matchType: "exact" },
    ],
    productTargets: [
      { asin: "B0CROATIA1", title: "Croatia Guide", themes: [] },
      { asin: "B0BREAD001", title: "Sourdough Book", themes: [] },
    ],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    { bookTitle: "Croatia Travel Guide", advertisedAsin: "B0CROATIA1" },
    { mode: "identity" },
  );
  assert.equal(out.keywords.length, 2);
  assert.equal(out.productTargets.length, 2);
  assert.equal(out.relevanceOutcome, "identity");
  assert.deepEqual(out.keywords, suggestions.keywords);
  assert.deepEqual(out.productTargets, suggestions.productTargets);
});

test("safeFilterProductTargets keeps untitled + advertised; drops off-topic titled", () => {
  const products = [
    { asin: "B0CROATIA1", title: "Croatia Travel Guide Pocket" },
    { asin: "B0UNTITLED1", title: null },
    { asin: "B0ASIN0001", title: "B0ASIN0001" },
    { asin: "B0BREAD001", title: "Sourdough Starter Handbook" },
    { asin: "B0ADVERT001", title: "Totally Unrelated Cookbook" },
  ];
  const kept = safeFilterProductTargets(products, {
    bookTitle: "Croatia Travel Guide 2025",
    advertisedAsin: "B0ADVERT001",
  });
  const asins = kept.map((p) => p.asin);
  assert.ok(asins.includes("B0CROATIA1"));
  assert.ok(asins.includes("B0UNTITLED1"));
  assert.ok(asins.includes("B0ASIN0001"));
  assert.ok(asins.includes("B0ADVERT001"));
  // 4/5 kept ≥ 0.6 floor — off-topic bread dropped.
  assert.ok(!asins.includes("B0BREAD001"));
});

test("safeFilterProductTargets keeps correlated themes despite low title similarity", () => {
  const products = [
    {
      asin: "B0NICHE001",
      title: "Hiking the Dalmatian Coast",
      themes: ["Books with similar readership"],
    },
    {
      asin: "B0COMP0001",
      title: "Phrase Book for Split",
      themes: ["Complementary products"],
    },
    {
      asin: "B0SUBS0001",
      title: "Adriatic Islands Yearbook",
      themes: ["Substitutes"],
    },
    {
      asin: "B0BREAD001",
      title: "Sourdough Starter Handbook",
      themes: [],
    },
    {
      asin: "B0CROATIA1",
      title: "Croatia Travel Guide Pocket",
      themes: [],
    },
    {
      asin: "B0UNTITLED1",
      title: null,
      themes: [],
    },
    {
      asin: "B0COOKIE01",
      title: "Cookie Baking Bible",
      themes: ["Other"],
    },
    {
      asin: "B0PASTA001",
      title: "Homemade Pasta Masterclass",
      themes: [],
    },
    {
      asin: "B0CAKE0001",
      title: "Birthday Cake Designs",
      themes: [],
    },
    {
      asin: "B0PIZZA001",
      title: "Neapolitan Pizza Oven Guide",
      themes: [],
    },
  ];
  const kept = safeFilterProductTargets(products, {
    bookTitle: "Croatia Travel Guide 2025",
    advertisedAsin: "B0CROATIA1",
  });
  const asins = kept.map((p) => p.asin);
  assert.ok(asins.includes("B0NICHE001"), "similar readership kept");
  assert.ok(asins.includes("B0COMP0001"), "complements kept");
  assert.ok(asins.includes("B0SUBS0001"), "substitutes kept");
  assert.ok(asins.includes("B0CROATIA1"));
  assert.ok(asins.includes("B0UNTITLED1"));
  assert.ok(!asins.includes("B0BREAD001"), "off-topic without keep-theme dropped");
  assert.ok(!asins.includes("B0COOKIE01"));
});

test("filterSuggestionsForBookRelevance heuristic keeps related rows", async () => {
  const suggestions = {
    keywords: [
      { keyword: "croatia travel guide", matchType: "broad" },
      { keyword: "croatia day trips", matchType: "phrase" },
      { keyword: "sourdough starter kit", matchType: "exact" },
    ],
    productTargets: [
      {
        asin: "B0CROATIA1",
        title: "Croatia Travel Guide Pocket",
        themes: ["Top clicks"],
      },
      {
        asin: "B0UNTITLED1",
        title: null,
        themes: ["Other"],
      },
      {
        asin: "B0READSHIP",
        title: "Dalmatian Village Walks",
        themes: ["Books with similar readership"],
      },
      {
        asin: "B0COMP0001",
        title: "Split City Phrase Book",
        themes: ["Complements"],
      },
      {
        asin: "B0SUBS0001",
        title: "Adriatic Islands Yearbook",
        themes: ["Substitutes"],
      },
      {
        asin: "B0VIEW0001",
        title: "Zagreb Coffee Walks",
        themes: ["Similar items (frequently viewed together)"],
      },
      {
        asin: "B0ADVERT001",
        title: "Totally Unrelated Cookbook",
        themes: [],
      },
      {
        asin: "B0BREAD001",
        title: "Sourdough Starter Handbook",
        themes: [],
      },
      {
        asin: "B0COOKIE01",
        title: "Cookie Baking Bible",
        themes: [],
      },
      {
        asin: "B0PASTA001",
        title: "Homemade Pasta Masterclass",
        themes: [],
      },
    ],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Croatia Travel Guide 2025",
      advertisedAsin: "B0ADVERT001",
      countryCode: "US",
      currencyCode: "USD",
    },
    { mode: "heuristic" },
  );
  // Keywords pass through (Amazon marketplace already scopes the list).
  assert.equal(out.keywords.length, 3);
  assert.ok(out.keywords.some((k) => /sourdough/i.test(k.keyword)));
  const asins = out.productTargets.map((p) => p.asin);
  assert.ok(asins.includes("B0CROATIA1"));
  assert.ok(asins.includes("B0UNTITLED1"));
  assert.ok(asins.includes("B0ADVERT001"));
  assert.ok(asins.includes("B0READSHIP"), "similar readership kept");
  assert.ok(asins.includes("B0COMP0001"), "complements kept");
  assert.ok(asins.includes("B0SUBS0001"), "substitutes kept");
  assert.ok(asins.includes("B0VIEW0001"), "frequently viewed kept");
  // 7 keepers / 10 ≥ 0.6 floor → off-topic without keep-theme dropped.
  assert.ok(!asins.includes("B0BREAD001"), "off-topic without keep-theme dropped");
  assert.ok(!asins.includes("B0COOKIE01"));
  assert.ok(!asins.includes("B0PASTA001"));
});

test("filterSuggestionsForBookRelevance safety restores over-filtered lists", async () => {
  const keywords = Array.from({ length: 10 }, (_, i) => ({
    keyword: `unrelated baking tip ${i}`,
    matchType: "broad",
  }));
  const productTargets = Array.from({ length: 10 }, (_, i) => ({
    asin: `B0UNREL${String(i).padStart(3, "0")}`,
    title: `Baking Sourdough Volume ${i}`,
    themes: [],
  }));
  const suggestions = { keywords, productTargets };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Croatia Travel Guide",
      advertisedAsin: "B0CROATIA99",
    },
    { mode: "heuristic" },
  );
  // Keywords always kept; products restore when over-filtered.
  assert.equal(out.keywords.length, 10);
  assert.equal(out.productTargets.length, 10);
  assert.deepEqual(out.keywords, keywords);
  assert.deepEqual(out.productTargets, productTargets);
});

test("filterSuggestionsForBookRelevance openai falls back without proxy", async () => {
  // Need enough rows that dropping 1 off-topic still clears the 0.6 product floor.
  const productTargets = [
    { asin: "B0ICE00001", title: "Iceland Road Trip Planner", themes: [] },
    { asin: "B0COOKIE01", title: "Cookie Baking Bible", themes: [] },
    { asin: "B0ICE00002", title: "Iceland Ring Road Atlas", themes: [] },
    { asin: "B0ICE00003", title: "Reykjavik Day Trips", themes: [] },
    { asin: "B0ICE00004", title: "Iceland Hiking Trails", themes: [] },
    { asin: "B0UNTITLED1", title: null, themes: [] },
    { asin: "B0ICE00005", title: "Iceland Hot Springs Guide", themes: [] },
    { asin: "B0ICE00006", title: "Iceland Photography Tips", themes: [] },
    { asin: "B0ICE00007", title: "Iceland Camping Map", themes: [] },
    { asin: "B0ICE00008", title: "Iceland Wildlife Watch", themes: [] },
  ];
  const suggestions = {
    keywords: [
      { keyword: "iceland road trip", matchType: "broad" },
      { keyword: "cookie recipe book", matchType: "exact" },
    ],
    productTargets,
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    { bookTitle: "Iceland Road Trip Guide", advertisedAsin: "B0ICE00001" },
    { mode: "openai" },
  );
  // Fallback = heuristic: keywords intact, products filtered.
  assert.equal(out.keywords.length, 2);
  const asins = out.productTargets.map((p) => p.asin);
  assert.ok(asins.includes("B0ICE00001"));
  assert.ok(!asins.includes("B0COOKIE01"));
  assert.ok(asins.length >= 6);
});

test("thin CA-sized keyword lists are not emptied by heuristic", async () => {
  // Canada SP often returns <8 keyword rows — below the old safety floor.
  const suggestions = {
    keywords: [
      { keyword: "nova scotia travel", matchType: "broad" },
      { keyword: "halifax guide", matchType: "phrase" },
      { keyword: "cape breton road trip", matchType: "exact" },
    ],
    productTargets: [
      { asin: "B0NS000001", title: "Nova Scotia Travel Guide", themes: [] },
      { asin: "B0BREADCA1", title: "Montreal Baker", themes: [] },
    ],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Nova Scotia Travel Guide 2026",
      advertisedAsin: "B0NS000001",
      countryCode: "CA",
      currencyCode: "CAD",
    },
    { mode: "heuristic" },
  );
  assert.equal(out.keywords.length, 3);
  // 0.6 product floor: keeping 1/2 restores the full Amazon list.
  assert.equal(out.productTargets.length, 2);
});

test("thin CA product lists restore when heuristic would empty them", async () => {
  const suggestions = {
    keywords: [{ keyword: "halifax walks", matchType: "BROAD_MATCH" }],
    productTargets: [
      { asin: "B0CAAAA001", title: "Quebec City Foodie Map", themes: [] },
      { asin: "B0CAAAA002", title: "Toronto Transit Tips", themes: [] },
      { asin: "B0CAAAA003", title: "Banff Day Hikes", themes: [] },
      { asin: "B0CAAAA004", title: "Vancouver Rain Guide", themes: [] },
      { asin: "B0CAAAA005", title: "Ottawa Museum Trail", themes: [] },
    ],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Alaska Travel Guide 2027",
      advertisedAsin: "B0ALASKA01",
      countryCode: "CA",
      currencyCode: "CAD",
    },
    { mode: "heuristic" },
  );
  // Keywords pass through even with Amazon enum-style match codes upstream;
  // filterSuggestions keeps them as-is (normalize happens in Nest preview).
  assert.equal(out.keywords.length, 1);
  // All five CA products would score < floor vs Alaska — restore full list.
  assert.equal(out.productTargets.length, 5);
});

test("normalizeKeywordMatchType keeps Amazon enum / missing codes", () => {
  assert.equal(normalizeKeywordMatchType("BROAD_MATCH"), "broad");
  assert.equal(normalizeKeywordMatchType("phrase_match"), "phrase");
  assert.equal(normalizeKeywordMatchType(""), "exact");
  assert.equal(normalizeKeywordMatchType("KEYWORD_EXACT_MATCH"), "exact");
  assert.equal(normalizeKeywordMatchType("weird_ca_code"), "exact");
});

test("products stay when book title is missing but advertised ASIN is set", async () => {
  const suggestions = {
    keywords: [{ keyword: "keep", matchType: "exact" }],
    productTargets: [
      { asin: "B0OTHER001", title: "Some Competitor Book", themes: [] },
      { asin: "B0ADVERT01", title: "My Book", themes: [] },
    ],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    { bookTitle: null, advertisedAsin: "B0ADVERT01" },
    { mode: "heuristic" },
  );
  assert.equal(out.productTargets.length, 2);
});

test("filterSuggestionsForBookRelevance openai uses provided proxy filter", async () => {
  const suggestions = {
    keywords: [{ keyword: "keep me", matchType: "broad" }],
    productTargets: [{ asin: "B0KEEP0001", title: "Keep", themes: [] }],
  };
  let called = false;
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    { bookTitle: "Anything", advertisedAsin: "B0KEEP0001" },
    {
      mode: "openai",
      openaiFilter: async (rows) => {
        called = true;
        return {
          keywords: rows.keywords.filter((k) => k.keyword === "keep me"),
          productTargets: rows.productTargets,
        };
      },
    },
  );
  assert.equal(called, true);
  assert.equal(out.keywords.length, 1);
  assert.equal(out.productTargets.length, 1);
});

test("filterSuggestionsForBookRelevance identity when no book context", async () => {
  const suggestions = {
    keywords: [{ keyword: "anything", matchType: "broad" }],
    productTargets: [{ asin: "B0ANYTHING", title: "Anything", themes: [] }],
  };
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    { bookTitle: null, advertisedAsin: null },
    { mode: "heuristic" },
  );
  assert.equal(out.relevanceOutcome, "heuristic");
  assert.deepEqual(out.keywords, suggestions.keywords);
  assert.deepEqual(out.productTargets, suggestions.productTargets);
});
