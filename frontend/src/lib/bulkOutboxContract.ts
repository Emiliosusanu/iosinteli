/**
 * Pure helpers for durable Amazon bulk mutations (no I/O).
 */

export const AMAZON_MIN_BID = 0.01;
export const AMAZON_MAX_BID = 1000;
export const BULK_MAX_ATTEMPTS_BEFORE_BACKOFF = 3;

export type BulkEntityKind = "keyword" | "product_target" | "campaign";
export type BulkActionKind = "pause" | "enable" | "bid_delta" | "set_bid";

export type BulkOutboxItem = {
  id: string;
  jobId: string;
  entityKind: BulkEntityKind;
  entityId: string;
  action: BulkActionKind;
  deltaUsd?: number;
  /** Absolute bid for set_bid (and base for bid_delta). */
  bid?: number | null;
  baseBid?: number | null;
  /** Prior bid so permanent Amazon failures can undo optimistic UI. */
  previousBid?: number | null;
  /** Prior enabled/paused for pause|enable revert. */
  previousEnabled?: boolean | null;
  status: "pending" | "in_flight" | "done" | "failed_permanent";
  attempts: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BulkSelectionMemory = {
  segment?: string;
  ids?: string[];
  selectMode?: boolean;
};

export type EnqueueBulkInput = {
  entityKind: BulkEntityKind;
  entityId: string;
  action: BulkActionKind;
  deltaUsd?: number;
  bid?: number | null;
  baseBid?: number | null;
  previousBid?: number | null;
  previousEnabled?: boolean | null;
};

export function clampAmazonBid(value: number): number {
  if (!Number.isFinite(value)) return AMAZON_MIN_BID;
  return Math.min(AMAZON_MAX_BID, Math.max(AMAZON_MIN_BID, Math.round(value * 100) / 100));
}

export function isTransientBulkError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status as number)
      : null;
  if (status != null) {
    if (status === 401 || status === 403) return true;
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status === 0) return true;
    if (status >= 400 && status < 500) return false;
  }
  const msg = error.message || "";
  if (/Network request failed|Failed to fetch|offline|timeout|Abort/i.test(msg)) return true;
  if (/Cannot PATCH|not found|invalid bid|validation/i.test(msg)) return false;
  return true;
}

/** Permanent Nest ownership / sync misses — never brand these as Amazon rejects. */
export function isPermanentNotFoundBulkError(message: string | null | undefined): boolean {
  return /not found|not accessible|ENTITY_NOT_FOUND|does not exist|Product target with ID|Keyword with ID/i.test(
    String(message || ""),
  );
}

export type BulkFailureSource = "stale_or_unowned" | "amazon" | "other";

/** Classify a permanent failure for seller-facing copy (Nest 404 vs Amazon). */
export function classifyBulkFailureSource(
  message: string | null | undefined,
  failureKind?: string | null,
): BulkFailureSource {
  if (failureKind === "stale_or_unowned") return "stale_or_unowned";
  if (failureKind === "amazon") return "amazon";
  if (isPermanentNotFoundBulkError(message)) return "stale_or_unowned";
  if (/amazon|Advertising API|sp\/(targets|keywords)|invalid bid/i.test(String(message || ""))) {
    return "amazon";
  }
  return "other";
}

export function bulkFailureAlertTitle(
  count: number,
  source: BulkFailureSource,
): string {
  if (source === "stale_or_unowned") {
    return count === 1
      ? "InteliAds couldn’t update this target"
      : `InteliAds couldn’t update ${count} targets`;
  }
  if (source === "amazon") {
    return count === 1 ? "Amazon rejected this change" : `Amazon rejected ${count} changes`;
  }
  return count === 1 ? "Couldn’t apply this change" : `Couldn’t apply ${count} changes`;
}

export function bulkFailureAlertBody(opts: {
  detail?: string | null;
  source: BulkFailureSource;
  restoredAny: boolean;
}): string {
  const restored = opts.restoredAny
    ? "The app restored the previous on-screen bid/state."
    : "The app refreshed data from the server.";
  if (opts.source === "stale_or_unowned") {
    const detail = opts.detail?.trim() || "Missing or not owned in your synced Ads data.";
    return `${detail}\n\n${restored} Retry won’t fix this until you sync, then Clear the banner if they stay gone.`;
  }
  if (opts.source === "amazon") {
    const detail = opts.detail?.trim();
    return detail
      ? `${detail}\n\n${restored} Confirm on Amazon if unsure, then Retry or Clear from Targets.`
      : `${restored} Confirm the live bid/state on Amazon, then Retry or Clear from Targets.`;
  }
  const detail = opts.detail?.trim();
  return detail ? `${detail}\n\n${restored}` : restored;
}

/** Prior optimistic value available so a Nest/outbox failure can honestly restore UI. */
export function canRestoreBulkRevertItem(item: {
  action: BulkActionKind;
  previousBid?: number | null;
  previousEnabled?: boolean | null;
}): boolean {
  if (item.action === "pause" || item.action === "enable") {
    return item.previousEnabled != null;
  }
  return item.previousBid != null && Number.isFinite(Number(item.previousBid));
}

/**
 * Decide which Nest bulk rows to revert after a completed/failed job.
 * Prefer explicit failed IDs; only revert-all when every item failed and IDs are missing.
 * Never claim a selective restore when IDs are unknown but some rows succeeded.
 */
export type NestBulkRevertPlan =
  | { mode: "by_id"; ids: Set<string> }
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "unknown_partial" };

export function nestBulkRevertPlan(opts: {
  failedIds?: string[] | null;
  permanentFailIds?: string[] | null;
  skippedIds?: string[] | null;
  resultFailed?: number | null;
  resultSucceeded?: number | null;
  resultSkipped?: number | null;
}): NestBulkRevertPlan {
  const ids = new Set<string>([
    ...(opts.failedIds || []),
    ...(opts.permanentFailIds || []),
    ...(opts.skippedIds || []),
  ]);
  if (ids.size > 0) return { mode: "by_id", ids };
  const failed = opts.resultFailed ?? 0;
  const skipped = opts.resultSkipped ?? 0;
  const succeeded = opts.resultSucceeded ?? 0;
  // Skipped rows never hit Amazon — treat like unapplied for revert-all.
  if (failed <= 0 && skipped <= 0) return { mode: "none" };
  if (succeeded <= 0) return { mode: "all" };
  return { mode: "unknown_partial" };
}

export function shouldRevertNestBulkEntity(
  entityId: string,
  plan: NestBulkRevertPlan,
): boolean {
  if (plan.mode === "by_id") return plan.ids.has(entityId);
  if (plan.mode === "all") return true;
  return false;
}

/** Minimal Nest bulk result shape for pure fail-id collectors (no I/O). */
export type NestBulkResultLike = {
  results?: Array<{
    id: string;
    status: "updated" | "skipped" | "failed";
    message?: string;
    failureKind?: "stale_or_unowned" | "amazon" | "validation" | "other";
    retryable?: boolean;
  }>;
};

/** Every failed entity id (permanent + retryable) — used to revert optimistic paint. */
export function collectFailedEntityIds(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results.filter((r) => r.status === "failed").map((r) => r.id);
}

/** Nest skipped ids — Amazon unchanged; optimistic paint must revert. */
export function collectSkippedEntityIds(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results.filter((r) => r.status === "skipped").map((r) => r.id);
}

/** Confirmed Amazon applies only — never invent success from the submit total. */
export function nestBulkConfirmedSucceeded(result?: {
  succeeded?: number;
  results?: Array<{ status?: string }>;
}): number {
  const counted = result?.results?.filter((r) => r.status === "updated").length ?? 0;
  const reported = Number(result?.succeeded);
  const fromCount = Number.isFinite(reported) ? reported : 0;
  return Math.max(0, counted, fromCount);
}

/** Honest copy when Nest skipped rows and Amazon never changed them. */
export function nestBulkSkipAlert(opts: {
  succeeded: number;
  skipped: number;
  restoredAny: boolean;
}): { title: string; body: string } {
  const title = opts.succeeded > 0 ? "Partly sent to Amazon Ads" : "Not sent to Amazon Ads";
  const restore = opts.restoredAny
    ? " Restored previous values for skipped rows."
    : " Showing refreshed data from the server.";
  return {
    title,
    body: `${opts.succeeded} sent, ${opts.skipped} skipped (Amazon unchanged).${restore}`,
  };
}

/**
 * Non-retryable failures only. Includes Amazon / validation / not-found when
 * `retryable` is false or omitted (omit ≠ retryable).
 */
export function collectPermanentFailIds(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results
    .filter((r) => r.status === "failed" && r.retryable !== true)
    .map((r) => r.id);
}

/** Explicitly retryable Nest failures — safe for Retry / resubmit. */
export function collectRetryableFailIds(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results
    .filter((r) => r.status === "failed" && r.retryable === true)
    .map((r) => r.id);
}

/** Ownership / missing-row permanent fails — Retry cannot resurrect these. */
export function collectNotFoundFailIds(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results
    .filter(
      (r) =>
        r.status === "failed" &&
        (r.failureKind === "stale_or_unowned" || isPermanentNotFoundBulkError(r.message)),
    )
    .map((r) => r.id);
}

export function collectPermanentFailMessages(result?: NestBulkResultLike): string[] {
  if (!result?.results?.length) return [];
  return result.results
    .filter((r) => r.status === "failed" && r.retryable !== true)
    .map((r) => {
      if (r.failureKind === "stale_or_unowned" || isPermanentNotFoundBulkError(r.message)) {
        return String(r.message || "InteliAds couldn’t update this target (missing or not owned)");
      }
      if (r.failureKind === "amazon") {
        return String(r.message || "Amazon rejected this change");
      }
      return String(r.message || "Update failed");
    })
    .slice(0, 5);
}

/**
 * True when a row is safe to include in a bulk write under the current state filter.
 * Active filter → entity + parents must be enabled (fail-closed).
 */
export function isBulkWritableTargetingRow(opts: {
  entityState: string | null | undefined;
  campaignState?: string | null;
  adGroupState?: string | null;
  stateFilter: "all" | "enabled" | "paused";
  knownPermanentFailIds?: Set<string>;
  entityId?: string;
}): boolean {
  if (opts.entityId && opts.knownPermanentFailIds?.has(opts.entityId)) return false;
  if (opts.stateFilter === "enabled") {
    const entity = String(opts.entityState || "").toLowerCase();
    if (entity !== "enabled" && entity !== "active") return false;
    const campaign = String(opts.campaignState || "").toLowerCase();
    if (campaign !== "enabled" && campaign !== "active") return false;
    if ("adGroupState" in opts) {
      const ag = String(opts.adGroupState || "").toLowerCase();
      if (ag !== "enabled" && ag !== "active") return false;
    }
    return true;
  }
  // All / Paused: still block archived.
  const entity = String(opts.entityState || "").toLowerCase();
  return entity !== "archived";
}

export function bulkBackoffMs(attempts: number): number {
  const n = Math.max(0, attempts);
  return Math.min(15 * 60_000, 2_000 * Math.pow(2, Math.min(6, n)));
}
