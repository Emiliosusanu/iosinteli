import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const react = {
  Component: class {},
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
};
function load(file, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(file), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require });
  return exports;
}
const flatten = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];

function contrast(a, b) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test("secondary labels and selected text meet 4.5:1 on supported opaque surfaces", () => {
  const theme = load("../src/lib/theme.ts", (name) => {
    if (name === "react") return { default: react, createContext: () => ({}) };
    if (name === "react-native") return { Platform: { select: (values) => values.ios } };
    return {};
  });
  for (const colors of Object.values(theme.palette)) {
    for (const ink of ["text_secondary", "text_tertiary"]) {
      for (const surface of ["background_primary", "background_secondary", "background_elevated"]) {
        assert.ok(contrast(colors[ink], colors[surface]) >= 4.5, `${ink} on ${surface}`);
      }
    }
    assert.ok(contrast("#FFFFFF", colors.control_selected) >= 4.5);
  }
  for (const value of Object.values(theme.typography)) assert.equal(value.letterSpacing, 0);
});

test("Reduce Motion removes press scaling while preserving opacity and outer hit bounds", () => {
  for (const reduced of [false, true]) {
    let current = 0;
    const styles = [];
    const component = load("../src/components/Motion.tsx", (name) => {
      if (name === "react") return { default: react, useEffect: (fn) => fn() };
      if (name === "react-native") return { Pressable: "Pressable", StyleSheet: { create: (s) => s } };
      if (name === "react-native-reanimated") return {
        default: { View: "AnimatedView" }, Easing: { bezier: () => ({}) },
        useSharedValue: () => ({ get: () => current, set: (value) => { current = value; } }),
        useAnimatedStyle: (fn) => { styles.push(fn); return {}; },
        withSpring: (value) => value, cancelAnimation() {},
      };
      if (name.endsWith("/theme")) return { useReduceMotion: () => reduced };
      return { PRESS_SCALE: 0.972 };
    });
    const bounds = { minWidth: 44, minHeight: 44 };
    const tree = component.PressableScale({ containerStyle: bounds, style: { height: 36 }, accessibilityLabel: "Filter" });
    assert.equal(tree.props.style, bounds);
    assert.equal(tree.props.accessibilityLabel, "Filter");
    tree.props.onPressIn();
    const pressed = styles[0]();
    assert.equal(pressed.transform[0].scale, reduced ? 1 : 0.972);
    assert.ok(pressed.opacity < 1);
    tree.props.onPressOut();
    assert.equal(styles[0]().transform[0].scale, 1);
  }
});

test("settings keep long values below the label and preserve their full accessibility text", () => {
  for (const [file, name] of [
    ["../src/components/ios/Native.tsx", "IOSSettingsRow"],
    ["../src/components/settings/SettingsPrimitives.tsx", "SettingsRow"],
  ]) {
  let fontScale = 1;
  const component = load(file, (name) => {
    if (name === "react") return { default: react };
    if (name === "react-native") return {
      TouchableOpacity: "TouchableOpacity", Pressable: "Pressable", View: "View", Text: "Text",
      StyleSheet: { create: (s) => s }, Platform: { OS: "ios" },
      useWindowDimensions: () => ({ fontScale }),
    };
    if (name.endsWith("/theme")) return { dashboard: {}, useTheme: () => ({ colors: {}, typography: {} }) };
    return {};
  });
  for (fontScale of [1, 1.6, 2]) {
    const value = "publisher@example-domain.com";
    const tree = component[name]({ label: "My account", value, onPress() {} });
    const texts = flatten(tree).filter((node) => node.type === "Text");
    assert.equal(texts.length, 2);
    assert.equal(texts[1].children[0], value);
    assert.equal(tree.props.accessibilityLabel, `My account. ${value}`);
    assert.equal(texts[1].props.numberOfLines, undefined);
  }
  }
});
