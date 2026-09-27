import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOOKS_LIST_ACTIVITY_DAYS,
  bookHasKdpOrAdsEvidence,
  bookRowHasRecentActivityKey,
  booksEmptyCopy,
  booksListActivityRange,
  collapseTopBooksByFormatGroup,
  filterBooksListVisibility,
  filterTopBooksByRecentActivity,
  identityAsinsForBookRow,
  mergeTopBookCatalogRows,
} from "../src/lib/booksListActivity.ts";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");

test("books list activity window is rolling last 60 days", () => {
  assert.equal(BOOKS_LIST_ACTIVITY_DAYS, 60);
  const now = new Date(2026, 7, 30);
  assert.deepEqual(booksListActivityRange(now), { start: "2026-07-02", end: "2026-08-30" });
});

test("filterTopBooksByRecentActivity keeps only active keys", () => {
  const rows = [
    { book_key: "A", asin: "A", sku: null, royalties: 1, orders: 0, spend: 0, sales: 0, impressions: 0, clicks: 0 },
    { book_key: "B", asin: "B", sku: null, royalties: 0, orders: 0, spend: 0, sales: 0, impressions: 0, clicks: 0 },
  ];
  const active = new Set(["A"]);
  assert.deepEqual(filterTopBooksByRecentActivity(rows, active).map((r) => r.book_key), ["A"]);
  assert.equal(bookRowHasRecentActivityKey(rows[0], active), true);
  assert.equal(bookRowHasRecentActivityKey(rows[1], active), false);
  assert.deepEqual(filterTopBooksByRecentActivity(rows, new Set()).map((r) => r.book_key), []);
  assert.deepEqual(filterTopBooksByRecentActivity(rows, null).map((r) => r.book_key), ["A", "B"]);
  assert.deepEqual(filterTopBooksByRecentActivity(rows, undefined).map((r) => r.book_key), ["A", "B"]);
});

test("filterBooksListVisibility keeps KDP, Ads metrics, or enabled campaign — not stock alone", () => {
  const stockOnly = {
    book_key: "STOCK",
    asin: "B0STOCKONLY",
    sku: null,
    royalties: null,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    in_stock: true,
    sponsorable: true,
  };
  // Quiet advertised title ($0 in range) — must still show (Nova Scotia / Vagus).
  const campaignFlagOnly = {
    book_key: "B0CAMPAIGN0",
    asin: "B0CAMPAIGN0",
    sku: null,
    royalties: null,
    kdp_orders: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: true,
    has_format_activity: false,
  };
  const nestZeroNoCampaign = {
    book_key: "B0NESTZERO1",
    asin: "B0NESTZERO1",
    sku: null,
    title: "Empty Nest Shelf",
    royalties: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: false,
    in_stock: true,
  };
  const kdp = {
    book_key: "KDP:1:DIGITAL=B0KINDLE01",
    asin: "B0KINDLE01",
    sku: null,
    royalties: 12.5,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_format_activity: true,
  };
  const ads = {
    book_key: "B0ADSBOOK1",
    asin: "B0ADSBOOK1",
    sku: null,
    royalties: null,
    orders: 0,
    spend: 4,
    sales: 10,
    impressions: 100,
    clicks: 2,
    has_campaign: true,
  };
  assert.equal(bookHasKdpOrAdsEvidence(stockOnly), false);
  assert.equal(bookHasKdpOrAdsEvidence(campaignFlagOnly), true);
  assert.equal(bookHasKdpOrAdsEvidence(nestZeroNoCampaign), false);
  assert.equal(bookHasKdpOrAdsEvidence(kdp), true);
  assert.equal(bookHasKdpOrAdsEvidence(ads), true);
  assert.deepEqual(
    filterBooksListVisibility([
      stockOnly,
      campaignFlagOnly,
      nestZeroNoCampaign,
      kdp,
      ads,
    ]).map((r) => r.asin),
    ["B0CAMPAIGN0", "B0KINDLE01", "B0ADSBOOK1"],
  );
});

test("mergeTopBookCatalogRows does not let Nest zeros wipe local KDP/Ads evidence", () => {
  const local = {
    book_key: "DIGITAL=B0VAGUS0001",
    asin: "B0VAGUS0001",
    sku: null,
    title: "Vagus",
    royalties: 480.5,
    kdp_orders: 12,
    orders: 3,
    spend: 120,
    sales: 150,
    impressions: 9000,
    clicks: 40,
    has_format_activity: true,
  };
  const nestZero = {
    book_key: "B0VAGUS0001",
    asin: "B0VAGUS0001",
    sku: null,
    title: "Vagus",
    royalties: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    breakeven_acos: 42,
  };
  const [merged] = mergeTopBookCatalogRows([local], [nestZero]);
  assert.equal(merged.royalties, 480.5);
  assert.equal(merged.spend, 120);
  assert.equal(merged.impressions, 9000);
  assert.equal(merged.clicks, 40);
  assert.equal(merged.orders, 3);
  assert.equal(merged.breakeven_acos, 42);
  assert.ok(bookHasKdpOrAdsEvidence(merged));
  assert.equal(filterBooksListVisibility([merged]).length, 1);
});

test("mergeTopBookCatalogRows keeps local BE when Nest sends zero", () => {
  const local = {
    book_key: "DIGITAL=B0COSTARIC",
    asin: "B0COSTARIC",
    sku: null,
    title: "Costa Rica",
    royalties: 100,
    spend: 50,
    sales: 80,
    impressions: 1000,
    clicks: 20,
    orders: 5,
    breakeven_acos: 44.87,
  };
  const nestZero = {
    book_key: "B0COSTARIC",
    asin: "B0COSTARIC",
    sku: null,
    title: "Costa Rica",
    royalties: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    orders: 0,
    breakeven_acos: 0,
  };
  const [merged] = mergeTopBookCatalogRows([local], [nestZero]);
  assert.equal(merged.breakeven_acos, 44.87);
  assert.equal(merged.royalties, 100);
});

test("collapseTopBooksByFormatGroup keeps authoritative BE from any sibling", () => {
  const withBe = {
    book_key: "B0COSTARIC",
    asin: "B0COSTARIC",
    sku: null,
    title: "Costa Rica",
    royalties: null,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    breakeven_acos: 44.87,
  };
  const withMetrics = {
    book_key: "DIGITAL=B0COSTARIC:PRINT=B0COSTPRNT",
    asin: "B0COSTARIC",
    sku: null,
    title: "Costa Rica Travel Guide",
    royalties: 290,
    spend: 100,
    sales: 291,
    orders: 40,
    impressions: 5000,
    clicks: 80,
    breakeven_acos: 0,
    has_format_activity: true,
  };
  const [collapsed] = collapseTopBooksByFormatGroup([withBe, withMetrics]);
  assert.equal(collapsed.breakeven_acos, 44.87);
  assert.equal(collapsed.spend, 100);
});

test("collapse keeps group when any sibling has KDP or Ads evidence", () => {
  const quietSibling = {
    book_key: "180797376X",
    asin: "180797376X",
    sku: null,
    title: "Quiet Paperback",
    royalties: null,
    kdp_orders: 0,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: false,
    in_stock: true,
  };
  const activeSibling = {
    book_key: "KDP:1:DIGITAL=B0KINDLE01:PRINT=180797376X",
    asin: "B0KINDLE01",
    sku: null,
    format_asins: ["B0KINDLE01", "180797376X"],
    title: "Active Kindle",
    royalties: 8,
    kdp_orders: 1,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    has_format_activity: true,
  };
  const collapsed = collapseTopBooksByFormatGroup([quietSibling, activeSibling]);
  assert.equal(collapsed.length, 1);
  assert.equal(filterBooksListVisibility(collapsed).length, 1);
  assert.ok(identityAsinsForBookRow(collapsed[0]).includes("180797376X"));
});

test("collapseTopBooksByFormatGroup unions formats and sums spend/sales", () => {
  const kindle = {
    book_key: "KDP:1:DIGITAL=B0KINDLE01:PRINT=180797376X",
    asin: "B0KINDLE01",
    sku: null,
    format_asins: ["B0KINDLE01", "180797376X"],
    title: "Alaska 2026",
    royalties: 40,
    kdp_orders: 2,
    spend: 10,
    sales: 20,
    orders: 1,
    impressions: 100,
    clicks: 5,
    has_campaign: true,
    has_format_activity: true,
  };
  const paperback = {
    book_key: "180797376X",
    asin: "180797376X",
    sku: null,
    title: "Alaska 2027",
    royalties: null,
    kdp_orders: 0,
    spend: 5,
    sales: 10,
    orders: 2,
    impressions: 50,
    clicks: 3,
    has_campaign: false,
    in_stock: true,
  };
  const other = {
    book_key: "B0OTHER001",
    asin: "B0OTHER001",
    sku: null,
    title: "Other",
    royalties: 1,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    has_format_activity: true,
  };
  const collapsed = collapseTopBooksByFormatGroup([kindle, paperback, other]);
  assert.equal(collapsed.length, 2);
  const alaska = collapsed.find((r) => identityAsinsForBookRow(r).includes("B0KINDLE01"));
  assert.ok(alaska);
  assert.equal(alaska.spend, 15);
  assert.equal(alaska.sales, 30);
  assert.equal(alaska.orders, 3);
  assert.equal(alaska.royalties, 40);
  assert.equal(alaska.has_campaign, true);
  assert.ok(identityAsinsForBookRow(alaska).includes("180797376X"));
  assert.equal(alaska.acos, 50);
});

test("catalog finalize collapses formats then filters empty shelves", () => {
  assert.match(queries, /collapseTopBooksByFormatGroup/);
  assert.match(queries, /filterBooksListVisibility/);
  assert.match(queries, /format_asins/);
  // Nest early-return / catalog mode must still filter via finalizeTopBooksList.
  assert.match(queries, /activityDays <= 0[\s\S]*filterBooksListVisibility\(collapseTopBooksByFormatGroup/);
});

test("finalize keeps KDP/Ads evidence rows with blank title (does not title-gate them out)", () => {
  // Source contract: listed = titled OR bookHasKdpOrAdsEvidence — never drop
  // royalty/ads rows solely for missing catalog title.
  assert.match(
    queries,
    /String\(row\.title \?\? ""\)\.trim\(\)\.length > 0 \|\| bookHasKdpOrAdsEvidence\(row\)/,
  );
  assert.match(queries, /bookHasKdpOrAdsEvidence/);
  const blankTitleKdp = {
    book_key: "KDP:1:DIGITAL=B0BLANKTTL1",
    asin: "B0BLANKTTL1",
    sku: null,
    title: null,
    royalties: 22,
    kdp_orders: 3,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_format_activity: true,
  };
  const blankTitleAds = {
    book_key: "B0BLANKADS1",
    asin: "B0BLANKADS1",
    sku: null,
    title: "   ",
    royalties: null,
    orders: 1,
    spend: 3.5,
    sales: 12,
    impressions: 80,
    clicks: 4,
    has_campaign: true,
  };
  const blankTitleNoise = {
    book_key: "B0BLANKZERO",
    asin: "B0BLANKZERO",
    sku: null,
    title: null,
    royalties: null,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: false,
    in_stock: true,
  };
  const blankTitleCampaign = {
    book_key: "B0BLANKCAMP",
    asin: "B0BLANKCAMP",
    sku: null,
    title: null,
    royalties: null,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: true,
  };
  assert.equal(bookHasKdpOrAdsEvidence(blankTitleKdp), true);
  assert.equal(bookHasKdpOrAdsEvidence(blankTitleAds), true);
  assert.equal(bookHasKdpOrAdsEvidence(blankTitleNoise), false);
  assert.equal(bookHasKdpOrAdsEvidence(blankTitleCampaign), true);
  // Mimic finalize listed gate + catalog visibility (collapse is a no-op here).
  const listed = [blankTitleKdp, blankTitleAds, blankTitleNoise, blankTitleCampaign].filter(
    (row) =>
      String(row.title ?? "").trim().length > 0 || bookHasKdpOrAdsEvidence(row),
  );
  assert.deepEqual(
    listed.map((r) => r.asin),
    ["B0BLANKTTL1", "B0BLANKADS1", "B0BLANKCAMP"],
  );
  assert.deepEqual(
    filterBooksListVisibility(collapseTopBooksByFormatGroup(listed)).map((r) => r.asin),
    ["B0BLANKTTL1", "B0BLANKADS1", "B0BLANKCAMP"],
  );
});

test("collapse keeps blank-title evidence sibling in the group", () => {
  const blankEvidence = {
    book_key: "KDP:1:DIGITAL=B0BLANKKIND",
    asin: "B0BLANKKIND",
    sku: null,
    format_asins: ["B0BLANKKIND", "180799999X"],
    title: null,
    royalties: 5,
    kdp_orders: 1,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    has_format_activity: true,
  };
  const titledQuiet = {
    book_key: "180799999X",
    asin: "180799999X",
    sku: null,
    title: "Quiet Print Sibling",
    royalties: null,
    kdp_orders: 0,
    spend: 0,
    sales: 0,
    orders: 0,
    impressions: 0,
    clicks: 0,
    has_campaign: false,
    in_stock: true,
  };
  const collapsed = collapseTopBooksByFormatGroup([blankEvidence, titledQuiet]);
  assert.equal(collapsed.length, 1);
  assert.equal(filterBooksListVisibility(collapsed).length, 1);
  assert.ok(bookHasKdpOrAdsEvidence(collapsed[0]));
});

test("fetchTopBooksRange applies 60-day activity filter", () => {
  assert.match(queries, /BOOKS_LIST_ACTIVITY_DAYS/);
  assert.match(queries, /fetchActiveBookKeysInRange/);
  assert.match(queries, /finalizeTopBooksList/);
  assert.match(queries, /filterTopBooksByRecentActivity/);
  assert.match(queries, /kdp_book_daily_activity/);
  assert.match(queries, /product_ad_metrics_activity/);
});

test("Overview admin books respect 60-day activity keys", () => {
  assert.match(home, /fetchActiveBookKeysForProfiles/);
  assert.match(home, /filterTopBooksByRecentActivity/);
  assert.match(home, /books-activity-60d/);
  assert.match(home, /activeBookKeysQ\.isError/);
  assert.match(home, /limit: 300/);
  assert.match(home, /activityDays: 0/);
  // products queryKey must include limit (300) — must not share Books full list key
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.products[\s\S]*?,\s*300\s*\]/);
});

test("Books tab uses period-scoped list without 60-day gate", () => {
  assert.match(products, /activityDays: 0/);
  assert.match(products, /booksEmptyCopy/);
  assert.match(products, /sameScopeWarmPlaceholder|noPeriodPlaceholder|LIST_PERIOD_QUERY_CACHE/);
  assert.doesNotMatch(products, /onCoreRows/);
  assert.match(products, /FINANCIAL_QUERY_ROOTS\.products[\s\S]*?,\s*0\s*\]\s*as const/);
});

test("Books list hierarchy: Net hero weight + statusChip tokens + lg covers", () => {
  assert.match(products, /statusChipTone/);
  assert.match(products, /t\.statusChip\./);
  assert.match(products, /fontWeight:\s*"800"/);
  assert.match(products, /fontSize:\s*22/);
  assert.match(products, /size="lg"/);
  assert.doesNotMatch(products, /LayoutAnimation/);
  // Status accent rail removed — Net negative pill remains the signal.
  assert.doesNotMatch(products, /toneRail/);
  assert.match(products, /with royalties, ads, or campaigns/);
});

test("empty books copy is not misleading when KDP was never imported", () => {
  const missing = booksEmptyCopy("", { iosHelperOn: false, hasLinkedKdp: false });
  assert.equal(missing.title, "Connect KDP");
  assert.match(missing.subtitle, /Chrome on a computer or the iPhone helper/);
  assert.equal(missing.actionLabel, "Set up royalties");
  const accountOnly = booksEmptyCopy("", { hasAccountRoyalties: true });
  assert.equal(accountOnly.title, "No per-book breakdown");
  assert.equal(accountOnly.subtitle, "");
  const inRange = booksEmptyCopy("", { iosHelperOn: true, hasLinkedKdp: true });
  assert.equal(inRange.title, "No book data in range");
  assert.equal(inRange.subtitle, "");
  // Linked via Chrome/helper on another device — do not nag Connect KDP.
  const linkedElsewhere = booksEmptyCopy("", { iosHelperOn: false, hasLinkedKdp: true });
  assert.equal(linkedElsewhere.title, "No book data in range");
});

test("Books soft-collapses TopBar+filters on scroll (mounted, Reanimated)", () => {
  assert.match(products, /FilterChrome/);
  assert.match(products, /useScrollChromeCollapse/);
  assert.match(products, /books-scroll-chrome/);
  assert.match(products, /ReanimatedAnimated\.FlatList|Reanimated\.FlatList/);
  assert.doesNotMatch(products, /listCanScrollRef/);
  // No Campaigns-style mount/unmount pop.
  assert.doesNotMatch(products, /setTopChromeVisible\(false\)/);
  assert.doesNotMatch(products, /topChromeVisible \? <TopBar/);
});
