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
