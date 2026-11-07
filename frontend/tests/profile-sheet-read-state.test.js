import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TopBar.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const topBar = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TopBar");
const render = topBar.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "renderProfileContent");

function sheet(flags = {}) {
  assert.ok(render, "Sheet read-state handling must come from the real TopBar");
  const calls = [];
  const env = {
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    View: "View", RetryState: "RetryState", ActivityIndicator: "ActivityIndicator",
    profiles: [], profilesError: null, profilesLoading: false, profilesFetching: false,
    listMode: "ready", ...flags,
    renderKdpGroups: () => { calls.push("kdp"); return "kdp"; },
    renderProfileRows: () => { calls.push("profiles"); return "profiles"; },
    refetchProfiles: () => calls.push("retry"),
  };
  vm.runInNewContext(ts.transpileModule(`${render.getText(ast)}; globalThis.tree = renderProfileContent();`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText, env);
  return { tree: env.tree, calls };
}

test("failed account reads never become an empty Ads or KDP profile list", () => {
  for (const listMode of ["ready", "ads_only", "all", "kdp_ads"]) {
    for (const profiles of [[], [{ id: "cached" }]]) {
      const { tree, calls } = sheet({ listMode, profiles, profilesError: new Error("offline") });
      assert.equal(tree.props.testID, "profiles-sheet-error");
      const retry = tree.children[0];
      assert.equal(retry.type, "RetryState");
      assert.equal(retry.props.title, "Couldn't load accounts");
      assert.deepEqual(calls, []);
      retry.props.onRetry();
      assert.deepEqual(calls, ["retry"]);
    }
  }
});

test("initial account loading cannot advertise a verified empty profile list", () => {
  for (const flag of ["profilesLoading", "profilesFetching"]) {
    const { tree, calls } = sheet({ [flag]: true });
    assert.equal(tree.children[0].type, "ActivityIndicator");
    assert.equal(tree.children[0].props.testID, "profiles-sheet-loading");
    assert.deepEqual(calls, []);
  }
});

test("successful empty reads and retained rows still use the established list renderer", () => {
  assert.equal(sheet().tree, "profiles");
  assert.equal(sheet({ listMode: "kdp_ads" }).tree, "kdp");
  assert.equal(sheet({ profilesFetching: true, profiles: [{ id: "cached" }] }).tree, "profiles");
});

test("both sheets use the read-state guard and disable selection for an unknown scope", () => {
  const contentCalls = [];
  const buttons = [];
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "renderProfileContent") contentCalls.push(node);
    if (ts.isJsxOpeningElement(node)) {
      const id = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "testID");
      if (id?.initializer?.getText(ast).includes("select-all-profiles") || id?.initializer?.getText(ast).includes("shared-market-")) buttons.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(topBar);
  assert.equal(contentCalls.length, 2);
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    const disabled = button.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "disabled");
    assert.equal(disabled?.initializer?.getText(ast), "{profilesUnavailable}");
  }
  let gate;
  const find = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "profilesUnavailable") gate = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  };
  find(topBar);
  for (const flag of ["profilesError", "profilesLoading", "profilesFetching"]) {
    assert.equal(vm.runInNewContext(gate, { profilesError: false, profilesLoading: false, profilesFetching: false, profiles: [], [flag]: true }), true);
  }
  assert.equal(vm.runInNewContext(gate, { profilesError: false, profilesLoading: false, profilesFetching: false, profiles: [] }), false);
});
