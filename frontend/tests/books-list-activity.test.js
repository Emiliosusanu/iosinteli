import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOOKS_LIST_ACTIVITY_DAYS,
  bookRowHasRecentActivityKey,
  booksEmptyCopy,
  booksListActivityRange,
  filterTopBooksByRecentActivity,
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
});

test("Books tab uses period-scoped list without 60-day gate", () => {
  assert.match(products, /activityDays: 0/);
  assert.match(products, /booksEmptyCopy/);
  assert.match(products, /sameScopeWarmPlaceholder|noPeriodPlaceholder|LIST_PERIOD_QUERY_CACHE/);
  assert.doesNotMatch(products, /onCoreRows/);
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
});
