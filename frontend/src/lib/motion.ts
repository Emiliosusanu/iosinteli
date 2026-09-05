/** One motion system. Components must not invent 180/220/300ms. */
export const motion = {
  pressFeedback: 100,
  fastState: 140,
  contentChange: 200,
  segmentTransition: 200,
  sheetTransition: 280,
  pagerTransition: 220,
  updateEmphasis: 400,
  interactionFast: 140,
  contentUpdate: 200,
  /** Soft settle after glass / scrub interactions. */
  glassSettle: 260,
  staggerStep: 45,
} as const;

/** Slightly deeper press for glass chips — still subtle, not bouncy UI. */
export const PRESS_SCALE = 0.972;

export function isPlaceholderMetric(value: string | null | undefined): boolean {
  const next = (value ?? "").trim();
  return next.length === 0 || next === "—" || next === "–";
}

/** Crossfade verified strings. Never invent a $0 start. */
export function shouldCrossfadeMetric(previous: string, next: string): boolean {
  if (previous === next) return false;
  if (isPlaceholderMetric(previous)) return false;
  return true;
}

export type SyncChromeState = "synced" | "refreshing" | "stale" | "failed";

export function formatUpdatedAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const mins = Math.max(0, Math.floor((now - ts) / 60_000));
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export function syncChrome(input: {
  failedRefresh: boolean;
  refreshing: boolean;
  /** Amazon Ads sync job running — distinct from dashboard pull-to-refresh. */
  syncing?: boolean;
  stale: boolean;
  warning: boolean;
  lastCompletedAt?: string | null;
  now?: number;
}): { state: SyncChromeState; compact: string; label: string } {
  if (input.failedRefresh) {
    return { state: "failed", compact: "Failed", label: "Couldn't refresh" };
  }
  if (input.refreshing) {
    return { state: "refreshing", compact: "Refreshing", label: "Refreshing" };
  }
  if (input.syncing) {
    return { state: "refreshing", compact: "Syncing", label: "Amazon sync in progress" };
  }
  if (input.stale || input.warning) {
    return { state: "stale", compact: "Stale", label: "Stale" };
  }
  const updated = formatUpdatedAgo(input.lastCompletedAt, input.now);
  return {
    state: "synced",
    compact: updated ? updated.replace("Updated ", "") : "Synced",
    label: updated ?? "Synced",
  };
}
