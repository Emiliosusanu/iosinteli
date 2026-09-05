/** Proven BidBot data/safety helpers. Do not invent engine scores or profile filters here. */

export const BIDBOT_VIEWING_CUSTOMER_MESSAGE =
  "Bid Bot changes aren't available while viewing another user's accounts.";

export type BidBotAutoMode = "off" | "high_confidence" | "aggressive";

export type BidApplicationItem = {
  recommendationId?: string;
  campaignId?: string;
  outcome?: string;
  message?: string;
  reasonCode?: string;
};

export type BidApplicationSummary = {
  requested?: number;
  applied?: number;
  failed?: number;
  stale?: number;
  conflicted?: number;
  skipped?: number;
  alreadyApplied?: number;
};

export type BidApplicationEnvelope = {
  requestId?: string;
  items?: BidApplicationItem[];
  summary?: BidApplicationSummary;
};

export function canMutateBidBot(params: {
  userId?: string | null;
  guestMode: boolean;
  adminFilterUserId?: string | null;
}): boolean {
  return !!params.userId && !params.guestMode && !params.adminFilterUserId;
}

/** Nest admin GET without filterUserId lists every user's pending recs. Always send a user. */
export function bidBotReadFilterUserId(
  userId?: string | null,
  adminFilterUserId?: string | null,
): string | undefined {
  return adminFilterUserId || userId || undefined;
}

export function bidBotStatusQueryKey(userId?: string | null, adminFilterUserId?: string | null) {
  return ["bid-engine-status", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

export function bidBotSettingsQueryKey(userId?: string | null, adminFilterUserId?: string | null) {
  return ["bid-engine-settings", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

export function bidBotRecsQueryKey(userId?: string | null, adminFilterUserId?: string | null) {
  return ["bid-recommendations", "pending", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

export function bidBotPlacementsQueryKey(userId?: string | null, adminFilterUserId?: string | null) {
  return ["bid-engine-placements", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

export function bidBotApplyLogQueryKey(userId?: string | null, adminFilterUserId?: string | null) {
  return ["bid-engine-apply-log", userId ?? "guest", adminFilterUserId ?? "self"] as const;
}

/** Do not enable BidBot Nest reads from user.id alone — that 401s before a bearer exists. */
export function bidBotReadsEnabled(input: {
  userId?: string | null;
  accessToken?: string | null;
  authState?: string | null;
  guestMode?: boolean;
}): boolean {
  return (
    !!input.userId &&
    typeof input.accessToken === "string" &&
    input.accessToken.trim().length > 0 &&
    input.authState === "authenticated" &&
    input.guestMode !== true
  );
}

export function isBidBotReadQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  if (
    root === "bid-recommendations" ||
    root === "bid-engine-settings" ||
    root === "bid-engine-placements" ||
    root === "bid-engine-apply-log"
  ) {
    return true;
  }
  // Home keeps ["bid-engine-status", filter]. BidBot uses the 3-part key.
  return root === "bid-engine-status" && queryKey.length >= 3;
}

export const BIDBOT_READ_TIMEOUT_MS = 15_000;
export const BIDBOT_READ_TIMEOUT_MESSAGE = "Couldn't load BidBot. The request took too long.";
export const BIDBOT_LOADING_STATUS_LABEL = "Loading BidBot status";
export const BIDBOT_LOADING_RECS_LABEL = "Loading recommendations";
export const BIDBOT_LOADING_PLACEMENTS_LABEL = "Loading placement recommendations";
export const BIDBOT_LOADING_ACTIVITY_LABEL = "Loading BidBot activity";

export function withBidBotReadTimeout<T>(
  promise: Promise<T>,
  ms: number = BIDBOT_READ_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(BIDBOT_READ_TIMEOUT_MESSAGE));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function autoModeLabel(mode?: string | null): string {
  if (mode === "high_confidence") return "Careful";
  if (mode === "aggressive") return "Aggressive";
  if (mode === "off") return "Off";
  return mode ? mode.replace(/_/g, " ") : "Off";
}

/** Home status. Operational, not an AI mascot. */
export function bidBotOperationalCopy(input: {
  autoMode?: string | null;
  pendingCount?: number | null;
  lastRunAt?: string | null;
}): { title: string; detail: string } {
  const mode = asAutoMode(input.autoMode);
  const last = input.lastRunAt ? `Last run ${String(input.lastRunAt).slice(0, 10)}` : "No run recorded yet";
  if (mode === "off") return { title: "BidBot Off", detail: last };
  if ((input.pendingCount ?? 0) > 0) return { title: "BidBot Recommendations ready", detail: last };
  return { title: "BidBot Monitoring", detail: last };
}

export function asAutoMode(value?: string | null): BidBotAutoMode {
  if (value === "high_confidence" || value === "aggressive") return value;
  return "off";
}

export function persistableBidBotSettings(input: {
  targetAcos: number;
  autoMode: BidBotAutoMode;
}) {
  return { targetAcos: input.targetAcos, autoMode: input.autoMode };
}

function firstEnvelopeMessage(envelope: BidApplicationEnvelope): string | undefined {
  const item = envelope.items?.find((row) => row.message || row.reasonCode);
  return item?.message || item?.reasonCode;
}

export function isBidApplicationEnvelope(value: unknown): value is BidApplicationEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as BidApplicationEnvelope;
  return Array.isArray(row.items) || (row.summary != null && typeof row.summary === "object");
}

/** HTTP 200 is not Amazon-applied. Web uses the same envelope. */
export function assertBidApplicationSucceeded(result: unknown): void {
  if (!isBidApplicationEnvelope(result)) return;
  const requested = Number(result.summary?.requested ?? result.items?.length ?? 0);
  const applied = Number(result.summary?.applied ?? 0);
  if (requested <= 0) {
    throw new Error("Nothing was applied.");
  }
  if (applied <= 0) {
    throw new Error(firstEnvelopeMessage(result) || "Amazon didn't apply those changes.");
  }
  if (applied < requested) {
    throw new Error(`Applied ${applied} of ${requested}. Some changes were blocked.`);
  }
}

export function assertRevertSucceeded(result: unknown): void {
  if (!result || typeof result !== "object") return;
  const outcome = String((result as { outcome?: string }).outcome || "");
  if (!outcome || outcome === "applied" || outcome === "reverted" || outcome === "already_applied") {
    return;
  }
  const message = (result as { message?: string }).message;
  throw new Error(message || `Couldn't revert that change (${outcome}).`);
}

/** Presentation helpers below. They do not change engine, apply, or view-as contracts. */

export const BIDBOT_SCOPE_HELPER =
  "Recommendations are for this InteliAds account. The header profile filter does not limit them.";

export const SNAPSHOT_BID_LABEL = "Bid when analyzed";
export const PROPOSED_BID_LABEL = "Recommended bid";

export const CURRENCY_GAP_CAPTION =
  "Amounts are bid values. Marketplace currency is not included on these recommendations.";

export const MIN_MAX_DISPLAY_CAPTION =
  "Account min/max from web are display-only. They are not BidBot caps saved here, and they are not the iPhone Settings guardrails.";

export const TARGET_ACOS_CAPTION =
  "Target ACoS is a BidBot setting for this InteliAds account. It is a percent and is saved with auto mode.";

export const VIEWING_CUSTOMER_BANNER = "Viewing a customer. Apply, Run, Revert, and auto mode stay off.";

export const AGGRESSIVE_CONFIRM_TITLE = "Turn on Aggressive?";
export const AGGRESSIVE_CONFIRM_MESSAGE =
  "High- and medium-confidence recommendations may be applied automatically the next time BidBot runs. Amazon Ads bids can change without tapping Apply.";

export const REVERT_BID_MESSAGE = "This writes the previous bid back to Amazon Ads.";
export const REVERT_PLACEMENT_MESSAGE = "This writes the previous placement adjustments back to Amazon Ads.";

export function formatBidAmount(value?: number | null): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Absolute amount change. Not a percent and not the final proposed value. */
export function bidDeltaLabel(from?: number | null, to?: number | null): string | undefined {
  if (from == null || to == null || !Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) return undefined;
  const delta = Number(to) - Number(from);
  if (delta === 0) return "Same amount";
  const amount = formatBidAmount(Math.abs(delta));
  return delta < 0 ? `Decrease by ${amount}` : `Increase by ${amount}`;
}

export function recommendationTitle(row: { keyword?: string | null }): string {
  return row.keyword?.trim() || "Recommendation";
}

export function recommendationContext(row: { campaignName?: string | null }): string | undefined {
  return row.campaignName?.trim() || undefined;
}

export function isExpiredRecommendation(status?: string | null): boolean {
  return status?.trim().toLowerCase() === "expired";
}

/**
 * Same gate as Nest pending + apply: status pending (or legacy null) AND
 * application_status pending. Expired leftover rows are not actionable.
 */
export function isActionablePendingRecommendation(row: {
  status?: string | null;
  applicationStatus?: string | null;
}): boolean {
  const status = row.status?.trim().toLowerCase();
  const application = (row.applicationStatus ?? "pending").trim().toLowerCase();
  if (status === "expired" || application === "expired") return false;
  if (application !== "pending") return false;
  return status === "pending" || status == null || status === "";
}

export function placementIdentity(value?: {
  top_of_search?: number | null;
  product_pages?: number | null;
  rest_of_search?: number | null;
} | null): string {
  if (!value) return "Placement";
  const parts: string[] = [];
  if (value.top_of_search != null) parts.push("Top of search");
  if (value.product_pages != null) parts.push("Product pages");
  if (value.rest_of_search != null) parts.push("Rest of search");
  return parts.join(" · ") || "Placement";
}

export function applyBidConfirmTitle(count: number): string {
  return count === 1 ? "Apply recommended bid?" : `Apply ${count} recommended bids?`;
}

export function applyBidConfirmMessage(
  rows: { keyword?: string | null; campaignName?: string | null; currentBid?: number | null; recommendedBid?: number | null }[],
): string {
  const first = rows[0];
  const extra = rows.length > 1 ? `\nAnd ${rows.length - 1} more.` : "";
  return [
    recommendationTitle(first ?? {}),
    recommendationContext(first ?? {}),
    `${SNAPSHOT_BID_LABEL}: ${formatBidAmount(first?.currentBid)}`,
    `New bid: ${formatBidAmount(first?.recommendedBid)}`,
    "This changes the bid on Amazon Ads.",
    extra.trim() || undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function applyPlacementConfirmTitle(count: number): string {
  return count === 1 ? "Apply placement change?" : `Apply ${count} placement changes?`;
}

export function applyPlacementConfirmMessage(
  rows: { campaignName?: string | null; campaignId?: string | null; currentText?: string; recommendedText?: string }[],
): string {
  const first = rows[0];
  const extra = rows.length > 1 ? `\nAnd ${rows.length - 1} more.` : "";
  return [
    first?.campaignName?.trim() || first?.campaignId || "Campaign",
    "Placement adjustment",
    `${first?.currentText || "—"} → ${first?.recommendedText || "—"}`,
    "This changes placement percentages on Amazon Ads. These are not bids.",
    extra.trim() || undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function needsRunAutoConfirm(mode: BidBotAutoMode): boolean {
  return mode === "high_confidence" || mode === "aggressive";
}

export function runEngineA11yLabel(mode: BidBotAutoMode): string {
  if (mode === "high_confidence") {
    return "Run engine. Careful mode may apply high-confidence recommendations automatically.";
  }
  if (mode === "aggressive") {
    return "Run engine. Aggressive mode may apply high- and medium-confidence recommendations automatically.";
  }
  return "Run engine. Generates recommendations only.";
}

export function runEngineConfirmTitle(): string {
  return "Run BidBot now?";
}

export function runEngineConfirmMessage(mode: BidBotAutoMode): string {
  if (mode === "high_confidence") {
    return "Careful mode is on. Qualifying high-confidence recommendations may be applied automatically. This is not limited to recommendations you selected.";
  }
  if (mode === "aggressive") {
    return "Aggressive mode is on. Qualifying high- and medium-confidence recommendations may be applied automatically. This is not limited to recommendations you selected.";
  }
  return "Run evaluates recommendations. Nothing is applied automatically.";
}

export function autoModeDescription(mode: BidBotAutoMode): string {
  if (mode === "high_confidence") {
    return "Careful auto-applies high-confidence recommendations after a run. Medium recommendations stay visible for Apply.";
  }
  if (mode === "aggressive") {
    return "Aggressive auto-applies high- and medium-confidence recommendations after a run.";
  }
  return "Off only generates recommendations. Run does not apply changes automatically.";
}

export function confidenceCategoryLabel(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?%?$/.test(trimmed)) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "high") return "High";
  if (lower === "medium") return "Medium";
  if (lower === "low") return "Low";
  return trimmed;
}

export function humanizeBidApplyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (!raw) return "Amazon didn't apply those changes.";
  if (/STALE_BID|DATA_STALE|stale|version mismatch|current_version/i.test(raw)) {
    if (/Refresh BidBot/i.test(raw)) return raw;
    return `${raw} Refresh BidBot before applying it.`;
  }
  return raw;
}

export function emptyBidRecsTitle(hasRun: boolean): string {
  return hasRun ? "No bid recommendations right now" : "BidBot hasn't run yet";
}

export function emptyBidRecsSubtitle(hasRun: boolean): string {
  return hasRun
    ? "Run the engine to evaluate bids again."
    : "Run the engine to generate recommendations. Nothing is applied while auto mode is Off.";
}

export function applyBidsButtonLabel(count: number): string {
  return count > 1 ? `Apply ${count} recommended bids` : "Apply recommended bid";
}

export function applyBidsA11yLabel(count: number, proposed?: string): string {
  if (count === 1 && proposed && proposed !== "—") return `Apply recommended bid, ${proposed}`;
  return applyBidsButtonLabel(count);
}

export function recRowAccessibilityLabel(args: {
  title: string;
  campaign?: string;
  analyzed?: string;
  proposed?: string;
  delta?: string;
}): string {
  return [
    args.title,
    args.campaign,
    "Recommendation",
    args.analyzed && args.analyzed !== "—" ? `${SNAPSHOT_BID_LABEL} ${args.analyzed}` : undefined,
    args.proposed && args.proposed !== "—" ? `${PROPOSED_BID_LABEL} ${args.proposed}` : undefined,
    args.delta,
  ]
    .filter(Boolean)
    .join(". ");
}

export function revertConfirmMessage(entityType?: string | null): string {
  return entityType && /placement/i.test(entityType) ? REVERT_PLACEMENT_MESSAGE : REVERT_BID_MESSAGE;
}

export const ABOUT_BIDBOT_COPY = [
  "BidBot recommends Amazon Ads bid and placement changes from your target ACoS.",
  "Recommendations are for this InteliAds account. The header profile filter does not limit them.",
  "Bid when analyzed is the bid BidBot used when it generated the recommendation. It may not match Amazon right now. Apply still checks Amazon before writing.",
  "Placement confidence is a category (High, Medium, Low), not a probability.",
  "Off: Run only generates recommendations.",
  "Careful: Run may automatically apply high-confidence recommendations.",
  "Aggressive: Run may automatically apply high- and medium-confidence recommendations.",
  "Automatic apply happens on Run. A server schedule only runs if it was already enabled elsewhere. This screen does not turn on a schedule.",
  "Applied changes appear under Activity. Revert writes the previous value back to Amazon Ads if Amazon is still at the applied value.",
].join("\n\n");
