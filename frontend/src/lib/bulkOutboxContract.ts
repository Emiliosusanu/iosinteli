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

export function bulkBackoffMs(attempts: number): number {
  const n = Math.max(0, attempts);
  return Math.min(15 * 60_000, 2_000 * Math.pow(2, Math.min(6, n)));
}
