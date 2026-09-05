import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("../src/components/OverviewHeaderV3.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");

test("OverviewHeaderV3 is a compact two-row control bar", () => {
  assert.match(header, /testID="home-header-v3"/);
  assert.match(header, /GlassPanel/);
  assert.match(header, /styles\.row1/);
  assert.match(header, /styles\.row2/);
  assert.match(header, /PeriodToggle/);
  assert.doesNotMatch(header, /IOSSegmentedControl/);
});

test("OverviewHeaderV3 keeps period and profile accessibility", () => {
  assert.match(header, /accessibilityRole="tablist"/);
  assert.match(header, /accessibilityRole="tab"/);
  assert.match(header, /testID="home-period"/);
  assert.match(header, /home-period-month/);
  assert.match(header, /home-period-week/);
  assert.match(header, /dashboard\.headerRow/);
  assert.match(header, /Profiles,/);
  assert.match(header, /Currency,/);
  assert.match(header, /Previous period/);
  assert.match(header, /Next period/);
});

test("OverviewHeaderV3 surfaces honest period transition states", () => {
  assert.match(header, /periodLoading/);
  assert.match(header, /periodRefreshing/);
  assert.match(header, /Loading…/);
  assert.match(header, /Updating…/);
  assert.match(header, /useReduceMotion/);
});

test("Home wires OverviewHeaderV3 instead of legacy header stack", () => {
  assert.match(home, /OverviewHeaderV3/);
  assert.match(home, /periodLoading=\{periodLoading/);
  assert.match(home, /periodRefreshing=\{periodRefreshing\}/);
  assert.doesNotMatch(home, /OverviewTopRow/);
  assert.doesNotMatch(home, /OverviewDateNav/);
  assert.doesNotMatch(home, /testID="home-period"[\s\S]*IOSSegmentedControl/);
});

test("theme exposes header V3 tokens", () => {
  assert.match(theme, /headerShellRadius/);
  assert.match(theme, /headerRowGap/);
  assert.match(theme, /headerControl/);
});
