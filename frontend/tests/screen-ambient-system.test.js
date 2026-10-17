import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
  assert.match(ambient, /No top safe-area pad/);
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
  assert.match(topBar, /MarketPill/);
  assert.match(topBar, /selectedMarketCountryCodes/);
  assert.match(topBar, /formatMarketPillLabel/);
  assert.match(topBar, /profile-selector-btn/);
  assert.match(topBar, /countryFlagEmoji/);
  assert.doesNotMatch(topBar, /multiCountryFlagIcons/);
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

test("iOS status-bar shield tracks insets without padding, input interception or accessible decoration", () => {
  let top = 59;
  let os = "ios";
  let color = "#E8F1FF";
  const exports = {};
  vm.runInNewContext(ts.transpileModule(ambient, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports,
    require: (name) => {
      if (name === "react") return { default: { createElement: (type, props, ...children) => ({ type, props, children }) } };
      if (name === "react-native") return { Platform: { get OS() { return os; } }, View: "View", StyleSheet: { absoluteFill: {} } };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top }) };
      if (name.endsWith("/theme")) return { useTheme: () => ({ colors: { ambient_top: color } }) };
      return {};
    },
  });
  for (color of ["#E8F1FF", "#0C1830"]) {
    for (top of [0, 20, 59]) {
      const child = { type: "List" };
      const tree = exports.AppScreen({ children: child, testID: "screen" });
      assert.equal(tree.props.testID, "screen");
      assert.equal(tree.props.style.paddingTop, undefined);
      assert.equal(tree.children[1], child);
      const shield = tree.children[2];
      if (top === 0) { assert.equal(shield, null); continue; }
      assert.equal(shield.props.testID, "screen-status-bar-shield");
      assert.equal(shield.props.style.height, top);
      assert.equal(shield.props.style.backgroundColor, color);
      assert.equal(shield.props.style.position, "absolute");
      assert.ok(shield.props.style.zIndex > 0);
      assert.equal(shield.props.style.top, 0);
      assert.equal(shield.props.pointerEvents, "none");
      assert.equal(shield.props.accessible, false);
      assert.equal(shield.props.accessibilityElementsHidden, true);
      assert.equal(shield.props.importantForAccessibility, "no-hide-descendants");
    }
  }
  os = "android"; top = 24;
  assert.equal(exports.AppScreen({ children: "content" }).children[2], null);
});

test("expanded headers clear the complete safe inset without creating a sticky navigation rail", () => {
  assert.match(topBar, /paddingTop: Math.max\(insets.top, 4\)/);
  const overview = readFileSync(new URL("../src/components/OverviewHeaderV3.tsx", import.meta.url), "utf8");
  assert.match(overview, /paddingTop: Math.max\(insets.top, 0\)/);
  assert.doesNotMatch(topBar + overview, /insets.top - 4/);
  assert.match(campaigns, /topChromeVisible \? <TopBar/);
  assert.match(targeting, /topChromeVisible \? <TopBar/);
});
