/**
 * Durable Amazon Ads bulk mutation outbox.
 *
 * Items are written to AsyncStorage BEFORE any network call. Drain resumes on
 * foreground, background wake, and explicit kick. Transient failures stay
 * pending and retry. Permanent Amazon validation failures are marked for review.
 */

import { storage } from "../utils/storage";
import {
  updateCampaignState,
  updateKeywordManual,
  updateProductTargetManual,
} from "./mutations";
import { NestApiError } from "./rulesApi";
import {
  bulkBackoffMs,
  clampAmazonBid,
  isTransientBulkError,
  type BulkActionKind,
  type BulkEntityKind,
  type BulkOutboxItem,
  type BulkSelectionMemory,
  type EnqueueBulkInput,
} from "./bulkOutboxContract";

export type {
  BulkActionKind,
  BulkEntityKind,
  BulkOutboxItem,
  BulkSelectionMemory,
  EnqueueBulkInput,
} from "./bulkOutboxContract";
export {
  AMAZON_MAX_BID,
  AMAZON_MIN_BID,
  BULK_MAX_ATTEMPTS_BEFORE_BACKOFF,
  clampAmazonBid,
  isTransientBulkError,
} from "./bulkOutboxContract";

const OUTBOX_KEY = "inteliads.bulkOutbox.v1";
const SELECTION_KEY = "inteliads.targeting.bulkSelection.v1";

type OutboxState = { items: BulkOutboxItem[] };

let drainLock: Promise<DrainResult> | null = null;
type DrainListener = (result: DrainResult) => void;
const drainListeners = new Set<DrainListener>();

/** Notify UI after Amazon writes finish so lists can refetch real bids. */
export function subscribeBulkOutboxDrain(listener: DrainListener): () => void {
  drainListeners.add(listener);
  return () => {
    drainListeners.delete(listener);
  };
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readOutbox(): Promise<OutboxState> {
  try {
    const raw = await storage.getItem<string>(OUTBOX_KEY, "");
    if (!raw || typeof raw !== "string") return { items: [] };
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? (parsed.items as BulkOutboxItem[]) : [];
    return { items };
  } catch {
    return { items: [] };
  }
}

async function writeOutbox(state: OutboxState): Promise<void> {
  const payload = JSON.stringify({ items: state.items });
  const ok = await storage.setItem(OUTBOX_KEY, payload);
  if (!ok) throw new Error("Couldn't save Amazon changes on this iPhone.");
  const verify = await storage.getItem<string>(OUTBOX_KEY, "");
  if (verify !== payload) {
    const retry = await storage.setItem(OUTBOX_KEY, payload);
    if (!retry) throw new Error("Couldn't save Amazon changes on this iPhone.");
  }
}

export async function loadBulkSelectionMemory(): Promise<BulkSelectionMemory> {
  try {
    const raw = await storage.getItem<string>(SELECTION_KEY, "");
    if (!raw || typeof raw !== "string") return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as BulkSelectionMemory) : {};
  } catch {
    return {};
  }
}

export async function saveBulkSelectionMemory(next: BulkSelectionMemory): Promise<void> {
  try {
    await storage.setItem(SELECTION_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export async function getBulkOutboxSnapshot(): Promise<{
  pending: number;
  inFlight: number;
  failed: number;
  done: number;
  items: BulkOutboxItem[];
}> {
  const { items } = await readOutbox();
  return {
    pending: items.filter((i) => i.status === "pending").length,
    inFlight: items.filter((i) => i.status === "in_flight").length,
    failed: items.filter((i) => i.status === "failed_permanent").length,
    done: items.filter((i) => i.status === "done").length,
    items,
  };
}

/** Persist the full job first, then kick drain. Never drops items on navigate away. */
export async function enqueueBulkAmazonWrites(inputs: EnqueueBulkInput[]): Promise<{ jobId: string; count: number }> {
  if (!inputs.length) return { jobId: "", count: 0 };
  const jobId = makeId("job");
  const stamp = nowIso();
  const state = await readOutbox();
  let live = state.items.filter((i) => i.status === "pending" || i.status === "in_flight" || i.status === "failed_permanent");

  // Newer absolute/delta bid for the same entity replaces older pending bid edits.
  // Inherit the Amazon-confirmed baseline from the superseded pending item so rapid
  // re-edits don't chain previousBid off an optimistic (never-confirmed) value.
  const supersedeKeys = new Set(
    inputs
      .filter((input) => input.action === "set_bid" || input.action === "bid_delta")
      .map((input) => `${input.entityKind}:${input.entityId}`),
  );
  const inheritedPreviousBid = new Map<string, number>();
  if (supersedeKeys.size) {
    for (const item of live) {
      if (item.status !== "pending") continue;
      if (item.action !== "set_bid" && item.action !== "bid_delta") continue;
      const key = `${item.entityKind}:${item.entityId}`;
      if (!supersedeKeys.has(key)) continue;
      const prior = Number(item.previousBid);
      if (!Number.isFinite(prior)) continue;
      // Keep the earliest baseline in the pending chain.
      if (!inheritedPreviousBid.has(key)) inheritedPreviousBid.set(key, prior);
    }
    live = live.filter((item) => {
      if (item.status !== "pending") return true;
      if (item.action !== "set_bid" && item.action !== "bid_delta") return true;
      return !supersedeKeys.has(`${item.entityKind}:${item.entityId}`);
    });
  }

  for (const input of inputs) {
    const key = `${input.entityKind}:${input.entityId}`;
    const inherited =
      (input.action === "set_bid" || input.action === "bid_delta") && inheritedPreviousBid.has(key)
        ? inheritedPreviousBid.get(key)!
        : null;
    live.push({
      id: makeId("item"),
      jobId,
      entityKind: input.entityKind,
      entityId: input.entityId,
      action: input.action,
      deltaUsd: input.deltaUsd,
      bid: input.bid ?? null,
      baseBid: input.baseBid ?? null,
      previousBid: inherited ?? input.previousBid ?? null,
      previousEnabled: input.previousEnabled ?? null,
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  await writeOutbox({ items: live });
  void drainBulkOutbox();
  return { jobId, count: inputs.length };
}

/** Queue a single absolute bid write — UI can close immediately. */
export async function enqueueEntityBidWrite(opts: {
  entityKind: Exclude<BulkEntityKind, "campaign">;
  entityId: string;
  bid: number;
  previousBid?: number | null;
}): Promise<{ jobId: string; count: number }> {
  return enqueueBulkAmazonWrites([
    {
      entityKind: opts.entityKind,
      entityId: opts.entityId,
      action: "set_bid",
      bid: clampAmazonBid(opts.bid),
      previousBid: opts.previousBid ?? null,
    },
  ]);
}

export type DrainResult = {
  processed: number;
  succeeded: number;
  remaining: number;
  failedPermanent: number;
  stoppedForAuth: boolean;
  /** Permanent Amazon rejects — UI must revert optimistic paint and tell the seller. */
  failedItems: Array<{
    entityKind: BulkEntityKind;
    entityId: string;
    action: BulkActionKind;
    previousBid?: number | null;
    previousEnabled?: boolean | null;
    lastError?: string | null;
  }>;
  succeededItems: Array<{
    entityKind: BulkEntityKind;
    entityId: string;
    action: BulkActionKind;
  }>;
};

async function applyItem(item: BulkOutboxItem): Promise<void> {
  if (item.action === "pause" || item.action === "enable") {
    const state = item.action === "enable" ? "enabled" : "paused";
    if (item.entityKind === "keyword") {
      await updateKeywordManual(item.entityId, { status: state, forceCooldown: true });
      return;
    }
    if (item.entityKind === "product_target") {
      await updateProductTargetManual(item.entityId, { state, forceCooldown: true });
      return;
    }
    await updateCampaignState(item.entityId, state);
    return;
  }

  if (item.action === "set_bid") {
    if (item.bid == null || !Number.isFinite(Number(item.bid))) {
      throw new NestApiError("Missing bid for Amazon write.", 400);
    }
    const next = clampAmazonBid(Number(item.bid));
    if (item.entityKind === "keyword") {
      await updateKeywordManual(item.entityId, { bid: next, forceCooldown: true });
      return;
    }
    if (item.entityKind === "product_target") {
      await updateProductTargetManual(item.entityId, { bid: next, forceCooldown: true });
      return;
    }
    throw new NestApiError("Campaigns do not support dollar bid edits here.", 400);
  }

  const delta = Number(item.deltaUsd) || 0;
  if (item.baseBid == null || !Number.isFinite(Number(item.baseBid))) {
    throw new NestApiError("Missing current bid for bulk dollar edit.", 400);
  }
  const next = clampAmazonBid(Number(item.baseBid) + delta);
  if (item.entityKind === "keyword") {
    await updateKeywordManual(item.entityId, { bid: next, forceCooldown: true });
    return;
  }
  if (item.entityKind === "product_target") {
    await updateProductTargetManual(item.entityId, { bid: next, forceCooldown: true });
    return;
  }
  throw new NestApiError("Campaigns do not support dollar bid bulk edits.", 400);
}

export async function drainBulkOutbox(): Promise<DrainResult> {
  if (drainLock) return drainLock;
  drainLock = (async (): Promise<DrainResult> => {
    let processed = 0;
    let succeeded = 0;
    let stoppedForAuth = false;
    const succeededItems: DrainResult["succeededItems"] = [];
    const failedItems: DrainResult["failedItems"] = [];
    const stamp = () => nowIso();

    // Crash/kill mid-write leaves items in_flight — reclaim them as pending.
    {
      const state = await readOutbox();
      const reclaimed = state.items.map((item) =>
        item.status === "in_flight"
          ? { ...item, status: "pending" as const, nextAttemptAt: null, updatedAt: stamp() }
          : item,
      );
      if (reclaimed.some((item, idx) => item.status !== state.items[idx]?.status)) {
        await writeOutbox({ items: reclaimed });
      }
    }

    // Sequential writes — Nest/Amazon rate limits; safer than parallel storms.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const state = await readOutbox();
      const now = Date.now();
      const next = state.items.find((item) => {
        if (item.status !== "pending") return false;
        if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) return false;
        return true;
      });
      if (!next) {
        const pruned = state.items.filter((i) => i.status !== "done");
        if (pruned.length !== state.items.length) await writeOutbox({ items: pruned });
        break;
      }

      next.status = "in_flight";
      next.updatedAt = stamp();
      await writeOutbox({
        items: state.items.map((i) => (i.id === next.id ? next : i)),
      });

      try {
        await applyItem(next);
        processed += 1;
        succeeded += 1;
        succeededItems.push({
          entityKind: next.entityKind,
          entityId: next.entityId,
          action: next.action,
        });
        const after = await readOutbox();
        await writeOutbox({
          items: after.items.map((i) =>
            i.id === next.id
              ? { ...i, status: "done", lastError: null, updatedAt: stamp(), attempts: i.attempts + 1 }
              : i,
          ),
        });
      } catch (error) {
        processed += 1;
        const message = error instanceof Error ? error.message : "Couldn't write Amazon Ads.";
        const after = await readOutbox();
        const attempts = next.attempts + 1;
        if (error instanceof NestApiError && (error.status === 401 || error.status === 403)) {
          stoppedForAuth = true;
          await writeOutbox({
            items: after.items.map((i) =>
              i.id === next.id
                ? {
                    ...i,
                    status: "pending",
                    attempts,
                    lastError: message,
                    nextAttemptAt: new Date(Date.now() + bulkBackoffMs(attempts)).toISOString(),
                    updatedAt: stamp(),
                  }
                : i,
            ),
          });
          break;
        }
        if (isTransientBulkError(error)) {
          await writeOutbox({
            items: after.items.map((i) =>
              i.id === next.id
                ? {
                    ...i,
                    status: "pending",
                    attempts,
                    lastError: message,
                    nextAttemptAt: new Date(Date.now() + bulkBackoffMs(attempts)).toISOString(),
                    updatedAt: stamp(),
                  }
                : i,
            ),
          });
          // Keep draining other due items; this one waits until nextAttemptAt.
          continue;
        }
        failedItems.push({
          entityKind: next.entityKind,
          entityId: next.entityId,
          action: next.action,
          previousBid: next.previousBid,
          previousEnabled: next.previousEnabled,
          lastError: message,
        });
        await writeOutbox({
          items: after.items.map((i) =>
            i.id === next.id
              ? {
                  ...i,
                  status: "failed_permanent",
                  attempts,
                  lastError: message,
                  updatedAt: stamp(),
                }
              : i,
          ),
        });
      }
    }

    const final = await getBulkOutboxSnapshot();
    const result: DrainResult = {
      processed,
      succeeded,
      remaining: final.pending + final.inFlight,
      failedPermanent: failedItems.length || final.failed,
      stoppedForAuth,
      failedItems,
      succeededItems,
    };
    if (result.succeeded > 0 || result.failedPermanent > 0 || failedItems.length > 0) {
      for (const listener of drainListeners) {
        try {
          listener(result);
        } catch {
          /* ignore subscriber errors */
        }
      }
    }
    return result;
  })().finally(() => {
    drainLock = null;
  });
  return drainLock;
}

export async function retryPermanentBulkFailures(): Promise<void> {
  const state = await readOutbox();
  const stamp = nowIso();
  await writeOutbox({
    items: state.items.map((i) =>
      i.status === "failed_permanent"
        ? { ...i, status: "pending", nextAttemptAt: null, lastError: null, updatedAt: stamp }
        : i,
    ),
  });
  await drainBulkOutbox();
}
