import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyGrokRelevanceSelection,
  buildGrokRelevanceMessages,
  buildGrokProductRelevanceMessages,
  collapseKeywordsToUniquePhrasesForGrok,
  expandGrokPhraseIndexesToOriginal,
  parseGrokRelevanceJson,
  relevancePromptNeedsChunking,
  GROK_RELEVANCE_KEYWORD_CHUNK,
} from "../src/lib/suggestionRelevanceGrokLogic.ts";
import {
  GROK_RELEVANCE_SYSTEM_PROMPT,
  GROK_RELEVANCE_USER_PROMPT_TEMPLATE,
  fillGrokRelevanceUserPrompt,
} from "../src/lib/suggestionRelevancePrompt.ts";
import { filterSuggestionsForBookRelevance } from "../src/lib/amazonCampaignSuggestions.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("editable Grok prompt file exposes system + user template placeholders", () => {
  assert.match(GROK_RELEVANCE_SYSTEM_PROMPT, /Sponsored Products/i);
  assert.match(GROK_RELEVANCE_SYSTEM_PROMPT, /STEP 2|search.intent|high-intent/i);
  assert.match(GROK_RELEVANCE_SYSTEM_PROMPT, /productIndexes|on the client/i);
  assert.match(GROK_RELEVANCE_SYSTEM_PROMPT, /Prefer precision over recall/);
  assert.doesNotMatch(GROK_RELEVANCE_SYSTEM_PROMPT, /non vedo|filtro con AI|al massimo 200/i);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /\{\{BOOK_TITLE\}\}/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /\{\{BOOK_SUBTITLE\}\}/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /\{\{BOOK_AUTHOR\}\}/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /\{\{BOOK_TOPIC\}\}/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /\{\{KEYWORD_CANDIDATES\}\}/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /keywordIndexes/);
  assert.match(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, /STEP 2|separate product LLM pass|filtered separately/i);
  const promptSrc = readFileSync(
    join(root, "src/lib/suggestionRelevancePrompt.ts"),
    "utf8",
  );
  assert.match(promptSrc, /EDIT THIS FILE/);
  assert.match(promptSrc, /GROK_PRODUCT_RELEVANCE_SYSTEM_PROMPT|separate AI pass/);
});

test("fillGrokRelevanceUserPrompt substitutes book metadata", () => {
  const filled = fillGrokRelevanceUserPrompt(
    "T={{BOOK_TITLE}} S={{BOOK_SUBTITLE}} A={{BOOK_AUTHOR}}",
    {
      BOOK_TITLE: "Alaska 2027",
      BOOK_SUBTITLE: "Road trips",
      BOOK_AUTHOR: "Emil",
    },
  );
  assert.equal(filled, "T=Alaska 2027 S=Road trips A=Emil");
});

test("product Groq prompt treats Title unavailable as untitled (themes still usable)", () => {
  const { user } = buildGrokProductRelevanceMessages(
    [
      {
        asin: "B0CWMB1JC6",
        title: "Title unavailable",
        themes: ["Similar items (frequently viewed together)"],
      },
      {
        asin: "0241618606",
        title: "DK New England",
        themes: ["Similar items"],
      },
    ],
    {
      bookTitle: "DK Eyewitness New England",
      advertisedAsin: "1807973751",
      countryCode: "CA",
      currencyCode: "CAD",
    },
  );
  assert.match(user, /B0CWMB1JC6 \| \(title missing\)/);
  assert.doesNotMatch(user, /B0CWMB1JC6 \| Title unavailable/);
  assert.match(user, /0241618606 \| DK New England/);
  assert.match(user, /frequently viewed together/);
});

test("parseGrokRelevanceJson keeps only valid indexes and strips fences", () => {
  const raw = `\`\`\`json
{"keywordIndexes":[2,0,99,-1],"productIndexes":[1],"reason":"on topic"}
\`\`\``;
  const parsed = parseGrokRelevanceJson(raw, {
    keywordCount: 3,
    productCount: 2,
  });
  assert.deepEqual(parsed.keywordIndexes, [2, 0]);
  assert.deepEqual(parsed.productIndexes, [1]);
  assert.equal(parsed.reason, "on topic");
});

test("applyGrokRelevanceSelection never invents rows; empty keyword keep stays empty", () => {
  const suggestions = {
    keywords: [
      { keyword: "alaska travel", matchType: "broad" },
      { keyword: "bread machine", matchType: "exact" },
      { keyword: "anchorage guide", matchType: "phrase" },
    ],
    productTargets: [
      { asin: "B0AAA11111", title: "Alaska Roads" },
      { asin: "B0BBB22222", title: "Cookie Book" },
    ],
  };
  const ranked = applyGrokRelevanceSelection(suggestions, {
    keywordIndexes: [2, 0],
    productIndexes: [0],
  });
  assert.deepEqual(
    ranked.keywords.map((k) => k.keyword),
    ["anchorage guide", "alaska travel"],
  );
  assert.deepEqual(
    ranked.productTargets.map((p) => p.asin),
    ["B0AAA11111"],
  );

  const emptyKeep = applyGrokRelevanceSelection(suggestions, {
    keywordIndexes: [],
    productIndexes: [],
  });
  // Empty keep stays empty — finalizeKeyword/ProductRelevanceKeep decide restore.
  assert.equal(emptyKeep.keywords.length, 0);
  assert.equal(emptyKeep.productTargets.length, 0);
});

test("buildGrokRelevanceMessages includes author topic subtitle", () => {
  const { system, user } = buildGrokRelevanceMessages(
    {
      keywords: [{ keyword: "denali hike", matchType: "exact", suggestedBid: 0.8 }],
      productTargets: [
        {
          asin: "B0DENALI01",
          title: "Denali Day Hikes",
          matchType: "exact",
          themes: ["Similar"],
        },
      ],
    },
    {
      bookTitle: "Alaska Travel Guide 2027",
      bookSubtitle: "National parks",
      bookAuthor: "Jane Doe",
      bookTopic: "Travel / Alaska",
      advertisedAsin: "B0ALASKA27",
      countryCode: "CA",
      currencyCode: "CAD",
    },
  );
  assert.match(system, /Never invent|ONLY select from/i);
  assert.match(system, /search.intent|high-intent|precision over recall/i);
  assert.match(user, /Alaska Travel Guide 2027/);
  assert.match(user, /National parks/);
  assert.match(user, /Jane Doe/);
  assert.match(user, /Travel \/ Alaska/);
  assert.match(user, /0 \| denali hike/);
  // Product ASINs must NOT be embedded in the keyword LLM prompt (separate product pass).
  assert.doesNotMatch(user, /B0DENALI01/);
  assert.match(user, /separate product LLM pass/i);
  assert.match(user, /CA/);
});

test("collapse keywords to unique phrases then expand restores all companions", () => {
  const keywords = [
    { keyword: "alaska travel", matchType: "broad" },
    { keyword: "alaska travel", matchType: "phrase" },
    { keyword: "alaska travel", matchType: "exact" },
    { keyword: "denali hike", matchType: "exact" },
    { keyword: "cookie book", matchType: "broad" },
  ];
  const { phrases, phraseToOriginalIndexes } =
    collapseKeywordsToUniquePhrasesForGrok(keywords);
  assert.equal(phrases.length, 3);
  assert.equal(phrases[0].matchType, "exact"); // prefer exact rep
  assert.deepEqual(phraseToOriginalIndexes[0], [0, 1, 2]);
  const expanded = expandGrokPhraseIndexesToOriginal([0, 1], phraseToOriginalIndexes);
  assert.deepEqual(expanded, [0, 1, 2, 3]);
});

test("products-only runs Grok product filter (not heuristic skip)", async () => {
  const suggestions = {
    keywords: [],
    productTargets: [
      { asin: "B0ICE00001", title: "Iceland Road Trip", themes: [] },
      { asin: "B0COOKIE01", title: "Cookie Bible", themes: [] },
    ],
  };
  let grokCalled = false;
  const out = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Iceland Road Trip Guide",
      advertisedAsin: "B0ICE00001",
    },
    {
      mode: "grok",
      grokFilter: async (rows) => {
        grokCalled = true;
        return applyGrokRelevanceSelection(rows, {
          keywordIndexes: [],
          productIndexes: [0],
        });
      },
    },
  );
  assert.equal(grokCalled, true);
  assert.equal(out.relevanceOutcome, "filtered");
  assert.equal(out.keywords.length, 0);
  assert.deepEqual(
    out.productTargets.map((p) => p.asin),
    ["B0ICE00001"],
  );
});

test("grok mode uses injected filter and falls back to heuristic on throw", async () => {
  const keywords = Array.from({ length: 12 }, (_, i) => ({
    keyword: i === 0 ? "iceland roads" : `filler kw ${i}`,
    matchType: "broad",
  }));
  const suggestions = {
    keywords,
    productTargets: [
      { asin: "B0ICE00001", title: "Iceland Road Trip", themes: [] },
      { asin: "B0COOKIE01", title: "Cookie Bible", themes: [] },
      { asin: "B0ICE00002", title: "Reykjavik Walks", themes: [] },
      { asin: "B0CAKE0001", title: "Cake Mix", themes: [] },
      { asin: "B0ICE00003", title: "Iceland Hiking", themes: [] },
    ],
  };
  const viaGrok = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Iceland Road Trip Guide",
      bookAuthor: "A. Author",
      advertisedAsin: "B0ICE00001",
    },
    {
      mode: "grok",
      grokFilter: async (rows) =>
        applyGrokRelevanceSelection(rows, {
          // Curated shortlist — AI may drop fillers.
          keywordIndexes: [0, 1, 2],
          productIndexes: [0, 2, 4],
        }),
    },
  );
  assert.deepEqual(
    viaGrok.keywords.map((k) => k.keyword),
    ["iceland roads", "filler kw 1", "filler kw 2"],
  );
  // Products honor Grok productIndexes (AI curated keep).
  assert.deepEqual(
    viaGrok.productTargets.map((p) => p.asin),
    ["B0ICE00001", "B0ICE00002", "B0ICE00003"],
  );

  const fellBack = await filterSuggestionsForBookRelevance(
    suggestions,
    {
      bookTitle: "Iceland Road Trip Guide",
      advertisedAsin: "B0ICE00001",
    },
    {
      mode: "grok",
      grokFilter: async () => {
        throw new Error("boom");
      },
    },
  );
  // Heuristic: keywords pass-through labeled failed_unfiltered (not AI curated).
  assert.equal(fellBack.keywords.length, 12);
  assert.equal(fellBack.relevanceOutcome, "failed_unfiltered");
  assert.match(String(fellBack.relevanceError ?? ""), /boom/);
  assert.equal(fellBack.productTargets.length, 5);
  assert.ok(fellBack.productTargets.some((p) => p.asin === "B0ICE00001"));
});

test("grok mode keeps curated shortlist (does not restore full Amazon dump)", async () => {
  const keywords = Array.from({ length: 12 }, (_, i) => ({
    keyword: i === 0 ? "iceland roads" : `filler kw ${i}`,
    matchType: "broad",
  }));
  const out = await filterSuggestionsForBookRelevance(
    { keywords, productTargets: [] },
    {
      bookTitle: "Iceland Road Trip Guide",
      advertisedAsin: "B0ICE00001",
      countryCode: "US",
    },
    {
      mode: "grok",
      grokFilter: async (rows) =>
        applyGrokRelevanceSelection(rows, {
          keywordIndexes: [0, 1, 2, 3],
          productIndexes: [],
        }),
    },
  );
  assert.equal(out.keywords.length, 4);
  assert.equal(out.keywords[0].keyword, "iceland roads");
});

test("grok mode restores full Amazon list only when AI keep is empty", async () => {
  const keywords = Array.from({ length: 12 }, (_, i) => ({
    keyword: i === 0 ? "iceland roads" : `filler kw ${i}`,
    matchType: "broad",
  }));
  const out = await filterSuggestionsForBookRelevance(
    { keywords, productTargets: [] },
    {
      bookTitle: "Iceland Road Trip Guide",
      advertisedAsin: "B0ICE00001",
      countryCode: "US",
    },
    {
      mode: "grok",
      grokFilter: async (rows) =>
        applyGrokRelevanceSelection(rows, {
          keywordIndexes: [],
          productIndexes: [],
        }),
    },
  );
  assert.equal(out.keywords.length, 12);
  assert.equal(out.relevanceOutcome, "restored_empty");
});

test("grok mode honors productIndexes; empty product keep restores Amazon", async () => {
  const keywords = Array.from({ length: 12 }, (_, i) => ({
    keyword: i === 0 ? "iceland roads" : `filler kw ${i}`,
    matchType: "broad",
  }));
  const suggestions = {
    keywords,
    productTargets: [
      { asin: "B0ICE00001", title: "Iceland Road Trip", themes: [] },
      { asin: "B0COOKIE01", title: "Cookie Baking Bible", themes: [] },
      { asin: "B0EXTRA001", title: "Iceland Hiking Trails Pocket", themes: [] },
    ],
  };
  const context = {
    bookTitle: "Iceland Road Trip Guide",
    advertisedAsin: "B0ICE00001",
  };

  const curated = await filterSuggestionsForBookRelevance(suggestions, context, {
    mode: "grok",
    grokFilter: async (rows) =>
      applyGrokRelevanceSelection(rows, {
        keywordIndexes: [0, 1, 2],
        productIndexes: [0, 2],
      }),
  });
  assert.deepEqual(
    curated.keywords.map((k) => k.keyword),
    ["iceland roads", "filler kw 1", "filler kw 2"],
  );
  assert.deepEqual(
    curated.productTargets.map((p) => p.asin),
    ["B0ICE00001", "B0EXTRA001"],
  );

  const emptyProducts = await filterSuggestionsForBookRelevance(
    suggestions,
    context,
    {
      mode: "grok",
      grokFilter: async (rows) =>
        applyGrokRelevanceSelection(rows, {
          keywordIndexes: [0, 1, 2],
          productIndexes: [],
        }),
    },
  );
  // Mixed: keyword outcome wins chrome; products still restore when AI kept none.
  assert.equal(emptyProducts.relevanceOutcome, "filtered");
  assert.equal(emptyProducts.productTargets.length, 3);

  const productsOnlyEmpty = await filterSuggestionsForBookRelevance(
    { keywords: [], productTargets: suggestions.productTargets },
    context,
    {
      mode: "grok",
      grokFilter: async (rows) =>
        applyGrokRelevanceSelection(rows, {
          keywordIndexes: [],
          productIndexes: [],
        }),
    },
  );
  assert.equal(productsOnlyEmpty.relevanceOutcome, "restored_empty");
  assert.equal(productsOnlyEmpty.productTargets.length, 3);
});

test("relevancePromptNeedsChunking triggers above keyword/char thresholds", () => {
  assert.equal(relevancePromptNeedsChunking(10, 1000), false);
  assert.equal(
    relevancePromptNeedsChunking(GROK_RELEVANCE_KEYWORD_CHUNK + 1, 100),
    true,
  );
  assert.equal(relevancePromptNeedsChunking(5, 20_000), true);
});
