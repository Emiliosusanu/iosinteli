import type { SyncReadEvidence } from "./syncFeedback";

export type OverviewReadFeedback = SyncReadEvidence & { label: string };

export function overviewReadFeedback(input: SyncReadEvidence): OverviewReadFeedback {
  // A hydrated read keeps its timestamp. "Cached data" is only a failed refresh.
  return { ...input, label: input.fetching ? "" : overviewReadLabel({ ...input, fetching: false }) };
}

/** A timestamp remains true on an idle screen, unlike a frozen "just now". */
export function overviewReadLabel(input: {
  updatedAt: number;
  fetching: boolean;
  failed: boolean;
}): string {
  if (input.fetching) return "Updating";
  if (input.failed) return input.updatedAt > 0 ? "Cached data · update failed" : "Update unavailable";
  if (!Number.isFinite(input.updatedAt) || input.updatedAt <= 0) return "Waiting";
  return new Date(input.updatedAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** A failed refresh cannot silently reuse rows as current recommendations. */
export function overviewRecommendationRows<T>(rows: T[] | undefined, failed: boolean): T[] {
  return failed ? [] : rows ?? [];
}
