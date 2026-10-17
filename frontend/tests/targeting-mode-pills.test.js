import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const pills = readFileSync(
  new URL("../src/components/TargetingModePills.tsx", import.meta.url),
  "utf8",
);
const targeting = readFileSync(
  new URL("../app/(tabs)/targeting.tsx", import.meta.url),
  "utf8",
);

test("every selected mode renders its icon and full label; the other modes render icons only", () => {
  let width = 393;
  const exports = {};
  const context = { exports, require(name) {
    if (name === "react") return { default: { createElement: (type, props, ...children) => ({ type, props, children }) } };
    if (name === "react-native") return { Text: "Text", View: "View", StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width }) };
    if (name.endsWith("/Motion")) return { PressableScale: "PressableScale" };
    if (name.endsWith("/Native")) return { SFSymbol: "SFSymbol" };
    if (name.endsWith("/theme")) return { useReduceMotion: () => true, useTheme: () => ({ colors: {} }) };
    return { playHaptic() {} };
  } };
  vm.runInNewContext(ts.transpileModule(pills, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const flatten = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];
  for (width of [320, 393, 430]) for (const option of exports.TARGETING_MODE_OPTIONS) {
    const changes = [];
    const tree = flatten(exports.TargetingModePills({ value: option.key, onChange: next => changes.push(next) }));
    const text = tree.filter(node => node.type === "Text");
    assert.equal(text.length, 1, option.key);
    assert.equal(text[0].children[0], option.label);
    assert.equal(tree.filter(node => node.type === "SFSymbol").length, 5);
    assert.equal(tree.filter(node => node.type === "PressableScale" && node.props.accessibilityState.selected).length, 1);
    for (const button of tree.filter(node => node.type === "PressableScale")) button.props.onPress();
    assert.deepEqual(changes, Array.from(exports.TARGETING_MODE_OPTIONS).filter(item => item.key !== option.key).map(item => item.key));
  }
});

test("TargetingModePills exposes five capsules with room for the selected label", () => {
  assert.match(pills, /TARGETING_MODE_OPTIONS/);
  assert.match(pills, /key:\s*"keywords"/);
  assert.match(pills, /key:\s*"asins"/);
  assert.match(pills, /key:\s*"auto"/);
  assert.match(pills, /key:\s*"category"/);
  assert.match(pills, /key:\s*"placement"/);
  assert.match(pills, /testID:\s*"segment-keywords"/);
  assert.doesNotMatch(pills, /ScrollView/);
  assert.match(pills, /flex:\s*1/);
  assert.match(pills, /styles\.slot/);
  assert.match(pills, /active && styles\.activeSlot/);
  assert.match(pills, /flex:\s*2\.3/);
  assert.match(pills, /borderRadius:\s*999/);
  assert.match(pills, /backgroundColor: active \? blue : idleBg/);
  assert.match(pills, /#FFFFFF/);
  assert.doesNotMatch(pills, /blue \+ "18"/);
  assert.doesNotMatch(pills, /auto_category/);
});

test("TargetingModePills uses brand-blue selection and SF Symbols", () => {
  assert.match(pills, /SFSymbol/);
  assert.match(pills, /key\.fill/);
  assert.match(pills, /cube\.fill/);
  assert.match(pills, /wand\.and\.stars/);
  assert.match(pills, /tag\.fill/);
  assert.match(pills, /square\.grid\.2x2\.fill/);
  assert.match(pills, /PressableScale/);
  assert.match(pills, /tone_primary/);
  assert.match(pills, /minHeight:\s*40/);
  assert.match(pills, /accessibilityState=\{\{\s*selected:\s*active/);
  assert.doesNotMatch(pills, /TouchableOpacity/);
  assert.doesNotMatch(pills, /chrome_selected/);
  assert.match(pills, /\{active \? \(/);
  assert.doesNotMatch(pills, /flexDirection: "column"/);
  assert.match(pills, /option\.label/);
});

test("Targets tab: unbundled chrome; status in filter sheet; tertiary Select", () => {
  assert.match(targeting, /TargetingModePills/);
  assert.match(targeting, /from "@\/src\/components\/TargetingModePills"/);
  assert.doesNotMatch(targeting, /FilterChrome/);
  assert.match(targeting, /testID="targeting-state-filter"/);
  assert.match(targeting, /testID="targeting-select-btn"/);
  assert.match(targeting, /\{selectMode \? "Done" : "Select all"\}/);
  assert.match(targeting, /else selectAllVisible\(\)/);
  assert.doesNotMatch(
    targeting,
    /ActiveFilterChip\s*\n\s*testID="targeting-select-btn"/,
  );
  assert.match(targeting, /DenseMetricLine/);
  assert.match(targeting, /styles\.switchWell/);
  assert.doesNotMatch(targeting, /enableFooter/);
  assert.doesNotMatch(targeting, /TargetPrimaryMetrics/);
  // Status lives in FilterSheetFields, not under the search row.
  const sheetIdx = targeting.indexOf("function FilterSheetFields");
  assert.ok(sheetIdx > 0);
  assert.doesNotMatch(targeting.slice(0, sheetIdx), /testID="targeting-state-filter"/);
  assert.match(targeting.slice(sheetIdx), /testID="targeting-state-filter"/);
  assert.match(targeting, /targeting-filter-chip-state/);
});
