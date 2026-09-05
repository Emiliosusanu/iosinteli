import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("../app/more/ad-groups.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

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
