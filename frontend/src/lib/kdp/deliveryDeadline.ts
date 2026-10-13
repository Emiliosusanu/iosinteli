import { taskDeadline, withKdpPreparationBudget } from "./backgroundBudget.ts";

/** Every entry point inherits the live native clock, even if cached AppState
 * still says active or the planner selected a longer processing mode. Native
 * reads are bounded preparation only; a late bridge answer cannot start work. */
export async function resolveKdpDeliveryDeadline(args: {
  mode: string;
  enteredAtMs: number;
  appState: string | null;
  readAppState?: () => string | null;
  requestedDeadlineAtMs?: number;
  readNativeDeadline: () => Promise<number | null>;
}): Promise<number | undefined> {
  const native = await withKdpPreparationBudget(
    // Preparation reserves four seconds itself and requires at least one
    // second remaining. Give this read two seconds from now, not a brittle
    // exact-one-second window reduced by module/lifecycle startup overhead.
    Date.now() + 6_000, args.readNativeDeadline,
  );
  if (native != null && Number.isFinite(native)) {
    const delivered = taskDeadline(args.mode, args.enteredAtMs, native);
    return args.requestedDeadlineAtMs == null ? delivered
      : Math.min(args.requestedDeadlineAtMs, delivered);
  }
  // Recheck after the bridge read: the phone can lock while it is pending.
  // Without an explicit delivered deadline, a planner's processing choice
  // does not prove that iOS granted a long processing window.
  const state = args.readAppState ? args.readAppState() : args.appState;
  return args.requestedDeadlineAtMs ?? (state !== "active"
    ? taskDeadline("recent", args.enteredAtMs) : undefined);
}
