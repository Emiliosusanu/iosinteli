import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatCurrency, formatPercent, parseLocaleNumber } from "../src/lib/format.ts";

const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/more/rule-create.tsx", import.meta.url), "utf8");
const payload = readFileSync(new URL("../src/lib/ruleBuilderPayload.ts", import.meta.url), "utf8");

test("create stays disabled by default in the Nest payload", () => {
  assert.match(queries, /enabled: false/);
  assert.match(queries, /Rules are ALWAYS created disabled/);
  assert.match(builder, /Create rule \(off\)/);
  assert.match(builder, /New rules start/);
  assert.equal(builder.includes("createOptimizationRule"), true);
});

test("edit update does not send enabled or target entity", () => {
  assert.match(queries, /Leaves enabled \+ target entity unchanged/);
  assert.match(builder, /updateOptimizationRule\(editId/);
  assert.equal(builder.includes("enabled: true"), false);
});

test("locale decimals parse without changing stored numbers", () => {
  assert.equal(parseLocaleNumber("0,65"), 0.65);
  assert.equal(parseLocaleNumber("10"), 10);
  assert.equal(parseLocaleNumber("0.10"), 0.1);
  assert.equal(Number.isFinite(parseLocaleNumber("")), false);
  assert.equal(formatCurrency(0.65, "USD"), "$0.65");
  assert.equal(formatPercent(10, 0), "10%");
});

test("payload builder drops leftover amounts on pause and harvest", () => {
  assert.match(payload, /HARVEST_ACTIONS.has\(actionType\)/);
  assert.match(payload, /ACTION_NEEDS_VALUE.has\(actionType\)/);
  assert.match(payload, /ACTION_USES_VALUETYPE.has\(actionType\) \? valueType : "fixed"/);
  assert.match(payload, /add_negative_keyword"\) return \["exact", "phrase"\]/);
  assert.match(builder, /setActionValue\(""\)/);
});

test("edit hydration preserves snake_case units and maps leftover negative broad to phrase", () => {
  assert.match(payload, /function hydrateRuleParam/);
  assert.match(payload, /function resolveMatchType/);
  assert.match(payload, /function resolveValueType/);
  assert.match(payload, /valueType \?\? action\?\.value_type/);
  assert.match(payload, /allowed.includes\("phrase"\) \? "phrase"/);
  assert.match(builder, /hydrateRuleParam/);
  assert.match(builder, /accounts saved on this rule|every \$\{scopeSingular/);
  assert.match(builder, /not one selected/);
  assert.match(builder, /setName\(typeof initial.name === "string" \? initial.name : ""\)/);
  assert.match(builder, /\[editing, editId, params.rule\]/);
});

test("builder keeps guest, edit-load, units, and list formatter hooks", () => {
  assert.match(builder, /SIGN_IN_TO_MUTATE_MESSAGE/);
  assert.match(builder, /Couldn't open this rule/);
  assert.match(builder, /formatCondition/);
  assert.match(builder, /formatAction/);
  assert.match(builder, /When all of these are true/);
  assert.match(builder, /metricUnitSuffix/);
  assert.match(builder, /Create rule \(off\)/);
  assert.match(builder, /This rule is on/);
  assert.match(builder, /This rule is off/);
});
