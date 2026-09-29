import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  collapseTargetingBookOptionsByParent,
  dedupeTargetingBookOptions,
  filterTargetingBookOptions,
  hasMeaningfulKdpDailySignal,
  isEligibleTargetingBookOption,
  mergeTargetingBookOptionSources,
  selectEligibleCreateBookOptions,
  selectEligibleTargetingBookOptions,
  unionCampaignIdsForBookAsins,
} from "../src/lib/targetingBookFilter.ts";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");

test("book filter keeps distinct ASINs even when titles match", () => {
  const rows = dedupeTargetingBookOptions([
    { asin: "B0F1G3QVF5", title: "Alaska Travel Guide 2026", campaignIds: ["c1"] },
    { asin: "B0FSKDQ27V", title: "Alaska Travel Guide 2026", campaignIds: ["c2"] },
  ]);
  assert.equal(rows.length, 2);
  assert.match(targeting, /One ASIN per row/);
});

test("dedupeTargetingBookOptions collapses identical ASINs and merges campaigns", () => {
  const rows = dedupeTargetingBookOptions([
    {
      asin: "b0prague01",
      title: "Prague Travel Guide 2026: Your Essential…",
      image_url: null,
      campaignIds: ["c1"],
      campaignCount: 1,
    },
    {
      asin: "B0PRAGUE01",
      title: "Prague Travel Guide 2026: Your Essential City Walk",
      image_url: "https://example.com/cover.jpg",
      campaignIds: ["c2", "c1"],
      campaignCount: 2,
      hasKdpData: true,
    },
    {
      asin: "B0ICELAND1",
      title: "Iceland Travel Guide 2026",
      image_url: null,
      campaignIds: ["c3"],
    },
  ]);
  assert.equal(rows.length, 2);
  const prague = rows.find((r) => r.asin === "B0PRAGUE01");
  assert.ok(prague);
  assert.equal(prague.title, "Prague Travel Guide 2026: Your Essential City Walk");
  assert.equal(prague.image_url, "https://example.com/cover.jpg");
  assert.deepEqual(prague.campaignIds.sort(), ["c1", "c2"]);
  assert.equal(prague.campaignCount, 2);
  assert.equal(prague.hasKdpData, true);
});

test("filterTargetingBookOptions matches title or ASIN", () => {
  const books = [
    {
      asin: "B0GREECE01",
      title: "Greece Travel Guide 2026: Step-by-Step",
      campaignIds: [],
    },
    {
      asin: "B0ITALY001",
      title: "Italy Travel Guide 2026: Avoid Crowds",
      campaignIds: [],
    },
  ];
  assert.deepEqual(
    filterTargetingBookOptions(books, "italy").map((b) => b.asin),
    ["B0ITALY001"],
  );
  assert.deepEqual(
    filterTargetingBookOptions(books, "b0greece").map((b) => b.asin),
    ["B0GREECE01"],
  );
  assert.equal(filterTargetingBookOptions(books, "  ").length, 2);
  assert.equal(filterTargetingBookOptions(books, "prague").length, 0);
});

test("hasMeaningfulKdpDailySignal requires royalties, orders, KENP, or format cents", () => {
  assert.equal(hasMeaningfulKdpDailySignal({ royalties: 0, orders: 0 }), false);
  assert.equal(hasMeaningfulKdpDailySignal({ royalties: 0.01 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ orders: 1 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ kenp_royalties: 0.5 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ ebook_royalties: 1 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ paperback_royalties: 2 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ pages_read: 12 }), true);
  assert.equal(hasMeaningfulKdpDailySignal({ kenp_pages: 3 }), true);
});

test("targets eligibility keeps campaign books only; drops KDP-only and stock-only", () => {
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "B0ALASKA01",
      title: "Alaska Travel Guide 2025",
      campaignIds: ["c1"],
    }),
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "B0CW1CHVNS",
      title: "B0CW1CHVNS",
      campaignIds: [],
      hasKdpData: true,
    }),
    false,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "180797376X",
      title: "Alaska 2027",
      campaignIds: [],
      hasKdpData: false,
      inStock: true,
    }),
    false,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "1803627867",
      title: "1803627867",
      campaignIds: ["c9"],
      hasKdpData: false,
    }),
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "ORPHAN0001",
      title: "Mystery Title",
      campaignIds: [],
      hasKdpData: false,
      inStock: false,
    }),
    false,
  );
});

test("create eligibility requires in-stock AND (KDP or Ads); drops stock-only and out-of-stock", () => {
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "B0CW1CHVNS",
        title: "B0CW1CHVNS",
        campaignIds: [],
        hasKdpData: true,
        inStock: true,
      },
      "create",
    ),
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "B0STOCKKDP",
        title: "Stock + KDP",
        campaignIds: [],
        hasKdpData: true,
        inStock: true,
      },
      "create",
    ),
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "B0STOCKADS",
        title: "Stock + Ads",
        campaignIds: ["c1"],
        hasKdpData: false,
        inStock: true,
      },
      "create",
    ),
    true,
  );
  // Stock-only empty — no KDP, no Ads
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "180797376X",
        title: "Alaska 2027",
        campaignIds: [],
        inStock: true,
        hasKdpData: false,
      },
      "create",
    ),
    false,
  );
  // KDP without stock
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "B0KDPONLY1",
        title: "KDP Only",
        campaignIds: [],
        hasKdpData: true,
        inStock: false,
      },
      "create",
    ),
    false,
  );
  // Ads without stock
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "B0CAMPAIGN",
        title: "Has Ads Only",
        campaignIds: ["c1"],
        hasKdpData: false,
        inStock: false,
      },
      "create",
    ),
    false,
  );
  assert.equal(
    isEligibleTargetingBookOption(
      {
        asin: "ORPHAN0001",
        title: "Old Published",
        campaignIds: [],
        hasKdpData: false,
        inStock: false,
      },
      "create",
    ),
    false,
  );
});

test("collapseTargetingBookOptionsByParent unions Kindle + paperback as one filter row", () => {
  const KINDLE = "B0BARNKIN1";
  const PRINT = "B0BARNPRT1";
  const GROUP = `DIGITAL=${KINDLE}:PRINT=${PRINT}::`;
  const collapsed = collapseTargetingBookOptionsByParent([
    {
      asin: KINDLE,
      title: "Barndominium Plans Kindle",
      campaignIds: ["c-kindle"],
      hasKdpData: true,
      formatAsins: [KINDLE, PRINT],
      groupKey: GROUP,
    },
    {
      asin: PRINT,
      title: "Barndominium Plans Paperback",
      campaignIds: ["c-print"],
      hasKdpData: true,
      formatAsins: [KINDLE, PRINT],
      groupKey: GROUP,
    },
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].asin, KINDLE);
  assert.deepEqual(collapsed[0].campaignIds.sort(), ["c-kindle", "c-print"]);
  assert.ok(collapsed[0].formatAsins.includes(PRINT));
  assert.equal(collapsed[0].hasKdpData, true);
  assert.deepEqual(
    unionCampaignIdsForBookAsins(collapsed, [PRINT]).sort(),
    ["c-kindle", "c-print"],
  );
});

test("targets selectEligible keeps parent with campaigns; drops KDP-only orphans", () => {
  const KINDLE = "B0PARENTK1";
  const PRINT = "B0PARENTP1";
  const GROUP = `DIGITAL=${KINDLE}:PRINT=${PRINT}::`;
  const selected = selectEligibleTargetingBookOptions([
    {
      asin: KINDLE,
      title: "Parent Guide Kindle",
      campaignIds: ["c1"],
      formatAsins: [KINDLE, PRINT],
      groupKey: GROUP,
    },
    {
      asin: PRINT,
      title: "Parent Guide Print",
      campaignIds: [],
      hasKdpData: true,
      formatAsins: [KINDLE, PRINT],
      groupKey: GROUP,
    },
    {
      asin: "ORPHAN0001",
      title: "Old Dead Title",
      campaignIds: [],
      hasKdpData: true,
    },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].asin, KINDLE);
  assert.ok(selected[0].hasKdpData);
  assert.deepEqual(selected[0].campaignIds, ["c1"]);
});

test("create selectEligible keeps in-stock+(KDP|Ads); drops stock-only, KDP-only, Ads-only", () => {
  const selected = selectEligibleCreateBookOptions([
    {
      asin: "B0KDPONLY1",
      title: "KDP Only Guide",
      campaignIds: [],
      hasKdpData: true,
    },
    {
      asin: "B0STOCK001",
      title: "In Stock Empty",
      campaignIds: [],
      inStock: true,
    },
    {
      asin: "B0STOCKKDP",
      title: "Stock + KDP",
      campaignIds: [],
      hasKdpData: true,
      inStock: true,
    },
    {
      asin: "B0STOCKADS",
      title: "Stock + Ads",
      campaignIds: ["c1"],
      inStock: true,
    },
    {
      asin: "B0ADSONLY1",
      title: "Ads Only",
      campaignIds: ["c1"],
    },
    {
      asin: "ORPHAN0001",
      title: "Published Empty",
      campaignIds: [],
    },
  ]);
  assert.deepEqual(selected.map((b) => b.asin).sort(), ["B0STOCKADS", "B0STOCKKDP"]);
});

test("mergeTargetingBookOptionSources defaults to targets (campaigns only)", () => {
  const merged = mergeTargetingBookOptionSources(
    [
      {
        asin: "B0SHARED01",
        title: "Shared Book",
        campaignIds: ["c1"],
        hasKdpData: false,
      },
      {
        asin: "1803627867",
        title: "1803627867",
        campaignIds: ["c2"],
        hasKdpData: false,
      },
    ],
    [
      {
        asin: "B0SHARED01",
        title: "Shared Book Longer Title From KDP",
        campaignIds: [],
        hasKdpData: true,
      },
      {
        asin: "B0KDPONLY1",
        title: "KDP Only Guide",
        campaignIds: [],
        hasKdpData: true,
      },
    ],
  );
  const asins = merged.map((b) => b.asin).sort();
  assert.deepEqual(asins, ["1803627867", "B0SHARED01"]);
  const shared = merged.find((b) => b.asin === "B0SHARED01");
  assert.ok(shared);
  assert.equal(shared.title, "Shared Book Longer Title From KDP");
  assert.deepEqual(shared.campaignIds, ["c1"]);
  assert.equal(shared.hasKdpData, true);

  const createMerged = mergeTargetingBookOptionSources(
    [{ asin: "B0ADSONLY1", title: "Ads", campaignIds: ["c1"] }],
    [{ asin: "B0KDPONLY1", title: "KDP", campaignIds: [], hasKdpData: true }],
    "create",
  );
  assert.deepEqual(createMerged.map((b) => b.asin), []);

  const createStockMerged = mergeTargetingBookOptionSources(
    [
      {
        asin: "B0STOCKADS",
        title: "Stock Ads",
        campaignIds: ["c1"],
        inStock: true,
      },
    ],
    [
      {
        asin: "B0STOCKKDP",
        title: "Stock KDP",
        campaignIds: [],
        hasKdpData: true,
        inStock: true,
      },
    ],
    "create",
  );
  assert.deepEqual(
    createStockMerged.map((b) => b.asin).sort(),
    ["B0STOCKADS", "B0STOCKKDP"],
  );
});

test("targeting filter sheet wires search, list rows, and context eligibility", () => {
  assert.match(targeting, /targeting-book-search/);
  assert.match(targeting, /styles\.bookListRow/);
  assert.match(targeting, /targeting-ranges-toggle/);
  assert.match(targeting, /FilterCheckRow/);
  assert.match(targeting, /filterTargetingBookOptions/);
  assert.match(targeting, /book\.asin/);
  assert.match(targeting, /name="checkmark"/);
  assert.match(queries, /dedupeTargetingBookOptions/);
  assert.match(queries, /selectEligibleTargetingBookOptions\(books, purpose\)/);
  assert.match(queries, /fetchKdpBooksForTargetingFilter/);
  assert.match(queries, /from "\.\/targetingBookFilter"/);
  assert.match(queries, /Catalog titles alone must NOT enter/);
  assert.match(queries, /hasMeaningfulKdpDailySignal/);
  assert.match(queries, /collapseTargetingBookOptionsByParent/);
  assert.match(queries, /purpose === "create"/);
  assert.match(mutations, /evidence !== "amazon_catalog"/);
});

test("fetchTargetingBookOptions always unions Nest with local campaigns+KDP", () => {
  assert.doesNotMatch(queries, /return finish\(nestBooks\);/);
  assert.match(queries, /\.\.\.nestBooks/);
  assert.match(queries, /\.\.\.campaignBooks/);
  assert.match(queries, /\.\.\.kdpBooks/);
  assert.match(queries, /Targets \(\`purpose: "targets"/);
});
