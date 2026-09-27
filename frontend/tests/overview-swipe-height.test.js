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
  assert.match(swipe, /bottomNav/);
  assert.match(swipe, /blocksExternalGesture/);
  // Page 2 must be reachable without fighting the chart scrub.
  assert.match(swipe, /chevron\.(left|right)/);
  assert.match(swipe, /Next widget page/);
  assert.match(swipe, /OverviewWidgetPageSwipeContext/);
  assert.match(swipe, /title\} · \$\{pageLabel\}/);
  assert.doesNotMatch(swipe, /<FlatList/);
  assert.doesNotMatch(swipe, /<ScrollView/);
  assert.doesNotMatch(swipe, /pageHeights/);
});

test("chart day scrub blocks widget page pan (not only period chrome)", () => {
  const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
  assert.match(charts, /useOverviewWidgetPageSwipeGesture/);
  assert.match(charts, /blocksExternalGesture\(widgetPageSwipe\)/);
});

test("Overview date page swipe lives outside chart plots", () => {
  assert.match(home, /createOverviewPeriodPan/);
  assert.match(home, /OverviewPeriodSwipeProvider/);
  assert.match(home, /Swipe a day on the chart/);
});

test("Overview campaigns query keeps a wide fill pool and longer timeout", () => {
  assert.match(home, /limit: 80/);
  assert.match(home, /TARGETING_QUERY_TIMEOUT_MS/);
});
