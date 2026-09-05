import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bulkFailureAlertBody,
  canRestoreBulkRevertItem,
  collectFailedEntityIds,
  collectNotFoundFailIds,
  collectPermanentFailIds,
  collectSkippedEntityIds,
  isBulkWritableTargetingRow,
  isPermanentNotFoundBulkError,
  isTransientBulkError,
  nestBulkConfirmedSucceeded,
  nestBulkRevertPlan,
  nestBulkSkipAlert,
  shouldRevertNestBulkEntity,
} from "../src/lib/bulkOutboxContract.ts";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const outbox = readFileSync(new URL("../src/lib/bulkOutbox.ts", import.meta.url), "utf8");
const nestJobs = readFileSync(new URL("../src/lib/nestBulkJobs.ts", import.meta.url), "utf8");

test("writable helper fail-closes Active rows with paused parents or dead IDs", () => {
  assert.equal(
    isBulkWritableTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      adGroupState: "enabled",
      stateFilter: "enabled",
    }),
    true,
  );
  assert.equal(
    isBulkWritableTargetingRow({
      entityState: "enabled",
      campaignState: "paused",
      adGroupState: "enabled",
      stateFilter: "enabled",
    }),
    false,
  );
  assert.equal(
    isBulkWritableTargetingRow({
      entityState: "enabled",
      campaignState: "enabled",
      adGroupState: "enabled",
      stateFilter: "enabled",
      entityId: "472934297764568",
      knownPermanentFailIds: new Set(["472934297764568"]),
    }),
    false,
  );
});

test("not-found permanent fails are never treated as transient", () => {
  assert.equal(isPermanentNotFoundBulkError("Product target with ID 472934297764568 not found"), true);
  assert.equal(isPermanentNotFoundBulkError("not found or not accessible"), true);
  assert.equal(isTransientBulkError(new Error("Product target with ID x not found")), false);
});

test("requeue skips not-found permanent fails", () => {
  assert.match(outbox, /isPermanentNotFoundBulkError\(i\.lastError\)/);
  assert.match(outbox, /dismissNotFoundPermanentBulkFailures/);
});

test("Nest durable bulk submit path is wired for keywords and product targets", () => {
  assert.match(targeting, /submitNestBulkManual/);
  assert.match(targeting, /requireActiveParents: stateFilter === "enabled"/);
  assert.match(targeting, /queued on InteliAds servers/);
  assert.match(targeting, /finished on InteliAds servers/);
  assert.match(targeting, /if \(submitted\.syncResult\)/);
  assert.match(targeting, /isBulkWritableTargetingRow/);
  assert.match(targeting, /dismissNotFoundPermanentBulkFailures/);
  assert.match(targeting, /listNestPermanentFailEntityIds/);
  assert.match(targeting, /Not on Active filter/);
  assert.match(targeting, /bulkFailureAlertTitle/);
  assert.match(targeting, /selected visible \/ filtered rows/);
  assert.match(targeting, /Pause anyway|Enable anyway/);
  assert.match(nestJobs, /\/product-targets\/bulk\/manual/);
  assert.match(nestJobs, /\/keywords\/bulk\/manual/);
  assert.match(nestJobs, /durable: true/);
  assert.match(nestJobs, /buildNestBulkItemsFromInputs/);
  assert.match(nestJobs, /requireActiveParents/);
  assert.match(nestJobs, /cancelNestBulkJob/);
  assert.match(nestJobs, /resubmitFailedNestBulkJobs/);
  assert.match(targeting, /resubmitFailedNestBulkJobs/);
  assert.match(targeting, /Nothing to retry/);
  assert.match(targeting, /no longer in this filtered list/);
  assert.match(targeting, /user\?\.id \?\? "anon"/);
  assert.match(targeting, /nestBulkRevertPlan/);
  assert.match(targeting, /restoredAny/);
  assert.doesNotMatch(targeting, /restoredAny:\s*true/);
});

test("failure copy classifies Nest not-found separately from Amazon", async () => {
  const {
    bulkFailureAlertTitle,
    classifyBulkFailureSource,
  } = await import("../src/lib/bulkOutboxContract.ts");
  assert.equal(
    classifyBulkFailureSource("Product target with ID x not found"),
    "stale_or_unowned",
  );
  assert.match(bulkFailureAlertTitle(1, "stale_or_unowned"), /InteliAds/);
  assert.match(bulkFailureAlertTitle(1, "amazon"), /Amazon rejected/);
});

test("Nest partial failure never claims restored when nothing was restored", () => {
  const plan = nestBulkRevertPlan({
    permanentFailIds: [],
    failedIds: [],
    resultFailed: 2,
    resultSucceeded: 3,
  });
  assert.equal(plan.mode, "unknown_partial");
  assert.equal(shouldRevertNestBulkEntity("abc", plan), false);
  assert.equal(
    canRestoreBulkRevertItem({ action: "set_bid", previousBid: null }),
    false,
  );
  assert.equal(
    canRestoreBulkRevertItem({ action: "pause", previousEnabled: true }),
    true,
  );
  assert.match(
    bulkFailureAlertBody({
      detail: "Amazon rejected",
      source: "amazon",
      restoredAny: false,
    }),
    /refreshed data from the server/,
  );
  assert.doesNotMatch(
    bulkFailureAlertBody({
      detail: "Amazon rejected",
      source: "amazon",
      restoredAny: false,
    }),
    /restored the previous/,
  );

  const byId = nestBulkRevertPlan({
    failedIds: ["a"],
    resultFailed: 1,
    resultSucceeded: 2,
  });
  assert.equal(byId.mode, "by_id");
  assert.equal(shouldRevertNestBulkEntity("a", byId), true);
  assert.equal(shouldRevertNestBulkEntity("b", byId), false);

  const allFailed = nestBulkRevertPlan({
    resultFailed: 2,
    resultSucceeded: 0,
  });
  assert.equal(allFailed.mode, "all");
  assert.equal(shouldRevertNestBulkEntity("x", allFailed), true);
});

test("collectFailedEntityIds includes amazon fails omitted by old permanent filter", () => {
  const result = {
    results: [
      { id: "ok", status: "updated" },
      {
        id: "amz",
        status: "failed",
        failureKind: "amazon",
        message: "Amazon Advertising API rejected",
      },
      {
        id: "gone",
        status: "failed",
        failureKind: "stale_or_unowned",
        message: "Product target with ID gone not found",
      },
      { id: "retry", status: "failed", retryable: true, message: "timeout" },
    ],
  };
  assert.deepEqual(collectFailedEntityIds(result), ["amz", "gone", "retry"]);
  assert.deepEqual(collectPermanentFailIds(result).sort(), ["amz", "gone"]);
  assert.deepEqual(collectNotFoundFailIds(result), ["gone"]);
});

test("Nest skipped rows revert optimistic paint and never claim a full send", () => {
  const result = {
    results: [
      { id: "ok", status: "updated" },
      { id: "skip", status: "skipped", message: "paused parent" },
    ],
  };
  assert.deepEqual(collectSkippedEntityIds(result), ["skip"]);
  const plan = nestBulkRevertPlan({
    skippedIds: collectSkippedEntityIds(result),
    resultSkipped: 1,
    resultSucceeded: 1,
    resultFailed: 0,
  });
  assert.equal(plan.mode, "by_id");
  assert.equal(shouldRevertNestBulkEntity("skip", plan), true);
  assert.equal(shouldRevertNestBulkEntity("ok", plan), false);

  const skipOnly = nestBulkRevertPlan({
    resultSkipped: 3,
    resultSucceeded: 0,
    resultFailed: 0,
  });
  assert.equal(skipOnly.mode, "all");

  const unknownSkip = nestBulkRevertPlan({
    resultSkipped: 2,
    resultSucceeded: 3,
    resultFailed: 0,
  });
  assert.equal(unknownSkip.mode, "unknown_partial");

  const skipCopy = nestBulkSkipAlert({ succeeded: 1, skipped: 2, restoredAny: true });
  assert.equal(skipCopy.title, "Partly sent to Amazon Ads");
  assert.match(skipCopy.body, /1 sent, 2 skipped/);
  assert.doesNotMatch(skipCopy.body, /finished on InteliAds servers/);
  assert.match(targeting, /nestBulkSkipAlert/);
  assert.match(targeting, /doneSkipped === 0/);
  assert.match(targeting, /skippedIds: collectSkippedEntityIds/);
  assert.equal(nestBulkConfirmedSucceeded({ succeeded: 0, results: [] }), 0);
  assert.equal(nestBulkConfirmedSucceeded({ succeeded: 0, results: [{ status: "updated" }] }), 1);
  assert.equal(nestBulkConfirmedSucceeded({ succeeded: 4 }), 4);
  assert.match(targeting, /nestBulkConfirmedSucceeded/);
  assert.match(targeting, /succeeded: nestBulkConfirmedSucceeded\(submitted\.syncResult\)/);
  assert.doesNotMatch(targeting, /succeeded: submitted\.syncResult\.succeeded \?\? 0/);
  assert.doesNotMatch(targeting, /doneSucceeded \|\| submitted\.total/);
});
