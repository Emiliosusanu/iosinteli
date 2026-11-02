/**
 * Responsive floating dock + frosted Overview sticky chrome.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { dockScaleForWidth } from "../src/lib/dockScale.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tabBar = readFileSync(join(root, "src/components/FloatingTabBar.tsx"), "utf8");
const header = readFileSync(
  join(root, "src/components/OverviewHeaderV3.tsx"),
  "utf8",
);

test("bottom navigation shows one selected inline label and five icons at phone widths", () => {
  let width = 393;
  const exports = {};
  const react = { createElement: (type, props, ...children) => typeof type === "function" ? type({ ...props, children }) : ({ type, props, children }) };
  const context = { exports, require(name) {
    if (name === "react") return { default: react, useMemo: fn => fn(), useEffect: fn => fn() };
    if (name === "react-native") return { Text: "Text", View: "View", StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) };
    if (name === "react-native-reanimated") return { default: { View: "AnimatedView" }, useSharedValue: value => ({ get: () => value, set: next => { value = next; } }), useAnimatedStyle: fn => fn(), withSpring: value => value };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 34 }) };
    if (name.endsWith("/Motion")) return { PressableScale: "PressableScale" };
    if (name.endsWith("/Native")) return { SFSymbol: "SFSymbol" };
    if (name.endsWith("/dockScale")) return { dockScaleForWidth };
    if (name.endsWith("/theme")) return { useReduceMotion: () => true, useTheme: () => ({ colors: { tone_primary: "#0A84FF" }, shadow: { floating: {} } }) };
    return { playHaptic() {} };
  } };
  vm.runInNewContext(ts.transpileModule(tabBar, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const routes = ["index", "campaigns", "targeting", "products", "more"].map(name => ({ name, key: name }));
  const labels = ["Home", "Campaigns", "Targets", "Books", "More"];
  const flatten = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];
  for (width of [320, 393, 430]) for (let index = 0; index < routes.length; index++) {
    const tree = flatten(exports.FloatingTabBar({ state: { index, routes }, descriptors: Object.fromEntries(routes.map(route => [route.key, { options: {} }])), navigation: {} }));
    const text = tree.filter(node => node.type === "Text");
    assert.equal(text.length, 1); assert.equal(text[0].children[0], labels[index]);
    assert.equal(tree.filter(node => node.type === "SFSymbol").length, 5);
    assert.equal(tree.filter(node => node.type === "PressableScale" && node.props.accessibilityState.selected).length, 1);
  }
});

test("dockScaleForWidth grows tap targets across sm/md/lg", () => {
  const sm = dockScaleForWidth(350);
  const md = dockScaleForWidth(400);
  const lg = dockScaleForWidth(430);
  const xl = dockScaleForWidth(800);
  assert.equal(sm.tier, "sm");
  assert.equal(md.tier, "md");
  assert.equal(lg.tier, "lg");
  assert.ok(sm.segmentMinHeight >= 48);
  assert.ok(md.segmentMinHeight > sm.segmentMinHeight);
  assert.ok(lg.icon >= md.icon);
  assert.ok(xl.maxWidth >= lg.maxWidth);
  assert.ok(xl.icon >= lg.icon);
});

test("FloatingTabBar uses solid theme-synced dock and is adaptive", () => {
  assert.match(tabBar, /PressableScale/);
  assert.match(tabBar, /dockScaleForWidth/);
  assert.match(tabBar, /tab-rail-\$\{scale\.tier\}/);
  assert.match(tabBar, /tabbar_background/);
  assert.match(tabBar, /shadow\.floating/);
  assert.match(tabBar, /withSpring/);
  assert.match(tabBar, /activePill/);
  // Inline selected label and icon, matching the top Targets selector.
  assert.match(tabBar, /house\.fill/);
  assert.match(tabBar, /megaphone\.fill/);
  assert.match(tabBar, /books\.vertical/);
  assert.match(tabBar, /flexDirection: "row"/);
  assert.doesNotMatch(tabBar, /flexDirection: "column"/);
  assert.match(tabBar, /focused && styles\.segmentSlotActive/);
  assert.match(tabBar, /selectedFg|tabbar_selected_fg/);
  assert.doesNotMatch(tabBar, /shadowOpacity:\s*0\.42/);
  assert.doesNotMatch(tabBar, /InteliAdsIcon/);
  assert.doesNotMatch(tabBar, /BlurView/);
});

test("Overview sticky chrome uses native BlurView frost + stadium period", () => {
  assert.match(header, /BlurView/);
  assert.match(header, /tint=\{chrome\.scheme === "dark" \? "dark"/);
  assert.match(header, /systemChromeMaterialLight/);
  assert.match(header, /overview-sticky-blur-/);
  assert.match(header, /stickyRgbSV/);
  assert.match(header, /home-header-compact/);
  assert.match(header, /home-period/);
  assert.match(header, /sun\.max/);
  assert.match(header, /roomy/);
});
