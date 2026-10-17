import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as accounts from "../src/lib/accountsUi.ts";

const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/MarketPill.tsx", import.meta.url), "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, require(name) {
  if (name === "react") return { default: react, useMemo: (fn) => fn(), useState: () => [null, () => {}] };
  if (name === "react-native") return { View: "View", Text: "Text", Platform: { OS: "ios" }, StyleSheet: { create: (s) => s } };
  if (name.endsWith("/accountsUi")) return accounts;
  if (name.endsWith("/theme")) return { useTheme: () => ({ scheme: "light", colors: {}, typography: {} }) };
  if (name.endsWith("/Motion")) return { PressableScale: "PressableScale" };
  return {};
} });
const flatten = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];

test("four selected markets render four separate full flags, also in compact mode", () => {
  for (const compact of [false, true]) {
    const tree = flatten(exports.MarketFlagStack({ countries: ["AU", "GB", "CA", "US", "UK"], compact }));
    const flags = tree.filter((node) => node.type === "Text");
    assert.equal(flags.length, 4);
    assert.deepEqual(flags.map((node) => node.children[0]), ["US", "CA", "GB", "AU"].map(accounts.countryFlagEmoji));
    assert.ok(!tree.some((node) => node.props.testID === "multi-country-overflow"));
    for (const flag of flags) {
      assert.equal(flag.props.allowFontScaling, false);
      const styles = flag.props.style;
      assert.equal(styles[0].transform, undefined);
    }
  }
});

test("extra markets never disappear silently from compact flags", () => {
  const tree = flatten(exports.MarketFlagStack({ countries: ["US", "CA", "GB", "AU", "DE", "FR"], compact: true }));
  const overflow = tree.find((node) => node.props.testID === "multi-country-overflow");
  assert.ok(overflow);
  assert.deepEqual(flatten(overflow).find((node) => node.type === "Text").children, ["+", 3]);
});

test("compact multi-market selector stays icon-led with full spoken context and 44 pt bounds", () => {
  let opens = 0;
  for (const countries of [["US"], ["US", "CA", "GB", "AU"]]) {
    const tree = flatten(exports.MarketPill({ countries, currency: "USD", compact: true, onPress: () => opens++ }));
    const button = tree.find((node) => node.type === "PressableScale");
    assert.equal(button.props.containerStyle.minHeight, 44);
    assert.equal(button.props.accessibilityLabel, `Profiles, ${accounts.formatMarketPillLabel(countries, "USD")}`);
    const text = tree.filter((node) => node.type === "Text");
    assert.equal(text.length, countries.length === 1 ? 1 : 0);
    button.props.onPress();
  }
  assert.equal(opens, 2);
});

test("header flags reflect only selected enabled profiles, including external profile IDs", () => {
  const profiles = [
    { id: "a", profile_id: "amazon-a", country_code: "US", is_enabled: true },
    { id: "b", profile_id: "amazon-b", country_code: "CA", is_enabled: true },
    { id: "c", profile_id: "amazon-c", country_code: "GB", is_enabled: false },
  ];
  assert.deepEqual(accounts.selectedMarketCountryCodes(profiles, []), []);
  assert.deepEqual(accounts.selectedMarketCountryCodes(profiles, ["missing"]), []);
  assert.deepEqual(accounts.selectedMarketCountryCodes(profiles, ["amazon-a", "c"]), ["US"]);
  assert.deepEqual(accounts.selectedMarketCountryCodes(profiles, ["a", "amazon-b"]), ["US", "CA"]);
});

test("measured narrow controls reserve chevron space and show counted overflow", () => {
  for (const width of [80, 96, 122, 188, 300]) {
    const capacity = exports.marketFlagCapacity(width, true, false);
    assert.ok(capacity >= 2 && capacity <= 4);
    const tree = flatten(exports.MarketFlagStack({ countries: ["US", "CA", "GB", "AU"], compact: true, maxVisible: capacity }));
    const texts = tree.filter((node) => node.type === "Text");
    assert.ok(texts.length * 20 + (texts.length - 1) * 3 + 32 <= width);
    assert.equal(Boolean(tree.find((node) => node.props.testID === "multi-country-overflow")), capacity < 4);
  }
});
