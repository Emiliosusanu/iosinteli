import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("dashboardApi CTR/CVR stay percent (never 0–1 ratios)", () => {
  const src = readFileSync(new URL("../src/lib/dashboardApi.ts", import.meta.url), "utf8");
  assert.match(src, /ctr: impressions > 0 \? \(clicks \/ impressions\) \* 100/);
  assert.match(src, /conversion_rate: clicks > 0 \? \(orders \/ clicks\) \* 100/);
  assert.match(src, /total_ctr: impressions > 0 \? \(clicks \/ impressions\) \* 100/);
  assert.match(src, /total_conversion_rate: clicks > 0 \? \(orders \/ clicks\) \* 100/);
  assert.match(src, /mapNestCampaign[\s\S]*total_ctr: impressions > 0 \? \(clicks \/ impressions\) \* 100|mapNestCampaign[\s\S]*total_ctr: n\(r\.total_ctr/);
  assert.match(src, /isNestKeywordSortAvailable/);
  assert.match(src, /noteNestKeywordSortFailure/);
  assert.doesNotMatch(src, /ctr: impressions > 0 \? clicks \/ impressions : null/);
  assert.doesNotMatch(src, /total_ctr: impressions > 0 \? clicks \/ impressions(?!\))/);
});
