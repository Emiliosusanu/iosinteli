/**
 * Nest keyword/product-target lists clamp per_page at 200 — clients must paginate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "src/lib/dashboardApi.ts"), "utf8");
const adGroupDetail = readFileSync(
  join(root, "app/more/ad-group/[id].tsx"),
  "utf8",
);

test("dashboardApi paginates Nest keywords past NEST_TARGETING_MAX_PAGE_SIZE", () => {
  assert.match(dash, /NEST_TARGETING_MAX_PAGE_SIZE\s*=\s*200/);
  assert.match(dash, /Math\.min\(want, NEST_TARGETING_MAX_PAGE_SIZE\)/);
  assert.match(dash, /NEST_TARGETING_MAX_PAGES/);
  assert.match(
    dash,
    /export async function fetchNestKeywords[\s\S]*?for \(let page = 1;/,
  );
  assert.match(
    dash,
    /export async function fetchNestProductTargets[\s\S]*?for \(let page = 1;/,
  );
  assert.match(dash, /if \(batch\.length < pageSize\) break/);
  // Must not hard-stop at a single page:1 fetch.
  assert.doesNotMatch(
    dash,
    /fetchNestKeywords[\s\S]{0,400}page:\s*1,[\s\S]{0,200}Couldn't load keywords/,
  );
});

test("ad group detail ranks the complete exact-period catalog before its 200-row render cap", () => {
  assert.match(adGroupDetail, /fetchExactCampaignTargetingCatalog/);
  assert.match(adGroupDetail, /catalog\.keywords\.filter/);
  assert.match(adGroupDetail, /catalog\.productTargets\.filter/);
  assert.match(adGroupDetail, /AD_GROUP_TARGET_DISPLAY_LIMIT\s*=\s*200/);
  assert.match(adGroupDetail, /\.slice\(0, AD_GROUP_TARGET_DISPLAY_LIMIT\)/);
  // The cap is applied to the already complete RPC catalog, never sent as a
  // server fetch limit that could hide a higher-ranked row after position 200.
  assert.doesNotMatch(adGroupDetail, /pageSize:\s*AD_GROUP_TARGET_DISPLAY_LIMIT/);
});
