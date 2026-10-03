import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const digest = readFileSync(new URL("../src/lib/notificationDigest.ts", import.meta.url), "utf8");

test("runAlertCheck uses full activated money scope + FX USD rollup and honest totals", () => {
  assert.match(notifications, /digestMoneyAdsProfileIds/);
  assert.match(notifications, /digestFetchGroupsForMoney/);
  assert.match(notifications, /nestMoneyHiddenForDigest/);
  assert.match(notifications, /digestNativeCurrencyFetchGroups/);
  assert.match(notifications, /activatedAdsProfileIds/);
  assert.match(notifications, /honestTotalsFromDayPoint/);
  assert.match(notifications, /formatDigestBody/);
  assert.match(notifications, /countFreshCompletedProfiles/);
  assert.match(notifications, /digestCoverageLine/);
  assert.match(notifications, /fetchMobileOverview/);
  // A metadata failure keeps a selected-scope fallback instead of mixing UUIDs.
  assert.match(notifications, /adsProfileIdsForSelection/);
  // Per-currency-only grouping (no FX) must not drive digests anymore.
  assert.doesNotMatch(notifications, /groupActivatedProfilesByCurrency/);
  assert.doesNotMatch(
    notifications,
    /queryIds = uniqueProfileIds\(profiles\.map\(\(p\) => p\.profile_id \|\| p\.id\)\)/,
  );
  // Empty profile catalog must abort — no mixed-id Nest frankensum.
  assert.match(notifications, /if \(!profiles\.length\) return 0/);
});

test("notifications never coerce snapshot spend with Number(x) || 0", () => {
  assert.doesNotMatch(notifications, /Number\(\s*todayPoint\.spend\s*\)\s*\|\|\s*0/);
  assert.doesNotMatch(notifications, /Number\(\s*snapshot\.yesterday\?\.spend\s*\)\s*\|\|\s*0/);
  assert.doesNotMatch(notifications, /Number\([^)]*spend[^)]*\)\s*\|\|\s*0/);
});

test("digest helpers export honest presence types and null-safe copy", () => {
  assert.match(digest, /export type DigestMetricPresence/);
  assert.match(digest, /export type HonestDigestTotals/);
  assert.match(digest, /export function honestTotalsFromDayPoint/);
  assert.match(digest, /export function digestMetricsLines/);
  assert.match(digest, /export function formatDigestBody/);
  assert.match(digest, /Spend n\/a|DIGEST_UNKNOWN/);
  assert.match(digest, /n\/a orders|DIGEST_UNKNOWN/);
  assert.doesNotMatch(digest, /Spend —/);
});
