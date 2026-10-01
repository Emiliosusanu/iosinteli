import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const campaign = readFileSync(
  new URL("../app/campaign/[id].tsx", import.meta.url),
  "utf8",
);

test("campaign detail keeps paused children visible and writable", () => {
  assert.match(campaign, /const activeChildrenOnly = childState === "enabled"/);
  assert.match(campaign, /campaign-keyword-state-/);
  assert.match(campaign, /updateKeywordManual\(kw\.id, \{ status: next \? "enabled" : "paused" \}\)/);
  assert.match(campaign, /campaign-target-state-/);
  assert.match(campaign, /updateProductTargetManual\(pt\.id, \{ state: next \? "enabled" : "paused" \}\)/);
  assert.match(campaign, /applyOptimisticEntityState/);
  assert.match(campaign, /revertOptimisticEntityState/);
});

test("campaign keyword, product and auto rows label every performance metric", () => {
  for (const label of ["Spend", "Impr", "Clicks", "Orders", "ACoS"]) {
    assert.match(campaign, new RegExp(`label: "${label}"`));
  }
  assert.match(campaign, /DenseMetricLine items=\{campaignTargetMetricItems\(kw/);
  assert.match(campaign, /DenseMetricLine items=\{campaignTargetMetricItems\(pt/);
  assert.match(campaign, /variant="auto"/);
});
