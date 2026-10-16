/** Read-only recovery is bounded. Access denials and cancellation never retry. */
export function shouldRetryBooksRead(failures: number, error: unknown): boolean {
  if (failures >= 2 || !error || typeof error !== "object") return false;
  const row = error as { name?: string; message?: string; status?: number; statusCode?: number; code?: string };
  if (row.name === "AbortError") return false;
  const status = Number(row.status ?? row.statusCode ?? 0);
  if (status) return status === 408 || status === 429 || status >= 500;
  return row.code === "57014" || /HOME_QUERY_TIMEOUT|timed? ?out|timeout|Network request failed|Failed to fetch|offline|NetworkError/i.test(`${row.message ?? ""} ${row.code ?? ""}`);
}

/** Do not keep hammering a deferred listing forever. Foreground only (hook).
 * Partial transient failures get two follow-up reads; pending work gets one minute.
 */
export function bookRetailRefetchInterval(query: { state: {
  data?: { pendingRequests?: number; failedRequests?: number }; dataUpdateCount?: number;
} }): number | false {
  const { data, dataUpdateCount = 1 } = query.state;
  if ((data?.pendingRequests ?? 0) > 0 && dataUpdateCount < 30) return 2000;
  if ((data?.failedRequests ?? 0) > 0 && dataUpdateCount < 3) return 5000;
  return false;
}
