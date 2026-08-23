import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ADS_UP_TO_DATE_LABEL,
  SYNC_VIEWING_CUSTOMER_MESSAGE,
  amsIntradayQueryKey,
  canMutateSync,
  claimsKdpOrAllSources,
  deriveSyncHero,
  syncOverviewQueryKey,
  syncStatusLabel,
  syncStatusQueryKey,
  triggerResponseMeansCompleted,
} from "../src/lib/syncContract.ts";

const syncScreen = readFileSync(new URL("../app/more/sync.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");

test("admin view-as cannot mutate sync and does not mix admin sessions", () => {
  assert.equal(canMutateSync({ userId: "admin", guestMode: false, adminFilterUserId: "customer" }), false);
  assert.equal(canMutateSync({ userId: "seller", guestMode: false, adminFilterUserId: null }), true);
  assert.equal(canMutateSync({ userId: "seller", guestMode: true, adminFilterUserId: null }), false);
  assert.match(syncScreen, /viewingCustomer = !!adminFilterUserId/);
  assert.match(syncScreen, /canMutateSync/);
  assert.match(syncScreen, /SYNC_VIEWING_CUSTOMER_MESSAGE/);
  assert.match(syncScreen, /includeSessions: !viewingCustomer/);
  assert.equal(
    SYNC_VIEWING_CUSTOMER_MESSAGE,
    "Amazon Ads sync isn't available while viewing another user's accounts.",
  );
});

test("status read can follow the viewed customer; trigger and cancel cannot", () => {
  assert.match(mutations, /filterUserId=\$\{encodeURIComponent\(filterUserId\)\}/);
  assert.match(mutations, /export function triggerSync\(\)/);
  assert.match(mutations, /export async function cancelSync\(\)/);
  assert.doesNotMatch(mutations, /function triggerSync\([^)]*filterUserId/);
  assert.doesNotMatch(mutations, /function cancelSync\([^)]*filterUserId/);
});

test("query keys separate self from viewed customer", () => {
  assert.deepEqual(syncStatusQueryKey("admin", "customer-a"), ["sync-status", "admin", "customer-a"]);
  assert.deepEqual(syncStatusQueryKey("admin", null), ["sync-status", "admin", "self"]);
  assert.notDeepEqual(syncOverviewQueryKey("admin", ["p1"], "a"), syncOverviewQueryKey("admin", ["p1"], "b"));
  assert.notDeepEqual(amsIntradayQueryKey("admin", ["p1"], "a"), amsIntradayQueryKey("admin", ["p1"], "b"));
  assert.match(syncScreen, /syncOverviewQueryKey/);
  assert.match(syncScreen, /syncStatusQueryKey/);
});

test("hero never claims KDP or all sources, and acceptance is not completion", () => {
  assert.equal(triggerResponseMeansCompleted(), false);
  assert.equal(claimsKdpOrAllSources(ADS_UP_TO_DATE_LABEL), false);
  assert.equal(claimsKdpOrAllSources("All data up to date"), true);
  assert.doesNotMatch(syncScreen, /All data up to date/);
  assert.doesNotMatch(syncScreen, /KDP/);
  assert.match(queries, /includeSessions/);
});

test("partial failure and missing freshness are not up to date", () => {
  const partial = deriveSyncHero({
    inProgress: false,
    profiles: [
      { status: "completed", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" },
      { status: "partial_failed", completed_at: "2026-08-22T10:00:00Z", started_at: "2026-08-22T09:00:00Z" },
    ],
  });
  assert.equal(partial.state, "warning");
  assert.notEqual(partial.label, ADS_UP_TO_DATE_LABEL);

  const noStamp = deriveSyncHero({
    inProgress: false,
    profiles: [{ status: "completed", completed_at: null, started_at: "2026-08-22T11:00:00Z" }],
  });
  assert.notEqual(noStamp.label, ADS_UP_TO_DATE_LABEL);
  assert.equal(noStamp.freshness, "none");

  const acceptedStillRunning = deriveSyncHero({
    inProgress: true,
    profiles: [{ status: "pending", completed_at: null, started_at: "2026-08-22T11:00:00Z" }],
  });
  assert.equal(acceptedStillRunning.state, "syncing");
  assert.notEqual(acceptedStillRunning.label, ADS_UP_TO_DATE_LABEL);
});

test("cancelled is not failed", () => {
  assert.equal(syncStatusLabel("cancelled"), "Cancelled");
  assert.equal(syncStatusLabel("failed"), "Failed");
  assert.notEqual(syncStatusLabel("cancelled"), syncStatusLabel("failed"));
  const cancelled = deriveSyncHero({
    inProgress: false,
    profiles: [{ status: "cancelled", completed_at: "2026-08-22T12:00:00Z", started_at: "2026-08-22T11:00:00Z" }],
  });
  assert.equal(cancelled.state, "idle");
  assert.notEqual(cancelled.label, ADS_UP_TO_DATE_LABEL);
});
