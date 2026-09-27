/**
 * Profile ids for locked-phone KDP ticks (TaskManager / silent push).
 * AppContext is not mounted in those wakes — read the same AsyncStorage key.
 */
import { storage } from "@/src/utils/storage";

const SELECTED_PROFILES_KEY = "inteliads.selectedProfiles";

export async function loadSelectedProfileIdsForBackground(): Promise<string[]> {
  try {
    const raw = await storage.getItem<string>(SELECTED_PROFILES_KEY, "");
    if (!raw || typeof raw !== "string") return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}
