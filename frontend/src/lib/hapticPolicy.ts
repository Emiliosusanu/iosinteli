import * as Haptics from "expo-haptics";

export type HapticKind = "select" | "confirm" | "success" | "error";

/** Haptics are for deliberate user action only. Never refresh, sync, scroll, or card press. */
export async function playHaptic(kind: HapticKind, reduceMotion = false): Promise<void> {
  if (reduceMotion && kind === "select") return;
  try {
    if (kind === "select") {
      await Haptics.selectionAsync();
      return;
    }
    if (kind === "confirm") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    await Haptics.notificationAsync(
      kind === "success"
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    );
  } catch {
    // Haptics are optional chrome.
  }
}
