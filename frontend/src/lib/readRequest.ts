export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  const e = error as { code?: string; status?: number; name?: string; message?: string } | null;
  if (e?.name === 'AbortError' || e?.code === 'SESSION_UNAVAILABLE') return false;
  if (['57014', '42501', '42703', 'PGRST301', 'PGRST302'].includes(e?.code ?? '')) return false;
  if (e?.status && e.status >= 400 && e.status < 500) return false;
  if (/session is unavailable|read timed out|HOME_QUERY_TIMEOUT/i.test(e?.message ?? '')) return false;
  return failureCount < 1;
}

function abortError() { const e = new Error('Read timed out or was cancelled'); e.name = 'AbortError'; return e; }

/** Bound concurrent reads, including time spent waiting. Cancelled queued work
 * never starts a database request when a screen has already moved on.
 */
export function createReadQueue(maxConcurrent = 4) {
  let active = 0;
  const waiting: Array<() => void> = [];
  function drain() { while (active < maxConcurrent && waiting.length) waiting.shift()!(); }
  return function run<T>(task: (signal: AbortSignal) => Promise<T>, upstream?: AbortSignal | null, timeoutMs = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let started = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); upstream?.removeEventListener('abort', abort); };
      const abort = () => {
        if (!settled) {
          settled = true;
          const index = waiting.indexOf(start);
          if (index >= 0) waiting.splice(index, 1);
          cleanup(); reject(abortError());
          // A transport may ignore cancellation. Settle the caller now, but keep
          // its slot until the transport ends so actual concurrency stays bounded.
          controller.abort();
        }
      };
      const start = () => {
        if (settled) return;
        started = true; active++;
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) throw abortError();
          return task(controller.signal);
        }).then(value => {
          if (!settled) resolve(value);
        }, error => {
          if (!settled) reject(error);
        }).finally(() => {
          settled = true; cleanup(); active--; drain();
        });
      };
      timer = setTimeout(abort, timeoutMs);
      upstream?.addEventListener('abort', abort, { once: true });
      if (upstream?.aborted) { abort(); return; }
      waiting.push(start); drain();
    });
  };
}
