import type { PricingCandidate } from "./pricingCandidates.ts";

export const PRICING_CHECKPOINT_KEY = "inteliads.kdpHelper.pricingCheckpoint.v1";
export const SHORT_PRICING_MAX_BOOKS = 3;
export const SHORT_WAKE_WORK_MS = 22_000;
const WRITE_RESERVE_MS = 4_000;

export class PricingSliceExpiredError extends Error {
  constructor() { super("KDP pricing slice deferred; existing prices preserved"); }
}

/** Reserve time for the database acknowledgement rather than starting another
 * 45-second Amazon request near the end of a short wake. */
export function pricingRequestTimeout(deadlineAtMs?: number, now = Date.now()): number | undefined {
  if (deadlineAtMs == null) return undefined;
  const remaining = deadlineAtMs - now - WRITE_RESERVE_MS;
  if (remaining < 1_000) throw new PricingSliceExpiredError();
  return Math.min(remaining, 12_000);
}

export type PricingCheckpoint = {
  needsDiscovery: boolean;
  pending: PricingCandidate[];
  /** Keep the current sweep finite even if older successful books age past 15m
   * while the phone is slowly draining its remaining books. */
  completed?: string[];
};
type CheckpointStorage = {
  getItem(key: string, fallback: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<boolean>;
};
const empty = (): PricingCheckpoint => ({ needsDiscovery: false, pending: [], completed: [] });
export const pricingCandidateKey = (row: PricingCandidate): string =>
  `${String(row.asin || "").trim().toUpperCase()}:${String(row.kdpBookId).trim().toUpperCase()}`;

/** Resume only candidates still admitted by the current live/format identity
 * checks. Failed/unsaved entries come before a new freshness sweep. */
export function resumePricingCandidates(
  prior: PricingCandidate[], eligible: PricingCandidate[], due: PricingCandidate[],
): PricingCandidate[] {
  const allowed = new Map(eligible.map(row => [pricingCandidateKey(row), row]));
  const ordered = [...prior.map(row => allowed.get(pricingCandidateKey(row))).filter(Boolean), ...due];
  const unique = new Map<string, PricingCandidate>();
  for (const row of ordered) if (row && !unique.has(pricingCandidateKey(row))) unique.set(pricingCandidateKey(row), row);
  return [...unique.values()];
}

/** One key per account: no root read/modify/write can mix two accounts.
 * The importer is single-flight. A durable save must succeed before probing. */
export function createPricingCheckpointStore(storage: CheckpointStorage) {
  const key = (accountId: string) => `${PRICING_CHECKPOINT_KEY}:${accountId}`;
  return {
    async load(accountId: string): Promise<PricingCheckpoint> {
      const raw = await storage.getItem(key(accountId), "");
      if (!raw) return empty();
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.pending)) return { ...empty(), needsDiscovery: true };
        return {
          needsDiscovery: Boolean(parsed.needsDiscovery),
          pending: parsed.pending.filter((row: PricingCandidate) => row && typeof row.kdpBookId === "string"),
          completed: Array.isArray(parsed.completed) ? parsed.completed.filter((key: unknown) => typeof key === "string") : [],
        };
      } catch { return { ...empty(), needsDiscovery: true }; }
    },
    async save(accountId: string, checkpoint: PricingCheckpoint): Promise<void> {
      if (!await storage.setItem(key(accountId), JSON.stringify(checkpoint))) {
        throw new Error("KDP pricing checkpoint could not be saved; retry pending");
      }
    },
  };
}
