// Nest API writes — same paths the web dashboard uses.
// Reads stay on Supabase RLS. nestApiFetch sends Nest JWT or the Supabase bearer.

import { nestApiFetch, nestApiJson, nestLogout, parseNestError, NestApiError } from "./rulesApi";
import { supabase } from "./supabase";
import {
  normalizeNestPricingPlansPayload,
  normalizeNestUserPlanPayload,
  unwrapNestUrlPayload,
  type NestPricingPlan,
  type NestUserPlan,
} from "./accountContract";
import { isTransientEnableProfileError } from "./accountsUi";
import { amazonManualWrite } from "./bulkOutboxContract";
import type { AmazonProfile } from "./types";
import {
  normalizeCampaignCreationMarketplaces,
  normalizeCampaignCreationPreview,
  type CreationMarketplace,
} from "./campaignCreationStock";
import {
  filterSuggestionsForBookRelevance,
  buildKeywordSuggestionCountStats,
  buildProductSuggestionCountStats,
  productTitleNeedsEnrichment,
  type KeywordMatchType,
  type KeywordSuggestionCountStats,
  type ProductMatchType,
  type ProductSuggestionLike,
} from "./amazonCampaignSuggestions";

export { amazonManualWrite } from "./bulkOutboxContract";
export { resolveCreationProfileId } from "./campaignCreationStock";
export type { KeywordSuggestionCountStats };

export type EntityState = "enabled" | "paused";

export interface PlacementAdjustments {
  top_of_search?: number;
  product_pages?: number;
  rest_of_search?: number;
}

export interface UpdateCampaignPayload {
  name?: string;
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

export interface DeleteKdpBookResult {
  account_id: string;
  asin: string;
  deleted_titles: number;
  deleted_formats: number;
  deleted_books: number;
  deleted_daily_rows: number;
  deleted_fact_rows: number;
  deleted_pricing_rows: number;
  rebuilt_days: number;
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

export type CampaignCreationTargeting = "auto" | "keywords" | "products";
export type CampaignCreationMarketplace = CreationMarketplace;

export type CampaignCreationBook = {
  asin: string;
  title: string;
  format: string | null;
  marketplaceIds: string[];
  availabilityEvidence: string | null;
  stockStatus: string | null;
  workKey: string | null;
  coverUrl: string | null;
  sku: string | null;
  publishedAt: string | null;
};

export type CampaignCreationPreview = ReturnType<
  typeof normalizeCampaignCreationPreview
> & {
  /** Present after preview/suggestions fetch applies Grok (honest Amazon vs Kept). */
  keywordCounts?: KeywordSuggestionCountStats;
};

export type CampaignCreationBooksResult = {
  source: string;
  fetchedAt: string | null;
  books: CampaignCreationBook[];
  verification: {
    kdpAccountCount: number;
    kdpTitleCount: number;
    kdpPaperbackCount: number;
  };
};

type CampaignKeywordInput = {
  keyword: string;
  matchType: KeywordMatchType;
  bid: number;
  source: "suggested" | "custom";
};

type CampaignProductTargetInput = {
  asin: string;
  matchType?: ProductMatchType;
  bid: number;
  source: "suggested" | "custom";
};

export type CreateCampaignInput = {
  profileId: string;
  advertisedAsin: string;
  targeting: CampaignCreationTargeting;
  name: string;
  adGroupName: string;
  dailyBudget: number;
  defaultBid: number;
  biddingStrategy: string;
  placements: {
    topOfSearch: number;
    productPages: number;
    restOfSearch: number;
  };
  enableAfterCreate: boolean;
  requestId: string;
  keywords?: CampaignKeywordInput[];
  productTargets?: CampaignProductTargetInput[];
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function creationBookFromApi(value: unknown): CampaignCreationBook | null {
  const row = objectRecord(value);
  const asin = String(row.asin ?? "").trim().toUpperCase();
  if (!asin) return null;
  const marketplaceIds = Array.isArray(row.marketplaceIds)
    ? row.marketplaceIds
    : Array.isArray(row.marketplace_ids)
      ? row.marketplace_ids
      : [];
  return {
    asin,
    title: optionalString(row.title) ?? asin,
    format: optionalString(row.format),
    marketplaceIds: [
      ...new Set(
        marketplaceIds
          .map((id) => String(id ?? "").trim())
          .filter(Boolean),
      ),
    ],
    availabilityEvidence: optionalString(
      row.availabilityEvidence ?? row.availability_evidence,
    ),
    stockStatus: optionalString(row.stockStatus ?? row.stock_status),
    workKey: optionalString(row.workKey ?? row.work_key),
    coverUrl: optionalString(
      row.coverUrl ?? row.cover_url ?? row.amazonImageUrl ?? row.amazon_image_url,
    ),
    sku: optionalString(row.sku),
    publishedAt: optionalString(row.publishedAt ?? row.published_at),
  };
}

/** Nest-owned KDP/Ads candidate shelf used by Create and Books. */
export async function fetchCampaignCreationBooks(): Promise<CampaignCreationBooksResult> {
  // Create picker: Nest aims for Ads-buyable paperbacks. Still drop bare
  // amazon_catalog "published" rows (no Ads stock signal) — empty catalog.
  const raw = await nestApiJson<unknown>(
    "/campaigns/creation/book-candidates",
    { method: "GET" },
    "Couldn't load campaign books.",
  );
  const root = objectRecord(raw);
  const nested = objectRecord(root.data);
  const body = Object.keys(nested).length ? { ...root, ...nested } : root;
  const books = (Array.isArray(body.books) ? body.books : [])
    .map(creationBookFromApi)
    .filter((book): book is CampaignCreationBook => book !== null)
    .filter((book) => {
      const evidence = String(book.availabilityEvidence ?? "")
        .trim()
        .toLowerCase();
      // Catalog-only published titles are not creatable and have no Ads signal.
      return evidence !== "amazon_catalog";
    });
  const verification = objectRecord(body.verification);
  return {
    source: String(body.source ?? "amazon_ads"),
    fetchedAt: optionalString(body.fetchedAt ?? body.fetched_at),
    books,
    verification: {
      kdpAccountCount:
        Number(verification.kdpAccountCount ?? verification.kdp_account_count) ||
        0,
      kdpTitleCount:
        Number(verification.kdpTitleCount ?? verification.kdp_title_count) || 0,
      kdpPaperbackCount:
        Number(
          verification.kdpPaperbackCount ?? verification.kdp_paperback_count,
        ) || 0,
    },
  };
}

export async function fetchCampaignCreationMarketplaces(
  asin: string,
): Promise<ReturnType<typeof normalizeCampaignCreationMarketplaces>> {
  const normalizedAsin = String(asin ?? "").trim().toUpperCase();
  const raw = await nestApiJson<unknown>(
    `/campaigns/creation/marketplaces?asin=${encodeURIComponent(normalizedAsin)}&includeDisabled=true`,
    { method: "GET" },
    "Couldn't verify Amazon marketplaces.",
  );
  return normalizeCampaignCreationMarketplaces(raw, normalizedAsin);
}

export async function previewCampaignCreation(input: {
  profileId: string;
  advertisedAsin: string;
  targeting: CampaignCreationTargeting;
  /**
   * Fires after Amazon normalize + companions, BEFORE Grok — so UI can show
   * live Amazon phrase/row totals (from this fetch) immediately.
   */
  onAmazonReady?: (partial: CampaignCreationPreview) => void;
}): Promise<CampaignCreationPreview> {
  // Mirror ad-group suggestions: Amazon SP is slow / rate-limits; retry
  // transient failures so CA/US KW+ASIN pickers don’t hard-fail on first 429.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      let raw: unknown;
      try {
        raw = await nestApiJson<unknown>(
          "/campaigns/creation/preview",
          {
            method: "POST",
            body: JSON.stringify(input),
            signal: controller.signal,
          },
          "Couldn't load Amazon suggestions.",
        );
      } finally {
        clearTimeout(timer);
      }
      const preview = normalizeCampaignCreationPreview(raw);
      const amazonKeywordRows = preview.keywords;
      const amazonProductRows = preview.productTargets;
      const productOnly =
        amazonKeywordRows.length === 0 && amazonProductRows.length > 0;
      const preGrokCounts = productOnly
        ? {
            ...buildProductSuggestionCountStats({
              amazonProducts: amazonProductRows,
              keptProducts: amazonProductRows,
            }),
            grokPending: true,
          }
        : {
            ...buildKeywordSuggestionCountStats({
              amazonApiRowCount: preview.amazonKeywordApi.rowCount,
              amazonApiPhraseCount: preview.amazonKeywordApi.phraseCount,
              amazonRows: amazonKeywordRows,
              keptRows: amazonKeywordRows,
            }),
            grokPending: true,
          };
      input.onAmazonReady?.({
        ...preview,
        keywords: amazonKeywordRows,
        productTargets: amazonProductRows,
        keywordCounts: preGrokCounts,
      });
      // Full Amazon payload → AI (UI SUGGESTION_PAGE_SIZE=50 is display-only).
      console.log(
        `[inteliads:create-preview] AI filter input keywords=${amazonKeywordRows.length} products=${amazonProductRows.length} targeting=${input.targeting}`,
      );
      const filtered = await filterSuggestionsForBookRelevance(
        {
          keywords: amazonKeywordRows,
          productTargets: amazonProductRows,
        },
        {
          bookTitle: preview.book?.title,
          bookSubtitle: preview.book?.subtitle,
          bookAuthor: preview.book?.author,
          bookTopic: preview.book?.topic,
          // Prefer || — Nest/normalize may leave book.asin as "" which blocks ??.
          advertisedAsin:
            String(preview.book?.asin ?? "").trim() ||
            String(input.advertisedAsin ?? "").trim() ||
            undefined,
          countryCode: preview.profile?.countryCode,
          currencyCode: preview.profile?.currencyCode,
        },
      );
      console.log(
        `[inteliads:create-preview] AI filter done keywords=${filtered.keywords.length} products=${filtered.productTargets.length} outcome=${filtered.relevanceOutcome ?? "n/a"}`,
      );
      const keywordCounts = productOnly
        ? buildProductSuggestionCountStats({
            amazonProducts: amazonProductRows,
            keptProducts: filtered.productTargets,
            relevanceOutcome: filtered.relevanceOutcome,
            relevanceError: filtered.relevanceError,
          })
        : buildKeywordSuggestionCountStats({
            amazonApiRowCount: preview.amazonKeywordApi.rowCount,
            amazonApiPhraseCount: preview.amazonKeywordApi.phraseCount,
            amazonRows: amazonKeywordRows,
            keptRows: filtered.keywords,
            relevanceOutcome: filtered.relevanceOutcome,
            relevanceError: filtered.relevanceError,
          });
      return {
        ...preview,
        keywords: filtered.keywords,
        productTargets: filtered.productTargets,
        keywordCounts,
      };
    } catch (error) {
      lastError = error;
      const status = error instanceof NestApiError ? error.status : 0;
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|timed out|timeout/i.test(error.message));
      const retryable =
        aborted ||
        status === 0 ||
        status === 408 ||
        status === 429 ||
        status >= 500;
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(8000, 1200 * 2 ** attempt)),
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Couldn't load Amazon suggestions.");
}

export function createCampaign(input: CreateCampaignInput) {
  return nestApiJson<{
    campaignId: string;
    adGroupId?: string;
    adId?: string;
    state: EntityState;
  }>(
    "/campaigns/creation",
    { method: "POST", body: JSON.stringify(input) },
    "Couldn't create campaign.",
  );
}

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
    targetingType?: string;
    primaryAsin?: string;
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

export type AdGroupTargeting = "auto" | "keywords" | "products";

export type AdGroupSuggestionKeyword = {
  keyword: string;
  matchType: KeywordMatchType;
  suggestedBid: number | null;
  rangeStart: number | null;
  rangeEnd: number | null;
};

export type AdGroupSuggestionProduct = ProductSuggestionLike & {
  matchType: ProductMatchType;
};

export type AdGroupSuggestionsResult = {
  source: "amazon_ads";
  fetchedAt: string;
  recommendationsAvailable: boolean;
  keywords: AdGroupSuggestionKeyword[];
  productTargets: AdGroupSuggestionProduct[];
  book: CampaignCreationPreview["book"];
  profile: CampaignCreationPreview["profile"];
  amazonKeywordApi: { rowCount: number; phraseCount: number };
  keywordCounts: KeywordSuggestionCountStats;
};

export async function fetchAdGroupSuggestions(input: {
  campaignId: string;
  targeting: "keywords" | "products";
  asin?: string;
  /** Ads profile — used to upgrade thin Nest suggestions via creation preview. */
  profileId?: string;
  /**
   * Fires after Amazon normalize + companions, BEFORE Grok — so Add keywords
   * can show live Amazon phrase/row totals (from this fetch) immediately.
   */
  onAmazonReady?: (partial: AdGroupSuggestionsResult) => void;
}): Promise<AdGroupSuggestionsResult> {
  // Amazon SP recommendations are slow; retry transient timeouts without
  // surfacing an empty picker after the first laggy attempt.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const loadRaw = async (body: {
        campaignId: string;
        targeting: "keywords" | "products";
        asin?: string;
      }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45_000);
        try {
          return await nestApiJson<unknown>(
            "/ad-groups/suggestions",
            {
              method: "POST",
              body: JSON.stringify(body),
              signal: controller.signal,
            },
            "Couldn't load Amazon suggestions.",
          );
        } finally {
          clearTimeout(timer);
        }
      };

      const asinHint = String(input.asin ?? "").trim();
      const profileHint = String(input.profileId ?? "").trim();

      // Prefer Create preview when we already know profile + ASIN: one Nest hop
      // with book{title…} + enriched product titles (KW + ASINs). Avoids thin
      // `/ad-groups/suggestions` → empty Groq keep, and avoids double Nest.
      const loadCreationPreviewRaw = async (
        targeting: "keywords" | "products",
        profileId: string,
        advertisedAsin: string,
      ) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45_000);
        try {
          return await nestApiJson<unknown>(
            "/campaigns/creation/preview",
            {
              method: "POST",
              body: JSON.stringify({
                profileId,
                advertisedAsin,
                targeting,
              }),
              signal: controller.signal,
            },
            "Couldn't load Amazon suggestions.",
          );
        } finally {
          clearTimeout(timer);
        }
      };

      let raw: unknown | null = null;
      let preview = normalizeCampaignCreationPreview({});
      let usedCreationPreview = false;
      let creationPreviewUnavailable = false;

      if (asinHint && profileHint) {
        try {
          raw = await loadCreationPreviewRaw(
            input.targeting,
            profileHint,
            asinHint,
          );
          preview = normalizeCampaignCreationPreview(raw);
          usedCreationPreview = true;
        } catch {
          usedCreationPreview = false;
          creationPreviewUnavailable = true;
        }
      }

      if (!usedCreationPreview) {
        let requestBody: {
          campaignId: string;
          targeting: "keywords" | "products";
          asin?: string;
        } = {
          campaignId: input.campaignId,
          targeting: input.targeting,
          ...(asinHint ? { asin: asinHint } : {}),
        };
        raw = await loadRaw(requestBody);
        preview = normalizeCampaignCreationPreview(raw);

        // Wrong/stale B0 ASIN override can empty US keyword suggestions (New England
        // cert: B0HJ3N6PQK → 0 rows; omit asin → Nest resolves ISBN → ~166×3).
        if (
          input.targeting === "keywords" &&
          asinHint &&
          preview.keywords.length === 0 &&
          !preview.recommendationsAvailable
        ) {
          requestBody = {
            campaignId: input.campaignId,
            targeting: input.targeting,
          };
          raw = await loadRaw(requestBody);
          preview = normalizeCampaignCreationPreview(raw);
        }

        // Thin Nest suggestions (no book.title / product titles) → one upgrade
        // hop via creation preview when we can resolve profile + asin.
        const asin =
          String(preview.book?.asin ?? "").trim() || asinHint;
        const profileId = String(
          preview.profile?.profileId ||
            preview.profile?.id ||
            profileHint ||
            "",
        ).trim();
        const bookTitle = String(preview.book?.title ?? "").trim();
        const rows =
          input.targeting === "products"
            ? preview.productTargets
            : preview.keywords;
        const missingProductTitles =
          input.targeting === "products"
            ? preview.productTargets.filter((row) =>
                productTitleNeedsEnrichment(row.title, row.asin),
              ).length
            : 0;
        const thinMeta =
          rows.length > 0 &&
          (!bookTitle ||
            (input.targeting === "products" &&
              missingProductTitles /
                Math.max(1, preview.productTargets.length) >
                0.3));
        if (asin && profileId && thinMeta && !creationPreviewUnavailable) {
          try {
            const upgradeRaw = await loadCreationPreviewRaw(
              input.targeting,
              profileId,
              asin,
            );
            const upgraded = normalizeCampaignCreationPreview(upgradeRaw);
            const upgradedRows =
              input.targeting === "products"
                ? upgraded.productTargets
                : upgraded.keywords;
            if (upgradedRows.length > 0) {
              preview = upgraded;
            }
          } catch {
            // Keep Nest ad-group suggestions; Groq may still use asin fallback.
            creationPreviewUnavailable = true;
          }
        }
      }

      // Creation preview can return 0 keywords for some ASINs while campaign-scoped
      // /ad-groups/suggestions still has Amazon rows — fall through + ASIN-omit.
      if (
        usedCreationPreview &&
        input.targeting === "keywords" &&
        preview.keywords.length === 0
      ) {
        try {
          let requestBody: {
            campaignId: string;
            targeting: "keywords" | "products";
            asin?: string;
          } = {
            campaignId: input.campaignId,
            targeting: "keywords",
            ...(asinHint ? { asin: asinHint } : {}),
          };
          raw = await loadRaw(requestBody);
          preview = normalizeCampaignCreationPreview(raw);
          if (
            asinHint &&
            preview.keywords.length === 0 &&
            !preview.recommendationsAvailable
          ) {
            raw = await loadRaw({
              campaignId: input.campaignId,
              targeting: "keywords",
            });
            preview = normalizeCampaignCreationPreview(raw);
          }
        } catch {
          // Keep empty creation-preview keywords.
        }
      }

      const amazonKeywordRows = preview.keywords;
      const amazonProductRows = preview.productTargets;
      const productOnly =
        amazonKeywordRows.length === 0 && amazonProductRows.length > 0;
      const preGrokCounts = productOnly
        ? {
            ...buildProductSuggestionCountStats({
              amazonProducts: amazonProductRows,
              keptProducts: amazonProductRows,
            }),
            grokPending: true,
          }
        : {
            ...buildKeywordSuggestionCountStats({
              amazonApiRowCount: preview.amazonKeywordApi.rowCount,
              amazonApiPhraseCount: preview.amazonKeywordApi.phraseCount,
              amazonRows: amazonKeywordRows,
              keptRows: amazonKeywordRows,
            }),
            grokPending: true,
          };
      input.onAmazonReady?.({
        source: preview.source,
        fetchedAt: preview.fetchedAt,
        recommendationsAvailable: preview.recommendationsAvailable,
        keywords: amazonKeywordRows,
        productTargets: amazonProductRows,
        book: preview.book,
        profile: preview.profile,
        amazonKeywordApi: preview.amazonKeywordApi,
        keywordCounts: preGrokCounts,
      });
      const filtered = await filterSuggestionsForBookRelevance(
        {
          keywords: amazonKeywordRows,
          productTargets: amazonProductRows,
        },
        {
          bookTitle: preview.book?.title,
          bookSubtitle: preview.book?.subtitle,
          bookAuthor: preview.book?.author,
          bookTopic: preview.book?.topic,
          advertisedAsin:
            String(preview.book?.asin ?? "").trim() ||
            String(input.asin ?? "").trim() ||
            undefined,
          countryCode: preview.profile?.countryCode,
          currencyCode: preview.profile?.currencyCode,
        },
      );
      const keywordCounts = productOnly
        ? buildProductSuggestionCountStats({
            amazonProducts: amazonProductRows,
            keptProducts: filtered.productTargets,
            relevanceOutcome: filtered.relevanceOutcome,
            relevanceError: filtered.relevanceError,
          })
        : buildKeywordSuggestionCountStats({
            amazonApiRowCount: preview.amazonKeywordApi.rowCount,
            amazonApiPhraseCount: preview.amazonKeywordApi.phraseCount,
            amazonRows: amazonKeywordRows,
            keptRows: filtered.keywords,
            relevanceOutcome: filtered.relevanceOutcome,
            relevanceError: filtered.relevanceError,
          });
      return {
        source: preview.source,
        fetchedAt: preview.fetchedAt,
        recommendationsAvailable: preview.recommendationsAvailable,
        keywords: filtered.keywords,
        productTargets: filtered.productTargets,
        book: preview.book,
        profile: preview.profile,
        amazonKeywordApi: preview.amazonKeywordApi,
        keywordCounts,
      };
    } catch (error) {
      lastError = error;
      const status =
        error instanceof NestApiError ? error.status : 0;
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /aborted|timed out|timeout/i.test(error.message));
      const retryable =
        aborted ||
        status === 0 ||
        status === 408 ||
        status === 429 ||
        status >= 500;
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(8000, 1200 * 2 ** attempt)),
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Couldn't load Amazon suggestions.");
}

export function createAdGroup(input: {
  campaignId: string;
  name: string;
  defaultBid: number;
  state: EntityState;
  targeting: AdGroupTargeting;
  advertisedAsin?: string;
  keywords?: CampaignKeywordInput[];
  productTargets?: CampaignProductTargetInput[];
}) {
  return nestApiJson<{
    adGroup: {
      id: string;
      adGroupId?: string;
      campaignId: string;
      name?: string;
      defaultBid?: number;
      state?: EntityState;
      targetingType?: string | null;
    };
    keywordCount?: number;
    productTargetCount?: number;
    adId?: string;
  }>(
    "/ad-groups",
    { method: "POST", body: JSON.stringify(input) },
    "Couldn't create ad group.",
  );
}

export function addAdGroupKeywords(
  adGroupId: string,
  keywords: CampaignKeywordInput[],
) {
  return nestApiJson<{
    created: number;
    failed?: number;
    keywordIds?: string[];
    errors?: unknown[];
  }>(
    `/ad-groups/${encodeURIComponent(adGroupId)}/keywords`,
    { method: "POST", body: JSON.stringify({ keywords }) },
    "Couldn't add keywords.",
  );
}

export function addAdGroupProductTargets(
  adGroupId: string,
  productTargets: CampaignProductTargetInput[],
) {
  return nestApiJson<{
    created: number;
    failed?: number;
    targetIds?: string[];
    errors?: unknown[];
  }>(
    `/ad-groups/${encodeURIComponent(adGroupId)}/product-targets`,
    { method: "POST", body: JSON.stringify({ productTargets }) },
    "Couldn't add product targets.",
  );
}

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
  payload: { name?: string; defaultBid?: number; forceCooldown?: boolean },
  fallbackTargetIds: string[] = [],
) {
  // Nest has no `/ad-groups/:id/manual`. Default bid is PATCH `/ad-groups/:id`,
  // same shape as campaign budget. If that route is missing, set the auto
  // targeting clause bids (close/loose/complements/substitutes) instead.
  try {
    return await nestApiJson(
      `/ad-groups/${adGroupId}`,
      { method: "PATCH", body: JSON.stringify({ name: payload.name, defaultBid: payload.defaultBid }) },
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
  /** Present on some Nest builds; client still enriches from Supabase link rows. */
  kdpAccountCount?: number;
  kdp_account_count?: number;
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

/** Nest product catalog — same rows the web Pricing page uses (do not invent plans). */
export async function fetchPricingPlans(): Promise<NestPricingPlan[]> {
  const data = await nestApiJson<unknown>(
    "/pricing-plans",
    { method: "GET" },
    "Couldn't load plans.",
  );
  return normalizeNestPricingPlansPayload(data);
}

export async function verifyAppleTransaction(signedTransaction: string): Promise<{
  active: boolean;
  planSlug: string;
  productId: string;
  expiresAt: string;
}> {
  return nestApiJson(
    "/apple-iap/transactions/verify",
    { method: "POST", body: JSON.stringify({ signedTransaction }) },
    "Couldn't verify the App Store purchase.",
  );
}

/**
 * Stripe Checkout session for a Nest catalog `stripePriceId`.
 * Opens in Safari (Apple Pay). Matches web `POST /stripe/create-checkout-session`.
 */
export async function createStripeCheckoutSession(
  priceId: string,
  opts?: { source?: string },
): Promise<{ url: string; sessionId?: string }> {
  const raw = await nestApiJson<unknown>(
    "/stripe/create-checkout-session",
    {
      method: "POST",
      body: JSON.stringify({
        priceId,
        source: opts?.source ?? "ios",
      }),
    },
    "Couldn't start checkout.",
  );
  const parsed = unwrapNestUrlPayload(raw);
  if (!parsed) throw new NestApiError("Checkout URL missing from server.", 502);
  return parsed;
}

/** Stripe Customer Portal — manage payment method / cancel (web Billing "Manage"). */
export async function createStripeBillingPortalSession(): Promise<{ url: string }> {
  const raw = await nestApiJson<unknown>(
    "/stripe/billing-portal",
    { method: "GET" },
    "Couldn't open billing portal.",
  );
  const parsed = unwrapNestUrlPayload(raw);
  if (!parsed) throw new NestApiError("Billing portal URL missing from server.", 502);
  return { url: parsed.url };
}

/**
 * Switch plan when a Stripe subscription already exists.
 * May return `requiresCheckout` + `url` when payment is needed first.
 */
export async function updateStripeSubscription(
  priceId: string,
): Promise<{
  success: boolean;
  message?: string;
  requiresCheckout?: boolean;
  url?: string;
  sessionId?: string;
}> {
  const raw = await nestApiJson<Record<string, unknown>>(
    "/stripe/update-subscription",
    {
      method: "POST",
      body: JSON.stringify({ priceId, source: "ios" }),
    },
    "Couldn't change plan.",
  );
  const body =
    raw && typeof raw === "object" && raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : raw;
  const url = typeof body?.url === "string" ? body.url : undefined;
  return {
    success: body?.success !== false,
    message: typeof body?.message === "string" ? body.message : undefined,
    requiresCheckout: Boolean(body?.requiresCheckout),
    url,
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
  };
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
      // Nest often omits link counts; fetchAmazonProfiles overwrites from bridge rows.
      kdp_account_count:
        Number(p.kdpAccountCount ?? p.kdp_account_count) || 0,
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
  const books: AmazonProfileBookPreview[] = [];
  for (const book of data.books ?? []) {
    const asin = String(book.asin || "").trim();
    const coverUrl =
      String(book.coverUrl || book.amazonImageUrl || "").trim() || null;
    if (!asin) continue;
    books.push({ asin, title: book.title ?? null, coverUrl });
  }
  return books;
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
  return fetchKdpAccountsForUser(null);
}

export async function fetchKdpAccountsForUser(filterUserId?: string | null) {
  const data = await nestApiJson<{ accounts?: KdpAccountSummary[] }>(
    `/kdp/accounts${qs({ filterUserId })}`,
    { method: "GET" },
    "Couldn't load KDP accounts.",
  );
  return data.accounts ?? [];
}

export async function updateKdpAccountName(kdpAccountId: string, name: string) {
  return nestApiJson<KdpAccountSummary>(
    `/kdp/accounts/${encodeURIComponent(kdpAccountId)}`,
    { method: "PATCH", body: JSON.stringify({ name: name.trim() }) },
    "Couldn't rename KDP account.",
  );
}

export async function deleteKdpBook(kdpAccountId: string, asin: string) {
  return nestApiJson<DeleteKdpBookResult>(
    `/kdp/accounts/${encodeURIComponent(kdpAccountId)}/books/${encodeURIComponent(asin)}`,
    { method: "DELETE" },
    "Couldn't delete the KDP book.",
  );
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
