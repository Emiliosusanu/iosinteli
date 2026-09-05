/**
 * Resolve KDP wake mode for background TaskManager deliveries.
 * Keeps native/Expo wake routing out of notifications.ts noise.
 */
import { consumeNativeWakeKind } from "inteliads-native-sync";
import { hourInTz } from "./dates.ts";
import {
  hasIncompleteNightly,
  resolveBackgroundKdpWakeMode,
  type KdpWakeMode,
} from "./planner.ts";
import { loadHelperDeferredDays, loadHelperSyncState } from "./persist.ts";

export async function resolveLockedPhoneKdpWakeMode(
  fallbackReason: "background" | "push" = "background",
): Promise<KdpWakeMode> {
  let pendingNativeKind: KdpWakeMode | null = null;
  try {
    pendingNativeKind = await consumeNativeWakeKind();
  } catch {
    pendingNativeKind = null;
  }

  // Silent push is always a short recent wake (Royaltix ~25s budget).
  if (fallbackReason === "push" && !pendingNativeKind) {
    return "recent";
  }

  try {
    const [state, deferred] = await Promise.all([loadHelperSyncState(), loadHelperDeferredDays()]);
    return resolveBackgroundKdpWakeMode({
      pendingNativeKind,
      hour: hourInTz(new Date()),
      onboardingDone: state.onboardingDone,
      incompleteNightly: hasIncompleteNightly(state),
      deferredCount: deferred.length,
    });
  } catch {
    return pendingNativeKind ?? "recent";
  }
}
