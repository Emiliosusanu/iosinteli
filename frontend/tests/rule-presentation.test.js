import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCurrency, formatPercent } from "../src/lib/format.ts";

const presentation = readFileSync(new URL("../src/lib/rulePresentation.ts", import.meta.url), "utf8");
const list = readFileSync(new URL("../app/more/automation.tsx", import.meta.url), "utf8");

test("money and percent formatting stay distinguishable", () => {
  assert.equal(formatCurrency(0.1, "USD"), "$0.10");
  assert.equal(formatPercent(10, 0), "10%");
  assert.equal(formatCurrency(12, "USD"), "$12.00");
  assert.match(presentation, /valueType === "percent"/);
  assert.match(presentation, /ACTION_USES_VALUETYPE/);
  assert.match(presentation, /formatCurrency/);
  assert.match(presentation, /formatPercent/);
});

test("Rules list presents When\/Then without changing engine semantics", () => {
  assert.match(list, /presentRule/);
  assert.match(list, /When /);
  assert.match(list, /Then /);
  assert.match(presentation, /formatCondition/);
  assert.match(presentation, /ACTION_LABELS/);
  assert.equal(list.includes("toggleOptimizationRule"), true);
  assert.equal(list.includes("Enable rule?"), true);
  assert.equal(list.includes("This rule will start changing bids or budgets on its schedule."), true);
  assert.equal(list.includes("EntityStateSwitch"), false);
  assert.equal(list.includes("createOptimizationRule"), false);
  assert.equal(list.includes("deleteOptimizationRule"), false);
});

test("Rules list keeps enable state, errors, and guest safety separate", () => {
  assert.match(presentation, /"Enabled"/);
  assert.match(presentation, /"Disabled"/);
  assert.match(list, /presented\.stateLabel/);
  assert.match(list, /RetryState/);
  assert.match(list, /SIGN_IN_TO_MUTATE_MESSAGE/);
  assert.match(list, /Couldn't load rules/);
  assert.match(list, /No rules yet/);
  assert.match(list, /No account connected/);
  assert.match(list, /toggleMutation\.variables\?\.id === rule\.id/);
  assert.match(list, /Opens the rule editor/);
  assert.match(list, /accessibilityLabel: "New rule"/);
});
