/**
 * Persisted KDP iPhone-helper activity lines for Sync / helper screens.
 * Ring buffer — newest first.
 */
import { storage } from "@/src/utils/storage";
import { buildKdpHelperOverview, type KdpHelperOverviewRow } from "./activityOverview.ts";

export { buildKdpHelperOverview, type KdpHelperOverviewRow };

const ACTIVITY_KEY = "inteliads.kdpHelper.activityLog";
const MAX_ENTRIES = 24;

export type KdpActivityKind =
  | "steady"
  | "nightly"
  | "onboarding"
  | "currency"
  | "error"
  | "info";

export type KdpActivityEntry = {
  id: string;
  atMs: number;
  kind: KdpActivityKind;
  message: string;
};

let activityWriteChain: Promise<void> = Promise.resolve();

export async function loadKdpActivityLog(): Promise<KdpActivityEntry[]> {
  try {
    const raw = await storage.getItem<string>(ACTIVITY_KEY, "");
    if (!raw || typeof raw !== "string") return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row === "object" && typeof row.message === "string")
      .map((row: Record<string, unknown>, index: number) => ({
        id: typeof row.id === "string" ? row.id : `kdp-act-${index}`,
        atMs: Number.isFinite(Number(row.atMs)) ? Number(row.atMs) : 0,
        kind: (typeof row.kind === "string" ? row.kind : "info") as KdpActivityKind,
        message: String(row.message),
      }))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function appendKdpActivity(
  message: string,
  kind: KdpActivityKind = "info",
): Promise<void> {
  const text = String(message || "").trim();
  if (!text) return;
  activityWriteChain = activityWriteChain
    .catch(() => undefined)
    .then(async () => {
      const prev = await loadKdpActivityLog();
      const entry: KdpActivityEntry = {
        id: `kdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        atMs: Date.now(),
        kind,
        message: text.slice(0, 240),
      };
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      await storage.setItem(ACTIVITY_KEY, JSON.stringify(next));
    });
  try {
    await activityWriteChain;
  } catch {
    /* best-effort */
  }
}

export async function clearKdpActivityLog(): Promise<void> {
  try {
    await storage.removeItem(ACTIVITY_KEY);
  } catch {
    /* best-effort */
  }
}
