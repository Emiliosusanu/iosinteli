/**
 * Nest-owned durable bulk mutation jobs (keywords + product targets).
 * Survives app kill — Nest processes asynchronously; client polls status.
 */

import { storage } from "../utils/storage";
import { nestApiJson, NestApiError } from "./rulesApi";
import type { BulkActionKind, BulkEntityKind } from "./bulkOutboxContract";
import {
  buildNestKeywordBulkBody,
  clampAmazonBid,
  classifyNestBulkPollFailure,
  collectFailedEntityIds,
  collectNotFoundFailIds,
  collectPermanentFailIds,
  collectPermanentFailMessages,
  collectRetryableFailIds,
  collectSkippedEntityIds,
  isLocalSyncNestJobId,
  isPermanentNotFoundBulkError,
  nestManualItemsToOutboxInputs,
} from "./bulkOutboxContract";

export {
  buildNestKeywordBulkBody,
  classifyNestBulkPollFailure,
  collectFailedEntityIds,
  collectNotFoundFailIds,
  collectPermanentFailIds,
  collectPermanentFailMessages,
  collectRetryableFailIds,
  collectSkippedEntityIds,
};

const NEST_BULK_JOBS_KEY = "inteliads.nestBulkJobs.v1";

export type NestBulkManualItem = {
  id: string;
  status?: "enabled" | "paused";
  state?: "enabled" | "paused";
  bid?: number;
  forceCooldown?: boolean;
};

export type NestBulkJobRecord = {
  jobId: string;
  entityKind: "keyword" | "product_target";
  total: number;
  processed: number;
  status: "pending" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
  /** Optimistic revert payloads for permanent failures. */
  revertItems: Array<{
    entityId: string;
    action: BulkActionKind;
    previousBid?: number | null;
    previousEnabled?: boolean | null;
  }>;
  /** Original Nest payload so Retry can resubmit failed rows. */
  items?: NestBulkManualItem[];
  /** requireActiveParents used on the original submit (Retry preserves it). */
  requireActiveParents?: boolean;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
  resultFailed?: number;
  resultSucceeded?: number;
  resultSkipped?: number;
  resultFailedPermanent?: number;
  resultFailedRetryable?: number;
  /** Sample permanent-fail messages for UI. */
  permanentMessages?: string[];
  /** Entity IDs that permanently failed (for optimistic revert / dead-ID gate). */
  permanentFailIds?: string[];
  /** All failed entity IDs (permanent + retryable) for selective optimistic revert. */
  failedIds?: string[];
  /** Nest skipped IDs (Amazon unchanged) — revert optimistic paint. */
  skippedIds?: string[];
  /** Dead Nest ownership misses — Retry must never resubmit these. */
  notFoundFailIds?: string[];
};

export type NestBulkManualResult = {
  updated: unknown[];
  succeeded: number;
  skipped: number;
  failed: number;
  failedPermanent?: number;
  failedRetryable?: number;
  results: Array<{
    id: string;
    status: "updated" | "skipped" | "failed";
    message?: string;
    failureKind?: "stale_or_unowned" | "amazon" | "validation" | "other";
    retryable?: boolean;
  }>;
};

export type NestBulkAccepted = {
  accepted: true;
  jobId: string;
  status: "pending";
  total: number;
};

export type NestBulkJobStatus = {
  jobId: string;
  status: NestBulkJobRecord["status"];
  total: number;
  processed: number;
  result?: NestBulkManualResult;
  error?: string;
};

type JobsState = { jobs: NestBulkJobRecord[] };

function nowIso() {
  return new Date().toISOString();
}

async function readJobs(): Promise<JobsState> {
  try {
    const raw = await storage.getItem<string>(NEST_BULK_JOBS_KEY, "");
    if (!raw || typeof raw !== "string") return { jobs: [] };
    const parsed = JSON.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? (parsed.jobs as NestBulkJobRecord[]) : [];
    return { jobs };
  } catch {
    return { jobs: [] };
  }
}

async function writeJobs(state: JobsState): Promise<void> {
  await storage.setItem(NEST_BULK_JOBS_KEY, JSON.stringify({ jobs: state.jobs }));
}

export async function getNestBulkJobsSnapshot(): Promise<{
  pending: number;
  failed: number;
  jobs: NestBulkJobRecord[];
}> {
  const { jobs } = await readJobs();
  const live = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const failed = jobs.filter(
    (j) =>
      j.status === "completed" &&
      (j.resultFailed ?? 0) > 0 &&
      !(j as { dismissed?: boolean }).dismissed,
  );
  // Also surface failed/interrupted job shells.
  const hardFailed = jobs.filter((j) => j.status === "failed" || j.status === "interrupted");
  return {
    pending: live.reduce((n, j) => n + Math.max(0, j.total - j.processed), 0) || live.length,
    failed: failed.reduce((n, j) => n + (j.resultFailed ?? 0), 0) + hardFailed.length,
    jobs,
  };
}

export function isNestBulkAccepted(response: unknown): response is NestBulkAccepted {
  return (
    typeof response === "object" &&
    response !== null &&
    (response as NestBulkAccepted).accepted === true &&
    typeof (response as NestBulkAccepted).jobId === "string"
  );
}

export async function submitNestBulkManual(opts: {
  entityKind: "keyword" | "product_target";
  items: NestBulkManualItem[];
  requireActiveParents?: boolean;
}): Promise<{ jobId: string; total: number; syncResult?: NestBulkManualResult }> {
  if (opts.entityKind !== "keyword") {
    throw new NestApiError(
      "Product-target bulk uses the iPhone outbox — Nest has no ID-list bulk route.",
      404,
    );
  }
  const body = buildNestKeywordBulkBody(opts.items);

  const response = await nestApiJson<NestBulkAccepted | NestBulkManualResult>(
    "/keywords/bulk/manual",
    { method: "PATCH", body: JSON.stringify(body) },
    "Couldn't queue Amazon bulk changes.",
  );

  if (isNestBulkAccepted(response)) {
    return { jobId: response.jobId, total: response.total };
  }
  // Sync path (should be rare when durable=true) — synthesize a completed local record.
  return {
    jobId: `sync_${Date.now().toString(36)}`,
    total: opts.items.length,
    syncResult: response,
  };
}

export async function pollNestBulkJob(
  entityKind: "keyword" | "product_target",
  jobId: string,
): Promise<NestBulkJobStatus> {
  const path =
    entityKind === "keyword"
      ? `/keywords/bulk/manual/jobs/${jobId}`
      : `/product-targets/bulk/manual/jobs/${jobId}`;
  return nestApiJson<NestBulkJobStatus>(path, { method: "GET" }, "Couldn't load bulk job status.");
}

export async function trackNestBulkJob(record: NestBulkJobRecord): Promise<void> {
  const state = await readJobs();
  const without = state.jobs.filter((j) => j.jobId !== record.jobId);
  without.unshift(record);
  // Keep last 20 jobs.
  await writeJobs({ jobs: without.slice(0, 20) });
}

export async function updateTrackedNestBulkJob(
  jobId: string,
  patch: Partial<NestBulkJobRecord>,
): Promise<NestBulkJobRecord | null> {
  const state = await readJobs();
  let updated: NestBulkJobRecord | null = null;
  const jobs = state.jobs.map((j) => {
    if (j.jobId !== jobId) return j;
    updated = { ...j, ...patch, updatedAt: nowIso() };
    return updated;
  });
  if (updated) await writeJobs({ jobs });
  return updated;
}

/** Build Nest items + revert metadata from outbox-style enqueue inputs. */
export function buildNestBulkItemsFromInputs(
  inputs: Array<{
    entityKind: BulkEntityKind;
    entityId: string;
    action: BulkActionKind;
    bid?: number | null;
    previousBid?: number | null;
    previousEnabled?: boolean | null;
  }>,
): {
  entityKind: "keyword" | "product_target";
  items: NestBulkManualItem[];
  revertItems: NestBulkJobRecord["revertItems"];
} | null {
  if (!inputs.length) return null;
  const kind = inputs[0].entityKind;
  if (kind !== "keyword" && kind !== "product_target") return null;
  if (inputs.some((i) => i.entityKind !== kind)) return null;

  const items: NestBulkManualItem[] = [];
  const revertItems: NestBulkJobRecord["revertItems"] = [];
  for (const input of inputs) {
    revertItems.push({
      entityId: input.entityId,
      action: input.action,
      previousBid: input.previousBid ?? null,
      previousEnabled: input.previousEnabled ?? null,
    });
    if (input.action === "pause" || input.action === "enable") {
      const state = input.action === "enable" ? "enabled" : "paused";
      items.push(
        kind === "keyword"
          ? { id: input.entityId, status: state }
          : { id: input.entityId, state },
      );
      continue;
    }
    if (input.bid == null || !Number.isFinite(Number(input.bid))) continue;
    items.push({ id: input.entityId, bid: clampAmazonBid(Number(input.bid)) });
  }
  if (!items.length) return null;
  return { entityKind: kind, items, revertItems };
}

export function isNotFoundBulkMessage(message: string | null | undefined): boolean {
  return isPermanentNotFoundBulkError(message);
}

function nestJobHasReviewableFailures(job: NestBulkJobRecord): boolean {
  return (
    (job.status === "completed" && (job.resultFailed ?? 0) > 0) ||
    job.status === "failed" ||
    job.status === "interrupted"
  );
}

/**
 * Resubmit Nest rows that failed but are worth another attempt.
 * Skips permanent not-found / unowned IDs (Clear those). Returns counts for honest UI.
 */
export async function resubmitFailedNestBulkJobs(opts?: {
  requireActiveParents?: boolean;
}): Promise<{ resubmitted: number; skippedNotFound: number; jobsStarted: number }> {
  const state = await readJobs();
  let resubmitted = 0;
  let skippedNotFound = 0;
  let jobsStarted = 0;
  const nextJobs: NestBulkJobRecord[] = [];

  for (const job of state.jobs) {
    if (!nestJobHasReviewableFailures(job)) {
      nextJobs.push(job);
      continue;
    }
    const items = job.items || [];
    if (!items.length) {
      // Nothing to rebuild — keep for Clear, do not pretend Retry did work.
      nextJobs.push(job);
      continue;
    }

    const failedIds = new Set([...(job.failedIds || []), ...(job.permanentFailIds || [])]);
    const notFoundIds = new Set(job.notFoundFailIds || []);
    const candidates =
      failedIds.size > 0
        ? items.filter((item) => failedIds.has(item.id))
        : (job.resultSucceeded ?? 0) > 0
          ? [] // partial failure without IDs — cannot safely know what to retry
          : items;

    const retryItems: NestBulkManualItem[] = [];
    const residualNotFound: NestBulkManualItem[] = [];
    for (const item of candidates) {
      if (notFoundIds.has(item.id)) {
        skippedNotFound += 1;
        residualNotFound.push(item);
        continue;
      }
      retryItems.push(item);
    }

    if (!retryItems.length) {
      // Leave job for Clear when only not-found / unknown remain.
      nextJobs.push(job);
      continue;
    }

    try {
      if (job.entityKind === "product_target") {
        const { enqueueBulkAmazonWrites } = await import("./bulkOutbox");
        await enqueueBulkAmazonWrites(
          nestManualItemsToOutboxInputs(retryItems, job.revertItems || []),
        );
        const stamp = nowIso();
        resubmitted += retryItems.length;
        jobsStarted += 1;
        if (residualNotFound.length) {
          const residualIds = new Set(residualNotFound.map((i) => i.id));
          nextJobs.push({
            ...job,
            jobId: `${job.jobId}:notfound`,
            total: residualNotFound.length,
            processed: residualNotFound.length,
            status: "completed",
            items: residualNotFound,
            revertItems: (job.revertItems || []).filter((r) => residualIds.has(r.entityId)),
            resultFailed: residualNotFound.length,
            resultSucceeded: 0,
            permanentFailIds: residualNotFound.map((i) => i.id),
            failedIds: residualNotFound.map((i) => i.id),
            notFoundFailIds: residualNotFound.map((i) => i.id),
            updatedAt: stamp,
          });
        }
        continue;
      }

      const submitted = await submitNestBulkManual({
        entityKind: "keyword",
        items: retryItems,
      });
      const stamp = nowIso();
      const revertItems = (job.revertItems || []).filter((r) =>
        retryItems.some((item) => item.id === r.entityId),
      );
      const record: NestBulkJobRecord = {
        jobId: submitted.jobId,
        entityKind: "keyword",
        total: submitted.total,
        processed: submitted.syncResult ? submitted.total : 0,
        status: submitted.syncResult ? "completed" : "pending",
        revertItems,
        items: retryItems,
        createdAt: stamp,
        updatedAt: stamp,
        resultFailed: submitted.syncResult?.failed,
        resultSucceeded: submitted.syncResult?.succeeded,
        resultSkipped: submitted.syncResult?.skipped,
        permanentMessages: collectPermanentFailMessages(submitted.syncResult),
        permanentFailIds: collectPermanentFailIds(submitted.syncResult),
        failedIds: collectFailedEntityIds(submitted.syncResult),
        skippedIds: collectSkippedEntityIds(submitted.syncResult),
        notFoundFailIds: collectNotFoundFailIds(submitted.syncResult),
      };
      nextJobs.push(record);
      if (residualNotFound.length) {
        const residualIds = new Set(residualNotFound.map((i) => i.id));
        nextJobs.push({
          ...job,
          jobId: `${job.jobId}:notfound`,
          total: residualNotFound.length,
          processed: residualNotFound.length,
          status: "completed",
          items: residualNotFound,
          revertItems: (job.revertItems || []).filter((r) => residualIds.has(r.entityId)),
          resultFailed: residualNotFound.length,
          resultSucceeded: 0,
          permanentFailIds: residualNotFound.map((i) => i.id),
          failedIds: residualNotFound.map((i) => i.id),
          notFoundFailIds: residualNotFound.map((i) => i.id),
          updatedAt: stamp,
        });
      }
      resubmitted += retryItems.length;
      jobsStarted += 1;
    } catch {
      // Keep original failed job so Clear/Retry remain available.
      nextJobs.push(job);
    }
  }

  await writeJobs({ jobs: nextJobs.slice(0, 20) });
  return { resubmitted, skippedNotFound, jobsStarted };
}

/** IDs Nest permanently rejected — never re-enqueue until sync clears them. */
export async function listNestPermanentFailEntityIds(): Promise<Set<string>> {
  const { jobs } = await readJobs();
  const ids = new Set<string>();
  for (const job of jobs) {
    for (const id of job.permanentFailIds || []) ids.add(id);
  }
  return ids;
}

export async function cancelNestBulkJob(
  entityKind: "keyword" | "product_target",
  jobId: string,
): Promise<NestBulkJobStatus> {
  const path =
    entityKind === "keyword"
      ? `/keywords/bulk/manual/jobs/${jobId}/cancel`
      : `/product-targets/bulk/manual/jobs/${jobId}/cancel`;
  return nestApiJson<NestBulkJobStatus>(path, { method: "POST" }, "Couldn't cancel bulk job.");
}

export async function dismissCompletedNestBulkFailures(): Promise<number> {
  const state = await readJobs();
  let removed = 0;
  const jobs = state.jobs.filter((j) => {
    const hasFails =
      (j.status === "completed" && (j.resultFailed ?? 0) > 0) ||
      j.status === "failed" ||
      j.status === "interrupted";
    if (!hasFails) return true;
    removed += j.resultFailed ?? (j.status === "failed" || j.status === "interrupted" ? 1 : 0);
    return false;
  });
  if (removed > 0) await writeJobs({ jobs });
  return removed;
}

async function settleOrphanProductTargetJob(
  job: NestBulkJobRecord,
): Promise<{ record: NestBulkJobRecord; notifyCompleted: boolean }> {
  const items = job.items || [];
  if (!items.length) {
    const record: NestBulkJobRecord = {
      ...job,
      status: "failed",
      lastError: "Product-target bulk uses the iPhone outbox — Nest has no ID-list bulk route.",
      updatedAt: nowIso(),
    };
    return { record, notifyCompleted: true };
  }
  try {
    const { enqueueBulkAmazonWrites } = await import("./bulkOutbox");
    await enqueueBulkAmazonWrites(nestManualItemsToOutboxInputs(items, job.revertItems || []));
    return {
      record: {
        ...job,
        status: "completed",
        processed: job.total,
        lastError: null,
        updatedAt: nowIso(),
      },
      notifyCompleted: false,
    };
  } catch (error) {
    const record: NestBulkJobRecord = {
      ...job,
      status: "failed",
      lastError: error instanceof Error ? error.message : "Couldn't move product-target bulk to the outbox.",
      updatedAt: nowIso(),
    };
    return { record, notifyCompleted: true };
  }
}

export async function refreshOpenNestBulkJobs(): Promise<{
  pending: number;
  failed: number;
  newlyCompleted: NestBulkJobRecord[];
}> {
  const state = await readJobs();
  const newlyCompleted: NestBulkJobRecord[] = [];
  const jobs: NestBulkJobRecord[] = [];

  for (const job of state.jobs) {
    if (job.status !== "pending" && job.status !== "running") {
      jobs.push(job);
      continue;
    }
    if (job.entityKind === "product_target") {
      const settled = await settleOrphanProductTargetJob(job);
      if (settled.notifyCompleted) newlyCompleted.push(settled.record);
      jobs.push(settled.record);
      continue;
    }
    if (isLocalSyncNestJobId(job.jobId)) {
      const next = { ...job, status: "completed" as const, processed: job.total, updatedAt: nowIso() };
      jobs.push(next);
      continue;
    }
    try {
      const status = await pollNestBulkJob(job.entityKind, job.jobId);
      const next: NestBulkJobRecord = {
        ...job,
        status: status.status,
        processed: status.processed,
        total: status.total || job.total,
        updatedAt: nowIso(),
        lastError: status.error ?? null,
        resultFailed: status.result?.failed ?? job.resultFailed,
        resultSucceeded: status.result?.succeeded ?? job.resultSucceeded,
        resultSkipped: status.result?.skipped ?? job.resultSkipped,
        resultFailedPermanent:
          status.result?.failedPermanent ?? job.resultFailedPermanent,
        resultFailedRetryable:
          status.result?.failedRetryable ?? job.resultFailedRetryable,
        permanentMessages: collectPermanentFailMessages(status.result),
        permanentFailIds: collectPermanentFailIds(status.result),
        failedIds: collectFailedEntityIds(status.result),
        skippedIds: collectSkippedEntityIds(status.result),
        notFoundFailIds: collectNotFoundFailIds(status.result),
      };
      if (status.status === "completed" || status.status === "failed" || status.status === "interrupted") {
        newlyCompleted.push(next);
      }
      jobs.push(next);
    } catch (error) {
      const kind = classifyNestBulkPollFailure(error);
      const next: NestBulkJobRecord = {
        ...job,
        status: kind === "gone" ? "failed" : job.status,
        lastError: error instanceof Error ? error.message : "Couldn't poll bulk job",
        updatedAt: nowIso(),
      };
      if (kind === "gone") newlyCompleted.push(next);
      jobs.push(next);
    }
  }

  await writeJobs({ jobs });
  const snap = await getNestBulkJobsSnapshot();
  return { pending: snap.pending, failed: snap.failed, newlyCompleted };
}

export { NEST_BULK_JOBS_KEY };
