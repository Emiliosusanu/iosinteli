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

test("compact edit controls keep 44 pt bounds and full placement labels without bypassing cooldown", () => {
  const alerts = [];
  const component = load("../src/components/Mutations.tsx", (name) => {
    if (name === "react") return { default: react };
    if (name === "react-native") return {
      TouchableOpacity: "TouchableOpacity", View: "View", Text: "Text",
      StyleSheet: { create: (styles) => styles }, Alert: { alert: (...args) => alerts.push(args) },
    };
    if (name.endsWith("/AppContext")) return { useApp: () => ({ entityCooldownHours: 24 }) };
    if (name.endsWith("/theme")) return { dashboard: {}, useTheme: () => ({ colors: {}, typography: {} }) };
    if (name.endsWith("/bidCooldown")) return { cooldownAlertMessage: () => "Wait before editing" };
    return {};
  });
  let edits = 0;
  for (const locked of [false, true]) {
    const tree = component.MutationTap({
      label: "Top", value: "Load", compact: true,
      accessibilityLabel: "Top of search placement bid, not loaded",
      cooldown: { isInCooldown: locked }, onPress: () => edits++,
    });
    assert.equal(tree.props.style[0].minHeight, 44);
    assert.equal(tree.props.style[0].maxWidth, "100%");
    assert.equal(tree.props.accessibilityLabel,
      `Top of search placement bid, not loaded${locked ? ", cooldown" : ""}`);
    tree.props.onPress();
  }
  assert.equal(edits, 1);
  assert.equal(alerts.length, 1);
  const fallback = component.MutationTap({ label: "Bid", value: "$0.75", onPress() {} });
  assert.equal(fallback.props.accessibilityLabel, "Bid $0.75");
  const campaigns = source("../app/(tabs)/campaigns.tsx");
  assert.match(campaigns, /: "Load"/);
  assert.match(campaigns, /field\.title} placement bid/);
});

test("campaign card touch feedback does not group and hide its independent controls", () => {
  const code = source("../app/(tabs)/campaigns.tsx");
  const ast = ts.createSourceFile("campaigns.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const card = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AnimatedCard");
  assert.ok(card);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`${card.getText(ast)}\nexports.card = AnimatedCard;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, React: react, useReduceMotion: () => true, useRef: (current) => ({ current }),
    Animated: { View: "AnimatedView", Value: class {} }, TouchableOpacity: "TouchableOpacity",
  });
  let opens = 0;
  const tree = exports.card({ children: "controls", onPress: () => opens++ });
  const press = tree.children[0];
  assert.equal(press.props.accessible, false);
  assert.equal(press.props.accessibilityRole, undefined);
  press.props.onPress();
  assert.equal(opens, 1);
  assert.match(code, /<TouchableOpacity\s+testID=\{`campaign-row-\$\{item.id\}`\}\s+accessibilityRole="button"/);
  assert.match(code, /onPress=\{openDetails\}\s+onLongPress=\{openStrategy\}/);
  assert.match(code, /const openStrategy = \(\) => \{\s+if \(blockIfCannotWriteAmazon\(writeGuard\)\) return/);
});

test("campaign budget and strategy have real 44 pt bounds and the native switch is not scaled down", () => {
  const code = source("../app/(tabs)/campaigns.tsx");
  const ast = ts.createSourceFile("campaigns.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles = ast.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find((node) => node.name.getText(ast) === "styles");
  const values = vm.runInNewContext(styles.initializer.getText(ast), {
    StyleSheet: { create: (value) => value, hairlineWidth: 0.5 }, layout: { minTap: 44 },
    dashboard: {}, spacing: { xs: 4, sm: 8 },
  });
  for (const name of ["budgetChip", "strategyButton"]) {
    assert.equal(values[name].minHeight, 44);
    assert.equal(values[name].minWidth, 44);
  }
  assert.equal(values.strategyButton.maxWidth, "100%");
  assert.ok(values.switchWell.minWidth >= 51);
  assert.equal(values.switchWell.minHeight, 44);
  assert.match(code, /<EntityStateSwitch\s+enabled=\{item.state === "enabled"\}\s+compact=\{false\}/);
});

test("campaign control labels distinguish edits and preserve their write guards", () => {
  const ast = ts.createSourceFile("campaigns.tsx", source("../app/(tabs)/campaigns.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buttons = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "TouchableOpacity"
      && node.openingElement.attributes.properties.some((attr) => ts.isJsxAttribute(attr)
        && attr.name.getText(ast) === "testID" && /campaign-(budget|strategy)-\$\{item.id\}/.test(attr.getText(ast)))) {
      buttons.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(buttons.length, 2);
  for (const blocked of [false, true]) {
    const opened = [];
    const exports = {};
    vm.runInNewContext(ts.transpileModule(`exports.buttons = [${buttons.map((node) => node.getText(ast)).join(",")}];`, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      exports, React: react, TouchableOpacity: "button", Text: "Text", SFSymbol: "icon",
      styles: {}, t: { colors: {}, typography: {} }, settingsCooldown: { isInCooldown: true },
      strategy: "Dynamic bids - down only", isDynamicBiddingStrategy: () => true,
      item: { id: "campaign-1", name: "Example", budget: 10, bidding_strategy: "LEGACY_FOR_SALES" },
      rowCurrency: "CAD", formatCurrency: (value, currency) => `${currency} ${value}`,
      writeGuard: { canWrite: !blocked }, blockIfCannotWriteAmazon: (guard) => !guard.canWrite,
      Haptics: { selectionAsync() {} }, setBudgetEdit: (value) => opened.push(value),
      setStrategyEdit: (value) => opened.push(value),
    });
    const [budget, strategy] = exports.buttons;
    for (const control of [budget, strategy]) {
      assert.equal(control.props.accessibilityRole, "button");
      assert.match(control.props.accessibilityHint, /writes Amazon Ads/);
      control.props.onPress();
    }
    assert.match(budget.props.accessibilityLabel, /Daily budget CAD 10/);
    assert.equal(strategy.props.accessibilityLabel, "Bidding strategy: Dynamic bids - down only, cooldown");
    assert.equal(opened.length, blocked ? 0 : 2);
    if (!blocked) {
      assert.equal(opened[0].id, "campaign-1");
      assert.equal(opened[1].strategy, "LEGACY_FOR_SALES");
    }
  }
});
