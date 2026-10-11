export function mapKdpMarketplacesSettled<T, R>(targets: T[], fetchTarget: (target: T) => Promise<R>, options?: {
  concurrency?: number; pauseMs?: number; delay?: (ms: number) => Promise<void>;
  now?: () => number; stopOnFailure?: boolean;
}): Promise<Array<PromiseSettledResult<R> & { durationMs: number; skipped?: boolean }>>;
