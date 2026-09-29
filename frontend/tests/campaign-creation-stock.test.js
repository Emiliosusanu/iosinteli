import assert from "node:assert/strict";
import test from "node:test";

import {
  adsStockSoftListed,
  amazonAdsStockConfirmed,
  bookAmazonProfileIds,
  createPaperbackSearchEmptyMessage,
  creationBooksToShelfCatalogRows,
  editionYearFromTitle,
  fallbackMarketplacesFromProfiles,
  filterRankCreatePaperbacks,
  ineligibleOutOfStockPaperbacks,
  isKindleAsinOnPrintWork,
  isPaperbackCreateCandidate,
  isPaperbackInStockListCandidate,
  kindleAsinsFromCatalog,
  liveStockStatusFromMarketplaces,
  marketplacesFromBookProfiles,
  marketplaceFallbackHint,
  marketplaceIsCreateChoice,
  matchLocalProfileForCreationMarketplace,
  nestCreateBookIsStockForBooks,
  normalizeCampaignCreationMarketplaces,
  normalizeCampaignCreationPreview,
  paperbackEditionStockCaption,
  parseCustomAsins,
  printAsinForDigitalFromCatalog,
  printAsinFromWorkKey,
  profilesForBook,
  resolveCreationProfileId,
  searchCreatePaperbacks,
  softListedAwaitingLiveConfirm,
  workFamilyKey,
  classifyCreationCampaignTargeting,
} from "../src/lib/campaignCreationStock.ts";

const profiles = [
  {
    id: "local-emilian",
    profile_id: "2543611550477751",
    country_code: "US",
    currency_code: "USD",
    marketplace_id: "ATVPDKIKX0DER",
  },
  {
    id: "local-mary",
    profile_id: "2588051190380043",
    country_code: "US",
    currency_code: "USD",
    marketplace_id: "ATVPDKIKX0DER",
  },
  {
    id: "local-ca",
    profile_id: "3896545512891020",
    country_code: "CA",
    currency_code: "CAD",
    marketplace_id: "A2EUQ1WTGCTBG2",
  },
];

test("stock confirmation distinguishes live Ads stock from soft existing-ad evidence", () => {
  assert.equal(amazonAdsStockConfirmed({ availabilityEvidence: "in_stock" }), true);
  assert.equal(amazonAdsStockConfirmed({ stockStatus: "IN STOCK" }), true);
  assert.equal(amazonAdsStockConfirmed({ availabilityEvidence: "amazon_catalog" }), false);
  assert.equal(amazonAdsStockConfirmed({ availabilityEvidence: "existing_product_ad" }), false);
  assert.equal(adsStockSoftListed({ availabilityEvidence: "existing_product_ad" }), true);
  assert.equal(adsStockSoftListed({ availabilityEvidence: "in_stock" }), false);
});

test("marketplace picker keeps soft existing_product_ad and drops catalog-only", () => {
  assert.equal(marketplaceIsCreateChoice({}), true);
  assert.equal(marketplaceIsCreateChoice({ availabilityEvidence: "in_stock" }), true);
  assert.equal(marketplaceIsCreateChoice({ availabilityEvidence: "existing_product_ad" }), true);
  assert.equal(marketplaceIsCreateChoice({ availabilityEvidence: "amazon_catalog" }), false);
  assert.equal(marketplaceIsCreateChoice({ stockStatus: "OUT_OF_STOCK" }), false);
});

test("book marketplaceIds are Amazon Ads profile ids and never leak other profiles", () => {
  const book = { asin: "B0G1MW7MQD", marketplaceIds: ["2543611550477751"] };
  assert.deepEqual(bookAmazonProfileIds(book), ["2543611550477751"]);
  const scoped = profilesForBook(profiles, book);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].profile_id, "2543611550477751");
  assert.equal(profilesForBook(profiles, { asin: "X", marketplaceIds: [] }).length, 0);
  assert.equal(fallbackMarketplacesFromProfiles(profiles, []).length, 0);
});

test("empty live marketplaces soft-fallback only when explicitly allowed", () => {
  const blocked = marketplacesFromBookProfiles(
    profiles,
    { asin: "B0G1MW7MQD", marketplaceIds: ["2543611550477751"] },
    [],
  );
  assert.equal(blocked.length, 0);
  const rows = marketplacesFromBookProfiles(
    profiles,
    { asin: "B0G1MW7MQD", marketplaceIds: ["2543611550477751"] },
    [],
    { allowSoftFallback: true },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].profileId, "2543611550477751");
  assert.equal(rows[0].availabilityEvidence, "existing_product_ad");
  assert.equal(resolveCreationProfileId(rows[0]), "2543611550477751");
});

test("normalizes nested or snake_case marketplace payloads", () => {
  const nested = normalizeCampaignCreationMarketplaces(
    {
      data: {
        asin: "B0HFCPQMS8",
        failed_count: 2,
        profiles: [
          {
            profile_id: "111",
            country_code: "US",
            currency_code: "USD",
            marketplace_id: "ATVPDKIKX0DER",
          },
        ],
      },
    },
    "B0HFCPQMS8",
  );
  assert.equal(nested.asin, "B0HFCPQMS8");
  assert.equal(nested.failedCount, 2);
  assert.equal(nested.marketplaces[0].id, "111");
  assert.equal(nested.marketplaces[0].countryCode, "US");
});

test("maps Nest ad-groups/suggestions top-level asin + profileId into book/profile", () => {
  const preview = normalizeCampaignCreationPreview({
    asin: "1807973751",
    profileId: "4138300112469957",
    productTargets: [
      {
        asin: "0241618606",
        themes: ["Similar items (frequently viewed together)"],
      },
    ],
  });
  assert.equal(preview.book.asin, "1807973751");
  assert.equal(preview.profile.profileId, "4138300112469957");
  assert.equal(preview.profile.id, "4138300112469957");
  assert.equal(preview.productTargets[0].asin, "0241618606");
});

test("normalizes preview keywords and product targets", () => {
  const preview = normalizeCampaignCreationPreview({
    recommendations_available: true,
    profile: { profile_id: "1120992069090651", country_code: "US", currency_code: "USD" },
    book: { asin: "B0G1C3XP9J", title: "Greece" },
    keywords: [
      { keyword: "greece travel", match_type: "broad", suggested_bid: 0.8 },
    ],
    product_targets: [{ asin: "b0aaaaaaaa", themes: ["similar"], suggested_bid: 1.2 }],
  });
  assert.equal(preview.recommendationsAvailable, true);
  assert.equal(preview.profile.profileId, "1120992069090651");
  // One Amazon phrase → Broad/Phrase/Exact companions for Create UX.
  assert.equal(preview.keywords.length, 3);
  assert.deepEqual(
    preview.keywords.map((row) => row.matchType),
    ["broad", "phrase", "exact"],
  );
  assert.equal(preview.productTargets[0].asin, "B0AAAAAAAA");
  assert.equal(preview.amazonKeywordApi.rowCount, 1);
  assert.equal(preview.amazonKeywordApi.phraseCount, 1);
});

test("CA keyword enum match types are kept (not dropped)", () => {
  const preview = normalizeCampaignCreationPreview({
    profile: { profile_id: "ca1", country_code: "CA", currency_code: "CAD" },
    book: { asin: "B0CANADA01", title: "Nova Scotia" },
    keywords: [
      { keyword: "halifax guide", match_type: "BROAD_MATCH", suggested_bid: 97 },
      { keyword: "cape breton", matchType: "PHRASE_MATCH" },
      { keyword: "peggy cove", match_type: "" },
    ],
    product_targets: [],
  });
  // 3 Amazon phrases × Broad/Phrase/Exact companions.
  assert.equal(preview.keywords.length, 9);
  assert.equal(preview.amazonKeywordApi.rowCount, 3);
  assert.equal(preview.amazonKeywordApi.phraseCount, 3);
  assert.equal(preview.keywords[0].matchType, "broad");
  assert.ok(preview.keywords.some((row) => row.keyword === "halifax guide" && row.matchType === "phrase"));
  assert.ok(preview.keywords.some((row) => row.keyword === "cape breton" && row.matchType === "exact"));
  assert.ok(preview.keywords.some((row) => row.keyword === "peggy cove" && row.matchType === "exact"));
  assert.equal(preview.profile.countryCode, "CA");
});

test("normalizes alternate product suggestion shapes and bare ASINs", () => {
  const nested = normalizeCampaignCreationPreview({
    recommendations: {
      products: [
        { target_asin: "B0BBBBBBBB", theme: "complementary", bid: 0.55 },
      ],
    },
    profile: { id: "p1" },
    book: { asin: "B0G1C3XP9J" },
  });
  assert.equal(nested.productTargets[0].asin, "B0BBBBBBBB");
  assert.deepEqual(nested.productTargets[0].themes, ["complementary"]);
  assert.equal(nested.productTargets[0].suggestedBid, 0.55);
  // Omitted match type → Exact default, plus Expanded companion for create UX.
  assert.deepEqual(
    nested.productTargets.map((row) => row.matchType),
    ["exact", "expanded"],
  );

  const bare = normalizeCampaignCreationPreview({
    asins: ["B0CCCCCCCC", "", "B0DDDDDDDD"],
    profile: { id: "p1" },
    book: { asin: "B0G1C3XP9J" },
  });
  assert.deepEqual(
    bare.productTargets.map((row) => `${row.asin}:${row.matchType}`),
    [
      "B0CCCCCCCC:exact",
      "B0DDDDDDDD:exact",
      "B0CCCCCCCC:expanded",
      "B0DDDDDDDD:expanded",
    ],
  );
  assert.equal(bare.recommendationsAvailable, true);
});

test("normalizes Amazon recommendedAsin + themes productTargets payload", () => {
  const preview = normalizeCampaignCreationPreview({
    source: "amazon_ads",
    recommendationsAvailable: true,
    profile: {
      id: "uuid-1",
      profileId: "2543611550477751",
      countryCode: "US",
      currencyCode: "USD",
    },
    book: { asin: "B0F2Z6ZWFP", title: "Print paperback" },
    productTargets: [
      {
        asin: "B0TARGET001",
        themes: ["Similar items (frequently viewed together)"],
        suggestedBid: null,
      },
      {
        recommendedAsin: "B0TARGET002",
        themes: ["Complements"],
        expressionType: "asinExpandedFrom",
      },
      {
        asin: "B0TARGET003",
        themes: ["Top clicks"],
        matchType: "asinSameAs",
      },
    ],
  });
  // One output per Amazon entity. No fabricated Exact/Expanded twin rows.
  assert.equal(preview.productTargets.length, 3);
  assert.equal(preview.productTargets[0].asin, "B0TARGET001");
  assert.deepEqual(
    preview.productTargets
      .filter((row) => row.asin === "B0TARGET002")
      .map((row) => row.matchType)
      .sort(),
    ["expanded"],
  );
  assert.deepEqual(preview.productTargets.find((r) => r.asin === "B0TARGET002" && r.matchType === "expanded")?.themes, [
    "Complements",
  ]);
  assert.equal(preview.recommendationsAvailable, true);
});

test("parses asinSameAs / asinExpandedFrom expression arrays", () => {
  const preview = normalizeCampaignCreationPreview({
    productTargets: [
      {
        expression: [{ type: "asinSameAs", value: "B0SAMEAS01" }],
        themes: ["Similar"],
      },
      {
        expression: [{ type: "asinExpandedFrom", value: "B0EXPAND01" }],
        themes: ["Similar"],
      },
    ],
    profile: { id: "p1" },
    book: { asin: "B0F2Z6ZWFP" },
  });
  const exact = preview.productTargets.filter((r) => r.asin === "B0SAMEAS01");
  const expanded = preview.productTargets.filter((r) => r.asin === "B0EXPAND01");
  assert.equal(exact.length, 1);
  assert.equal(expanded.length, 1);
  assert.equal(exact[0].matchType, "exact");
  assert.equal(expanded[0].matchType, "expanded");
});

test("empty productTargets with recommendationsAvailable false stays empty", () => {
  const preview = normalizeCampaignCreationPreview({
    recommendationsAvailable: false,
    profile: { profileId: "1" },
    book: { asin: "B0F2Z6ZWFP" },
    keywords: [],
    productTargets: [],
  });
  assert.equal(preview.productTargets.length, 0);
  assert.equal(preview.recommendationsAvailable, false);
});

test("parseCustomAsins accepts only B0 paperbacks", () => {
  assert.deepEqual(
    parseCustomAsins("B0G1C3XP9J\nbogus\nB0HFCPQMS8, B0G1C3XP9J"),
    ["B0G1C3XP9J", "B0HFCPQMS8"],
  );
});

test("Puerto Rico soft-fallback never invents Emilian Susanu without live", () => {
  const EMILIAN_US = "2543611550477751";
  const PUERTO_RICO = ["2588051190380043", "4138300112469957"];
  const profiles = [
    {
      id: "uuid-us",
      profile_id: EMILIAN_US,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: "uuid-mary",
      profile_id: "2588051190380043",
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: "uuid-ca",
      profile_id: "4138300112469957",
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: "A2EUQ1WTGCTBG2",
    },
  ];
  const display = marketplacesFromBookProfiles(
    profiles,
    { asin: "B0HFCPQMS8", marketplaceIds: PUERTO_RICO },
    [],
    { allowSoftFallback: true },
  );
  assert.deepEqual(
    display.map((row) => row.profileId).sort(),
    [...PUERTO_RICO].sort(),
  );
  assert.equal(
    display.some((row) => row.profileId === EMILIAN_US),
    false,
  );
});

test("Puerto Rico live CA is choosable when candidates only list Mary", () => {
  const MARY = "2588051190380043";
  const CA = "4138300112469957";
  const EMILIAN = "2543611550477751";
  const profiles = [
    {
      id: MARY,
      profile_id: MARY,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: CA,
      profile_id: CA,
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: "A2EUQ1WTGCTBG2",
    },
    {
      id: EMILIAN,
      profile_id: EMILIAN,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
  ];
  // Live Nest /marketplaces for B0HFCPQMS8 sometimes returns CA only while
  // book-candidates.marketplaceIds is [Mary] — intersection used to empty the picker.
  const live = [
    {
      id: CA,
      profileId: CA,
      countryCode: "CA",
      currencyCode: "CAD",
      marketplaceId: "A2EUQ1WTGCTBG2",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
    },
  ];
  const display = marketplacesFromBookProfiles(
    profiles,
    { asin: "B0HFCPQMS8", marketplaceIds: [MARY] },
    live,
  );
  assert.deepEqual(
    display.map((row) => row.profileId),
    [CA],
  );
  assert.equal(
    display.some((row) => row.profileId === EMILIAN),
    false,
  );
});

test("shared ATVPD marketplace id must not relabel VP2 as Emilian Susanu", () => {
  const EMILIAN = "2543611550477751";
  const VP2 = "3423496215225846";
  const CA_VPS2 = "3896545512891020";
  const profiles = [
    {
      id: "uuid-emilian",
      profile_id: EMILIAN,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: "uuid-vp2",
      profile_id: VP2,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: "uuid-ca",
      profile_id: CA_VPS2,
      country_code: "CA",
      currency_code: "CAD",
      marketplace_id: "A2EUQ1WTGCTBG2",
    },
  ];
  const live = [
    {
      id: VP2,
      profileId: VP2,
      countryCode: "US",
      currencyCode: "USD",
      marketplaceId: "ATVPDKIKX0DER",
      availabilityEvidence: "in_stock",
    },
  ];
  // Nest over-lists CA; live only confirms VP2 — prefer live.
  const display = marketplacesFromBookProfiles(
    profiles,
    { asin: "B0HFKCDPVG", marketplaceIds: [CA_VPS2, VP2] },
    live,
  );
  assert.deepEqual(
    display.map((row) => row.profileId),
    [VP2],
  );
  const local = matchLocalProfileForCreationMarketplace(profiles, display[0]);
  assert.equal(local?.profile_id, VP2);
  assert.notEqual(local?.profile_id, EMILIAN);
});

test("Kindle DIGITAL ASIN is not a paperback create candidate", () => {
  const kindle = {
    asin: "B0HBL32D6W",
    workKey: "DIGITAL=B0HBL32D6W:PRINT=B0HFCPQMS8::",
    format: "paperback",
    availabilityEvidence: "in_stock",
    stockStatus: "IN_STOCK",
  };
  const print = {
    asin: "B0HFCPQMS8",
    workKey: "DIGITAL=B0HBL32D6W:PRINT=B0HFCPQMS8::",
    format: "paperback",
    availabilityEvidence: "in_stock",
    stockStatus: "IN_STOCK",
    hasKdpData: true,
  };
  assert.equal(isKindleAsinOnPrintWork(kindle), true);
  assert.equal(isKindleAsinOnPrintWork(print), false);
  assert.equal(isPaperbackCreateCandidate(kindle), false);
  assert.equal(isPaperbackCreateCandidate(print), true);
});

test("create primary list drops Nest stock-only empties without KDP or Ads", () => {
  const stockOnly = {
    asin: "B0STOCKMT1",
    title: "Stock Empty Guide",
    format: "paperback",
    availabilityEvidence: "in_stock",
    stockStatus: "IN_STOCK",
  };
  const stockPlusKdp = { ...stockOnly, asin: "B0STOCKKDP", hasKdpData: true };
  const stockPlusAds = { ...stockOnly, asin: "B0STOCKADS", hasCampaign: true };
  assert.equal(isPaperbackInStockListCandidate(stockOnly), false);
  assert.equal(isPaperbackCreateCandidate(stockOnly), false);
  assert.equal(isPaperbackInStockListCandidate(stockPlusKdp), true);
  assert.equal(isPaperbackInStockListCandidate(stockPlusAds), true);
});

test("Puerto Rico bare-workKey Kindle is not labeled creatable paperback", () => {
  // Nest returns Kindle with format=paperback + bare workKey; PRINT sibling
  // carries DIGITAL=…:PRINT=…. Create must not list Kindle as Paperback.
  const books = [
    {
      asin: "B0HBL32D6W",
      title: "Puerto Rico Travel Guide 2027",
      workKey: "B0HBL32D6W",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
    },
    {
      asin: "B0HFCPQMS8",
      title: "Puerto Rico Travel Guide 2027",
      workKey: "DIGITAL=B0HBL32D6W:PRINT=B0HFCPQMS8::",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      hasCampaign: true,
    },
  ];
  const kindleAsins = kindleAsinsFromCatalog(books);
  assert.deepEqual([...kindleAsins], ["B0HBL32D6W"]);
  assert.equal(printAsinForDigitalFromCatalog("B0HBL32D6W", books), "B0HFCPQMS8");
  assert.equal(isKindleAsinOnPrintWork(books[0]), false);
  assert.equal(isKindleAsinOnPrintWork(books[0], kindleAsins), true);
  assert.equal(isPaperbackCreateCandidate(books[0], null, kindleAsins), false);
  assert.equal(isPaperbackCreateCandidate(books[1], null, kindleAsins), true);
  assert.deepEqual(
    filterRankCreatePaperbacks(books, {}).map((b) => b.asin),
    ["B0HFCPQMS8"],
  );
  assert.deepEqual(
    searchCreatePaperbacks(books, "B0HBL32D6W", {}).map((b) => b.asin),
    ["B0HFCPQMS8"],
  );
  assert.equal(
    createPaperbackSearchEmptyMessage({
      search: "B0HBL32D6W",
      books: [books[0]],
    }),
    "No paperback found for this search.",
  );
  assert.equal(
    createPaperbackSearchEmptyMessage({ search: "B0HBL32D6W", books }),
    "That's a Kindle ASIN. Use paperback B0HFCPQMS8.",
  );
});

test("Iceland-style existing_product_ad is Verify/search soft-allow, not primary list", () => {
  const iceland = {
    asin: "B0HB5MB9L9",
    title: "Iceland Travel Guide",
    workKey: "DIGITAL=B0DHQRH35G:PRINT=B0HB5MB9L9::TANDEM=VV_8001_391506",
    format: "paperback",
    availabilityEvidence: "existing_product_ad",
    marketplaceIds: ["1120992069090651"],
  };
  // Soft-allow: selectable for Verify, but not on empty-search in-stock list.
  assert.equal(isPaperbackCreateCandidate(iceland), true);
  assert.equal(isPaperbackInStockListCandidate(iceland), false);
  assert.deepEqual(
    filterRankCreatePaperbacks([iceland], {}).map((b) => b.asin),
    [],
  );
  assert.deepEqual(
    searchCreatePaperbacks([iceland], "", {}).map((b) => b.asin),
    [],
  );
  assert.deepEqual(
    searchCreatePaperbacks([iceland], "iceland", {}).map((b) => b.asin),
    ["B0HB5MB9L9"],
  );
  assert.equal(
    isPaperbackCreateCandidate(iceland, { status: "in_stock" }),
    true,
  );
  assert.equal(isPaperbackInStockListCandidate(iceland, { status: "in_stock" }), true);
  assert.equal(
    isPaperbackCreateCandidate(iceland, { status: "out_of_stock" }),
    false,
  );
  assert.equal(amazonAdsStockConfirmed(iceland), false);
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: false,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
    }),
    "Linked · not reconfirmed",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: { asin: "B0BLANK0001" },
      selected: false,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
    }),
    "Stock not confirmed",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: true,
      liveInStockCount: 0,
      livePending: true,
      displayProfileCount: 0,
      usingFallback: false,
    }),
    "Checking…",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: true,
      liveInStockCount: 0,
      livePending: true,
      displayProfileCount: 1,
      usingFallback: true,
    }),
    "Checking…",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: false,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
      liveStatus: "out_of_stock",
    }),
    "Out of stock",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: true,
      liveInStockCount: 1,
      livePending: false,
      displayProfileCount: 1,
      usingFallback: false,
    }),
    "In stock · 1 profile",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: true,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 1,
      usingFallback: true,
    }),
    "Linked profile · not reconfirmed",
  );
  assert.equal(
    paperbackEditionStockCaption({
      book: iceland,
      selected: true,
      liveInStockCount: 0,
      livePending: false,
      displayProfileCount: 0,
      usingFallback: false,
      liveStatus: "error",
    }),
    "Check failed — retry",
  );
  assert.match(
    marketplaceFallbackHint({ profileCount: 1 }),
    /did not reconfirm stock.*linked Ads profile/i,
  );
  assert.match(
    marketplaceFallbackHint({ profileCount: 1, failedCount: 2 }),
    /availability check failed.*linked Ads profile/i,
  );
  assert.equal(
    liveStockStatusFromMarketplaces({
      marketplaces: [],
      checkedCount: 6,
      failedCount: 0,
      nestBuyable: true,
    }),
    "unknown",
  );
});

test("Kindle ASIN search resolves to sibling paperback (B0DTJC4638 → B0F2Z6ZWFP)", () => {
  const books = [
    {
      asin: "B0F2Z6ZWFP",
      title: "Sample Travel Guide 2026",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      workKey: "DIGITAL=B0DTJC4638:PRINT=B0F2Z6ZWFP::TANDEM=VV_8001_165586",
      hasKdpData: true,
    },
    {
      asin: "B0DTJC4638",
      title: "Sample Travel Guide 2026",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      workKey: "DIGITAL=B0DTJC4638:PRINT=B0F2Z6ZWFP::TANDEM=VV_8001_165586",
    },
    {
      asin: "B0OTHERPB01",
      title: "Other Guide",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      workKey: ":PRINT=B0OTHERPB01::",
      hasCampaign: true,
    },
  ];
  assert.equal(printAsinFromWorkKey(books[0].workKey), "B0F2Z6ZWFP");
  assert.equal(isKindleAsinOnPrintWork(books[1]), true);
  assert.equal(isPaperbackCreateCandidate(books[1]), false);
  const hits = searchCreatePaperbacks(books, "B0DTJC4638", {});
  assert.deepEqual(
    hits.map((b) => b.asin),
    ["B0F2Z6ZWFP"],
  );
  assert.equal(
    createPaperbackSearchEmptyMessage({ search: "B0DTJC4638", books: [] }),
    "No paperback found for this search.",
  );
  assert.equal(
    createPaperbackSearchEmptyMessage({
      search: "B0DTJC4638",
      books: [books[1]],
    }),
    "That's a Kindle ASIN. Use paperback B0F2Z6ZWFP.",
  );
});

test("search surfaces soft-listed / out-of-stock paperbacks instead of empty stock miss", () => {
  const books = [
    {
      asin: "B0SOFTLIST1",
      title: "Softlisted Guide",
      format: "paperback",
      availabilityEvidence: "existing_product_ad",
      workKey: ":PRINT=B0SOFTLIST1::",
    },
    {
      asin: "B0OUTSTOCK1",
      title: "Outstock Guide",
      format: "paperback",
      availabilityEvidence: "existing_product_ad",
      workKey: ":PRINT=B0OUTSTOCK1::",
    },
    {
      asin: "B0INSTOCK01",
      title: "Instock Guide",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      workKey: ":PRINT=B0INSTOCK01::",
      hasCampaign: true,
    },
  ];
  const live = {
    B0OUTSTOCK1: { status: "out_of_stock" },
  };
  // Empty search = ads-eligible + in stock only (soft hidden until query).
  assert.deepEqual(
    searchCreatePaperbacks(books, "", live).map((b) => b.asin),
    ["B0INSTOCK01"],
  );
  assert.deepEqual(
    searchCreatePaperbacks(books, "B0SOFTLIST1", live).map((b) => b.asin),
    ["B0SOFTLIST1"],
  );
  assert.deepEqual(
    searchCreatePaperbacks(books, "outstock", live).map((b) => b.asin),
    ["B0OUTSTOCK1"],
  );
  assert.equal(
    createPaperbackSearchEmptyMessage({ search: "zzzz-no-hit", books }),
    "No paperback found for this search.",
  );
});

test("filterRankCreatePaperbacks prefers Nest in_stock and newest year per work family", () => {
  const books = [
    {
      asin: "B0DK43B6M6",
      title: "Portugal Travel Guide 2024",
      format: "paperback",
      availabilityEvidence: "existing_product_ad",
      workKey: "B0DK43B6M6",
    },
    {
      asin: "B0HBK3SQXF",
      title: "Portugal Travel Guide 2026",
      format: "paperback",
      availabilityEvidence: "existing_product_ad",
      workKey: "DIGITAL=B0DJV9DVVT:PRINT=B0HBK3SQXF::TANDEM=VV_8001_334904",
    },
    {
      asin: "B0G14HT7YN",
      title: "Portugal Travel Guide 2026",
      format: "paperback",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      workKey: "DIGITAL=B0DJV9DVVT:PRINT=B0G14HT7YN::TANDEM=VV_8001_334904",
      hasKdpData: true,
    },
    {
      asin: "B0FR8V9TLV",
      title: "Madrid Travel Guide 2026",
      format: "paperback",
      availabilityEvidence: "existing_product_ad",
      workKey: ":PRINT=B0FR8V9TLV::",
    },
  ];
  const live = {
    B0HBK3SQXF: { status: "in_stock" },
    B0FR8V9TLV: { status: "out_of_stock" },
    B0DK43B6M6: { status: "in_stock" },
  };
  // Soft-only Nest rows need live in_stock; year-dedupe still drops 2024.
  const ranked = filterRankCreatePaperbacks(books, live);
  assert.deepEqual(
    ranked.map((b) => b.asin).sort(),
    ["B0G14HT7YN", "B0HBK3SQXF"].sort(),
  );
  assert.deepEqual(
    filterRankCreatePaperbacks(books, {}).map((b) => b.asin),
    ["B0G14HT7YN"],
  );
  assert.equal(editionYearFromTitle("Iceland Travel Guide 2025"), 2025);
  assert.equal(
    workFamilyKey({
      asin: "B0HBK3SQXF",
      workKey: "DIGITAL=B0DJV9DVVT:PRINT=B0HBK3SQXF::TANDEM=VV_8001_334904",
    }),
    "TANDEM:VV_8001_334904",
  );
  assert.equal(ineligibleOutOfStockPaperbacks(books, live).length, 1);
  assert.ok(
    softListedAwaitingLiveConfirm(books, {}).some((b) => b.asin === "B0DK43B6M6"),
  );
  assert.equal(
    softListedAwaitingLiveConfirm(books, live).some((b) => b.asin === "B0DK43B6M6"),
    false,
  );
  assert.equal(
    liveStockStatusFromMarketplaces({
      marketplaces: [],
      checkedCount: 6,
      failedCount: 0,
    }),
    "out_of_stock",
  );
  assert.equal(
    liveStockStatusFromMarketplaces({
      marketplaces: [{ availabilityEvidence: "in_stock" }],
      checkedCount: 6,
      failedCount: 0,
    }),
    "in_stock",
  );
});

test("live marketplaces in_stock for soft-listed book keeps VP1 profile only", () => {
  const VP1 = "1120992069090651";
  const EMILIAN = "2543611550477751";
  const profiles = [
    {
      id: "uuid-vp1",
      profile_id: VP1,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
    {
      id: "uuid-emilian",
      profile_id: EMILIAN,
      country_code: "US",
      currency_code: "USD",
      marketplace_id: "ATVPDKIKX0DER",
    },
  ];
  const live = [
    {
      id: VP1,
      profileId: VP1,
      countryCode: "US",
      currencyCode: "USD",
      marketplaceId: "ATVPDKIKX0DER",
      availabilityEvidence: "in_stock",
      stockStatus: "IN_STOCK",
      verificationSource: "amazon_metadata",
    },
  ];
  const display = marketplacesFromBookProfiles(
    profiles,
    {
      asin: "B0HB5MB9L9",
      marketplaceIds: [VP1],
      availabilityEvidence: "existing_product_ad",
    },
    live,
  );
  assert.deepEqual(
    display.map((row) => row.profileId),
    [VP1],
  );
  assert.equal(display[0].availabilityEvidence, "in_stock");
});

test("creationBooksToShelfCatalogRows stamps Nest soft/confirmed stock for Books (not campaign)", () => {
  const rows = creationBooksToShelfCatalogRows([
    {
      asin: "180797376X",
      title: "Alaska Travel Guide 2027: Step-By-Step Road Trips",
      coverUrl: null,
      workKey: "DIGITAL=B0ALASKAK:PRINT=180797376X",
      stockStatus: null,
      availabilityEvidence: undefined,
      verificationSource: "existing_product_ad",
      marketplaceIds: ["2543611550477751", "2588051190380043"],
    },
    {
      asin: "B0CONFIRMD1",
      title: "Confirmed In Stock Paperback",
      coverUrl: null,
      workKey: "B0CONFIRMD1",
      stockStatus: "IN_STOCK",
      availabilityEvidence: "in_stock",
      verificationSource: "amazon_metadata",
    },
  ]);
  assert.equal(rows.length, 2);
  const alaska = rows.find((row) => row.asin === "180797376X");
  assert.equal(alaska?.in_stock, true);
  assert.equal(alaska?.has_campaign, false);
  assert.equal(alaska?.sponsorable, true);
  assert.match(String(alaska?.book_key), /PRINT=180797376X/);
  assert.equal(nestCreateBookIsStockForBooks({
    asin: "180797376X",
    verificationSource: "existing_product_ad",
  }), true);
  assert.equal(
    nestCreateBookIsStockForBooks({
      asin: "B0OOSONLY01",
      availabilityEvidence: undefined,
      stockStatus: null,
    }),
    false,
  );
  const confirmed = rows.find((row) => row.asin === "B0CONFIRMD1");
  assert.equal(confirmed?.in_stock, true);
});

test("classifyCreationCampaignTargeting labels Auto vs Manual Keywords/Products", () => {
  assert.deepEqual(
    classifyCreationCampaignTargeting({ campaignTargetingType: "auto" }),
    { kind: "auto", label: "Auto" },
  );
  assert.deepEqual(
    classifyCreationCampaignTargeting({
      campaignTargetingType: "manual",
      adGroupTargetingTypes: ["keyword"],
    }),
    { kind: "keywords", label: "Manual · Keywords" },
  );
  assert.deepEqual(
    classifyCreationCampaignTargeting({
      campaignTargetingType: "manual",
      adGroupTargetingTypes: ["product"],
    }),
    { kind: "products", label: "Manual · Products / ASINs" },
  );
});
