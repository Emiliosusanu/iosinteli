import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");

test("Books header scrolls in the native list instead of changing the viewport height", () => {
  assert.match(products, /ListHeaderComponent=\{listHeader\}/);
  assert.match(products, /books-scroll-chrome/);
  assert.doesNotMatch(products, /chromeAnimatedStyle|useScrollChromeCollapse|marginBottom:\s*-|onBooksScroll/);
});
