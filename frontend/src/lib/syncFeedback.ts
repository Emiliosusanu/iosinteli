export type SyncReadEvidence = {
  fetching: boolean;
  failed: boolean;
  updatedAt: number;
  received?: boolean;
};

export type SyncFeedbackState = {
  contextKey: string;
  baseline: number | null;
  phase: "idle" | "updating" | "success";
};

/** A cache hit, cancellation, failed read or context switch is not a successful refresh. */
export function nextSyncFeedback(
  previous: SyncFeedbackState | null,
  contextKey: string,
  read: SyncReadEvidence,
  visible: boolean,
): SyncFeedbackState {
  const baseline = Number.isFinite(read.updatedAt) && read.updatedAt > 0 ? read.updatedAt : 0;
  if (!visible) return { contextKey, baseline: null, phase: "idle" };
  const sameContext = previous?.contextKey === contextKey;
  if (read.fetching) return {
    contextKey,
    baseline: sameContext && previous.baseline != null ? previous.baseline : baseline,
    phase: "updating",
  };
  const succeeded = sameContext && previous.phase === "updating" &&
    previous.baseline != null && !read.failed && read.received === true && baseline > previous.baseline;
  return { contextKey, baseline: null, phase: succeeded ? "success" : "idle" };
}
