/** A timestamp remains true on an idle screen, unlike a frozen "just now". */
export function overviewReadLabel(input: {
  updatedAt: number;
  fetching: boolean;
  failed: boolean;
}): string {
  if (input.fetching) return "Updating from server";
  if (input.failed) return input.updatedAt > 0 ? "Cached data · update failed" : "Update unavailable";
  if (!Number.isFinite(input.updatedAt) || input.updatedAt <= 0) return "Waiting for server";
  const stamp = new Date(input.updatedAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Server read · ${stamp}`;
}

/** A failed refresh cannot silently reuse rows as current recommendations. */
export function overviewRecommendationRows<T>(rows: T[] | undefined, failed: boolean): T[] {
  return failed ? [] : rows ?? [];
}
