/** Keep at most three storefronts (nine report requests) active, without
 * making fast storefronts wait for the slowest member of a fixed batch. */
export async function mapKdpMarketplacesSettled(targets, fetchTarget, {
  concurrency = 3,
  pauseMs = 250,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  stopOnFailure = false,
} = {}) {
  const results = new Array(targets.length);
  const limit = Math.min(3, Math.max(1, Math.trunc(Number(concurrency)) || 1));
  let cursor = 0;
  let failed = false;
  let firstFailure;
  async function worker() {
    let first = true;
    for (;;) {
      if (stopOnFailure && failed) return;
      const index = cursor++;
      if (index >= targets.length) return;
      if (!first && pauseMs > 0) await delay(pauseMs);
      if (stopOnFailure && failed) return;
      first = false;
      const started = now();
      try {
        results[index] = { status: 'fulfilled', value: await fetchTarget(targets[index]), durationMs: Math.max(0, now() - started) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason, durationMs: Math.max(0, now() - started) };
        if (!failed) firstFailure = reason;
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  for (let index = 0; index < results.length; index++) {
    if (!results[index]) results[index] = { status: 'rejected', reason: firstFailure, durationMs: 0, skipped: true };
  }
  return results;
}
