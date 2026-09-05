// Nest API writes — same paths the web dashboard uses.
// Reads stay on Supabase RLS. nestApiFetch sends Nest JWT or the Supabase bearer.

import { nestApiFetch, nestApiJson, nestLogout, parseNestError, NestApiError } from "./rulesApi";
import { supabase } from "./supabase";
import { normalizeNestUserPlanPayload, type NestUserPlan } from "./accountContract";
import { isTransientEnableProfileError } from "./accountsUi";
import { amazonManualWrite } from "./bulkOutboxContract";
import type { AmazonProfile } from "./types";

export { amazonManualWrite } from "./bulkOutboxContract";

export type EntityState = "enabled" | "paused";

export interface PlacementAdjustments {
  top_of_search?: number;
  product_pages?: number;
  rest_of_search?: number;
}

export interface UpdateCampaignPayload {
  budget?: number;
  biddingStrategy?: string;
  placementAdjustments?: PlacementAdjustments;
}

export interface HarvestResult {
  success?: boolean;
  message?: string;
  results?: unknown;
}

/** Search-term add/negate — never title Added/Negated unless Nest said success. */
export function harvestAmazonWriteAlert(
  kind: "add" | "negate",
  result?: HarvestResult | null,
): { title: string; body: string } {
  if (result?.success === false) {
    return {
      title: kind === "add" ? "Not added on Amazon" : "Not negated on Amazon",
      body: result.message ?? "Amazon didn't confirm this change.",
    };
  }
  if (result?.success === true) {
    return {
      title: kind === "add" ? "Added" : "Negated",
      body: result.message ?? (kind === "add" ? "Added as a keyword." : "Search term negated."),
    };
  }
  return {
    title: "Not confirmed on Amazon yet",
    body: result?.message ?? "InteliAds accepted the request. Amazon confirmation is still pending.",
  };
}

export interface SyncStatus {
  isSyncInProgress?: boolean;
  hasSyncAccess?: boolean;
  noSyncAccessMessage?: string;
}

export interface SyncTriggerResult {
  message?: string;
  syncLogId?: string;
  profileCount?: number;
  timestamp?: string;
}

export interface AmazonConnectResponse {
  url: string;
  state?: string;
}

export interface KdpAccountSummary {
  id: string;
  name: string;
  linked_amazon_profile_ids: string[];
  book_count?: number;
  last_synced_at?: string | null;
}

export interface BidRecommendation {
  id: string;
  currentVersionId?: string;
  recommendationVersion?: number;
  campaignId?: string;
  campaignName?: string;
  keywordId?: string;
  keyword?: string;
  currentBid?: number;
  recommendedBid?: number;
  reason?: string;
  engineScore?: number;
  bidDelta?: number;
  status?: string;
  applicationStatus?: string;
  expiresAt?: string;
  direction?: string;
}

export interface BidEngineSettings {
  cooldownHours?: number;
  placementCooldownHours?: number;
  autoMode?: "off" | "high_confidence" | "aggressive" | string;
  autoScheduleEnabled?: boolean;
  watchdogEnabled?: boolean;
  targetAcos?: number;
  maxBid?: number | null;
  minBid?: number | null;
  lastRunAt?: string | null;
  appliesToday?: number;
  autoAppliesToday?: number;
}

export interface BidEngineStatus extends BidEngineSettings {
  lastRunStats?: { recommendations?: number; scored?: number; errors?: number } | null;
}

export interface BidEngineApplyLogEntry {
  id: string;
  keywordText?: string;
  campaignId?: string;
  applySource?: string;
  bidBefore?: number;
  bidAfter?: number;
  appliedAt?: string;
  entityType?: string;
}

export interface PlacementRecommendation {
  recommendationId?: string;
  currentVersionId?: string;
  recommendationVersion?: number;
  campaignId: string;
  campaignName?: string;
  currentPlacements?: PlacementAdjustments;
  recommendedPlacements?: PlacementAdjustments;
  confidence?: string;
  inCooldown?: boolean;
}

export interface RevertReapplyResult {
  message?: string;
  count?: number;
  errors?: number;
}

function qs(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function requestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ios-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ── Campaigns ──────────────────────────────────────────────────────────────

export async function updateCampaignState(campaignId: string, state: EntityState) {
  return nestApiJson<{ id: string; state: EntityState }>(
    `/campaigns/${campaignId}/state`,
    { method: "PATCH", body: JSON.stringify({ state }) },
    "Couldn't update campaign state.",
  );
}

export function pauseCampaign(campaignId: string) {
  return updateCampaignState(campaignId, "paused");
}

export function enableCampaign(campaignId: string) {
  return updateCampaignState(campaignId, "enabled");
}

export async function fetchCampaignApi(campaignId: string) {
  return nestApiJson<{
    id: string;
    name?: string;
    state?: EntityState;
    budget?: number;
    placementAdjustments?: PlacementAdjustments;
    biddingStrategy?: string;
  }>(`/campaigns/${campaignId}`, { method: "GET" }, "Couldn't load campaign.");
}

/** Prefetch placement % for list rows so UI never paints forever-dashes as if Amazon has no bid. */
export async function prefetchCampaignPlacementAdjustments(
  campaignIds: string[],
  opts: { concurrency?: number } = {},
): Promise<Record<string, PlacementAdjustments>> {
  const ids = [...new Set(campaignIds.map(String).filter(Boolean))];
  const out: Record<string, PlacementAdjustments> = {};
  if (!ids.length) return out;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 6));
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      try {
        const api = await fetchCampaignApi(id);
        // Never invent 0% — missing/null stays omitted so the row keeps "…" / "—".
        if (api.placementAdjustments) {
          out[id] = api.placementAdjustments;
        }
      } catch {
        /* leave missing — row keeps loading state until tap/retry */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return out;
}

export async function updateCampaign(campaignId: string, payload: UpdateCampaignPayload) {
  return nestApiJson<{ id: string; budget?: number; placementAdjustments?: PlacementAdjustments }>(
    `/campaigns/${campaignId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    "Couldn't update campaign.",
  );
}

// ── Keywords / targets / ad groups ─────────────────────────────────────────

export async function updateKeywordManual(
  keywordId: string,
  payload: { status?: EntityState; bid?: number; forceCooldown?: boolean },
) {
  const { forceCooldown, ...fields } = payload;
  return nestApiJson(
    `/keywords/${keywordId}/manual`,
    { method: "PATCH", body: JSON.stringify(amazonManualWrite(fields, forceCooldown)) },
    "Couldn't update keyword.",
  );
}

export async function updateProductTargetManual(
  productTargetId: string,
  payload: { state?: EntityState; bid?: number; forceCooldown?: boolean },
) {
  const { forceCooldown, ...fields } = payload;
  return nestApiJson(
    `/product-targets/${productTargetId}/manual`,
    { method: "PATCH", body: JSON.stringify(amazonManualWrite(fields, forceCooldown)) },
    "Couldn't update target.",
  );
}

export async function updateAdGroupState(adGroupId: string, state: EntityState) {
  return nestApiJson<{ id: string; state: EntityState }>(
    `/ad-groups/${adGroupId}/state`,
    { method: "PATCH", body: JSON.stringify({ state }) },
    "Couldn't update ad group.",
  );
}

export async function updateAdGroupManual(
  adGroupId: string,
  payload: { defaultBid?: number; forceCooldown?: boolean },
  fallbackTargetIds: string[] = [],
) {
  // Nest has no `/ad-groups/:id/manual`. Default bid is PATCH `/ad-groups/:id`,
  // same shape as campaign budget. If that route is missing, set the auto
  // targeting clause bids (close/loose/complements/substitutes) instead.
  try {
    return await nestApiJson(
      `/ad-groups/${adGroupId}`,
      { method: "PATCH", body: JSON.stringify({ defaultBid: payload.defaultBid }) },
      "Couldn't update ad group bid.",
    );
  } catch (error) {
    const status = error instanceof NestApiError ? error.status : 0;
    const message = error instanceof Error ? error.message : "";
    const missingRoute = status === 404 || /Cannot PATCH/i.test(message);
    if (!missingRoute || payload.defaultBid == null || fallbackTargetIds.length === 0) throw error;
    for (const targetId of fallbackTargetIds) {
      await updateProductTargetManual(targetId, {
        bid: payload.defaultBid,
        forceCooldown: payload.forceCooldown,
      });
    }
    return { id: adGroupId, defaultBid: payload.defaultBid };
  }
}

// ── Search terms ───────────────────────────────────────────────────────────

export async function addSearchTermAsTarget(
  id: string,
  opts: { adGroupIds?: string[]; matchType?: "broad" | "phrase" | "exact"; bid?: number; negateInSource?: boolean } = {},
) {
  return nestApiJson<HarvestResult>(
    `/search-terms/${id}/add`,
    { method: "POST", body: JSON.stringify(opts) },
    "Couldn't add that search term.",
  );
}

export async function negateSearchTerm(
  id: string,
  opts: { adGroupIds?: string[]; matchType?: "negativeExact" | "negativePhrase" } = {},
) {
  return nestApiJson<HarvestResult>(
    `/search-terms/${id}/negate`,
    { method: "POST", body: JSON.stringify(opts) },
    "Couldn't negate that search term.",
  );
}

// ── Sync ───────────────────────────────────────────────────────────────────

export function fetchSyncStatus(options?: { filterUserId?: string | null }) {
  const filterUserId = options?.filterUserId?.trim();
  const path = filterUserId
    ? `/amazon/sync/status?filterUserId=${encodeURIComponent(filterUserId)}`
    : "/amazon/sync/status";
  // Cap wait so Sync UI does not sit on "Checking Amazon Ads status…" for ages.
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(12_000)
      : undefined;
  return nestApiJson<SyncStatus>(
    path,
    { method: "GET", ...(signal ? { signal } : {}) },
    "Couldn't check sync status.",
  );
}

export function triggerSync() {
  return nestApiJson<SyncTriggerResult>("/amazon/sync", { method: "POST" }, "Couldn't start sync.");
}

export async function cancelSync() {
  await nestApiJson("/amazon/sync/cancel", { method: "POST" }, "Couldn't cancel sync.");
}

// ── Amazon / KDP ───────────────────────────────────────────────────────────

export function fetchAmazonConnectUrl() {
  const q = new URLSearchParams({ returnTo: "inteliads://auth/amazon/callback" });
  return nestApiJson<AmazonConnectResponse>(
    `/auth/amazon/connect?${q.toString()}`,
    { method: "GET" },
    "Couldn't start Amazon connect.",
  );
}

export async function fetchAmazonLoginUrl() {
  await nestLogout();
  const q = new URLSearchParams({ returnTo: "inteliads://auth/amazon/callback" });
  return nestApiJson<AmazonConnectResponse>(
    `/auth/amazon/login?${q.toString()}`,
    { method: "GET", allowAnonymous: true },
    "Couldn't start Amazon login.",
  );
}

type NestAmazonProfile = {
  id?: string;
  profileId?: string;
  profile_id?: string;
  countryCode?: string;
  country_code?: string;
  currencyCode?: string;
  currency_code?: string;
  marketplaceId?: string;
  marketplace_id?: string;
  accountType?: string;
  account_type?: string;
  accountName?: string;
  account_name?: string;
  accountId?: string;
  account_id?: string;
  nickname?: string;
  isEnabled?: boolean;
  is_enabled?: boolean;
  campaignsEnabledCount?: number;
  campaignsPausedCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type NestUser = {
  id: string;
  email: string;
  fullName?: string;
  isAdmin?: boolean;
};

export async function fetchNestMe() {
  return nestApiJson<{ id: string; email: string; isAdmin?: boolean }>(
    "/auth/me",
    { method: "GET" },
    "Couldn't load account.",
  );
}

/** Authoritative billing plan from Nest `GET /pricing-plans/current` (null = no plan). */
export async function fetchCurrentUserPlan(): Promise<NestUserPlan | null> {
  try {
    const data = await nestApiJson<unknown>(
      "/pricing-plans/current",
      { method: "GET" },
      "Couldn't load subscription.",
    );
    return normalizeNestUserPlanPayload(data);
  } catch (error) {
    // Older API builds 404'd plan-less users; treat as no plan.
    if (error instanceof NestApiError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchNestUsers(): Promise<NestUser[]> {
  const data = await nestApiJson<NestUser[] | { users?: NestUser[] }>(
    "/auth/users",
    { method: "GET" },
    "Couldn't load users.",
  );
  return Array.isArray(data) ? data : data.users ?? [];
}

export async function fetchNestAmazonProfiles(filterUserId?: string | null): Promise<AmazonProfile[]> {
  const path = filterUserId
    ? `/amazon/profiles?filterUserId=${encodeURIComponent(filterUserId)}`
    : "/amazon/profiles";
  const data = await nestApiJson<{ profiles?: NestAmazonProfile[] }>(
    path,
    { method: "GET" },
    "Couldn't load Amazon profiles.",
  );
  return (data.profiles ?? []).map((p) => {
    const amazonId = String(p.profileId ?? p.profile_id ?? "");
    const id = amazonId || String(p.id ?? "");
    const enabled = Number(p.campaignsEnabledCount ?? 0) || 0;
    const paused = Number(p.campaignsPausedCount ?? 0) || 0;
    return {
      id,
      profile_id: amazonId || id,
      country_code: p.countryCode ?? p.country_code ?? null,
      currency_code: p.currencyCode ?? p.currency_code ?? null,
      marketplace_id: p.marketplaceId ?? p.marketplace_id ?? null,
      account_type: p.accountType ?? p.account_type ?? null,
      account_name: p.accountName ?? p.account_name ?? null,
      account_id: p.accountId ?? p.account_id ?? null,
      nickname: p.nickname ?? null,
      is_enabled: p.isEnabled ?? p.is_enabled,
      campaigns_enabled_count: enabled,
      campaigns_paused_count: paused,
      campaign_count: enabled + paused,
      kdp_account_count: 0,
      created_at: p.createdAt ?? new Date().toISOString(),
      updated_at: p.updatedAt ?? new Date().toISOString(),
    };
  }).filter((p) => p.id);
}

export type AmazonProfileBookPreview = {
  asin: string;
  title: string | null;
  coverUrl: string | null;
};

/** Nest GET /amazon/profiles/:id/books — real sponsored/KDP covers only. */
export async function fetchAmazonProfileBooks(
  profileId: string,
  opts?: { filterUserId?: string | null },
): Promise<AmazonProfileBookPreview[]> {
  const adsId = String(profileId || "").trim();
  if (!adsId) return [];
  const q = opts?.filterUserId
    ? `?filterUserId=${encodeURIComponent(opts.filterUserId)}`
    : "";
  const data = await nestApiJson<{
    books?: Array<{ asin?: string; title?: string | null; coverUrl?: string | null; amazonImageUrl?: string | null }>;
  }>(`/amazon/profiles/${encodeURIComponent(adsId)}/books${q}`, { method: "GET" }, "Couldn't load profile books.");
  return (data.books ?? [])
    .map((book) => {
      const asin = String(book.asin || "").trim();
      const coverUrl = String(book.coverUrl || book.amazonImageUrl || "").trim() || null;
      if (!asin || !coverUrl) return null;
      return {
        asin,
        title: book.title ?? null,
        coverUrl,
      };
    })
    .filter((row): row is AmazonProfileBookPreview => !!row);
}

async function persistUserAmazonProfileEnabled(
  candidateIds: string[],
  enabled: boolean,
  preferInsertId: string,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) throw new NestApiError("Sign in to change profiles.", 401);

  const ids = [...new Set(candidateIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new NestApiError("Missing Amazon profile id.", 400);

  // Prefer the Ads profile id Nest uses; still try every candidate.
  const ordered = [
    preferInsertId,
    ...ids.filter((id) => id !== preferInsertId),
  ].filter(Boolean);

  let lastError: unknown = null;
  for (const id of ordered) {
    // Do NOT rely on UPDATE … RETURNING — RLS often hides the row and we
    // falsely fall through to INSERT → unique violation → "Couldn't update".
    const { error: updateErr } = await supabase
      .from("user_amazon_profiles")
      .update({ is_enabled: enabled })
      .eq("user_id", userId)
      .eq("amazon_profile_id", id);
    if (updateErr) {
      lastError = updateErr;
    } else {
      const { data: row, error: readErr } = await supabase
        .from("user_amazon_profiles")
        .select("amazon_profile_id, is_enabled")
        .eq("user_id", userId)
        .eq("amazon_profile_id", id)
        .maybeSingle();
      if (readErr) lastError = readErr;
      else if (row) {
        if (row.is_enabled === enabled) return;
        // Row exists but value didn't stick — try upsert path below.
      } else {
        const { error: insertErr } = await supabase.from("user_amazon_profiles").insert({
          user_id: userId,
          amazon_profile_id: id,
          is_enabled: enabled,
        });
        if (!insertErr) return;
        // Unique race: another writer inserted — update again.
        if (/duplicate|unique/i.test(String((insertErr as { message?: string }).message || ""))) {
          const { error: retryErr } = await supabase
            .from("user_amazon_profiles")
            .update({ is_enabled: enabled })
            .eq("user_id", userId)
            .eq("amazon_profile_id", id);
          if (!retryErr) return;
          lastError = retryErr;
        } else {
          lastError = insertErr;
        }
        continue;
      }
    }

    const { error: upsertErr } = await supabase.from("user_amazon_profiles").upsert(
      {
        user_id: userId,
        amazon_profile_id: id,
        is_enabled: enabled,
      },
      { onConflict: "user_id,amazon_profile_id" },
    );
    if (!upsertErr) return;
    lastError = upsertErr;
  }

  const message =
    lastError && typeof lastError === "object" && "message" in lastError
      ? String((lastError as { message?: string }).message || "")
      : "";
  throw new NestApiError(
    message || "Couldn't update that Amazon profile flag.",
    500,
  );
}

const ENABLE_PROFILE_RETRY_MS = 400;

async function nestToggleProfileEnabled(adsProfileId: string, isEnabled: boolean) {
  const maxAttempts = isEnabled ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await nestApiJson<{ message?: string; profile?: { id: string; is_enabled?: boolean } }>(
        `/amazon/profiles/${encodeURIComponent(adsProfileId)}/toggle`,
        { method: "PATCH", body: JSON.stringify({ isEnabled }) },
        "Couldn't update profile.",
      );
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && isTransientEnableProfileError(error)) {
        await new Promise((resolve) => setTimeout(resolve, ENABLE_PROFILE_RETRY_MS * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function toggleAmazonProfile(
  profileId: string,
  isEnabled: boolean,
  opts?: { rowId?: string | null; adsProfileId?: string | null },
) {
  // Nest is the product source of truth for enable/disable (rules + AMS) — same as web.
  // Local Supabase pivot mirrors Nest so the Accounts list stays honest.
  const adsProfileId = String(opts?.adsProfileId || profileId).trim();
  const rowId = String(opts?.rowId || profileId).trim();

  const nestResult = await nestToggleProfileEnabled(adsProfileId, isEnabled);

  try {
    await persistUserAmazonProfileEnabled([rowId, adsProfileId, profileId], isEnabled, adsProfileId || rowId);
  } catch {
    // Nest already flipped — list may catch up on next refetch.
  }

  return { is_enabled: nestResult.profile?.is_enabled ?? isEnabled };
}

export async function updateProfileNickname(profileId: string, nickname: string) {
  const data = await nestApiJson<{ message?: string; profile?: { id: string; nickname?: string } }>(
    `/amazon/profiles/${profileId}/nickname`,
    { method: "PATCH", body: JSON.stringify({ nickname }) },
    "Couldn't save nickname.",
  );
  return data.profile ?? data;
}

export async function fetchKdpAccounts() {
  const data = await nestApiJson<{ accounts?: KdpAccountSummary[] }>("/kdp/accounts", { method: "GET" }, "Couldn't load KDP accounts.");
  return data.accounts ?? [];
}

export async function setKdpLinkedProfiles(kdpAccountId: string, amazonProfileIds: string[]) {
  const data = await nestApiJson<{ amazon_profile_ids?: string[] }>(
    `/kdp/accounts/${kdpAccountId}/profiles`,
    { method: "POST", body: JSON.stringify({ amazon_profile_ids: amazonProfileIds }) },
    "Couldn't link KDP account.",
  );
  return data.amazon_profile_ids ?? amazonProfileIds;
}

export async function unlinkKdpProfile(kdpAccountId: string, amazonProfileId: string) {
  await nestApiJson(`/kdp/accounts/${kdpAccountId}/profiles/${amazonProfileId}`, { method: "DELETE" }, "Couldn't unlink profile.");
}

// ── Bid Bot ────────────────────────────────────────────────────────────────

export async function fetchBidRecommendations(
  params: { status?: string; page?: number; per_page?: number; filterUserId?: string | null } = {},
) {
  const data = await nestApiJson<{ data?: BidRecommendation[] } | BidRecommendation[]>(
    `/bid-recommendations${qs({
      status: params.status,
      page: params.page ?? 1,
      per_page: params.per_page ?? 50,
      filterUserId: params.filterUserId,
    })}`,
    { method: "GET" },
    "Couldn't load bid recommendations.",
  );
  if (Array.isArray(data)) return data;
  return data.data ?? [];
}

export async function fetchPendingBidRecommendations(filterUserId?: string | null) {
  const data = await nestApiJson<BidRecommendation[] | { data?: BidRecommendation[] }>(
    `/bid-recommendations/pending${qs({ filterUserId })}`,
    { method: "GET" },
    "Couldn't load pending recommendations.",
  );
  return Array.isArray(data) ? data : data.data ?? [];
}

export function fetchBidEngineStatus(filterUserId?: string | null) {
  return nestApiJson<BidEngineStatus>(
    `/bid-engine/status${qs({ filterUserId })}`,
    { method: "GET" },
    "Couldn't load Bid Bot status.",
  );
}

export function fetchBidEngineSettings(filterUserId?: string | null) {
  return nestApiJson<BidEngineSettings>(
    `/bid-engine/settings${qs({ filterUserId })}`,
    { method: "GET" },
    "Couldn't load Bid Bot settings.",
  );
}

export function updateBidEngineSettings(settings: Partial<BidEngineSettings>) {
  return nestApiJson<BidEngineSettings>(
    "/bid-engine/settings",
    { method: "PUT", body: JSON.stringify(settings) },
    "Couldn't save Bid Bot settings.",
  );
}

export function runBidEngine(params: { limit?: number; targetAcos?: number } = {}) {
  return nestApiJson("/bid-engine/run", { method: "POST", body: JSON.stringify(params) }, "Couldn't run Bid Bot.");
}

export async function applyBidRecommendations(recs: BidRecommendation[]) {
  const ids = recs.map((row) => row.id).filter(Boolean);
  const versionIds: Record<string, string> = {};
  for (const row of recs) {
    if (row.id && row.currentVersionId) versionIds[row.id] = row.currentVersionId;
  }
  return nestApiJson(
    "/bid-recommendations/bulk",
    { method: "PATCH", body: JSON.stringify({ ids, status: "applied", requestId: requestId(), versionIds }) },
    "Couldn't apply recommendations.",
  );
}

export async function fetchPlacementRecommendations(filterUserId?: string | null) {
  const data = await nestApiJson<{ data?: PlacementRecommendation[] } | PlacementRecommendation[]>(
    `/bid-engine/placement-recommendations${qs({ filterUserId })}`,
    { method: "GET" },
    "Couldn't load placement recommendations.",
  );
  return Array.isArray(data) ? data : data.data ?? [];
}

export function applyPlacementRecommendations(recs: PlacementRecommendation[]) {
  const campaignIds = recs.map((row) => row.campaignId).filter(Boolean);
  const recommendations = recs.flatMap((row) => {
    const recommendationId = row.recommendationId || row.currentVersionId;
    if (!row.campaignId || !recommendationId || row.recommendationVersion == null) return [];
    return [{ campaignId: row.campaignId, recommendationId, recommendationVersion: row.recommendationVersion }];
  });
  return nestApiJson(
    "/bid-engine/placement-recommendations/apply",
    { method: "POST", body: JSON.stringify({ campaignIds, requestId: requestId(), recommendations }) },
    "Couldn't apply placement recommendations.",
  );
}

export async function fetchBidEngineApplyLog(
  params: { page?: number; per_page?: number; filterUserId?: string | null } = {},
) {
  const data = await nestApiJson<{ data?: BidEngineApplyLogEntry[] } | BidEngineApplyLogEntry[]>(
    `/bid-engine/apply-log${qs({ page: params.page ?? 1, per_page: params.per_page ?? 30, filterUserId: params.filterUserId })}`,
    { method: "GET" },
    "Couldn't load Bid Bot activity.",
  );
  return Array.isArray(data) ? data : data.data ?? [];
}

export function revertBidApplyLog(applyLogId: string) {
  return nestApiJson(
    `/bid-engine/apply-log/${encodeURIComponent(applyLogId)}/revert`,
    { method: "POST", body: JSON.stringify({}) },
    "Couldn't revert that bid change.",
  );
}

// ── Rules ──────────────────────────────────────────────────────────────────

export function revertRuleExecution(executionId: string) {
  return nestApiJson<RevertReapplyResult>(
    `/rules/executions/${executionId}/revert`,
    { method: "POST" },
    "Couldn't revert that rule run.",
  );
}

export function reapplyRuleExecution(executionId: string) {
  return nestApiJson<RevertReapplyResult>(
    `/rules/executions/${executionId}/reapply`,
    { method: "POST" },
    "Couldn't reapply that rule run.",
  );
}

export { nestApiFetch, parseNestError, requestId };
