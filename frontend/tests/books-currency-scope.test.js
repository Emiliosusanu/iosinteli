import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const books = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

test("Books finance uses enabled profiles with currency in its cache scope", () => {
  assert.match(books, /booksMoneyProfileIds/);
  assert.match(books, /profileIds: moneyProfileIds/);
  assert.match(books, /moneyProfileIds, royaltyProfiles, dateRange\.start, dateRange\.end, primaryCurrency/);
});

test("Book Detail converts campaign money for the enabled portfolio", () => {
  assert.match(detail, /booksMoneyProfileIds/);
  assert.match(detail, /fetchBookCampaignsRange\([\s\S]*?profileIds: moneyProfileIds/);
  assert.match(detail, /displayCurrency: primaryCurrency/);
  assert.match(detail, /fetchTopBooksRange\([\s\S]*?profileIds: moneyProfileIds/);
});

test("Overview Top Books and catalog use only the displayed currency profiles", () => {
  const topBooksStart = overview.indexOf("const topBooksQ");
  const catalogEnd = overview.indexOf("useEffect(() =>", overview.indexOf("const catalogBooksQ"));
  const section = overview.slice(topBooksStart, catalogEnd);
  assert.match(section, /profileIds: moneyProfileIds/);
  assert.doesNotMatch(section, /profileIds: scopeProfiles/);
});
