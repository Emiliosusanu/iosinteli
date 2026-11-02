/** A persisted page may paint immediately, but only a response for this selection is current. */
export function isTargetingPageFresh(
  updatedAt: number,
  selectedAt: number,
  cacheHydrated: boolean,
  isPlaceholder: boolean,
): boolean {
  return cacheHydrated && !isPlaceholder && updatedAt > selectedAt;
}

/** A retained tab needs a new read when its last response ages past the cache window. */
export function shouldRevalidateTargetingPageOnVisit(
  updatedAt: number,
  now: number,
  maxAgeMs: number,
): boolean {
  return updatedAt > 0 && (now < updatedAt || now - updatedAt >= maxAgeMs);
}

/** A successful HTTP read is not proof that Amazon has synced through today. */
export function targetingFreshnessLabel(input: {
  updatedAt: number;
  fetching: boolean;
  failed: boolean;
  now?: number;
}): string {
  if (input.fetching) return "Updating";
  if (input.failed) return input.updatedAt > 0 ? "Cached data · update failed" : "Update unavailable";
  if (!input.updatedAt) return "Waiting";
  return new Date(input.updatedAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
