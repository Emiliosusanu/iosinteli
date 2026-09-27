/**
 * Books list chrome: soft Reanimated collapse (opacity + translateY + margin),
 * reduce-motion snap, no mount/unmount.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(
  join(root, "src/hooks/useScrollChromeCollapse.ts"),
  "utf8",
);
const products = readFileSync(join(root, "app/(tabs)/products.tsx"), "utf8");

test("useScrollChromeCollapse animates opacity + translateY + marginBottom", () => {
  assert.match(hook, /useAnimatedScrollHandler/);
  assert.match(hook, /useAnimatedStyle/);
  assert.match(hook, /withTiming/);
  assert.match(hook, /translateY/);
  assert.match(hook, /marginBottom/);
  assert.match(hook, /opacity/);
  assert.match(hook, /SCROLL_CHROME_HIDE_Y/);
  assert.match(hook, /SCROLL_CHROME_SHOW_Y/);
  assert.match(hook, /CHROME_TIMING_MS/);
  assert.match(hook, /reduceSV/);
});

test("Books wires scroll chrome collapse without unmounting TopBar", () => {
  assert.match(products, /useScrollChromeCollapse/);
  assert.match(products, /books-scroll-chrome/);
  assert.match(products, /onChromeLayout/);
  assert.match(products, /chromeAnimatedStyle/);
  assert.match(products, /onBooksScroll/);
  assert.match(products, /<TopBar \/>/);
  assert.match(products, /FilterChrome/);
  assert.doesNotMatch(products, /topChromeVisible \?/);
});
