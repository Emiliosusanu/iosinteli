import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  clampAmazonBid,
  isTransientBulkError,
  AMAZON_MIN_BID,
} from "../src/lib/bulkOutboxContract.ts";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const outbox = readFileSync(new URL("../src/lib/bulkOutbox.ts", import.meta.url), "utf8");
const outboxContract = readFileSync(new URL("../src/lib/bulkOutboxContract.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const mutationsUi = readFileSync(new URL("../src/components/Mutations.tsx", import.meta.url), "utf8");
const invalidateAds = readFileSync(new URL("../src/lib/invalidateAds.ts", import.meta.url), "utf8");
const nestBulk = readFileSync(new URL("../src/lib/nestBulkJobs.ts", import.meta.url), "utf8");

test("Amazon bid clamp never writes invalid floors or absurd ceilings", () => {
  assert.equal(AMAZON_MIN_BID, 0.01);
  assert.equal(clampAmazonBid(0), AMAZON_MIN_BID);
  assert.equal(clampAmazonBid(-1), AMAZON_MIN_BID);
  assert.equal(clampAmazonBid(0.01), 0.01);
  assert.equal(clampAmazonBid(0.055), 0.06);
  assert.equal(clampAmazonBid(5000), 1000);
});

test("bulk outbox classifies network and 5xx as transient, validation as permanent", () => {
  assert.equal(isTransientBulkError(new Error("Network request failed")), true);
  assert.equal(isTransientBulkError(Object.assign(new Error("rate limited"), { status: 429 })), true);
  assert.equal(isTransientBulkError(Object.assign(new Error("boom"), { status: 503 })), true);
  assert.equal(isTransientBulkError(Object.assign(new Error("Cannot PATCH"), { status: 404 })), false);
  assert.equal(isTransientBulkError(Object.assign(new Error("invalid bid"), { status: 400 })), false);
});

test("bid edits stay honest until Amazon confirms — revert + alert on permanent reject", () => {
  assert.match(targeting, /Writing to Amazon Ads/);
  assert.match(targeting, /queued on InteliAds servers|Not confirmed on Amazon yet/);
  assert.match(targeting, /previousBid/);
  assert.match(targeting, /revertOptimisticEntityBid/);
  assert.match(targeting, /Couldn't queue those Amazon changes\. Nothing was sent/);
  assert.match(outbox, /previousBid/);
  assert.match(outbox, /failedItems/);
  assert.match(outbox, /failed_permanent/);
  assert.match(outbox, /inheritedPreviousBid/);
  assert.match(outbox, /Amazon-confirmed baseline/);
  assert.match(app, /bulkFailureAlertTitle|Amazon rejected/);
  assert.match(app, /classifyBulkFailureSource|stale_or_unowned/);
  assert.match(app, /revertOptimisticEntityBid/);
  assert.match(app, /result\.failedItems/);
  assert.match(app, /restoredAny/);
  assert.match(app, /nestBulkRevertPlan/);
  assert.match(app, /canRestoreBulkRevertItem/);
  assert.doesNotMatch(app, /restoredAny:\s*true/);
  assert.doesNotMatch(targeting, /restoredAny:\s*true/);
  assert.match(targeting, /resubmitFailedNestBulkJobs/);
  assert.match(targeting, /skippedStale/);
  assert.match(outboxContract, /nestBulkRevertPlan/);
  assert.match(outboxContract, /canRestoreBulkRevertItem/);
  assert.match(nestBulk, /resubmitFailedNestBulkJobs/);
  assert.match(nestBulk, /collectFailedEntityIds/);
  assert.match(invalidateAds, /export function revertOptimisticEntityBid/);
  assert.doesNotMatch(targeting, /Queued for Amazon/);
});

test("targeting exposes bulk select, durable queue, and expanded filters", () => {
  assert.match(targeting, /targeting-bulk-bar/);
  assert.match(targeting, /bottom: t\.layout\.tabClearance/);
  assert.match(targeting, /label=\{selectMode \? "Done" : "Select"\}/);
  assert.match(targeting, /min=\{0\.01\}/);
  assert.match(targeting, /targeting-bulk-increase/);
  assert.match(targeting, /targeting-bulk-decrease/);
  assert.match(targeting, /targeting-bulk-pause/);
  assert.match(targeting, /targeting-bulk-enable/);
  assert.match(targeting, /confirmEnableSelected/);
  assert.match(targeting, /enqueueSelected\("enable"\)/);
  assert.match(targeting, /fetchTargetingBookOptions/);
  assert.match(targeting, /targeting-book-all/);
  assert.match(targeting, /bookAsin/);
  assert.match(targeting, /enqueueBulkAmazonWrites/);
  assert.match(targeting, /submitNestBulkManual/);
  assert.match(targeting, /isBulkWritableTargetingRow/);
  assert.match(targeting, /dismissNotFoundPermanentBulkFailures/);
  assert.match(targeting, /enqueueEntityBidWrite/);
  assert.match(targeting, /ACoS high/);
  assert.match(targeting, /ACoS low/);
  assert.match(targeting, /has_clicks/);
  assert.match(targeting, /has_impressions/);
  assert.match(targeting, /saveBulkSelectionMemory/);
  assert.match(outbox, /inteliads\.bulkOutbox\.v1/);
  assert.match(outbox, /forceCooldown: true/);
  assert.match(outbox, /status === "in_flight"/);
  assert.match(outbox, /retryPermanentBulkFailures/);
  assert.match(outbox, /requeuePermanentBulkFailures/);
  assert.match(outbox, /dismissPermanentBulkFailures/);
  assert.match(outbox, /dismissNotFoundPermanentBulkFailures/);
  assert.match(outbox, /isPermanentNotFoundBulkError/);
  assert.match(outbox, /enqueueEntityBidWrite/);
  assert.match(outbox, /set_bid/);
  assert.match(outbox, /supersedeKeys/);
  assert.match(outbox, /subscribeBulkOutboxDrain/);
  assert.match(outbox, /action === "enable"/);
  assert.match(app, /drainBulkOutbox/);
  assert.match(app, /subscribeBulkOutboxDrain/);
  assert.match(app, /next === "background"/);
  assert.match(app, /refreshOpenNestBulkJobs/);
  assert.match(outboxContract, /not found/i);
  assert.match(outboxContract, /stale_or_unowned/);
  assert.match(nestBulk, /submitNestBulkManual/);
  assert.match(nestBulk, /failedPermanent/);
  assert.match(nestBulk, /listNestPermanentFailEntityIds/);
  assert.match(notifications, /drainBulkOutbox/);
  assert.match(targeting, /requeuePermanentBulkFailures/);
  assert.match(targeting, /dismissPermanentBulkFailures/);
  assert.match(targeting, /targeting-bulk-outbox-clear/);
  assert.match(targeting, /Writing/);
  assert.match(targeting, /InteliAds servers/);
  assert.match(targeting, /fetchAdGroupDefaultBids/);
  assert.match(targeting, /inheritedDefaultBid/);
  assert.match(targeting, /applyOptimisticEntityBid/);
  assert.match(targeting, /applyOptimisticEntityState/);
  assert.match(targeting, /revertOptimisticEntityState/);
  assert.match(targeting, /forceCooldown: true/);
  assert.match(mutationsUi, /Close first so the seller can edit the next bid immediately/);
  assert.match(mutationsUi, /min = 0\.01/);
  assert.match(mutationsUi, /Hold the user's choice until the parent/);
  assert.match(mutationsUi, /setOptimistic\(next\)/);
});

test("entity enable/disable paints cache immediately and soft-refreshes active queries only", () => {
  assert.match(invalidateAds, /export function applyOptimisticEntityState/);
  assert.match(invalidateAds, /export function revertOptimisticEntityState/);
  assert.match(invalidateAds, /export function invalidateEntityStateQueries/);
  assert.match(invalidateAds, /refetchType: "active"/);
  assert.match(invalidateAds, /status: nextStatus/);
  assert.match(invalidateAds, /state: nextStatus/);
  assert.doesNotMatch(
    targeting,
    /await updateKeywordManual\(item\.id, \{ status: next \? "enabled" : "paused" \}\);\s*await invalidateAds\(\)/,
  );
});
