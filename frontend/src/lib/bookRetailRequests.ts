const REQUEST_TIMEOUT_MS = 15_000;

/** Prioritize the first displayed editions and their active/selected markets.
 * Other owned markets still run; never let profile-id order choose latency. */
export function prioritizeBookRetailRequests<T extends { batch: string[]; marketplaceCode: string | null }>(
  requests: T[], asins: readonly string[], activeMarkets: readonly string[] = [], preferredMarket = '',
): T[] {
  const country = (value: string) => value.trim().toUpperCase().replace(/^UK$/, 'GB');
  const active = new Set(activeMarkets.map(country));
  const preferred = country(preferredMarket);
  const rank = new Map(asins.map((asin, index) => [asin, index]));
  const marketRank = (market: string | null) => active.has(country(market ?? '')) ? 0
    : preferred && country(market ?? '') === preferred ? 1 : 2;
  return requests.sort((a, b) => (rank.get(a.batch[0]) ?? 0) - (rank.get(b.batch[0]) ?? 0)
    || marketRank(a.marketplaceCode) - marketRank(b.marketplaceCode));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('Listing read cancelled'), { name: 'AbortError' });
}

/** A bounded pool publishes each successful observation immediately. Slow
 * marketplaces cannot hold up good rows or the next available request slot. */
export async function readBookRetailRequests<T, R>(
  requests: readonly T[],
  read: (request: T, context: { signal: AbortSignal }) => Promise<readonly R[]>,
  opts: { signal?: AbortSignal; timeoutMs?: number; onRows?: (rows: readonly R[]) => void } = {},
): Promise<{ rows: R[]; failedRequests: number }> {
  const rowsByRequest: Array<readonly R[]> = [];
  let failedRequests = 0;
  let successfulRequests = 0;
  let firstError: unknown;
  let fatalError: unknown;
  let cursor = 0;
  const active = new Set<(reason: unknown) => void>();
  const fail = (error: unknown) => {
    fatalError ??= error;
    for (const cancel of active) cancel(fatalError);
  };
  const worker = async () => {
    while (cursor < requests.length && !fatalError) {
      if (opts.signal?.aborted) { fatalError = abortReason(opts.signal); break; }
      const index = cursor++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (reason: unknown) => void = () => {};
      const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const abortRequest = (reason: unknown) => { controller.abort(reason); rejectAbort(reason); };
      active.add(abortRequest);
      const cancel = () => abortRequest(opts.signal ? abortReason(opts.signal) : new Error('Listing read cancelled'));
      opts.signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        const error = Object.assign(new Error('Listing request timed out'), { status: 503 });
        controller.abort(error);
        rejectAbort(error);
      }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
      let rows: readonly R[] | undefined;
      try {
        rows = await Promise.race([read(requests[index], { signal: controller.signal }), cancelled]);
      } catch (error: any) {
        const status = Number(error?.status ?? error?.statusCode ?? 0);
        if (opts.signal?.aborted) fail(abortReason(opts.signal));
        else if (status === 401 || status === 403 || error?.name === 'AbortError') fail(error);
        else { failedRequests += 1; firstError ??= error; }
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', cancel);
        active.delete(abortRequest);
      }
      if (opts.signal?.aborted) fatalError = abortReason(opts.signal);
      if (rows && !fatalError) {
        successfulRequests += 1;
        rowsByRequest[index] = rows;
        opts.onRows?.(rows);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, requests.length) }, worker));
  if (fatalError) throw fatalError;
  if (requests.length && !successfulRequests) throw firstError ?? new Error('Listing details unavailable');
  return { rows: rowsByRequest.flatMap(rows => rows ?? []), failedRequests };
}
