/** Proven Sync data-contract helpers. Do not invent backend states here. */

export const SYNC_VIEWING_CUSTOMER_MESSAGE =
  "Amazon Ads sync isn't available while viewing another user's accounts.";

export const ADS_UP_TO_DATE_LABEL = "Amazon Ads up to date";
export const ADS_NEEDS_REVIEW_LABEL = "Amazon Ads needs review";
export const ADS_SYNCING_LABEL = "Syncing Amazon Ads…";
export const ADS_NOT_SYNCED_LABEL = "Amazon Ads not synced yet";
export const ADS_FINISHED_NO_FRESHNESS_LABEL = "Amazon Ads sync finished";

export type SyncHeroState = "connected" | "syncing" | "warning" | "idle";

export type SyncLogLike = {
  status?: string | null;
  completed_at?: string | null;
  started_at?: string | null;
};

export function canReadSync(params: {
  userId?: string | null;
  guestMode: boolean;
}): boolean {
  return !!params.userId && !params.guestMode;
}

export function canMutateSync(params: {
  userId?: string | null;
  guestMode: boolean;
  adminFilterUserId?: string | null;
}): boolean {
  return canReadSync(params) && !params.adminFilterUserId;
}

export function syncOverviewQueryKey(
  userId: string | undefined,
  selectedProfileIds: string[],
  adminFilterUserId?: string | null,
) {
  return ["sync-overview", userId, adminFilterUserId ?? "self", selectedProfileIds] as const;
}

export function syncStatusQueryKey(userId: string | undefined, adminFilterUserId?: string | null) {
  return ["sync-status", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

export function amsIntradayQueryKey(
  userId: string | undefined,
  selectedProfileIds: string[],
  adminFilterUserId?: string | null,
) {
  return ["ams-intraday", userId, adminFilterUserId ?? "self", selectedProfileIds] as const;
}

export function isActiveSyncStatus(status: string): boolean {
  return status === "pending" || status === "running" || status === "processing" || status === "in_progress";
}

export function isFailedSyncStatus(status: string): boolean {
  return status === "failed" || status === "partial_failed";
}

/** Nest only persists pending | completed | failed | partial_failed | cancelled. */
export function syncStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "In progress";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "partial_failed":
      return "Partial";
    case "cancelled":
      return "Cancelled";
    case "running":
    case "processing":
    case "in_progress":
      return "In progress";
    default:
      return status?.trim() ? status : "—";
  }
}

export function syncStatusTone(status: string): "good" | "warning" | "danger" | "inactive" {
  if (status === "completed") return "good";
  if (status === "partial_failed" || status === "pending") return "warning";
  if (status === "failed") return "danger";
  if (status === "cancelled" || isActiveSyncStatus(status)) return "inactive";
  return "inactive";
}

export function syncTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "manual":
      return "Manual";
    case "hourly":
      return "Hourly";
    case "full":
      return "Nightly";
    default:
      return type?.trim() ? type : "Sync";
  }
}

/**
 * Last-success copy. Job start must not be shown as "Updated".
 * Missing completed_at is a freshness gap, not "up to date".
 */
export function syncFreshnessKind(
  row: SyncLogLike | undefined,
): "completed" | "started" | "none" {
  if (!row) return "none";
  if (row.completed_at) return "completed";
  if (row.started_at && isActiveSyncStatus(row.status ?? "")) return "started";
  return "none";
}

export function deriveSyncHero(args: {
  inProgress: boolean;
  profiles: SyncLogLike[];
}): { state: SyncHeroState; label: string; freshness: "completed" | "started" | "none" } {
  const profiles = args.profiles;
  const latest = profiles[0];
  const lastStatus = latest?.status ?? "";
  const failed = profiles.some((row) => isFailedSyncStatus(row.status ?? ""));

  if (args.inProgress || isActiveSyncStatus(lastStatus)) {
    return { state: "syncing", label: ADS_SYNCING_LABEL, freshness: syncFreshnessKind(latest) };
  }
  if (failed || lastStatus === "failed" || lastStatus === "partial_failed") {
    return { state: "warning", label: ADS_NEEDS_REVIEW_LABEL, freshness: syncFreshnessKind(latest) };
  }
  if (lastStatus === "completed") {
    if (latest?.completed_at) {
      return { state: "connected", label: ADS_UP_TO_DATE_LABEL, freshness: "completed" };
    }
    return { state: "idle", label: ADS_FINISHED_NO_FRESHNESS_LABEL, freshness: "none" };
  }
  return { state: "idle", label: ADS_NOT_SYNCED_LABEL, freshness: syncFreshnessKind(latest) };
}

/** HTTP 200/202 on POST /amazon/sync means the job was accepted, not that Ads finished. */
export function triggerResponseMeansCompleted(): boolean {
  return false;
}

export function claimsKdpOrAllSources(label: string): boolean {
  const lower = label.toLowerCase();
  return lower.includes("all data") || lower.includes("kdp") || lower.includes("royalt");
}

/** Presentation helpers below. They do not change Nest scope or deriveSyncHero rules. */

export const CHECKING_STATUS_LABEL = "Checking…";
export const STATUS_UNAVAILABLE_LABEL = "Couldn't check status";
export const LOADING_LOGS_LABEL = "Loading logs…";
export const SELECT_PROFILE_FOR_FRESHNESS_LABEL = "Select a profile";

export const SCOPE_HELPER = "Selected profiles · Sync runs for all enabled";

export const NO_SELECTED_TITLE = "No profiles in view";
export const NO_SELECTED_SUBTITLE = "Pick a profile for Ads logs. Sync still runs for all enabled.";

export const NO_PROFILE_LOGS_TITLE = "No sync history";
export const NO_AMS_TITLE = "No stream messages";

export const AMS_SECTION_TITLE = "Marketing Stream";
export const AMS_SECTION_SUBTITLE = "Not refreshed by Sync now";

export const RECORDS_FOOTNOTE =
  "Writes in this window — not catalog size.";

export const CANCEL_CONFIRM_TITLE = "Cancel sync?";
export const CANCEL_CONFIRM_MESSAGE =
  "Stops the current job. Imported data stays.";

export const VIEWING_CUSTOMER_BANNER = "Viewing customer — Sync off";

export const REFRESH_A11Y_LABEL = "Refresh status and logs";
export const REFRESH_A11Y_HINT = "Refreshes status and logs. Does not start sync.";

export const SYNC_NOW_HINT = "Syncs Ads for all enabled profiles. Not royalties.";
export const CANCEL_SYNC_HINT = "Stops the current job. Imported data stays.";

export const RECONNECT_COPY = "Reconnect Amazon in Accounts.";

export function formatSyncWhen(
  iso: string | null | undefined,
  now = Date.now(),
  opts?: { spoken?: boolean },
): string {
  if (!iso) return "—";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "—";
  const spoken = !!opts?.spoken;
  const mins = Math.round(Math.abs(now - time) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) {
    if (spoken) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
    return `${mins} min ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    if (spoken) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    return hours === 1 ? "1 hr ago" : `${hours} hr ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    if (spoken) return days === 1 ? "yesterday" : `${days} days ago`;
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function latestLogPerProfile<T extends { amazon_profile_id: string }>(logs: T[]): T[] {
  const seen = new Set<string>();
  const latest: T[] = [];
  for (const row of logs) {
    if (seen.has(row.amazon_profile_id)) continue;
    seen.add(row.amazon_profile_id);
    latest.push(row);
  }
  return latest;
}

export function profileRunDisplayName(row: { profile_name?: string | null }): string {
  const name = row.profile_name?.trim();
  return name || "Amazon profile";
}

/** Success freshness is completed_at as "Updated". Pending uses Started. Fail/cancel keep a time without "Updated". */
export function profileRunWhenLabel(
  row: SyncLogLike,
  now = Date.now(),
  opts?: { spoken?: boolean },
): string | undefined {
  if (isActiveSyncStatus(row.status ?? "")) {
    return row.started_at ? `Started ${formatSyncWhen(row.started_at, now, opts)}` : undefined;
  }
  if (row.status === "completed" && row.completed_at) {
    return `Updated ${formatSyncWhen(row.completed_at, now, opts)}`;
  }
  if (row.completed_at) return formatSyncWhen(row.completed_at, now, opts);
  if (row.started_at) return `Started ${formatSyncWhen(row.started_at, now, opts)}`;
  return undefined;
}

export function latestProfilesNeedingReview(latest: { status?: string | null; profile_name?: string | null }[]): string[] {
  return latest
    .filter((row) => isFailedSyncStatus(row.status ?? ""))
    .map((row) => profileRunDisplayName(row));
}

export function windowHasOlderFailureThanLatest(
  logs: { amazon_profile_id: string; status?: string | null }[],
  latest: { amazon_profile_id: string; status?: string | null }[],
): boolean {
  const latestFailed = latest.some((row) => isFailedSyncStatus(row.status ?? ""));
  const windowFailed = logs.some((row) => isFailedSyncStatus(row.status ?? ""));
  return windowFailed && !latestFailed;
}

export function needsReviewNote(args: {
  heroLabel: string;
  latest: { status?: string | null; profile_name?: string | null; amazon_profile_id: string }[];
  logs: { amazon_profile_id: string; status?: string | null }[];
}): string | undefined {
  if (args.heroLabel !== ADS_NEEDS_REVIEW_LABEL) return undefined;
  const current = latestProfilesNeedingReview(args.latest);
  if (current.length === 1) return `${current[0]} needs review.`;
  if (current.length > 1) return `${current.length} selected profiles need review.`;
  if (windowHasOlderFailureThanLatest(args.logs, args.latest)) {
    return "An earlier run in this log window failed or partially failed.";
  }
  return "A failed or partial run is in this log window.";
}

export function resolvePresentedHero(args: {
  inProgress: boolean;
  statusKnown: boolean;
  statusFailed?: boolean;
  logsKnown: boolean;
  hasSelectedProfiles: boolean;
  profiles: SyncLogLike[];
}): { state: SyncHeroState; label: string; freshness: "completed" | "started" | "none"; provisional: boolean } {
  if (args.inProgress) {
    return { ...deriveSyncHero({ inProgress: true, profiles: args.profiles }), provisional: false };
  }
  if (!args.statusKnown) {
    return {
      state: "idle",
      label: args.statusFailed ? STATUS_UNAVAILABLE_LABEL : CHECKING_STATUS_LABEL,
      freshness: "none",
      provisional: true,
    };
  }
  if (!args.hasSelectedProfiles) {
    return { state: "idle", label: SELECT_PROFILE_FOR_FRESHNESS_LABEL, freshness: "none", provisional: true };
  }
  if (!args.logsKnown) {
    return { state: "idle", label: LOADING_LOGS_LABEL, freshness: "none", provisional: true };
  }
  return { ...deriveSyncHero({ inProgress: false, profiles: args.profiles }), provisional: false };
}

export function syncHeroDetail(args: {
  inProgress: boolean;
  freshness: "completed" | "started" | "none";
  profiles: SyncLogLike[];
  now?: number;
  spoken?: boolean;
}): string | undefined {
  const now = args.now ?? Date.now();
  const spoken = args.spoken;
  if (args.inProgress) {
    const pending =
      args.profiles.find((row) => isActiveSyncStatus(row.status ?? "")) ?? args.profiles[0];
    if (pending?.started_at) return `Started ${formatSyncWhen(pending.started_at, now, { spoken })}`;
    return undefined;
  }
  if (args.freshness === "completed" && args.profiles[0]?.completed_at) {
    return `Updated ${formatSyncWhen(args.profiles[0].completed_at, now, { spoken })}`;
  }
  if (args.freshness === "started" && args.profiles[0]?.started_at) {
    return `Started ${formatSyncWhen(args.profiles[0].started_at, now, { spoken })}`;
  }
  return undefined;
}

export function syncHeroAccessibilityLabel(args: {
  label: string;
  detail?: string;
  reviewNote?: string;
}): string {
  return [args.label.replace(/…$/, ""), args.detail, args.reviewNote].filter(Boolean).join(". ");
}

export function profileRunAccessibilityLabel(args: {
  name: string;
  status?: string | null;
  when?: string;
  error?: string | null;
}): string {
  return [args.name, syncStatusLabel(args.status), args.when, args.error?.trim() || undefined]
    .filter(Boolean)
    .join(". ");
}

export function sessionRowAccessibilityLabel(args: {
  type?: string | null;
  status?: string | null;
  when?: string;
}): string {
  const kind = syncTypeLabel(args.type);
  const scheduled =
    args.type === "hourly" || args.type === "full" ? "Scheduled. Not started from this screen" : undefined;
  return [kind, syncStatusLabel(args.status), args.when, scheduled].filter(Boolean).join(". ");
}

export function logWindowCaption(args: { completed: number; failed: number; records: string }): string {
  return `This log window: ${args.completed} completed · ${args.failed} failed or partial · ${args.records} entity writes`;
}

/** Strong LWA/token signals only. Do not match generic unauthorized / failed. */
export function looksLikeExpiredAmazonToken(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("invalid_grant")) return true;
  if (m.includes("refresh_token") && (m.includes("expired") || m.includes("revoked") || m.includes("invalid"))) {
    return true;
  }
  if (/\brefresh token\b/.test(m) && (m.includes("expired") || m.includes("revoked") || m.includes("invalid"))) {
    return true;
  }
  return false;
}

export function reconnectRequiredFromLatest(latest: { error_message?: string | null }[]): boolean {
  return latest.some((row) => looksLikeExpiredAmazonToken(row.error_message));
}

export function amsEventLabel(kind: string | null | undefined): string {
  const trimmed = kind?.trim();
  if (!trimmed) return "Stream event";
  return trimmed.replace(/_/g, " ");
}
