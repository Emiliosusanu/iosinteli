import assert from "node:assert/strict";
import test from "node:test";

import {
  bookDisplayTitle,
  hasResolvedBookMetadata,
} from "../src/lib/bookPresentation.ts";
import { booksTopRoyalties } from "../src/lib/overviewWidgets.ts";

const orphan = {
  book_key: "B0CW3DXQSC",
  asin: "B0CW3DXQSC",
  sku: null,
  title: null,
  image_url: "https://example.com/cover.jpg",
  impressions: 0,
  clicks: 0,
  orders: 0,
  spend: 0,
  sales: 0,
  royalties: 269,
  acos: 0,
  roas: null,
  net: 269,
  breakeven_acos: 0,
  ads_state: "ready",
  kdp_state: "ready",
};

test("orphan KDP rows never expose the ASIN or a pending label as their book title", () => {
  assert.equal(bookDisplayTitle(orphan), "Title unavailable");
  assert.equal(hasResolvedBookMetadata(orphan), false);
});

test("Top royalties ranks by royalty totals; unresolved catalog rows stay listed", () => {
  // Title honesty is separate (bookDisplayTitle → "Title unavailable"); the swipe ranks money.
  const identified = { ...orphan, asin: "B0IDENTIFIED", title: "Resolved book", royalties: 100 };
  assert.deepEqual(booksTopRoyalties([orphan, identified]).map((book) => book.asin), [
    "B0CW3DXQSC",
    "B0IDENTIFIED",
  ]);
});
