import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as targetingPage from "../src/lib/targetingPage.ts";

const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
const adGroup = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
const compareByTargetingRpcAcos = targetingPage.compareByTargetingRpcAcos;

test("campaign and ad group preserve the Targeting RPC's ACoS tie order for Greece products", () => {
  assert.equal(typeof compareByTargetingRpcAcos, "function");
  const rows = [
    { id: "27413020154562", total_sales: 0, total_acos: 0, total_spend: 0.8, total_clicks: 1, total_impressions: 22 },
    { id: "312788018524029", total_sales: 0, total_acos: 0, total_spend: 0.86, total_clicks: 1, total_impressions: 79 },
    { id: "32562532387189", total_sales: 0, total_acos: 0, total_spend: 0.75, total_clicks: 1, total_impressions: 170 },
    { id: "536935502283920", total_sales: 0, total_acos: 0, total_spend: 0.63, total_clicks: 1, total_impressions: 28 },
  ];
  assert.deepEqual(
    [...rows].sort(compareByTargetingRpcAcos).map((row) => row.id),
    ["32562532387189", "312788018524029", "536935502283920", "27413020154562"],
  );
  assert.match(campaign, /visibleProductTargets[\s\S]*?compareByTargetingRpcAcos/);
  assert.match(adGroup, /baseTargets[\s\S]*?\.sort\(compareByTargetingRpcAcos\)/);
});

test("Targeting RPC ACoS order prefers sales ACoS, then clicks, impressions, freshness and ID", () => {
  const rows = [
    { id: "b", total_sales: 0, total_acos: 0, total_clicks: 1, total_impressions: 5, metrics_updated_at: "2026-10-04T18:00:00Z" },
    { id: "a", total_sales: 0, total_acos: 0, total_clicks: 1, total_impressions: 5, metrics_updated_at: "2026-10-04T18:00:00Z" },
    { id: "new", total_sales: 0, total_acos: 0, total_clicks: 1, total_impressions: 5, metrics_updated_at: "2026-10-04T19:00:00Z" },
    { id: "clicks", total_sales: 0, total_acos: 0, total_clicks: 2, total_impressions: 1 },
    { id: "acos", total_sales: 10, total_acos: 35, total_clicks: 0, total_impressions: 1 },
  ];
  assert.deepEqual(
    [...rows].sort(compareByTargetingRpcAcos).map((row) => row.id),
    ["acos", "clicks", "new", "a", "b"],
  );
});
