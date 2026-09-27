/** Sort campaign (and list) search terms: ACoS ascending when known, else spend high→low. */

export type SearchTermSortRow = {
  total_acos?: number | null;
  total_sales?: number | null;
  total_spend?: number | null;
};

export function searchTermHasAcos(row: SearchTermSortRow): boolean {
  return Number(row.total_sales) > 0;
}

/**
 * Terms with sales (ACoS) first, low ACoS first; terms without sales by spend high→low.
 */
export function compareSearchTermsAcosThenSpend(a: SearchTermSortRow, b: SearchTermSortRow): number {
  const aHas = searchTermHasAcos(a);
  const bHas = searchTermHasAcos(b);
  if (aHas && bHas) {
    const byAcos = (Number(a.total_acos) || 0) - (Number(b.total_acos) || 0);
    if (byAcos !== 0) return byAcos;
    return (Number(b.total_spend) || 0) - (Number(a.total_spend) || 0);
  }
  if (aHas !== bHas) return aHas ? -1 : 1;
  return (Number(b.total_spend) || 0) - (Number(a.total_spend) || 0);
}

export function sortSearchTermsAcosThenSpend<T extends SearchTermSortRow>(rows: T[]): T[] {
  return [...rows].sort(compareSearchTermsAcosThenSpend);
}
