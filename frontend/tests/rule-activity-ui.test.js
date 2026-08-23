import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RULE_ACTIVITY_LIMIT,
  activityCapCopy,
  activityChangedCount,
  activityCountsLabel,
  activityEvaluatedCount,
  activityFailedCount,
  activityIsInProgress,
  activityNavParams,
  activityRecentCopy,
  canReadRuleActivity,
  ruleActivityQueryKey,
} from "../src/lib/ruleActivityContract.ts";

const screen = readFileSync(new URL("../app/more/rule-history.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("../src/lib/ruleActivity.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/more/rule-detail/[id].tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("../app/more/automation.tsx", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/more/rule-create.tsx", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../src/lib/ruleExecutionPresentation.ts", import.meta.url), "utf8");
const labels = readFileSync(new URL("../src/lib/rulePresentation.ts", import.meta.url), "utf8");

test("rows navigate with the execution id, not the rule id", () => {
  assert.deepEqual(
    activityNavParams({
      executionId: "exec-77",
      ruleName: "Daily ACoS Control",
      executedAt: "2026-08-22T12:32:00.000Z",
      rawStatus: "completed",
      changed: 3,
    }),
    {
      id: "exec-77",
      ruleName: "Daily ACoS Control",
      executedAt: "2026-08-22T12:32:00.000Z",
      status: "completed",
      entities: "3",
    },
  );
  assert.match(helper, /executionId: run\.id/);
  assert.match(helper, /ruleId: run\.rule_id/);
  assert.match(screen, /pathname: "\/more\/rule-detail\/\[id\]"/);
  assert.match(screen, /params: activityNavParams\(row\)/);
  assert.match(screen, /item\.executionId/);
  assert.equal(screen.includes("/more/rule-create"), false);
});

test("status labels stay shared with Execution Detail", () => {
  assert.match(labels, /return "Completed"/);
  assert.match(labels, /return "Failed"/);
  assert.match(labels, /return "Partial fail"/);
  assert.match(labels, /return "Running"/);
  assert.match(labels, /return "Pending"/);
  assert.match(labels, /return "Reapplied"/);
  assert.match(helper, /presentExecutionOutcome\(\{ status: run\.status, changed, failed \}\)/);
  assert.match(screen, /presentActivityRow/);
  assert.doesNotMatch(screen, /ok = run\.status === "completed"/);
});

test("completed with zero changes is not formatted as failed", () => {
  assert.match(presentation, /if \(key === "failed"\)/);
  assert.match(presentation, /No changes needed/);
  assert.match(presentation, /This run failed/);
  assert.match(helper, /presentExecutionOutcome/);
  assert.match(helper, /countsLabel \?\? outcomeSpoken/);
});

test("partial failure copy uses real changed and failed counts", () => {
  assert.equal(activityCountsLabel({ status: "partial_fail", changed: 12, failed: 2 }), "12 changed · 2 failed");
  assert.equal(activityCountsLabel({ status: "completed", changed: 0, failed: 0 }), null);
  assert.equal(activityCountsLabel({ status: "failed", changed: 0, failed: 0 }), null);
  assert.match(presentation, /"partial_fail" \|\| key === "partial_failed"/);
  assert.match(helper, /activityCountsLabel\(\{ status: run\.status, changed, failed \}\)/);
});

test("changed and evaluated stay separate; evaluated is never invented", () => {
  assert.equal(activityChangedCount({ entities: 12 }), 12);
  assert.equal(activityFailedCount({ errors_count: 2 }), 2);
  assert.equal(activityEvaluatedCount({}), null);
  assert.equal(activityEvaluatedCount({ entities_checked: 40 }), 40);
  assert.match(helper, /activityEvaluatedCount\(run\)/);
  assert.doesNotMatch(helper, /changed \+ failed|evaluated = changed/);
  assert.doesNotMatch(screen, /When |Then |ACoS >/);
  assert.doesNotMatch(screen, /entities_checked \+|changed \+ failed/);
});

test("recent history is not presented as complete lifetime history", () => {
  assert.equal(RULE_ACTIVITY_LIMIT, 30);
  assert.equal(activityRecentCopy(), "Recent activity. Newest first.");
  assert.match(activityCapCopy(), /latest 30/);
  assert.doesNotMatch(activityCapCopy(), /All activity|Complete history|lifetime/i);
  assert.match(queries, /\.order\("executed_at", \{ ascending: false \}\)/);
  assert.match(screen, /return rightAt - leftAt/);
  assert.match(queries, /\.limit\(RULE_ACTIVITY_LIMIT\)/);
  assert.match(screen, /activityRecentCopy\(\)/);
  assert.match(screen, /activityCapCopy\(\)/);
  assert.doesNotMatch(screen, /All activity|Complete history|Rules run|Changes made/);
});

test("admin view-as cannot read the signed-in user's history", () => {
  assert.equal(
    canReadRuleActivity({ userId: "admin", guestMode: false, viewingCustomer: true, profileCount: 2 }),
    false,
  );
  assert.equal(
    canReadRuleActivity({ userId: "seller", guestMode: false, viewingCustomer: false, profileCount: 2 }),
    true,
  );
  assert.equal(
    canReadRuleActivity({ userId: "seller", guestMode: true, viewingCustomer: false, profileCount: 2 }),
    false,
  );
  assert.deepEqual(ruleActivityQueryKey("admin", "customer", ["p1"]), [
    "rule-history-page",
    "admin",
    "customer",
    ["p1"],
  ]);
  assert.match(screen, /Customer rule activity unavailable/);
  assert.match(screen, /ruleActivityQueryKey\(user\?\.id, adminFilterUserId, selectedProfileIds\)/);
  assert.match(screen, /placeholderData: undefined/);
  assert.match(screen, /enabled: canRead/);
});

test("query error is not an empty history state", () => {
  assert.match(screen, /Couldn't load rule activity/);
  assert.match(screen, /No rule activity yet/);
  assert.match(screen, /execsQ\.isError && !execsQ\.data/);
  assert.match(screen, /Couldn't refresh\. Pull to try again/);
  assert.match(screen, /Sign in to view rule activity/);
  assert.match(screen, /No profiles in the current view/);
});

test("list stays read-only: no Revert or Reapply", () => {
  assert.doesNotMatch(screen, /revertRuleExecution|reapplyRuleExecution/);
  assert.doesNotMatch(screen, /"Revert"|"Reapply"/);
  assert.match(detail, /revertRuleExecution/);
  assert.match(detail, /reapplyRuleExecution/);
  assert.doesNotMatch(screen, /createOptimizationRule|toggleOptimizationRule|deleteOptimizationRule/);
});

test("running and pending stay in progress", () => {
  assert.equal(activityIsInProgress("running"), true);
  assert.equal(activityIsInProgress("pending"), true);
  assert.equal(activityIsInProgress("completed"), false);
  assert.equal(activityCountsLabel({ status: "running", changed: 4, failed: 1 }), null);
  assert.match(presentation, /This run is still in progress/);
  assert.match(helper, /activityIsInProgress\(run\.status\)/);
});

test("current Rule name is the join, not a historical snapshot", () => {
  assert.match(helper, /optimization_rules\?\.name/);
  assert.doesNotMatch(screen, /historicalName|rule_snapshot/);
  assert.doesNotMatch(helper, /conditions|parseAction|formatCondition/);
});

test("completed Rules surfaces stay untouched by this list pass", () => {
  assert.match(list, /presentRule/);
  assert.match(detail, /presentExecutionOutcome/);
  assert.match(detail, /Evaluated count is not stored on this run/);
  assert.match(builder, /alreadyEnabled/);
});
