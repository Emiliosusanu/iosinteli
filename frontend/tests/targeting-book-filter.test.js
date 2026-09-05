import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  dedupeTargetingBookOptions,
  filterTargetingBookOptions,
  isEligibleTargetingBookOption,
  mergeTargetingBookOptionSources,
  selectEligibleTargetingBookOptions,
} from "../src/lib/targetingBookFilter.ts";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");

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

test("isEligibleTargetingBookOption keeps campaign/KDP books and drops bare orphans", () => {
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
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "1803627867",
      title: "1803627867",
      campaignIds: ["c9"],
      hasKdpData: false,
    }),
    false,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "1803627867",
      title: "1803627867",
      image_url: "https://example.com/cover.jpg",
      campaignIds: ["c9"],
    }),
    true,
  );
  assert.equal(
    isEligibleTargetingBookOption({
      asin: "ORPHAN0001",
      title: "Mystery Title",
      campaignIds: [],
      hasKdpData: false,
    }),
    false,
  );
});

test("mergeTargetingBookOptionSources unions campaign + KDP and dedupes by ASIN", () => {
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
  assert.deepEqual(asins, ["B0KDPONLY1", "B0SHARED01"]);
  const shared = merged.find((b) => b.asin === "B0SHARED01");
  assert.ok(shared);
  assert.equal(shared.title, "Shared Book Longer Title From KDP");
  assert.deepEqual(shared.campaignIds, ["c1"]);
  assert.equal(shared.hasKdpData, true);
  assert.equal(
    selectEligibleTargetingBookOptions([
      { asin: "B0BARE0001", title: "B0BARE0001", campaignIds: ["c1"] },
    ]).length,
    0,
  );
});

test("targeting filter sheet wires search, list rows, and fetch-side eligibility", () => {
  assert.match(targeting, /targeting-book-search/);
  assert.match(targeting, /styles\.bookList/);
  assert.match(targeting, /filterTargetingBookOptions/);
  assert.match(targeting, /book\.asin/);
  assert.match(targeting, /checkmark\.circle\.fill/);
  assert.match(targeting, /campaign or KDP books/);
  assert.match(queries, /dedupeTargetingBookOptions/);
  assert.match(queries, /selectEligibleTargetingBookOptions/);
  assert.match(queries, /fetchKdpBooksForTargetingFilter/);
  assert.match(queries, /from "\.\/targetingBookFilter"/);
});
