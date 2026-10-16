/** A failed marketplace must not hide successful exact-ASIN observations.
 * Keep requests bounded and preserve authentication failures for the caller. */
export async function readBookRetailRequests<T, R>(
  requests: readonly T[],
  read: (request: T) => Promise<readonly R[]>,
): Promise<{ rows: R[]; failedRequests: number }> {
  const rows: R[] = [];
  let failedRequests = 0;
  let successfulRequests = 0;
  let firstError: unknown;
  for (let offset = 0; offset < requests.length; offset += 3) {
    const results = await Promise.allSettled(requests.slice(offset, offset + 3).map(read));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successfulRequests += 1;
        rows.push(...result.value);
      } else {
        const error = result.reason;
        const status = Number(error?.status ?? error?.statusCode ?? 0);
        if (status === 401 || status === 403) throw error;
        failedRequests += 1;
        firstError ??= error;
      }
    }
  }
  if (requests.length && !successfulRequests) throw firstError ?? new Error('Listing details unavailable');
  return { rows, failedRequests };
}
