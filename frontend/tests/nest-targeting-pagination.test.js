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

test("ad group detail loads keywords/products without a hard 200 client slice", () => {
  assert.match(adGroupDetail, /fetchKeywords\([\s\S]*?adGroupId:\s*id/);
  assert.match(adGroupDetail, /fetchProductTargets\([\s\S]*?adGroupId:\s*id/);
  // No explicit limit:200 on the detail fetch (Nest pagination handles completeness).
  assert.doesNotMatch(
    adGroupDetail,
    /fetchKeywords\([\s\S]{0,200}limit:\s*200/,
  );
  assert.doesNotMatch(
    adGroupDetail,
    /fetchProductTargets\([\s\S]{0,200}limit:\s*200/,
  );
});
