import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  calculatorBreakEvenFromKdpTitle,
  formatBreakEvenAcos,
  hasAuthoritativeBreakEven,
  isOverBreakEven,
  isPlaceholderCoverUrl,
  pickCalculatorBreakEvenAcos,
  pickUsableCoverUrl,
} from "../src/lib/kdpTitlePresentation.ts";
import { logicalBookAsinsFromDailyRows } from "../src/lib/kdpBookIdentity.ts";

const SASH = "https://m.media-amazon.com/images/S/sash//sCxYoSS1zm8glOt.svg";
const ITALY_COVER = "https://images-na.ssl-images-amazon.com/images/P/B0FSSV2PRT._SY120_.jpg";
const ALASKA_COVER = "https://images-na.ssl-images-amazon.com/images/P/B0GYW7XTXQ._SY120_.jpg";
const ADS_COVER = "https://m.media-amazon.com/images/I/51bF7zdxfdL._SS60_.jpg";
const ALASKA_KINDLE = "B0F1G3QVF5";
const ALASKA_PAPERBACK = "B0GYW7XTXQ";
const ITALY = "B0FSSV2PRT";
const ALASKA_GROUP = "DIGITAL=B0F1G3QVF5:PRINT=B0GYW7XTXQ::";
const ITALY_GROUP = ":PRINT=B0FSSV2PRT::";

const persistSource = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const productSource = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const queriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const booksReadSource = readFileSync(new URL("../src/lib/kdpBooksRead.ts", import.meta.url), "utf8");

test("valid same-ASIN cover wins over sash", () => {
  assert.equal(isPlaceholderCoverUrl(SASH), true);
  assert.equal(isPlaceholderCoverUrl(ITALY_COVER), false);
  assert.equal(pickUsableCoverUrl(SASH, ITALY_COVER), ITALY_COVER);
});

test("sash plus proven sibling cover stays inside the logical book", () => {
  const asins = logicalBookAsinsFromDailyRows(ALASKA_KINDLE, [
    { asin: ALASKA_KINDLE, group_key: ALASKA_GROUP },
    { asin: ALASKA_PAPERBACK, group_key: ALASKA_GROUP },
    { asin: ITALY, group_key: ITALY_GROUP },
  ]);
  assert.deepEqual(asins.sort(), [ALASKA_KINDLE, ALASKA_PAPERBACK].sort());
  const coverByAsin = {
    [ALASKA_KINDLE]: SASH,
    [ALASKA_PAPERBACK]: ALASKA_COVER,
    [ITALY]: ITALY_COVER,
  };
  const scoped = asins.map((asin) => coverByAsin[asin]);
  assert.equal(pickUsableCoverUrl(...scoped), ALASKA_COVER);
  assert.notEqual(pickUsableCoverUrl(...scoped), ITALY_COVER);
});

test("sash plus product_ads cover is accepted", () => {
  assert.equal(pickUsableCoverUrl(SASH, ADS_COVER), ADS_COVER);
});

test("no valid cover stays empty instead of inventing one", () => {
  assert.equal(pickUsableCoverUrl(SASH, "", null), null);
});

test("unrelated book cover does not leak unless the caller passes it", () => {
  const alaskaOnly = pickUsableCoverUrl(SASH, ALASKA_COVER);
  assert.equal(alaskaOnly, ALASKA_COVER);
  assert.notEqual(alaskaOnly, ITALY_COVER);
});

test("stored target_break_even_acos is percent units, not a 0-1 ratio", () => {
  const stored = calculatorBreakEvenFromKdpTitle({
    target_break_even_acos: 43.01596688350088,
    net_royalty_per_sale: 7.274,
    kdp_list_price: 16.91,
  });
  assert.equal(stored, 43.01596688350088);
  assert.equal(formatBreakEvenAcos(stored), "43.02%");
});

test("fallback BE is net per sale / list price × 100, same as web", () => {
  assert.equal(
    calculatorBreakEvenFromKdpTitle({
      target_break_even_acos: null,
      net_royalty_per_sale: 7.274,
      kdp_list_price: 16.91,
    }),
    (7.274 / 16.91) * 100,
  );
  assert.equal(pickCalculatorBreakEvenAcos([null, 43.01596688350088]), 43.02);
});

test("missing pricing is unavailable, not 69/0/100", () => {
  assert.equal(
    calculatorBreakEvenFromKdpTitle({
      target_break_even_acos: null,
      net_royalty_per_sale: null,
      kdp_list_price: 16.91,
    }),
    null,
  );
  assert.equal(pickCalculatorBreakEvenAcos([null, 0, undefined]), 0);
  assert.equal(hasAuthoritativeBreakEven(0), false);
  assert.equal(formatBreakEvenAcos(0), "—");
  assert.equal(formatBreakEvenAcos(69), "69.00%");
});

test("ACoS and break-even stay separate; labels use calculator BE", () => {
  const acos = 62.6;
  const inventedBe = 69;
  const webBe = 43.02;
  assert.equal(isOverBreakEven(acos, inventedBe), false);
  assert.equal(isOverBreakEven(acos, webBe), true);
  assert.equal(isOverBreakEven(acos, 0), false);
  assert.equal(queriesSource.includes("allTimeRoyalties"), false);
  assert.equal(booksReadSource.includes("pickCalculatorBreakEvenAcos"), true);
  assert.equal(productSource.includes("formatBreakEvenAcos"), true);
  assert.equal(persistSource.includes("inteliads.queryCache.v4"), true);
});
