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

test("campaign child previews and metrics stay scoped to the selected period", () => {
  assert.match(campaign, /campaign-keywords[\s\S]*dateRange\.start, dateRange\.end/);
  assert.match(campaign, /campaign-product-targets[\s\S]*dateRange\.start, dateRange\.end/);
  assert.match(campaign, /start: dateRange\.start/);
  assert.match(campaign, /end: dateRange\.end/);
  assert.match(campaign, /campaignChildPreviewByAdGroup/);
  assert.match(campaign, /keywordCount/);
  assert.match(campaign, /targetCount/);
  assert.match(campaign, /childPreviewLoading[\s\S]*Loading targets/);
  assert.match(campaign, /childPreviewFailed[\s\S]*Targets unavailable/);
  assert.match(campaign, /Performance metrics · \{formatDateRangeLabel\(dateRange\)\}/);
});
