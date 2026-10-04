import assert from "node:assert/strict";
import test from "node:test";
import {
  bookRetailAsins,
  bookRetailEditions,
  bookRetailStockTone,
  bookRetailStockLabel,
  indexBookRetailSnapshots,
  indexProfileBookRetailSnapshots,
  primaryBookRetailEdition,
} from "../src/lib/bookRetailMetadata.ts";

const book = {
  book_key: "KDP:DIGITAL=B0ABCDEFGH:PRINT=1803014466::",
  asin: "B0ABCDEFGH",
  format_asins: ["B0ABCDEFGH", "1803014466"],
};

test("retail metadata stays on the exact format ASIN", () => {
  const snapshots = indexBookRetailSnapshots([
    { asin: "B0ABCDEFGH", amazon_rating: 4.1, amazon_review_count: 30, amazon_stock_status: "In Stock", amazon_meta_updated_at: "2026-10-01T10:00:00Z" },
    { asin: "1803014466", amazon_rating: 4.8, amazon_review_count: 50, amazon_stock_status: "Currently unavailable", amazon_meta_updated_at: "2026-10-02T10:00:00Z" },
  ]);
  assert.deepEqual(bookRetailAsins([book]), ["1803014466", "B0ABCDEFGH"]);
  const editions = bookRetailEditions(book, snapshots);
  assert.deepEqual(editions.map((row) => [row.format, row.snapshot.asin, row.snapshot.reviewCount]), [
    ["Paperback", "1803014466", 50],
    ["Kindle", "B0ABCDEFGH", 30],
  ]);
  assert.equal(editions[0].snapshot.stockStatus, "Currently unavailable");
});

test("latest timestamp wins for duplicate owned records; missing is not zero", () => {
  const snapshots = indexBookRetailSnapshots([
    { asin: "1803014466", amazon_rating: 4.2, amazon_review_count: 17, amazon_meta_updated_at: "2026-10-01T10:00:00Z" },
    { asin: "1803014466", amazon_rating: 4.6, amazon_review_count: 21, amazon_meta_updated_at: "2026-10-02T10:00:00Z" },
    { asin: "B0ABCDEFGH", amazon_rating: 0, amazon_review_count: null },
  ]);
  assert.equal(snapshots["1803014466"].rating, 4.6);
  assert.equal(snapshots["1803014466"].reviewCount, 21);
  assert.equal(snapshots["B0ABCDEFGH"], undefined);
  const missingEdition = bookRetailEditions(book, snapshots).find((row) => row.snapshot.asin === "B0ABCDEFGH");
  assert.deepEqual(missingEdition?.snapshot, {
    asin: "B0ABCDEFGH",
    rating: null,
    reviewCount: null,
    stockStatus: null,
    checkedAt: null,
  });
});

test("stock tone recognizes explicit negative status without treating it as available", () => {
  assert.equal(bookRetailStockTone("IN_STOCK"), "good");
  assert.equal(bookRetailStockTone("Currently unavailable"), "danger");
  assert.equal(bookRetailStockTone("Not in stock"), "danger");
  assert.equal(bookRetailStockLabel("IN_STOCK"), "In stock");
});

test("web profile-book API metadata is exact-ASIN, scoped, and does not invent a check date", () => {
  const snapshots = indexProfileBookRetailSnapshots([
    { asin: "B0GSMGJHKV", amazonRating: 4.6, amazonReviewCount: 66, amazonStockStatus: "IN_STOCK" },
    { asin: "B0FXRGN5HX", amazonRating: 4.5, amazonReviewCount: 35, amazonStockStatus: "IN_STOCK" },
    { asin: "B0F80GHL3P", amazonRating: null, amazonReviewCount: null, amazonStockStatus: "OUT_OF_STOCK" },
  ], ["B0GSMGJHKV", "B0F80GHL3P"]);
  assert.deepEqual(Object.keys(snapshots).sort(), ["B0F80GHL3P", "B0GSMGJHKV"]);
  assert.equal(snapshots.B0GSMGJHKV.rating, 4.6);
  assert.equal(snapshots.B0GSMGJHKV.reviewCount, 66);
  assert.equal(snapshots.B0GSMGJHKV.checkedAt, null);
  assert.equal(snapshots.B0F80GHL3P.stockStatus, "OUT_OF_STOCK");
});

test("Books preview uses an edition with real listing data when another edition is missing", () => {
  const snapshots = indexProfileBookRetailSnapshots([
    { asin: "B0ABCDEFGH", amazonRating: 4.3, amazonReviewCount: 12, amazonStockStatus: "IN_STOCK" },
  ], ["B0ABCDEFGH", "1803014466"]);
  const preview = primaryBookRetailEdition(book, snapshots);
  assert.equal(preview?.snapshot.asin, "B0ABCDEFGH");
  assert.equal(preview?.format, "Kindle");
});
