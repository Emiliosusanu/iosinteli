import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareSearchTermsAcosThenSpend, sortSearchTermsAcosThenSpend } from "../src/lib/searchTermSort.ts";
import { coalesceExactHarvestBid, DEFAULT_EXACT_HARVEST_BID } from "../src/lib/exactHarvestBid.ts";

test("exact harvest bid defaults to 0.85 and clamps", () => {
  assert.equal(DEFAULT_EXACT_HARVEST_BID, 0.85);
  assert.equal(coalesceExactHarvestBid(undefined), 0.85);
  assert.equal(coalesceExactHarvestBid(1.25), 1.25);
  assert.equal(coalesceExactHarvestBid(0.01), 0.02);
  assert.equal(coalesceExactHarvestBid(999), 100);
});

test("search terms sort by ACoS then spend", () => {
  const rows = [
    { id: "a", total_sales: 0, total_acos: 0, total_spend: 5 },
    { id: "b", total_sales: 10, total_acos: 40, total_spend: 2 },
    { id: "c", total_sales: 10, total_acos: 12, total_spend: 1 },
    { id: "d", total_sales: 0, total_acos: 0, total_spend: 9 },
  ];
  assert.deepEqual(
    sortSearchTermsAcosThenSpend(rows).map((r) => r.id),
    ["c", "b", "d", "a"],
  );
  assert.equal(compareSearchTermsAcosThenSpend(rows[0], rows[3]) > 0, true);
});

test("campaign detail keeps ACoS presentation; harvest helpers stay exported", () => {
  const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  const sortLib = readFileSync(new URL("../src/lib/searchTermSort.ts", import.meta.url), "utf8");
  const bidLib = readFileSync(new URL("../src/lib/exactHarvestBid.ts", import.meta.url), "utf8");
  assert.match(campaign, /ACoS|acos/);
  assert.match(sortLib, /sortSearchTermsAcosThenSpend/);
  assert.match(bidLib, /DEFAULT_EXACT_HARVEST_BID/);
});

test("exact harvest bid module remains the default Exact bid source", () => {
  const bidLib = readFileSync(new URL("../src/lib/exactHarvestBid.ts", import.meta.url), "utf8");
  assert.match(bidLib, /DEFAULT_EXACT_HARVEST_BID\s*=\s*0\.85/);
  assert.match(bidLib, /coalesceExactHarvestBid/);
});

test("settings exposes Default Exact bid and campaign Exact uses App default", () => {
  const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
  const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  assert.match(appContext, /defaultExactBid/);
  assert.match(appContext, /setDefaultExactBid/);
  assert.match(appContext, /EXACT_HARVEST_BID_SETTING_KEY/);
  assert.match(campaign, /bid:\s*defaultExactBid/);
  assert.match(campaign, /fastAddSearchTermExact/);
});

test("Exact button disables when search term looks targeted including isTargeted", () => {
  const harvest = readFileSync(new URL("../src/lib/searchTermHarvest.ts", import.meta.url), "utf8");
  assert.match(harvest, /isTargeted/);
  assert.match(harvest, /status === "targeted"/);
  assert.match(harvest, /enrichSearchTermsCrossCampaignTargeted/);
});

test("campaign Exact harvest optimistically marks term targeted after success", () => {
  const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
  assert.match(campaign, /setQueriesData/);
  assert.match(campaign, /status:\s*"targeted"/);
  assert.match(queries, /enrichSearchTermsCrossCampaignTargeted/);
});
