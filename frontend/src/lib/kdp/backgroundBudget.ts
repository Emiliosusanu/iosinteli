/** The deadline belongs to the whole delivered task, not just its importer. */
export const SHORT_TASK_WORK_MS = 22_000;
export const PROCESSING_TASK_WORK_MS = 120_000;
export class KdpTaskBudgetExpired extends Error {
  constructor() { super('KDP background budget exhausted; checkpoint retained'); }
}
export function taskDeadline(mode: string, enteredAtMs: number, nativeDeadlineAtMs?: number | null): number {
  const local = enteredAtMs + (mode === 'processing' ? PROCESSING_TASK_WORK_MS : SHORT_TASK_WORK_MS);
  return nativeDeadlineAtMs != null && Number.isFinite(nativeDeadlineAtMs)
    ? Math.min(local, nativeDeadlineAtMs) : local;
}
export function taskRequestTimeout(deadlineAtMs?: number, now = Date.now(), reserveMs = 4_000): number | undefined {
  if (deadlineAtMs == null) return undefined;
  const remaining = deadlineAtMs - now - reserveMs;
  if (remaining < 1_000) throw new KdpTaskBudgetExpired();
  return Math.min(12_000, remaining);
}
export function canStartReportDay(deadlineAtMs?: number, now = Date.now()): boolean {
  return deadlineAtMs == null || deadlineAtMs - now >= 9_000;
}

/** Abort the actual cloud request, then await its settlement. An ACK lost at
 * expiry leaves the checkpoint pending; the next capture reconciles the DB. */
export async function withKdpTaskRequest<T>(deadlineAtMs: number | undefined,
  operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (deadlineAtMs == null) return operation();
  const timeout = taskRequestTimeout(deadlineAtMs, Date.now(), 1_000)!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const result = await operation(controller.signal);
    // PostgREST resolves aborted fetches as { error } by default. A settled
    // response after our abort cannot acknowledge a checkpoint, even if a
    // transport ignored cancellation and returned an otherwise valid ACK.
    if (controller.signal.aborted) throw new KdpTaskBudgetExpired();
    return result;
  }
  catch (error) {
    if (controller.signal.aborted) throw new KdpTaskBudgetExpired();
    throw error;
  } finally { clearTimeout(timer); }
}

/** Preparation reads/SDK session waits cannot consume the entire delivery.
 * This is deliberately never used for financial writes: SDK auth may finish
 * later, but a timed-out caller never starts an importer or ACKs a checkpoint. */
export async function withKdpPreparationBudget<T>(deadlineAtMs: number | undefined,
  operation: () => Promise<T>): Promise<T> {
  if (deadlineAtMs == null) return operation();
  const timeout = taskRequestTimeout(deadlineAtMs)!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new KdpTaskBudgetExpired()), timeout);
    })]);
  } finally { if (timer != null) clearTimeout(timer); }
}
