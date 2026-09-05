import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  asinBelongsToLogicalBook,
  bookRowMatchesOpenedAsin,
  groupKeysForOpenedAsin,
  logicalBookAsinsFromDailyRows,
  primaryAsinFromGroupKey,
} from "../src/lib/kdpBookIdentity.ts";

const queriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const productSource = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");

const ALASKA_KINDLE = "B0F1G3QVF5";
const ALASKA_PAPERBACK = "B0GYW7XTXQ";
const ITALY_PAPERBACK = "B0FSSV2PRT";
const ALASKA_GROUP = "DIGITAL=B0F1G3QVF5:PRINT=B0GYW7XTXQ::";
const ITALY_GROUP = ":PRINT=B0FSSV2PRT::";

const dailyRows = [
  { asin: ALASKA_KINDLE, group_key: ALASKA_GROUP },
  { asin: ALASKA_PAPERBACK, group_key: ALASKA_GROUP },
  { asin: ITALY_PAPERBACK, group_key: ITALY_GROUP },
  { asin: "B0OLDPRINT1", group_key: "DIGITAL=B0KINDLE001:PRINT=B0NEWPRINT1::" },
  { asin: "B0NEWPRINT1", group_key: "DIGITAL=B0KINDLE001:PRINT=B0NEWPRINT1::" },
  { asin: "B0KINDLE001", group_key: "DIGITAL=B0KINDLE001:PRINT=B0NEWPRINT1::" },
];

test("Kindle ASIN resolves the proven paperback sibling and no other book", () => {
  const asins = logicalBookAsinsFromDailyRows(ALASKA_KINDLE, dailyRows);
  assert.deepEqual(asins.sort(), [ALASKA_KINDLE, ALASKA_PAPERBACK].sort());
  assert.equal(asinBelongsToLogicalBook(ALASKA_PAPERBACK, asins), true);
  assert.equal(asinBelongsToLogicalBook(ITALY_PAPERBACK, asins), false);
});

test("opening the paperback sibling still resolves the Kindle anchor", () => {
  const asins = logicalBookAsinsFromDailyRows(ALASKA_PAPERBACK, dailyRows);
  assert.deepEqual(asins.sort(), [ALASKA_KINDLE, ALASKA_PAPERBACK].sort());
});

test("Italy paperback is a proven different book", () => {
  const asins = logicalBookAsinsFromDailyRows(ITALY_PAPERBACK, dailyRows);
  assert.deepEqual(asins, [ITALY_PAPERBACK]);
  assert.equal(asinBelongsToLogicalBook(ALASKA_KINDLE, asins), false);
});

test("replacement paperback stays under the Kindle-anchored group_key", () => {
  const asins = logicalBookAsinsFromDailyRows("B0NEWPRINT1", dailyRows);
  assert.deepEqual(asins.sort(), ["B0KINDLE001", "B0NEWPRINT1", "B0OLDPRINT1"].sort());
});

test("missing group_key does not invent siblings from titles or nearby ASINs", () => {
  const rows = [
    { asin: ALASKA_KINDLE, group_key: null },
    { asin: ALASKA_PAPERBACK, group_key: ALASKA_GROUP },
    { asin: ITALY_PAPERBACK, group_key: ITALY_GROUP },
  ];
  assert.deepEqual(logicalBookAsinsFromDailyRows(ALASKA_KINDLE, rows), [ALASKA_KINDLE]);
  assert.deepEqual(groupKeysForOpenedAsin(ALASKA_KINDLE, rows), []);
});

test("Book Detail campaign matching uses logical-book ASINs, not the opened ASIN alone", () => {
  assert.equal(queriesSource.includes("logicalBookAsinsFromDailyRows"), true);
  assert.equal(queriesSource.includes("fetchLogicalBookAsins"), true);
  assert.equal(queriesSource.includes("asinBelongsToLogicalBook"), true);
  assert.equal(productSource.includes("fetchBookCampaignsRange"), true);
  assert.equal(productSource.includes("bookRowMatchesOpenedAsin"), true);
  assert.equal(productSource.includes("Download latest cover file"), false);
});

test("Kindle remains the list/detail anchor for a proven sibling group", () => {
  assert.equal(primaryAsinFromGroupKey(ALASKA_GROUP, [ALASKA_PAPERBACK, ALASKA_KINDLE]), ALASKA_KINDLE);
  assert.equal(primaryAsinFromGroupKey(ITALY_GROUP, [ITALY_PAPERBACK]), ITALY_PAPERBACK);
});

test("opening either Alaska ASIN matches the same logical book row", () => {
  const row = { asin: ALASKA_KINDLE, sku: null, book_key: ALASKA_GROUP };
  assert.equal(bookRowMatchesOpenedAsin(row, ALASKA_KINDLE), true);
  assert.equal(bookRowMatchesOpenedAsin(row, ALASKA_PAPERBACK), true);
  assert.equal(bookRowMatchesOpenedAsin(row, ITALY_PAPERBACK), false);
});
