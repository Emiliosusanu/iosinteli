// Nest API writes — same paths the web dashboard uses.
// Reads stay on Supabase. Do not send the Supabase session JWT here.

import { nestApiFetch, nestApiJson, parseNestError } from "./rulesApi";
import type { AmazonProfile } from "./types";

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
  return nestApiJson(
    `/keywords/${keywordId}/manual`,
    { method: "PATCH", body: JSON.stringify(payload) },
    "Couldn't update keyword.",
  );
}

export async function updateProductTargetManual(
  productTargetId: string,
  payload: { state?: EntityState; bid?: number; forceCooldown?: boolean },
) {
  return nestApiJson(
    `/product-targets/${productTargetId}/manual`,
    { method: "PATCH", body: JSON.stringify(payload) },
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
  return nestApiJson<SyncStatus>(path, { method: "GET" }, "Couldn't check sync status.");
}

export function triggerSync() {
  return nestApiJson<SyncTriggerResult>("/amazon/sync", { method: "POST" }, "Couldn't start sync.");
}

export async function cancelSync() {
  await nestApiJson("/amazon/sync/cancel", { method: "POST" }, "Couldn't cancel sync.");
}

// ── Amazon / KDP ───────────────────────────────────────────────────────────

export function fetchAmazonConnectUrl() {
  return nestApiJson<AmazonConnectResponse>("/auth/amazon/connect", { method: "GET" }, "Couldn't start Amazon connect.");
}

export function fetchAmazonLoginUrl() {
  return nestApiJson<AmazonConnectResponse>("/auth/amazon/login", { method: "GET" }, "Couldn't start Amazon login.");
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
    const enabled = p.campaignsEnabledCount ?? 0;
    const paused = p.campaignsPausedCount ?? 0;
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
      campaign_count: enabled + paused,
      kdp_account_count: 0,
      created_at: p.createdAt ?? new Date().toISOString(),
      updated_at: p.updatedAt ?? new Date().toISOString(),
    };
  }).filter((p) => p.id);
}

export async function toggleAmazonProfile(profileId: string, isEnabled: boolean) {
  const data = await nestApiJson<{ message?: string; profile?: { id: string; is_enabled?: boolean } }>(
    `/amazon/profiles/${profileId}/toggle`,
    { method: "PATCH", body: JSON.stringify({ isEnabled }) },
    "Couldn't update profile.",
  );
  return data.profile ?? data;
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
