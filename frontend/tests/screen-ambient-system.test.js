import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ambient = readFileSync(new URL("../src/components/ScreenAmbient.tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../src/components/Primitives.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/components/ios/Native.tsx", import.meta.url), "utf8");
const sub = readFileSync(new URL("../src/components/SubScreen.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/components/auth/AuthChrome.tsx", import.meta.url), "utf8");
const welcome = readFileSync(new URL("../app/auth/welcome.tsx", import.meta.url), "utf8");
const more = readFileSync(new URL("../app/(tabs)/more.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const campaigns = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");

test("dashboard tokens stay the Dribbble card/chip radii", () => {
  assert.match(theme, /cardRadius: 20/);
  assert.match(theme, /chipRadius: 12/);
});

test("ScreenAmbient reuses the Overview wash, not a new palette", () => {
  assert.match(ambient, /ambient_top/);
  assert.match(ambient, /ambient_mid/);
  assert.match(ambient, /locations=\{\[0, 0\.28, 0\.55\]\}/);
  assert.match(ambient, /export function AppScreen/);
  assert.match(ambient, /dashboard\.cardRadius/);
  assert.match(ambient, /glass_stroke/);
});

test("tabs, SubScreen, and auth inherit the same wash", () => {
  for (const src of [home, campaigns, targeting, products, more]) {
    assert.match(src, /AppScreen/);
    assert.doesNotMatch(src, /SafeAreaView/);
  }
  assert.match(sub, /<ScreenAmbient/);
  assert.match(auth, /<ScreenAmbient/);
  assert.match(welcome, /<ScreenAmbient/);
});

test("filters and buttons share the Overview glass chip chrome", () => {
  assert.match(ambient, /export function glassControlStyle/);
  assert.match(primitives, /export function FilterIconButton/);
  assert.match(primitives, /export function ActiveFilterChip/);
  assert.match(primitives, /headerShellRadius/);
  assert.match(primitives, /glass_background/);
  assert.match(campaigns, /FilterIconButton/);
  assert.match(targeting, /FilterIconButton/);
  assert.match(native, /dashboard\.chipRadius/);
  assert.match(native, /dashboard\.metricChipRadius/);
  assert.match(native, /tone_primary \+ "55"/);
  assert.match(topBar, /glass_background/);
});

test("shared cards and grouped lists use the 20pt elevated chrome", () => {
  assert.match(primitives, /elevatedCardStyle\(t\)/);
  assert.match(primitives, /export function ListCard/);
  assert.match(primitives, /export function SectionCard/);
  assert.match(native, /dashboard\.cardRadius/);
  assert.match(more, /elevatedCardStyle\(t\)/);
  assert.match(topBar, /dashboard\.cardRadius/);
  assert.match(topBar, /dashboard\.chipRadius/);
});
