import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const billing = readFileSync(new URL("../app/more/billing.tsx", import.meta.url), "utf8");

test("Apple checkout does not advertise a web price or web trial when StoreKit has no product", () => {
  assert.doesNotMatch(billing, /formatNestPricingPlanPrice|group\.trialDays|group\.description/);
  assert.match(billing, /storeProduct\?\.description/);
});

test("StoreKit errors have their own retry and remain distinct from an empty product catalog", () => {
  assert.match(billing, /billing-store-error/);
  assert.match(billing, /billing-store-empty/);
  assert.match(billing, /storeProductsQ\.refetch/);
});

test("an unknown or refreshing current plan blocks checkout", () => {
  assert.match(billing, /currentPlanQ\.isFetching/);
  assert.match(billing, /currentPlanQ\.isError/);
  assert.match(billing, /currentPlanQ\.refetch\(\)/);
});

function rowValue(name, flags = {}) {
  const ast = ts.createSourceFile("billing.tsx", billing, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const row = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PlanRow");
  let expression;
  const find = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = node.initializer.getText(ast);
    }
    ts.forEachChild(node, find);
  };
  find(row);
  assert.ok(expression, `${name} must come from the real PlanRow`);
  return vm.runInNewContext(expression, {
    isCurrent: false, busy: false, planUnavailable: false, storeLoading: false,
    planConfirmed: true, price: undefined, busySlug: null,
    BILLING_CURRENT_PLAN_BADGE: "Current", ...flags,
  });
}

test("a settled empty Apple catalog does not keep claiming a current-plan check", () => {
  for (const planConfirmed of [true, false]) {
    assert.equal(rowValue("cta", { planConfirmed }), "Unavailable");
    assert.equal(rowValue("canPurchase", { planConfirmed }), false);
  }
});

test("only pending work shows Checking and a confirmed priced offer permits checkout", () => {
  assert.equal(rowValue("cta", { storeLoading: true }), "Checking…");
  assert.equal(rowValue("cta", { price: "$39", planConfirmed: false }), "Checking…");
  assert.equal(rowValue("canPurchase", { price: "$39", planConfirmed: false }), false);
  assert.equal(rowValue("cta", { price: "$39" }), "Continue");
  assert.equal(rowValue("canPurchase", { price: "$39" }), true);
  assert.equal(rowValue("cta", { price: "$39", planUnavailable: true }), "Unavailable");
});
