/** Initial ranked Targets window; sorting/filtering still run globally in the RPC. */

export const TARGETING_PAGE_SIZE = 100;

/** Append a ranked server page without re-sorting or duplicating entity IDs. */
export function appendTargetingPageRows<T extends { id?: unknown }>(
  head: readonly T[],
  loadedTail: readonly T[],
  nextPage: readonly T[],
): T[] {
  const seen = new Set(
    [...head, ...loadedTail].map((row) => String(row.id ?? "")),
  );
  const append = nextPage.filter((row) => {
    const id = String(row.id ?? "");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return [...loadedTail, ...append];
}

/** Bounded page number strip: always first + last, and a window around current. */
export function targetingPageNumbers(page: number, totalPages: number): number[] {
  const safeTotal = Math.max(1, Math.floor(totalPages) || 1);
  const safePage = Math.max(1, Math.min(Math.floor(page) || 1, safeTotal));
  const pages = new Set<number>([1, safeTotal]);
  const start = Math.max(1, Math.min(safePage - 2, safeTotal - 4));
  for (let n = start; n <= Math.min(safeTotal, start + 4); n += 1) pages.add(n);
  return [...pages].filter((n) => n >= 1 && n <= safeTotal).sort((a, b) => a - b);
}

export function targetingTotalPages(total: number, pageSize: number = TARGETING_PAGE_SIZE): number {
  const size = Math.max(1, pageSize);
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}
