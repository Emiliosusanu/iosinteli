import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("../app/more/ad-groups.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
const addTargets = readFileSync(new URL("../app/adgroup/add-targets.tsx", import.meta.url), "utf8");

test("ad groups list is scoped, capped, and cannot spin pull-to-refresh forever", () => {
  assert.match(queries, /export const AD_GROUPS_LIST_LIMIT = 500/);
  assert.match(queries, /enrichCounts/);
  assert.match(queries, /adGroupIds\.length <= 120/);
  assert.match(screen, /AD_GROUPS_LIST_LIMIT/);
  assert.match(screen, /enrichCounts: false/);
  assert.match(screen, /withQueryTimeout/);
  assert.match(screen, /setRefreshing\(false\)/);
  assert.match(screen, /Ad groups took too long/);
  assert.match(screen, /sortedProfileIds\(selectedProfileIds\)/);
  assert.match(screen, /top \$\{AD_GROUPS_LIST_LIMIT\} by spend/);
  assert.match(home, /limit: 80/);
  assert.match(home, /enrichCounts: false/);
});

test("ad group detail and add-target screens load one scoped group", () => {
  assert.match(queries, /export async function fetchAdGroupById/);
  assert.match(queries, /\.eq\("id", id\)/);
  assert.match(queries, /\.in\("amazon_profile_id", profileIds\)/);
  assert.match(detail, /fetchAdGroupById\(id, selectedProfileIds/);
  assert.doesNotMatch(detail, /fetchAdGroups\(selectedProfileIds/);
  assert.match(addTargets, /fetchAdGroupById\(adGroupId, selectedProfileIds/);
  assert.doesNotMatch(addTargets, /fetchAdGroups\(selectedProfileIds/);
  assert.match(queries, /fetchAdGroupAutomationHistory[\s\S]*fetchAdGroupById\(adGroupId, profileIds\)/);
});
