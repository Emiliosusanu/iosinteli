import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCurrency, formatPercent } from "../src/lib/format.ts";

const presentation = readFileSync(new URL("../src/lib/ruleExecutionPresentation.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../app/more/rule-detail/[id].tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("../app/more/automation.tsx", import.meta.url), "utf8");

test("before/after units stay distinguishable", () => {
  assert.equal(formatCurrency(0.79, "USD"), "$0.79");
  assert.equal(formatCurrency(0.71, "USD"), "$0.71");
  assert.equal(formatPercent(10, 0), "10%");
  assert.match(presentation, /isMoneyAction/);
  assert.match(presentation, /isPercentAction/);
  assert.match(presentation, /isStateAction/);
  assert.match(presentation, /Enabled/);
  assert.match(presentation, /Paused/);
  assert.match(presentation, /\$\{before\} → \$\{after\}/);
});

test("no-change completed is not formatted as failed", () => {
  assert.match(presentation, /No changes needed/);
  assert.match(presentation, /This run failed/);
  assert.match(presentation, /Finished with/);
  assert.match(presentation, /Changed \$\{input.changed\}/);
  assert.equal(presentation.includes("Made ${changed}"), false);
});

test("entity result and safe errors stay historical", () => {
  assert.match(presentation, /"Changed" \| "Failed" \| "No change"/);
  assert.match(presentation, /Amazon rejected this change/);
  assert.match(presentation, /access_token/);
  assert.match(presentation, /raw.length > 180/);
  assert.match(screen, /formatBeforeAfter\(entity.action_type, entity.old_value, entity.new_value/);
  assert.match(screen, /safeExecutionError/);
  assert.match(screen, /fetchRuleExecutionEntities\(\[id\]\)/);
});

test("execution detail stays an audit surface with existing Amazon writes demoted", () => {
  assert.match(screen, /This run/);
  assert.match(screen, /No changes needed/);
  assert.match(screen, /Couldn't load entities/);
  assert.match(screen, /The run summary above is still from this execution/);
  assert.match(screen, /write to Amazon/);
  assert.match(screen, /revertRuleExecution/);
  assert.match(screen, /reapplyRuleExecution/);
  assert.match(screen, /ListFooterComponent/);
  assert.match(screen, /Evaluated count is not stored on this run/);
  assert.equal(screen.includes("createOptimizationRule"), false);
  assert.equal(screen.includes("toggleOptimizationRule"), false);
  assert.match(list, /pathname: "\/more\/rule-detail\/\[id\]"/);
});
