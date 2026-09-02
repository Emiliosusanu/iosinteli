import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const swipe = readFileSync(new URL("../src/components/OverviewSwipeWidget.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

test("OverviewSwipeWidget pages in-place so nested scroll cannot clip rows", () => {
  assert.match(swipe, /overview-swipe-page/);
  assert.match(swipe, /onSelect=\{setPageIndex\}/);
  assert.match(swipe, /GlassPanel/);
  assert.match(swipe, /StaggerReveal/);
  assert.match(swipe, /GestureDetector/);
  assert.match(swipe, /activeOffsetX/);
  assert.doesNotMatch(swipe, /<FlatList/);
  assert.doesNotMatch(swipe, /<ScrollView/);
  assert.doesNotMatch(swipe, /pageHeights/);
});

test("Overview campaigns query keeps a wide fill pool and longer timeout", () => {
  assert.match(home, /limit: 80/);
  assert.match(home, /TARGETING_QUERY_TIMEOUT_MS/);
});
