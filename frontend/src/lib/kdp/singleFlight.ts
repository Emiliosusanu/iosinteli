/** Coalesce overlapping wakes before any session, planner or report work starts. */
export function createSingleFlight<Args extends unknown[], Result>(
  run: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let inFlight: Promise<Result> | null = null;
  return (...args) => {
    if (inFlight) return inFlight;
    const pending = Promise.resolve().then(() => run(...args));
    const tracked = pending.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}
