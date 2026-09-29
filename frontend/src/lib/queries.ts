// Supabase data access layer for inteliads
// All queries are filtered by selected profile IDs and date range when applicable.

import { supabase } from "./supabase";
import { parseNestError, rulesApiFetch, hasNestToken, nestApiJson } from "./rulesApi";
import { fetchNestAmazonProfiles } from "./mutations";
import {
  fetchAggregatedCampaigns,
  fetchNestCampaignById,
  fetchNestKeywordById,
  fetchNestKeywords,
  fetchNestProductTargetById,
  fetchNestProductTargets,
  fetchNestTopBooks,
  isNestKeywordSortAvailable,
  noteNestKeywordSortFailure,
} from "./dashboardApi";
import {
  BOOK_CAMPAIGN_METRICS_BUDGET_MS,
  BOOK_CAMPAIGN_PLACEMENT_BUDGET_MS,
  CAMPAIGNS_PLACEMENT_BUDGET_MS,
  NEST_TARGETING_LIST_BUDGET_MS,
  TARGETING_PAGE_DISPLAY_ENRICH_MS,
  TARGETING_PAGE_METRICS_BUDGET_MS,
  withQueryTimeout,
} from "./queryTimeout";
import { createReadQueue } from "./readRequest";
import {
  campaignPlacementSharesFromBuckets,
  emptyCampaignPlacementShares,
  placementSlotMetrics,
  type CampaignPlacementShares,
} from "./placementMetrics";

export {
  emptyCampaignPlacementShares,
  placementSlotMetrics,
  type CampaignPlacementShares,
  type PlacementSlotField,
  type PlacementSlotMetricValues,
} from "./placementMetrics";
import { NEGATIVE_RESULT_LIMIT } from "./negativeTargeting";
import { RULE_ACTIVITY_LIMIT } from "./ruleActivityContract";
import {
  asinBelongsToLogicalBook,
  logicalBookKeyForAdvertisedAsin,
  logicalBookAsinsFromDailyRows,
  primaryAsinFromGroupKey,
  mergeCatalogIntoDailyAsinGroups,
  verifiedAsinGroupsFromDailyRows,
  verifiedCampaignLogicalBooks,
  verifiedKdpBookCatalog,
} from "./kdpBookIdentity";
import { assembleLogicalBookRows, emptyLogicalBook, type LogicalBookAccumulator } from "./kdpBooksRead";
import {
  kdpAccountCountsByAmazonProfileId,
  linkedKdpAccountIdsFromRows,
} from "./kdpAccountLinks";
import { aggregateKdpDailyRows, kdpTrace } from "./kdpRoyaltiesTrace";
import {
  aggregateKdpFormatRoyalties,
  bookDailyRoyaltiesTotal,
  readKdpFormatRows,
  emptyKdpFormatRoyaltyRange,
  type KdpFormatRoyaltyRange,
} from "./kdpFormatRoyalties";
import {
  calculatorBreakEvenFromKdpTitle,
  pickUsableCoverUrl,
} from "./kdpTitlePresentation";
import {
  dedupeTargetingBookOptions,
  filterTargetingBookOptions,
  hasMeaningfulKdpDailySignal,
  selectEligibleTargetingBookOptions,
  type TargetingBookEligibilityContext,
} from "./targetingBookFilter";
import {
  BOOKS_LIST_ACTIVITY_DAYS,
  annotateBooksListVisibility,
  bookHasKdpOrAdsEvidence,
  bookHasSignalInRange,
  booksListActivityRange,
  collapseTopBooksByFormatGroup,
  filterBooksListVisibility,
  filterTopBooksByRecentActivity,
  identityAsinsForBookRow,
  mergeTopBookCatalogRows,
  preferEditionTitle,
} from "./booksListActivity";

export {
  collapseTargetingBookOptionsByParent,
  dedupeTargetingBookOptions,
  filterTargetingBookOptions,
  hasMeaningfulKdpDailySignal,
  isEligibleTargetingBookOption,
  mergeTargetingBookOptionSources,
  selectEligibleCreateBookOptions,
  selectEligibleTargetingBookOptions,
} from "./targetingBookFilter";
export type { TargetingBookEligibilityContext } from "./targetingBookFilter";
import { aggregateDailyMetrics, aggregateDailyMetricsForDisplay } from "./dailyMetrics";
import { netRoyaltiesKnown } from "./netRoyalties";
import { describeProductTarget, extractTargetAsin, isCategoryTarget, isUsableBookTitle } from "./targeting";

export const ADMIN_FILTER_KEY = "inteliads.adminFilterUserId";
import {
  AmazonProfile,
  Campaign,
  AdGroup,
  Keyword,
  ProductTarget,
  ProductAd,
  CampaignMetric,
  SearchTerm,
  NegativeKeyword,
  NegativeProductTarget,
  OptimizationRule,
  RuleExecutionWithName,
  TodayExecutionStats,
  HourlyMetric,
  UserSetting,
  ProfileSyncLog,
  SyncLog,
  RuleExecutionEntity,
  KpiSnapshot,
  MetricsTotals,
} from "./types";
import { shouldShowActiveOrPausedWithData } from "./campaigns";

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

function debugDataScope(event: string, details: Record<string, number | string>) {
  if (process.env.EXPO_PUBLIC_DEBUG_DATA_SCOPE !== "true") return;
  // Counts and labels only; never log user IDs, profile IDs, keys, or raw row payloads.
  // eslint-disable-next-line no-console
  console.info(`[inteliads:data] ${event}`, details);
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

export const POSTGREST_PAGE_SIZE = 1000;
/** Defensive cap so a stuck page cannot loop forever. 2500 × 1000 = 2.5M rows. */
export const POSTGREST_MAX_PAGES = 2500;

/**
 * Metric hydration is shared by Campaigns, Ad groups, Products and detail
 * screens. A per-call limit still let several mounted screens issue 5-8 large
 * metric reads together. Keep DB pressure bounded across the app; queued work
 * remains complete and keeps the same date/entity scope.
 * (From Codex `codex/ios-speed` - Bound iOS targeting refresh pressure.)
 */
const runMetricRead = createReadQueue(2);

export type MobileTargetingSegment = "keywords" | "asins" | "auto" | "category" | "placement";
export type MobileTargetingSort = "acos" | "spend" | "orders" | "clicks" | "impressions" | "bid";

export type MobileTargetingPage = {
  rows: Array<Keyword | ProductTarget | Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  snapshot: string;
  asOf: string;
  metricsCoveredThrough: string | null;
  contract: "exact-period-cascade-v1";
};

export class MobileTargetingSnapshotChangedError extends Error {
  constructor() {
    super("Targeting changed; reload page 1");
    this.name = "MobileTargetingSnapshotChangedError";
  }
}

export function isMobileTargetingSnapshotChanged(error: unknown): boolean {
  return (
    error instanceof MobileTargetingSnapshotChangedError ||
    (typeof error === "object" &&
      error !== null &&
      (String((error as { code?: unknown }).code ?? "") === "PT409" ||
        /targeting changed; reload page 1/i.test(
          String((error as { message?: unknown }).message ?? ""),
        )))
  );
}

/**
 * One exact-date, globally ranked targeting page. The database owns filters,
 * totals and order across the full selected scope; the app must not re-sort a
 * returned page or merge it with another snapshot.
 */
export async function fetchMobileTargetingPage(input: {
  segment: MobileTargetingSegment;
  sort: MobileTargetingSort;
  page: number;
  pageSize?: number;
  start: string;
  end: string;
  profiles: string[];
  ownerId?: string | null;
  campaignIds?: string[];
  state?: "all" | "enabled" | "active" | "paused";
  search?: string;
  perf?: string;
  advanced?: Record<string, number | null>;
  snapshot?: string | null;
  signal?: AbortSignal;
  /** Skip title/cover fill — used for catalog-tail pages so first paint stays fast. */
  skipDisplayEnrich?: boolean;
}): Promise<MobileTargetingPage> {
  if (!input.profiles.length) {
    throw new Error("At least one targeting profile is required");
  }
  const payload = {
    segment: input.segment,
    sort: input.sort,
    page: Math.max(1, Math.floor(input.page)),
    pageSize: Math.min(500, Math.max(1, Math.floor(input.pageSize ?? 500))),
    start: input.start,
    end: input.end,
    profiles: uniqueStrings(input.profiles.map(String)).sort(),
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    ...(input.campaignIds ? { campaignIds: uniqueStrings(input.campaignIds.map(String)).sort() } : {}),
    state: input.state ?? "all",
    search: input.search?.trim() ?? "",
    perf: input.perf ?? "all",
    advanced: input.advanced ?? {},
    ...(input.snapshot ? { snapshot: input.snapshot } : {}),
  };
  let request = supabase.rpc("mobile_targeting_page_v1", { p_input: payload });
  if (input.signal) request = request.abortSignal(input.signal);
  const { data, error } = await request;
  if (error) {
    if (isMobileTargetingSnapshotChanged(error)) {
      throw new MobileTargetingSnapshotChangedError();
    }
    throw error;
  }
  const result = data as Partial<MobileTargetingPage> | null;
  if (
    !result ||
    result.contract !== "exact-period-cascade-v1" ||
    !Array.isArray(result.rows) ||
    !Number.isInteger(result.total) ||
    !Number.isInteger(result.page) ||
    !Number.isInteger(result.pageSize) ||
    typeof result.snapshot !== "string" ||
    typeof result.asOf !== "string" ||
    !(
      result.metricsCoveredThrough === undefined ||
      result.metricsCoveredThrough === null ||
      typeof result.metricsCoveredThrough === "string"
    )
  ) {
    throw new Error("Invalid targeting page response");
  }
  // The deployed exact-period RPC predates this optional coverage marker.
  // Missing means unknown, never a failed catalog response and never invented
  // metric coverage.
  const page: MobileTargetingPage = {
    ...(result as Omit<MobileTargetingPage, "metricsCoveredThrough">),
    metricsCoveredThrough: result.metricsCoveredThrough ?? null,
  };

  // Display-only title/cover fill — never drop, re-sort, or invent catalog rows.
  // RPC pages omit Nest/KDP enrichment; without this ASINs show bare codes and
  // Auto/Category/Placement show cube placeholders instead of book covers.
  // Critical path: local Supabase only + hard budget. Open Library / Amazon retail
  // HTML must not block Targets → ASINs (build 305 hung the spinner for minutes).
  if (!input.skipDisplayEnrich) {
    try {
      if (input.segment === "asins" || input.segment === "auto" || input.segment === "category") {
        page.rows = await withQueryTimeout(
          enrichProductTargetDisplay(page.rows as ProductTarget[], input.profiles, {
            skipKdp: false,
            // Open Library OK; Amazon retail HTML is what hung Targets → ASINs for minutes.
            skipRetail: true,
          }),
          TARGETING_PAGE_DISPLAY_ENRICH_MS,
          input.signal,
        );
      } else if (input.segment === "placement") {
        page.rows = await withQueryTimeout(
          enrichPlacementPageBookCovers(page.rows as Record<string, unknown>[], input.profiles),
          TARGETING_PAGE_DISPLAY_ENRICH_MS,
          input.signal,
        );
      }
    } catch (error) {
      // Soft-degrade: keep ranked page rows even if title/cover lookup flakes/times out.
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] page display enrichment failed", error);
    }
  }

  return page;
}

/** Bound parallel RPC walks so one segment cannot starve the others. */
async function mapPoolLimited<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        results[i] = await worker(items[i]!, i);
      }
    }),
  );
  return results;
}

/**
 * Pages 2..N for a stable snapshot — ordered, no re-sort, no invent.
 * Display enrich runs once on the concatenated tail (not per page) so Keywords
 * and other segments are not penalized by repeated ASIN title work.
 */
export async function fetchMobileTargetingCatalogTail(input: {
  head: MobileTargetingPage;
  segment: MobileTargetingSegment;
  sort: MobileTargetingSort;
  pageSize?: number;
  start: string;
  end: string;
  profiles: string[];
  ownerId?: string | null;
  campaignIds?: string[];
  state?: "all" | "enabled" | "active" | "paused";
  search?: string;
  perf?: string;
  advanced?: Record<string, number | null>;
  signal?: AbortSignal;
}): Promise<MobileTargetingPage["rows"]> {
  const head = input.head;
  const pageSize = Math.max(1, head.pageSize || TARGETING_LIST_LIMIT);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, head.total) / pageSize));
  if (totalPages <= 1 || head.rows.length >= head.total) return [];

  const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const byPage = new Map<number, MobileTargetingPage["rows"]>();
  await mapPoolLimited(pageNumbers, 3, async (page) => {
    if (input.signal?.aborted) throw new Error("Targeting catalog tail aborted");
    const result = await fetchMobileTargetingPage({
      segment: input.segment,
      sort: input.sort,
      page,
      pageSize,
      start: input.start,
      end: input.end,
      profiles: input.profiles,
      ownerId: input.ownerId,
      campaignIds: input.campaignIds,
      state: input.state,
      search: input.search,
      perf: input.perf,
      advanced: input.advanced,
      snapshot: head.snapshot,
      signal: input.signal,
      skipDisplayEnrich: true,
    });
    if (result.snapshot !== head.snapshot) {
      throw new MobileTargetingSnapshotChangedError();
    }
    byPage.set(page, result.rows);
  });

  let ordered = pageNumbers.flatMap((page) => byPage.get(page) ?? []);
  if (!ordered.length) return [];

  try {
    if (input.segment === "asins" || input.segment === "auto" || input.segment === "category") {
      ordered = await withQueryTimeout(
        enrichProductTargetDisplay(ordered as ProductTarget[], input.profiles, {
          skipKdp: false,
          skipRetail: true,
        }),
        TARGETING_PAGE_DISPLAY_ENRICH_MS,
        input.signal,
      );
    } else if (input.segment === "placement") {
      ordered = await withQueryTimeout(
        enrichPlacementPageBookCovers(ordered as Record<string, unknown>[], input.profiles),
        TARGETING_PAGE_DISPLAY_ENRICH_MS,
        input.signal,
      );
    }
  } catch (error) {
    // Soft-degrade: keep ranked tail rows even if title/cover lookup flakes.
    // eslint-disable-next-line no-console
    console.warn("[inteliads:targeting] catalog tail display enrichment failed", error);
  }
  return ordered;
}
/** Targets tab: first-window size so multi-profile keyword reads stay responsive. Not an Amazon write limit — Load more grows past this until the filtered catalog is exhausted. */
export const TARGETING_LIST_LIMIT = 500;
/** Page size for progressive catalog windows (Load more grows the window). */
export const LIST_PAGE_SIZE = TARGETING_LIST_LIMIT;

export class IncompleteReadError extends Error {
  readonly code = "INCOMPLETE_READ";
  constructor(message = "PostgREST read exceeded the safety page limit") {
    super(message);
    this.name = "IncompleteReadError";
  }
}

async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = POSTGREST_PAGE_SIZE,
  opts?: { signal?: AbortSignal; maxPages?: number },
): Promise<T[]> {
  const maxPages = opts?.maxPages ?? POSTGREST_MAX_PAGES;
  const rows: T[] = [];
  for (let page = 0, from = 0; ; page += 1, from += pageSize) {
    if (opts?.signal?.aborted) {
      throw new IncompleteReadError("PostgREST read aborted");
    }
    if (page >= maxPages) {
      throw new IncompleteReadError("PostgREST read exceeded the safety page limit");
    }
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
}

/**
 * Fetch up to `limit` ordered rows via PostgREST ranges.
 * A single `.limit(N)` silently truncates when N exceeds the server max-rows
 * (usually 1000) — Load more past the first page must page explicitly.
 */
async function fetchLimitedOrderedRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  limit: number,
  opts?: { signal?: AbortSignal },
): Promise<T[]> {
  if (limit <= 0) return [];
  if (limit <= POSTGREST_PAGE_SIZE) {
    const { data, error } = await buildQuery(0, limit - 1);
    if (error) throw error;
    return (data ?? []).slice(0, limit);
  }
  const maxPages = Math.min(POSTGREST_MAX_PAGES, Math.ceil(limit / POSTGREST_PAGE_SIZE) + 1);
  const rows = await fetchAllPages<T>(buildQuery, POSTGREST_PAGE_SIZE, {
    signal: opts?.signal,
    maxPages,
  });
  return rows.slice(0, limit);
}

/** One owned spend-ordered window — append paging resumes via `nextFrom`. */
export type OwnedOrderedWindow<T> = {
  rows: T[];
  /** PostgREST range start for the next append (after last examined ordered row). */
  nextFrom: number;
  /** Ordered catalog ended (empty/short page) before filling `limit`. */
  exhausted: boolean;
};

/**
 * Spend-ordered window that survives `user_campaigns` ownership trim.
 *
 * Fixed oversample (2× / ≤900) under-filled once `listCap ≥ 900` (oversample ==
 * limit) → ownership trim → N < listCap → false Complete · N (96: Active+ACoS
 * stuck at 417 vs live-parent ~5666). Walk pages until owned count fills `limit`
 * or the ordered catalog is exhausted (short page).
 *
 * `resumeFrom` continues an earlier walk so Load more appends without re-scanning
 * 0..N (97: full-window re-fetch hit TARGETING_PAGE_TIMEOUT ~3k → Couldn't load).
 */
async function fetchOwnedOrderedWindow<T extends { id?: string; campaign_id?: string | null }>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  limit: number,
  ownerUserId: string,
  opts?: {
    signal?: AbortSignal;
    pageSize?: number;
    resumeFrom?: number;
    owned?: Set<string>;
    seenIds?: Set<string>;
  },
): Promise<OwnedOrderedWindow<T>> {
  if (limit <= 0) {
    return { rows: [], nextFrom: Math.max(0, opts?.resumeFrom ?? 0), exhausted: true };
  }
  const owned = opts?.owned ?? (await fetchOwnedCampaignIds(ownerUserId));
  if (!owned.size) {
    return { rows: [], nextFrom: Math.max(0, opts?.resumeFrom ?? 0), exhausted: true };
  }
  const pageSize = Math.min(
    POSTGREST_PAGE_SIZE,
    Math.max(opts?.pageSize ?? TARGETING_LIST_LIMIT, Math.min(limit, POSTGREST_PAGE_SIZE)),
  );
  const collected: T[] = [];
  const seen = opts?.seenIds ?? new Set<string>();
  const maxScan = Math.min(POSTGREST_MAX_PAGES * POSTGREST_PAGE_SIZE, Math.max(limit * 40, 20_000));
  let cursor = Math.max(0, opts?.resumeFrom ?? 0);
  let exhausted = false;
  const scanBudget = cursor + maxScan;
  while (collected.length < limit && cursor < scanBudget) {
    if (opts?.signal?.aborted) {
      throw new IncompleteReadError("PostgREST read aborted");
    }
    const { data, error } = await buildQuery(cursor, cursor + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    if (!batch.length) {
      exhausted = true;
      break;
    }
    let examined = 0;
    for (; examined < batch.length && collected.length < limit; examined += 1) {
      const row = batch[examined];
      const id = String(row.id || "");
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const campaignId = String(row.campaign_id || "");
      if (campaignId && !owned.has(campaignId)) continue;
      collected.push(row);
    }
    cursor += examined;
    if (collected.length >= limit) {
      exhausted = false;
      break;
    }
    if (batch.length < pageSize) {
      exhausted = true;
      break;
    }
    // Full page consumed without filling limit — advance past unread tail if any.
    if (examined < batch.length) cursor += batch.length - examined;
  }
  return {
    rows: collected.slice(0, limit),
    nextFrom: cursor,
    exhausted: exhausted || collected.length < limit,
  };
}

async function fetchOwnedLimitedOrderedRows<T extends { id?: string; campaign_id?: string | null }>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  limit: number,
  ownerUserId: string,
  opts?: { signal?: AbortSignal; pageSize?: number; resumeFrom?: number },
): Promise<T[]> {
  const window = await fetchOwnedOrderedWindow(buildQuery, limit, ownerUserId, opts);
  return window.rows;
}

export class BooksReadError extends Error {
  stage: string;
  code: string;
  constructor(stage: string, code = "error") {
    super(`Books ${stage} failed`);
    this.name = "BooksReadError";
    this.stage = stage;
    this.code = String(code || "error").slice(0, 80);
  }
}

function booksErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown };
    if (record.code) return String(record.code);
    if (record.message) return String(record.message).slice(0, 80);
  }
  return "error";
}

function logBooksStage(stage: string, error: unknown) {
  // eslint-disable-next-line no-console
  console.warn(`[inteliads:books] ${stage}`, booksErrorCode(error));
}

const BOOKS_IN_CHUNK = 200;

async function fetchRequiredPages<T>(
  stage: string,
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  try {
    return await fetchAllPages(buildQuery);
  } catch (error) {
    logBooksStage(stage, error);
    throw new BooksReadError(stage, booksErrorCode(error));
  }
}

async function fetchOptionalInPages<T>(
  stage: string,
  ids: string[],
  buildQuery: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  chunkSize = BOOKS_IN_CHUNK,
): Promise<T[]> {
  if (!ids.length) return [];
  const rows: T[] = [];
  for (const chunk of chunkArray(ids, chunkSize)) {
    try {
      rows.push(...(await fetchAllPages((from, to) => buildQuery(chunk, from, to))));
    } catch (error) {
      logBooksStage(stage, error);
    }
  }
  return rows;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function emptyTotals(): MetricsTotals {
  return {
    total_impressions: 0,
    total_clicks: 0,
    total_orders: 0,
    total_sales: 0,
    total_spend: 0,
    total_acos: 0,
    total_ctr: 0,
    total_roas: 0,
    total_cpc: 0,
    total_conversion_rate: 0,
  };
}

function finalizeTotals(t: MetricsTotals): MetricsTotals {
  t.total_acos = safeDivide(t.total_spend, t.total_sales) * 100;
  t.total_roas = safeDivide(t.total_sales, t.total_spend);
  t.total_ctr = safeDivide(t.total_clicks, t.total_impressions) * 100;
  t.total_cpc = safeDivide(t.total_spend, t.total_clicks);
  t.total_conversion_rate = safeDivide(t.total_orders, t.total_clicks) * 100;
  return t;
}

function addMetricRow(t: MetricsTotals, row: any) {
  t.total_impressions += toNumber(row.impressions);
  t.total_clicks += toNumber(row.clicks);
  t.total_orders += toNumber(row.orders);
  t.total_sales += toNumber(row.sales);
  t.total_spend += toNumber(row.spend);
}

async function fetchCampaignMetricRows(
  campaignIds: string[],
  start: string,
  end: string,
): Promise<Array<{ campaign_id: string; date: string; impressions: unknown; clicks: unknown; orders: unknown; spend: unknown; sales: unknown }>> {
  const rows: Array<{ campaign_id: string; date: string; impressions: unknown; clicks: unknown; orders: unknown; spend: unknown; sales: unknown }> = [];
  if (!campaignIds.length) return rows;
  for (const chunk of chunkArray(campaignIds, 200)) {
    rows.push(
      ...(await fetchAllPages((from, to) =>
        supabase
          .from("campaign_metrics")
          .select("campaign_id,date,impressions,clicks,orders,spend,sales")
          .in("campaign_id", chunk)
          .gte("date", start)
          .lte("date", end)
          .order("campaign_id", { ascending: true })
          .order("date", { ascending: true })
          .range(from, to),
      )),
    );
  }
  return rows;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchMetricTotalsByEntity(
  table: string,
  entityColumn: string,
  ids: string[],
  start?: string,
  end?: string,
): Promise<Map<string, MetricsTotals>> {
  const totals = new Map<string, MetricsTotals>();
  if (!ids.length || !start || !end) return totals;
  const selectColumns = [entityColumn, "impressions", "clicks", "orders", "spend", "sales"].join(",");
  // Keep each indexed IN read small enough for Supabase I/O. Module-wide queue
  // bounds overlap from independently mounted screens (Codex ios-speed).
  const idChunks = chunkArray(ids, 80);
  const concurrency = 2;

  async function enrichChunk(chunk: string[]) {
    try {
      await runMetricRead(async (signal) => {
        let from = 0;
        for (;;) {
          const { data, error } = await supabase
            .from(table)
            .select(selectColumns)
            .in(entityColumn, chunk)
            .gte("date", start)
            .lte("date", end)
            .order(entityColumn, { ascending: true })
            .order("date", { ascending: true })
            .range(from, from + POSTGREST_PAGE_SIZE - 1)
            .abortSignal(signal);
          if (error) throw error;
          const pageRows = data ?? [];
          for (const row of pageRows) {
            const candidate: unknown = row;
            if (!isUnknownRecord(candidate)) continue;
            const record = candidate;
            const id = record[entityColumn];
            if (!id) continue;
            const key = String(id);
            const current = totals.get(key) ?? emptyTotals();
            addMetricRow(current, record);
            totals.set(key, current);
          }
          if (pageRows.length < POSTGREST_PAGE_SIZE) break;
          from += POSTGREST_PAGE_SIZE;
        }
      });
    } catch (error) {
      // One metrics chunk must not fail the whole catalog enrich (append grow / exhaust).
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] metrics chunk soft-failed", table, error);
    }
  }

  for (let i = 0; i < idChunks.length; i += concurrency) {
    await Promise.all(idChunks.slice(i, i + concurrency).map(enrichChunk));
  }

  for (const total of totals.values()) finalizeTotals(total);
  return totals;
}

function applyMetricTotals<T extends Partial<MetricsTotals>>(row: T, totals?: MetricsTotals): T {
  if (!totals) return row;
  return { ...row, ...totals };
}

function normalizeProfileIds(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return uniqueStrings(parsed);
  } catch {}

  return uniqueStrings(
    value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((id) => id.trim().replace(/^"|"$/g, "")),
  );
}

export interface KdpRoyaltyDay {
  date: string;
  royalties: number;
  orders: number;
}

export interface KdpRoyaltyRange {
  hasKdpData: boolean;
  totalRoyalties: number;
  totalOrders: number;
  daily: KdpRoyaltyDay[];
  coverage: "complete" | "partial" | "missing" | "not_linked";
  coveredDays: number;
  daysInRange: number;
  coveredAccountDays: number;
  expectedAccountDays: number;
  /** Account-day completeness vs linked KDP accounts for the requested scope. */
  completeness?: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  linkedAccountCount?: number;
  rawRowCount?: number;
}

const linkedKdpAccountReads = new Map<string, Promise<string[]>>();

async function fetchLinkedKdpAccountIds(
  profileIds: string[],
  opts?: { includePaused?: boolean; allowLegacy?: boolean },
): Promise<string[]> {
  const key = `${uniqueStrings(profileIds).sort().join(",")}|${opts?.includePaused === true}|${opts?.allowLegacy !== false}`;
  const existing = linkedKdpAccountReads.get(key);
  if (existing) return existing;
  const pending = fetchLinkedKdpAccountIdsUncached(profileIds, opts);
  linkedKdpAccountReads.set(key, pending);
  void pending.then(
    () => linkedKdpAccountReads.delete(key),
    () => linkedKdpAccountReads.delete(key),
  );
  return pending;
}

async function fetchLinkedKdpAccountIdsUncached(
  profileIds: string[],
  opts?: { includePaused?: boolean; allowLegacy?: boolean },
): Promise<string[]> {
  if (!profileIds.length) return [];

  const linkedAccounts: any[] = [];
  for (const chunk of chunkArray(profileIds, BOOKS_IN_CHUNK)) {
    linkedAccounts.push(
      ...(await fetchAllPages<any>((from, to) =>
        supabase
          .from("kdp_account_amazon_profiles")
          .select("kdp_account_id, amazon_profile_id, is_paused")
          .in("amazon_profile_id", chunk)
          .order("kdp_account_id", { ascending: true })
          .order("amazon_profile_id", { ascending: true })
          .range(from, to),
      )),
    );
  }
  kdpTrace("KD_LINK_ROWS", { count: linkedAccounts.length });

  // Dedupes kdp_account_id when the same shelf is linked to US + CA (or more).
  let linkedIds = linkedKdpAccountIdsFromRows(linkedAccounts ?? [], profileIds, {
    includePaused: opts?.includePaused === true,
  });

  // Match web resolveOwnedActiveKdpScope: only the signed-in user's shelves.
  // Shared Ads profiles can bridge other users' KDP accounts — without this
  // filter those leak into Overview Gross (~$4.2K vs web ~$3.8K).
  linkedIds = await filterOwnedKdpAccountIds(linkedIds);
  kdpTrace("KD_OWNED_LINK_ROWS", { count: linkedIds.length });

  // Legacy amazon_profile_id on kdp_accounts: only when explicitly allowed.
  // Overview portfolio used to pass every Ads profile (incl. Disabled); legacy
  // matching those ids pulled unlinked / foreign shelves into Gross.
  if (opts?.allowLegacy === false) return linkedIds;

  const explicitlyLinkedProfileIds = new Set(
    linkedAccounts
      .map((row: any) => row.amazon_profile_id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0),
  );

  const activeLinkedIds = uniqueStrings(
    linkedAccounts
      .filter((row: any) => row.is_paused !== true)
      .map((row: any) => row.kdp_account_id),
  );

  const legacyProfileIds = profileIds.filter((id) => !explicitlyLinkedProfileIds.has(id));
  if (!legacyProfileIds.length) return activeLinkedIds.length ? activeLinkedIds : linkedIds;

  const { ensureFreshSupabaseSession } = await import("./supabase");
  const session = await ensureFreshSupabaseSession();
  const userId = session?.user?.id;
  if (!userId) return activeLinkedIds.length ? activeLinkedIds : linkedIds;

  const legacyAccounts: any[] = [];
  for (const chunk of chunkArray(legacyProfileIds, BOOKS_IN_CHUNK)) {
    legacyAccounts.push(
      ...(await fetchAllPages<any>((from, to) =>
        supabase
          .from("kdp_accounts")
          .select("id")
          .eq("user_id", userId)
          .in("amazon_profile_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }

  return uniqueStrings([...activeLinkedIds, ...legacyAccounts.map((row: any) => row.id)]);
}

/** Keep only kdp_accounts owned by the signed-in user (web certified money contract). */
async function filterOwnedKdpAccountIds(accountIds: string[]): Promise<string[]> {
  const ids = uniqueStrings(accountIds);
  if (!ids.length) return [];
  const { ensureFreshSupabaseSession } = await import("./supabase");
  const session = await ensureFreshSupabaseSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from("kdp_accounts")
    .select("id")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return uniqueStrings((data ?? []).map((row: any) => row.id));
}

export type KdpRoyaltyQueryScope = "linked_profiles" | "user_accounts";

/**
 * Session KDP accounts owned by the signed-in user — no Ads profile required.
 * Always filter `user_id` explicitly: RLS alone has leaked other users' shelves
 * (e.g. Sebastian Danga) into Overview Gross/Net via `user_accounts`.
 */
async function fetchSessionKdpAccountIds(): Promise<string[]> {
  const { ensureFreshSupabaseSession } = await import("./supabase");
  const session = await ensureFreshSupabaseSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase.from("kdp_accounts").select("id").eq("user_id", userId);
  if (error) throw error;
  return uniqueStrings((data ?? []).map((row: any) => row.id));
}

export interface OwnedBookIdentity {
  asin: string;
  title: string | null;
  image_url: string | null;
  book_key: string;
}

/**
 * Resolve stable, owned KDP catalog metadata independently of the current
 * date/profile filter. Book detail routes can be opened from notifications or
 * old links, so their title must not degrade to a raw ASIN merely because the
 * book is outside the current financial result set.
 */
export async function fetchOwnedBookIdentity(openedAsin: string): Promise<OwnedBookIdentity | null> {
  const opened = String(openedAsin ?? "").trim().toUpperCase();
  if (!opened) return null;

  const accountIds = await fetchSessionKdpAccountIds();
  if (!accountIds.length) return null;

  const { data: openedRows, error: openedError } = await supabase
    .from("kdp_book_daily_data")
    .select("asin, group_key")
    .in("account_id", accountIds)
    .eq("asin", opened);
  if (openedError) throw openedError;

  const groupKeys = uniqueStrings(
    (openedRows ?? []).map((row: any) => String(row.group_key ?? "").trim()).filter(Boolean),
  );
  let dailyRows = (openedRows ?? []) as any[];
  if (groupKeys.length) {
    const { data: siblingRows, error: siblingError } = await supabase
      .from("kdp_book_daily_data")
      .select("asin, group_key")
      .in("account_id", accountIds)
      .in("group_key", groupKeys);
    if (siblingError) throw siblingError;
    dailyRows = siblingRows ?? dailyRows;
  }

  const siblingAsins = logicalBookAsinsFromDailyRows(opened, dailyRows);
  const candidateAsins = uniqueStrings([opened, ...siblingAsins]);
  const { data: titleRows, error: titleError } = await supabase
    .from("kdp_titles")
    .select("asin, title, cover_url, amazon_image_url")
    .in("account_id", accountIds)
    .in("asin", candidateAsins);
  if (titleError) throw titleError;

  const exactTitle = (titleRows ?? []).find(
    (row: any) => String(row.asin ?? "").trim().toUpperCase() === opened && String(row.title ?? "").trim(),
  );
  const titled = exactTitle ?? (titleRows ?? []).find((row: any) => String(row.title ?? "").trim()) ?? null;
  const covered = exactTitle ?? (titleRows ?? []).find(
    (row: any) => String(row.cover_url ?? "").trim() || String(row.amazon_image_url ?? "").trim(),
  ) ?? null;
  const bookKey = String(
    (openedRows ?? []).find((row: any) => String(row.group_key ?? "").trim())?.group_key
      ?? dailyRows.find((row: any) => String(row.group_key ?? "").trim())?.group_key
      ?? opened,
  ).trim().toUpperCase();

  if (!titled && !covered && !dailyRows.length) return null;
  return {
    asin: opened,
    title: titled ? String((titled as any).title ?? "").trim() || null : null,
    image_url: covered
      ? pickUsableCoverUrl((covered as any).cover_url, (covered as any).amazon_image_url) ?? null
      : null,
    book_key: bookKey || opened,
  };
}

async function fetchKdpAccountIdsForRoyaltyQuery(
  profileIds: string[],
  kdpScope: KdpRoyaltyQueryScope = "linked_profiles",
  opts?: { includePausedLinks?: boolean; allowLegacyProfileLinks?: boolean },
): Promise<string[]> {
  if (kdpScope === "user_accounts") return fetchSessionKdpAccountIds();
  if (!profileIds.length) return [];
  return fetchLinkedKdpAccountIds(profileIds, {
    includePaused: opts?.includePausedLinks === true,
    allowLegacy: opts?.allowLegacyProfileLinks !== false,
  });
}

async function fetchLogicalBookAsins(
  profileIds: string[],
  openedAsin: string,
): Promise<string[]> {
  const opened = String(openedAsin ?? "").trim().toUpperCase();
  if (!opened) return [];

  const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
  if (!kdpAccountIds.length) return [opened];

  const { data: openedRows, error: openedErr } = await supabase
    .from("kdp_book_daily_data")
    .select("asin, group_key")
    .in("account_id", kdpAccountIds)
    .eq("asin", opened);
  if (openedErr) throw openedErr;

  const groupKeys = uniqueStrings(
    (openedRows ?? []).map((row: any) => String(row.group_key ?? "").trim()).filter(Boolean),
  );
  let asins = groupKeys.length
    ? await (async () => {
        const { data: siblingRows, error: siblingErr } = await supabase
          .from("kdp_book_daily_data")
          .select("asin, group_key")
          .in("account_id", kdpAccountIds)
          .in("group_key", groupKeys);
        if (siblingErr) throw siblingErr;
        return logicalBookAsinsFromDailyRows(opened, siblingRows ?? []);
      })()
    : [opened];

  return asins;
}

async function loadShelfHealQuarantineEntries(): Promise<
  import("./kdp/shelfHeal.ts").QuarantineEntry[]
> {
  try {
    const { resolveQuarantineUserId, loadKdpAsinQuarantineEntries } = await import(
      "./kdp/shelfHealStore.ts"
    );
    const userId = await resolveQuarantineUserId();
    if (!userId) return [];
    return await loadKdpAsinQuarantineEntries(userId);
  } catch {
    return [];
  }
}

export async function fetchKdpRoyaltiesRange(
  profileIds: string[],
  startDate: string,
  endDate: string,
  opts?: {
    kdpScope?: KdpRoyaltyQueryScope;
    includePausedLinks?: boolean;
    /** Default true. Overview portfolio must pass false to avoid Disabled-profile legacy inflate. */
    allowLegacyProfileLinks?: boolean;
  },
): Promise<KdpRoyaltyRange> {
  const kdpScope = opts?.kdpScope ?? "linked_profiles";
  kdpTrace("KD01_QUERY_START", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    profileCount: profileIds.length,
    kdpScope,
  });
  const accountIds = await fetchKdpAccountIdsForRoyaltyQuery(profileIds, kdpScope, {
    includePausedLinks: opts?.includePausedLinks,
    allowLegacyProfileLinks: opts?.allowLegacyProfileLinks,
  });
  kdpTrace("KD05_SCOPE_FILTER", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    linkedAccounts: accountIds.length,
    filteredByAdsProfiles: kdpScope === "linked_profiles" ? 1 : 0,
  });
  if (!accountIds.length) {
    kdpTrace("KD02_QUERY_RETURN", { date: startDate, count: 0, total: 0 });
    return {
      hasKdpData: false,
      totalRoyalties: 0,
      totalOrders: 0,
      daily: [],
      coverage: "not_linked",
      coveredDays: 0,
      daysInRange: 0,
      coveredAccountDays: 0,
      expectedAccountDays: 0,
      completeness: "UNKNOWN",
      linkedAccountCount: 0,
      rawRowCount: 0,
    };
  }

  const quarantineEntries = await loadShelfHealQuarantineEntries();
  const {
    accountIdsHitByQuarantine,
    aggregateBookDailyToAccountDays,
    filterRowsExcludingQuarantine,
  } = await import("./kdp/shelfHeal.ts");
  const hitAccountIds = accountIdsHitByQuarantine(accountIds, quarantineEntries);
  const hitSet = new Set(hitAccountIds);
  const cleanAccountIds = accountIds.filter((id) => !hitSet.has(id));

  let rawRows: any[] = [];
  let usingDaily = true;

  if (cleanAccountIds.length) {
    let dailyRows: any[] = [];
    let dailyError: any = null;
    try {
      for (const chunk of chunkArray(cleanAccountIds, BOOKS_IN_CHUNK)) {
        dailyRows.push(
          ...(await fetchAllPages<any>((from, to) =>
            supabase
              .from("kdp_daily_data")
              .select("account_id, date, royalties, orders")
              .in("account_id", chunk)
              .gte("date", startDate)
              .lte("date", endDate)
              .order("date", { ascending: true })
              .order("account_id", { ascending: true })
              .range(from, to),
          )),
        );
      }
    } catch (error) {
      dailyError = error;
    }

    let entryRows: any[] = [];
    let entryError: any = null;
    if (dailyError || !dailyRows.length) {
      try {
        for (const chunk of chunkArray(cleanAccountIds, BOOKS_IN_CHUNK)) {
          entryRows.push(
            ...(await fetchAllPages<any>((from, to) =>
              supabase
                .from("kdp_entries")
                .select("account_id, date, income, orders")
                .in("account_id", chunk)
                .gte("date", startDate)
                .lte("date", endDate)
                .order("date", { ascending: true })
                .order("account_id", { ascending: true })
                .range(from, to),
            )),
          );
        }
      } catch (error) {
        entryError = error;
      }
    }
    if (dailyError && entryError && !hitAccountIds.length) throw entryError;
    if (!dailyError && dailyRows.length === 0 && entryError && !hitAccountIds.length) {
      throw entryError;
    }

    usingDaily = dailyRows.length > 0;
    rawRows = usingDaily
      ? dailyRows
      : entryRows.map((row) => ({
          account_id: row.account_id,
          date: row.date,
          royalties: row.income,
          orders: row.orders,
        }));
  }

  // Quarantine hit: do not trust account-day kdp_daily_data for those shelves —
  // re-aggregate from book-daily excluding quarantined (account_id, asin) pairs.
  if (hitAccountIds.length) {
    try {
      const bookRows = await fetchAllPages<any>((from, to) =>
        supabase
          .from("kdp_book_daily_data")
          .select("account_id, date, asin, royalties, orders")
          .in("account_id", hitAccountIds)
          .gte("date", startDate)
          .lte("date", endDate)
          .order("date", { ascending: true })
          .order("asin", { ascending: true })
          .range(from, to),
      );
      const kept = filterRowsExcludingQuarantine(bookRows, quarantineEntries);
      rawRows = [...rawRows, ...aggregateBookDailyToAccountDays(kept)];
      usingDaily = true;
    } catch (err) {
      if (!cleanAccountIds.length) throw err;
      // Keep clean-account totals if book-daily path fails.
    }
  }

  if (!cleanAccountIds.length && !hitAccountIds.length) {
    rawRows = [];
  }

  kdpTrace("KD02_QUERY_RETURN", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    source: hitAccountIds.length
      ? "kdp_book_daily_data_quarantine"
      : usingDaily
        ? "kdp_daily_data"
        : "kdp_entries",
  });
  kdpTrace("KD03_RAW_COUNT", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    count: rawRows.length,
  });

  const aggregated = aggregateKdpDailyRows(rawRows, accountIds.length, {
    start: startDate,
    end: endDate,
    source: usingDaily ? "kdp_daily_data" : "kdp_entries",
  });
  kdpTrace("KD04_RAW_TOTAL", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
  });
  kdpTrace("KD06_SCOPE_COUNT", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    count: aggregated.accountCount,
    linkedAccounts: accountIds.length,
  });
  kdpTrace("KD07_SCOPE_TOTAL", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
  });
  kdpTrace("KD08_CURRENCY_NORMALIZE", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    note: "kdp_daily_data_has_no_currency_column",
  });
  kdpTrace("KD09_NORMALIZED_TOTAL", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
  });
  kdpTrace("KD10_DATE_FILTER", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    start: startDate,
    end: endDate,
  });
  kdpTrace("KD11_DATE_TOTAL", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
  });
  kdpTrace("KD12_AGGREGATE", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    count: aggregated.daily.length,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
    completeness: aggregated.completeness,
  });

  kdpTrace("KD15_UI_VALUE", {
    date: startDate === endDate ? startDate : `${startDate}..${endDate}`,
    total: Number(aggregated.totalRoyalties.toFixed(2)),
    completeness: aggregated.completeness,
  });

  return {
    hasKdpData: aggregated.daily.length > 0,
    totalRoyalties: aggregated.totalRoyalties,
    totalOrders: aggregated.totalOrders,
    daily: aggregated.daily,
    coverage: aggregated.coverage,
    coveredDays: aggregated.coveredDays,
    daysInRange: aggregated.daysInRange,
    coveredAccountDays: aggregated.coveredAccountDays,
    expectedAccountDays: aggregated.expectedAccountDays,
    completeness: aggregated.completeness,
    linkedAccountCount: accountIds.length,
    rawRowCount: aggregated.rawCount,
  };
}

/** Paperback / KU / Kindle mix from kdp_book_daily_data for Overview charts. */
export async function fetchKdpFormatRoyaltiesRange(
  profileIds: string[],
  startDate: string,
  endDate: string,
  opts?: {
    kdpScope?: KdpRoyaltyQueryScope;
    includePausedLinks?: boolean;
    allowLegacyProfileLinks?: boolean;
  },
): Promise<KdpFormatRoyaltyRange> {
  const accountIds = await fetchKdpAccountIdsForRoyaltyQuery(
    profileIds,
    opts?.kdpScope ?? "linked_profiles",
    {
      includePausedLinks: opts?.includePausedLinks,
      allowLegacyProfileLinks: opts?.allowLegacyProfileLinks,
    },
  );
  if (!accountIds.length) return emptyKdpFormatRoyaltyRange();

  const quarantineEntries = await loadShelfHealQuarantineEntries();
  const { filterRowsExcludingQuarantine } = await import("./kdp/shelfHeal.ts");

  const selectWithFormats =
    "account_id, date, royalties, ebook_royalties, paperback_royalties, kenp_royalties, asin";
  let rows = await readKdpFormatRows(
    () => fetchAllPages<any>((from, to) =>
      supabase
        .from("kdp_book_daily_data")
        .select(selectWithFormats)
        .in("account_id", accountIds)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("asin", { ascending: true })
        .range(from, to),
    ),
    () => fetchAllPages<any>((from, to) =>
      supabase
        .from("kdp_book_daily_data")
        .select("account_id, date, royalties, asin")
        .in("account_id", accountIds)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("asin", { ascending: true })
        .range(from, to),
    ),
  );

  rows = filterRowsExcludingQuarantine(rows, quarantineEntries);
  return aggregateKdpFormatRoyalties(rows);
}

const ADS_ENGINE_ENTITY_CAP = 250;

type AdsEngineDailyPoint = {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
};

export type AdsEngineFunnelRange = {
  daily: AdsEngineDailyPoint[];
  entityCount: number;
};

type AdsEngineEntityRef = { id: string; amazon_profile_id: string | null };

/** search_terms inherit profile via campaigns — no amazon_profile_id column. */
async function fetchAdsEngineEntityIds(
  profileIds: string[],
  entityTable: "keywords" | "search_terms",
): Promise<AdsEngineEntityRef[]> {
  if (entityTable === "keywords") {
    const { data, error } = await supabase
      .from("keywords")
      .select("id, amazon_profile_id")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false })
      .limit(ADS_ENGINE_ENTITY_CAP);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: String(row.id),
      amazon_profile_id: row.amazon_profile_id ? String(row.amazon_profile_id) : null,
    }));
  }

  const campaigns = await fetchAllPages<{ id: string; amazon_profile_id: string | null }>((from, to) =>
    supabase
      .from("campaigns")
      .select("id, amazon_profile_id")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const campaignIds = uniqueStrings(campaigns.map((row) => row.id));
  if (!campaignIds.length) return [];
  const profileByCampaign = new Map(
    campaigns.map((row) => [
      String(row.id ?? ""),
      row.amazon_profile_id ? String(row.amazon_profile_id) : null,
    ]),
  );

  const ranked: Array<{ id: string; spend: number; amazon_profile_id: string | null }> = [];
  for (const chunk of chunkArray(campaignIds, 300)) {
    const { data, error } = await supabase
      .from("search_terms")
      .select("id, total_spend, campaign_id")
      .in("campaign_id", chunk)
      .order("total_spend", { ascending: false })
      .limit(ADS_ENGINE_ENTITY_CAP);
    if (error) throw error;
    for (const row of data ?? []) {
      ranked.push({
        id: String(row.id),
        spend: Number(row.total_spend) || 0,
        amazon_profile_id: profileByCampaign.get(String(row.campaign_id ?? "")) ?? null,
      });
    }
  }
  ranked.sort((a, b) => b.spend - a.spend);
  const entities: AdsEngineEntityRef[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    entities.push({ id: row.id, amazon_profile_id: row.amazon_profile_id });
    if (entities.length >= ADS_ENGINE_ENTITY_CAP) break;
  }
  return entities;
}

async function fetchEntityDailyAggregateForProfiles(
  profileIds: string[],
  start: string,
  end: string,
  opts: {
    entityTable: "keywords" | "search_terms";
    metricsTable: "keyword_metrics" | "search_term_metrics";
    entityColumn: "keyword_id" | "search_term_id";
    moneyProfileIds?: readonly string[];
    displayCurrency?: string;
    profileCurrencyById?: ReadonlyMap<string, string> | Record<string, string>;
    fxRates?: Map<string, number>;
  },
): Promise<AdsEngineFunnelRange> {
  if (!profileIds.length || !start || !end) return { daily: [], entityCount: 0 };
  const entities = await fetchAdsEngineEntityIds(profileIds, opts.entityTable);
  if (!entities.length) return { daily: [], entityCount: 0 };
  const ids = entities.map((entity) => entity.id);
  const profileByEntity = new Map(
    entities.map((entity) => [entity.id, entity.amazon_profile_id]),
  );

  const rows: CampaignMetric[] = [];
  for (const chunk of chunkArray(ids, 80)) {
    const page = await fetchAllPages<any>((from, to) =>
      supabase
        .from(opts.metricsTable)
        .select(`date,impressions,clicks,orders,spend,sales,${opts.entityColumn}`)
        .in(opts.entityColumn, chunk)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .range(from, to),
    );
    for (const row of page) {
      const entityId = String(row[opts.entityColumn] ?? "");
      rows.push({
        id: `${entityId}-${row.date}`,
        campaign_id: entityId,
        date: String(row.date).slice(0, 10),
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        orders: Number(row.orders) || 0,
        spend: Number(row.spend) || 0,
        sales: Number(row.sales) || 0,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
        amazon_profile_id: profileByEntity.get(entityId) ?? null,
      });
    }
  }
  return {
    daily: aggregateDailyMetricsForDisplay(rows, {
      moneyProfileIds: opts.moneyProfileIds,
      displayCurrency: opts.displayCurrency,
      profileCurrencyById: opts.profileCurrencyById,
      fxRates: opts.fxRates,
    }),
    entityCount: ids.length,
  };
}

export type AdsEngineMoneyContext = {
  moneyProfileIds?: readonly string[];
  displayCurrency?: string;
  profileCurrencyById?: ReadonlyMap<string, string> | Record<string, string>;
  fxRates?: Map<string, number>;
};

/** Top keywords by spend — daily funnel for Ads Engine Keywords page. */
export async function fetchKeywordDailyAggregate(
  profileIds: string[],
  start: string,
  end: string,
  money?: AdsEngineMoneyContext,
): Promise<AdsEngineFunnelRange> {
  return fetchEntityDailyAggregateForProfiles(profileIds, start, end, {
    entityTable: "keywords",
    metricsTable: "keyword_metrics",
    entityColumn: "keyword_id",
    ...money,
  });
}

/** Top search terms by spend — daily funnel for Ads Engine Search terms page. */
export async function fetchSearchTermDailyAggregate(
  profileIds: string[],
  start: string,
  end: string,
  money?: AdsEngineMoneyContext,
): Promise<AdsEngineFunnelRange> {
  return fetchEntityDailyAggregateForProfiles(profileIds, start, end, {
    entityTable: "search_terms",
    metricsTable: "search_term_metrics",
    entityColumn: "search_term_id",
    ...money,
  });
}

function ruleAppliesToProfiles(rule: Pick<OptimizationRule, "amazon_profile_ids">, profileIds?: string[]): boolean {
  if (!profileIds) return true;
  if (!profileIds.length) return false;

  const ruleProfileIds = normalizeProfileIds(rule.amazon_profile_ids);
  if (!ruleProfileIds.length) return true;

  const selected = new Set(profileIds);
  return ruleProfileIds.some((id) => selected.has(id));
}

async function fetchRuleIdsForUser(userId: string, profileIds?: string[]): Promise<string[]> {
  const { data, error } = await supabase
    .from("optimization_rules")
    .select("id, amazon_profile_ids")
    .eq("user_id", userId);
  if (error) throw error;

  return uniqueStrings(
    ((data ?? []) as OptimizationRule[])
      .filter((rule) => ruleAppliesToProfiles(rule, profileIds))
      .map((rule) => rule.id),
  );
}

// ---------- Amazon Profiles (scoped to current user) ----------
// Checks all three linkage paths the schema supports so a logged-in user
// always sees every profile that belongs to them, regardless of which
// path was used to create the link:
//
//   Path A: auth.users → user_amazon_profiles → amazon_profiles
//   Path B: auth.users → user_user_profiles → user_profiles
//             → user_profiles_amazon_profiles → amazon_profiles
//   Path C: auth.users → user_campaigns → campaigns.amazon_profile_id
//             (fallback: at least surfaces profiles with active campaigns)
//
export async function fetchLinkedAmazonProfileIds(userId: string): Promise<string[]> {
  const [links, userProfileLinks, userCampaignLinks] = await Promise.all([
    fetchAllPages<any>((from, to) =>
      supabase
        .from("user_amazon_profiles")
        .select("amazon_profile_id")
        .eq("user_id", userId)
        .order("amazon_profile_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<any>((from, to) =>
      supabase
        .from("user_user_profiles")
        .select("user_profile_id")
        .eq("user_id", userId)
        .order("user_profile_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<any>((from, to) =>
      supabase
        .from("user_campaigns")
        .select("campaign_id")
        .eq("user_id", userId)
        .order("campaign_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const directIds = uniqueStrings(links.map((l: any) => l.amazon_profile_id));
  const userProfileIds = uniqueStrings(userProfileLinks.map((l: any) => l.user_profile_id));
  const campaignIds = uniqueStrings(userCampaignLinks.map((l: any) => l.campaign_id));

  const profileBridgeIds: string[] = [];
  for (const chunk of chunkArray(userProfileIds, BOOKS_IN_CHUNK)) {
    profileBridgeIds.push(
      ...(await fetchAllPages<any>((from, to) =>
        supabase
          .from("user_profiles_amazon_profiles")
          .select("amazon_profile_id")
          .in("user_profile_id", chunk)
          .order("amazon_profile_id", { ascending: true })
          .range(from, to),
      )).map((r: any) => r.amazon_profile_id),
    );
  }

  const campaignProfileIds: string[] = [];
  for (const chunk of chunkArray(campaignIds, BOOKS_IN_CHUNK)) {
    campaignProfileIds.push(
      ...(await fetchAllPages<any>((from, to) =>
        supabase
          .from("campaigns")
          .select("amazon_profile_id")
          .in("id", chunk)
          .order("amazon_profile_id", { ascending: true })
          .range(from, to),
      )).map((c: any) => c.amazon_profile_id),
    );
  }

  const resolved = uniqueStrings([...directIds, ...profileBridgeIds, ...campaignProfileIds]);
  debugDataScope("linked-profiles", {
    direct: directIds.length,
    bridged: profileBridgeIds.length,
    campaignDerived: campaignProfileIds.length,
    total: resolved.length,
  });
  return resolved;
}

// No signed-in user → no profiles. Do not select amazon_profiles unscoped
// (guest/anon must not see whatever RLS happens to allow).
export async function fetchAmazonProfiles(
  userId?: string | null,
  filterUserId?: string | null,
): Promise<AmazonProfile[]> {
  if (!userId) return [];

  // Nest resolves direct, account-bridge, and campaign ownership together.
  // Keep the customer scope explicit for admin viewing; a failed read must
  // surface as a failed read rather than presenting an empty account list.
  const profiles = await fetchNestAmazonProfiles(filterUserId);
  const withKdpCounts = await attachKdpAccountCountsFromBridge(profiles);
  return withKdpCounts.sort((a, b) => {
    const enabledDelta = Number(b.is_enabled === true) - Number(a.is_enabled === true);
    if (enabledDelta !== 0) return enabledDelta;
    const campaignDelta = (b.campaign_count ?? 0) - (a.campaign_count ?? 0);
    if (campaignDelta !== 0) return campaignDelta;
    return (a.nickname ?? a.account_name ?? a.profile_id).localeCompare(
      b.nickname ?? b.account_name ?? b.profile_id,
    );
  });
}

/** Fill `kdp_account_count` from Supabase bridge rows (Nest often hardcodes 0). */
async function attachKdpAccountCountsFromBridge(
  profiles: AmazonProfile[],
): Promise<AmazonProfile[]> {
  if (!profiles.length) return profiles;
  const profileIds = uniqueStrings(
    profiles.map((p) => String(p.profile_id || p.id || "").trim()),
  );
  if (!profileIds.length) return profiles;

  const links: Array<{
    kdp_account_id?: string | null;
    amazon_profile_id?: string | null;
    is_paused?: boolean | null;
  }> = [];
  try {
    for (const chunk of chunkArray(profileIds, BOOKS_IN_CHUNK)) {
      links.push(
        ...(await fetchAllPages((from, to) =>
          supabase
            .from("kdp_account_amazon_profiles")
            .select("kdp_account_id, amazon_profile_id, is_paused")
            .in("amazon_profile_id", chunk)
            .order("kdp_account_id", { ascending: true })
            .order("amazon_profile_id", { ascending: true })
            .range(from, to),
        )),
      );
    }
  } catch {
    // Keep Nest values if bridge read fails (Auth/RLS); do not blank the list.
    return profiles;
  }

  const counts = kdpAccountCountsByAmazonProfileId(links);
  return profiles.map((p) => {
    const id = String(p.profile_id || p.id || "").trim();
    const fromBridge = counts[id] ?? 0;
    if (fromBridge === (p.kdp_account_count ?? 0)) return p;
    return { ...p, kdp_account_count: fromBridge };
  });
}

export async function setUserAmazonProfileEnabled(
  userId: string,
  amazonProfileId: string,
  enabled: boolean,
): Promise<void> {
  const payload = {
    user_id: userId,
    amazon_profile_id: amazonProfileId,
    is_enabled: enabled,
  };

  const { data: updated, error: updateErr } = await supabase
    .from("user_amazon_profiles")
    .update({ is_enabled: enabled })
    .eq("user_id", userId)
    .eq("amazon_profile_id", amazonProfileId)
    .select("amazon_profile_id")
    .maybeSingle();
  if (updateErr) throw updateErr;
  if (updated) return;

  const { error: insertErr } = await supabase
    .from("user_amazon_profiles")
    .insert(payload);
  if (insertErr) throw insertErr;
}

// ---------- Campaigns ----------

export type CreationExistingCampaignRow = {
  id: string;
  name: string;
  state: string;
  kind: "auto" | "keywords" | "products" | "unknown";
  label: string;
};

/**
 * Active (enabled) campaigns advertising `asin` on ONE Ads profile.
 * Scoped via product_ads → campaigns so a wrong marketplace/country cannot leak in.
 */
export async function fetchActiveCampaignsForBookProfile(opts: {
  profileId: string;
  asin: string;
}): Promise<CreationExistingCampaignRow[]> {
  const profileId = String(opts.profileId || "").trim();
  const asin = String(opts.asin || "")
    .trim()
    .toUpperCase();
  if (!profileId || !/^[A-Z0-9]{10}$/.test(asin)) return [];

  const asinVariants = [...new Set([asin, asin.toLowerCase()])];
  const { data: ads, error: adsError } = await supabase
    .from("product_ads")
    .select("campaign_id, asin, status")
    .eq("amazon_profile_id", profileId)
    .in("asin", asinVariants)
    .in("status", ["enabled"]);
  if (adsError) throw adsError;

  const campaignIds = [
    ...new Set(
      (ads ?? [])
        .map((row) => String((row as { campaign_id?: string }).campaign_id || "").trim())
        .filter(Boolean),
    ),
  ];
  if (!campaignIds.length) return [];

  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select("id, name, state, targeting_type, amazon_profile_id")
    .in("id", campaignIds)
    .eq("amazon_profile_id", profileId)
    .eq("state", "enabled")
    .order("name", { ascending: true });
  if (campaignsError) throw campaignsError;
  if (!campaigns?.length) return [];

  const liveIds = campaigns.map((row) => String((row as { id: string }).id));
  const { data: adGroups, error: adGroupsError } = await supabase
    .from("ad_groups")
    .select("campaign_id, targeting_type, state")
    .in("campaign_id", liveIds)
    .eq("amazon_profile_id", profileId);
  if (adGroupsError) throw adGroupsError;

  const groupsByCampaign = new Map<string, string[]>();
  for (const row of adGroups ?? []) {
    const campaignId = String((row as { campaign_id?: string }).campaign_id || "").trim();
    if (!campaignId) continue;
    const state = String((row as { state?: string }).state || "").toLowerCase();
    if (state && state !== "enabled") continue;
    const list = groupsByCampaign.get(campaignId) ?? [];
    list.push(String((row as { targeting_type?: string }).targeting_type ?? ""));
    groupsByCampaign.set(campaignId, list);
  }

  const { classifyCreationCampaignTargeting } = await import(
    "./campaignCreationStock.ts"
  );

  return campaigns.map((row) => {
    const id = String((row as { id: string }).id);
    const classified = classifyCreationCampaignTargeting({
      campaignTargetingType: (row as { targeting_type?: string | null }).targeting_type,
      adGroupTargetingTypes: groupsByCampaign.get(id) ?? [],
    });
    return {
      id,
      name: String((row as { name?: string }).name || "Campaign"),
      state: String((row as { state?: string }).state || "enabled"),
      kind: classified.kind,
      label: classified.label,
    };
  });
}

export async function fetchCampaigns(
  profileIds: string[],
  opts: { search?: string; state?: string; type?: string; limit?: number } = {},
): Promise<Campaign[]> {
  if (!profileIds.length) return [];
  const buildQuery = (from?: number, to?: number) => {
    let q = supabase
      .from("campaigns")
      .select("*")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false });

    if (opts.state) q = q.eq("state", opts.state);
    if (opts.type) q = q.eq("type", opts.type);
    if (opts.search) q = q.ilike("name", `%${opts.search}%`);
    if (opts.limit) q = q.limit(opts.limit);
    else if (from != null && to != null) q = q.range(from, to);
    return q;
  };

  if (opts.limit) {
    const { data, error } = await buildQuery();
    if (error) throw error;
    return (data ?? []) as Campaign[];
  }

  return fetchAllPages<Campaign>((from, to) => buildQuery(from, to));
}

export async function fetchCampaignById(
  id: string,
  profileIds?: string[],
  filterUserId?: string | null,
): Promise<Campaign | null> {
  if (filterUserId && (await hasNestToken())) {
    return fetchNestCampaignById(id);
  }
  if (profileIds && !profileIds.length) return null;

  let q = supabase.from("campaigns").select("*").eq("id", id);
  if (profileIds) q = q.in("amazon_profile_id", profileIds);

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data as Campaign;
  if (await hasNestToken()) {
    try {
      return await fetchNestCampaignById(id);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------- Ad Groups ----------
export type AdGroupEnriched = AdGroup & {
  keyword_count: number;
  product_target_count: number; // real ASIN/category targets (manual)
  auto_target_count: number;    // auto-targeting clauses (loose/close match, etc.)
  is_auto: boolean;
};

// Amazon auto-targeting expression codes (stored in product_targets for auto ad groups)
const AUTO_EXPRESSION_TYPES = new Set([
  "queryhighrelmatches", "querybroadrelmatches", "asinaccessoryrelated", "asinsubstituterelated",
  "asinsubstitutes", "close-match", "loose-match", "complements", "substitutes",
]);

/** Matches Nest expressionTypesForTargetType — filter product_targets before the 500 cap. */
export type ProductTargetKind = "auto" | "asin" | "category";

const PRODUCT_TARGET_KIND_EXPRESSION_TYPES: Record<ProductTargetKind, string[]> = {
  auto: [
    "queryHighRelMatches",
    "QUERY_HIGH_REL_MATCHES",
    "queryBroadRelMatches",
    "QUERY_BROAD_REL_MATCHES",
    "asinSubstituteRelated",
    "ASIN_SUBSTITUTE_RELATED",
    "asinAccessoryRelated",
    "ASIN_ACCESSORY_RELATED",
    "close-match",
    "loose-match",
    "complements",
    "substitutes",
    "auto",
  ],
  asin: [
    "ASIN_SAME_AS",
    "asinSameAs",
    "ASIN_EXPANDED_FROM",
    "asinExpandedFrom",
    "ASIN_SUBSTITUTES_RELATED",
    "asinSubstitutesRelated",
    "ASIN_ACCESSORIES_RELATED",
    "asinAccessoriesRelated",
    "manual",
    "exact",
    "asin",
  ],
  category: ["ASIN_CATEGORY_SAME_AS", "asinCategorySameAs"],
};

function productTargetMatchesKind(row: ProductTarget, kind: ProductTargetKind): boolean {
  const described = describeProductTarget(row.expression, row.expression_type, row.resolved_expression);
  if (kind === "auto") return described.isAuto;
  if (kind === "category") {
    return isCategoryTarget(row.expression, row.expression_type) || described.label === "Category";
  }
  return !described.isAuto && !isCategoryTarget(row.expression, row.expression_type) && described.label !== "Category";
}

/** Lightweight ad-group default bids for targeting inheritance (auto close/loose/etc). */
export async function fetchAdGroupDefaultBids(profileIds: string[]): Promise<Record<string, number>> {
  if (!profileIds.length) return {};
  const rows = await fetchAllPages<{ id: string; default_bid: number | null }>((from, to) =>
    supabase
      .from("ad_groups")
      .select("id, default_bid")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const out: Record<string, number> = {};
  for (const row of rows) {
    const bid = Number(row.default_bid);
    if (!Number.isFinite(bid) || bid <= 0) continue;
    const id = String(row.id || "");
    if (!id) continue;
    out[id] = bid;
  }
  return out;
}

/** List fetch cap — same honesty as Campaigns/Targets (not an Amazon write ceiling). */
export const AD_GROUPS_LIST_LIMIT = 500;

export async function fetchAdGroups(
  profileIds: string[],
  campaignId?: string,
  range?: {
    start?: string;
    end?: string;
    state?: string;
    /** Cap rows. Default 500 for account-wide lists; omit/raise only when campaign-scoped. */
    limit?: number;
    /**
     * Scan keywords + product_targets for Keywords/Products/Auto badges.
     * Default: on for a single campaign (small), off for account-wide lists
     * (that scan hangs large accounts — use targeting_type for Auto instead).
     */
    enrichCounts?: boolean;
  },
): Promise<AdGroupEnriched[]> {
  if (!profileIds.length) return [];
  const limit =
    range?.limit != null
      ? range.limit
      : campaignId
        ? undefined
        : AD_GROUPS_LIST_LIMIT;
  const enrichCounts = range?.enrichCounts ?? Boolean(campaignId);

  let q = supabase
    .from("ad_groups")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });
  if (campaignId) q = q.eq("campaign_id", campaignId);
  if (range?.state) q = q.eq("state", range.state);
  if (limit != null) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as AdGroup[];
  const totals =
    range?.start && range?.end
      ? await fetchMetricTotalsByEntity(
          "ad_group_metrics",
          "ad_group_id",
          rows.map((row) => row.id),
          range.start,
          range.end,
        )
      : null;
  const enriched = rows.map((row) =>
    applyMetricTotals(row, totals ? totals.get(row.id) ?? emptyTotals() : undefined),
  );

  const adGroupIds = rows.map((r) => r.id);
  const kwCountMap = new Map<string, number>();
  const autoCountMap = new Map<string, number>(); // auto-targeting clauses
  const manualPtMap = new Map<string, number>(); // real ASIN/category targets

  // Account-wide keyword/product_target `.in(all ad group ids)` is the hang:
  // PostgREST caps / URL length + huge row sets. Only enrich when scoped/small.
  if (enrichCounts && adGroupIds.length && adGroupIds.length <= 120) {
    const chunkSize = 40;
    for (let i = 0; i < adGroupIds.length; i += chunkSize) {
      const chunk = adGroupIds.slice(i, i + chunkSize);
      const [kwRes, ptRes] = await Promise.all([
        supabase.from("keywords").select("ad_group_id").in("ad_group_id", chunk),
        supabase.from("product_targets").select("ad_group_id, expression_type").in("ad_group_id", chunk),
      ]);
      for (const row of kwRes.data ?? []) {
        const id = (row as { ad_group_id?: string }).ad_group_id;
        if (id) kwCountMap.set(id, (kwCountMap.get(id) ?? 0) + 1);
      }
      for (const row of ptRes.data ?? []) {
        const id = (row as { ad_group_id?: string }).ad_group_id;
        if (!id) continue;
        const expr = String((row as { expression_type?: string }).expression_type ?? "").toLowerCase();
        if (AUTO_EXPRESSION_TYPES.has(expr)) {
          autoCountMap.set(id, (autoCountMap.get(id) ?? 0) + 1);
        } else {
          manualPtMap.set(id, (manualPtMap.get(id) ?? 0) + 1);
        }
      }
    }
  }

  return enriched.map((row) => {
    const targetingType = String(row.targeting_type ?? "").toLowerCase();
    const autoCount = autoCountMap.get(row.id) ?? 0;
    const manualPt = manualPtMap.get(row.id) ?? 0;
    const kw = kwCountMap.get(row.id) ?? 0;
    const isAuto =
      targetingType === "auto" || (autoCount > 0 && manualPt === 0 && kw === 0);
    return {
      ...row,
      keyword_count: kw,
      product_target_count: manualPt,
      auto_target_count: autoCount,
      is_auto: isAuto,
    };
  });
}

// ---------- Keywords ----------
export async function fetchKeywords(
  profileIds: string[],
  opts: {
    campaignId?: string;
    /** Book filter: top spend within these campaigns (not global top-500). */
    campaignIds?: string[];
    adGroupId?: string;
    adGroupIds?: string[];
    matchType?: string;
    status?: string;
    limit?: number;
    search?: string;
    start?: string;
    end?: string;
    filterUserId?: string | null;
    /** Signed-in user — drop rows Nest would NotFound (missing user_campaigns). */
    ownerUserId?: string | null;
    /** Resume PostgREST walk for owned append pages (seller Active/Paused). */
    resumeFrom?: number;
  } = {},
): Promise<Keyword[]> {
  if (!profileIds.length) return [];
  const scopedAdGroupIds = uniqueStrings((opts.adGroupIds ?? []).map(String).filter(Boolean));
  if (opts.adGroupIds && scopedAdGroupIds.length === 0) return [];
  const scopedCampaignIds = uniqueStrings(
    (opts.campaignIds ?? []).map(String).filter(Boolean),
  );
  // Book / multi-campaign scope.
  // Active/Paused (or search): merge campaign chunks without fair-quota slice so Load more
  // can exhaust every matching keyword. Unfiltered "All" still fair-shares to keep first paint fast.
  // `limit` omitted ⇒ full catalog (Targets exhaust / advanced sort honesty).
  if (scopedCampaignIds.length > 0 && !opts.campaignId && !opts.adGroupId && !scopedAdGroupIds.length) {
    const exhaustAll = opts.limit == null;
    const limit = exhaustAll ? Number.POSITIVE_INFINITY : (opts.limit ?? TARGETING_LIST_LIMIT);
    const exhaustive = Boolean(opts.status || opts.search);
    if (exhaustive) {
      const byId = new Map<string, Keyword>();
      for (const chunk of chunkArray(scopedCampaignIds, 80)) {
        const buildScoped = (from: number, to: number) => {
          let q = supabase
            .from("keywords")
            .select("*")
            .in("amazon_profile_id", profileIds)
            .in("campaign_id", chunk)
            .order("total_spend", { ascending: false });
          if (opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
          if (opts.matchType) q = q.eq("match_type", opts.matchType);
          if (opts.status) q = q.eq("status", opts.status);
          if (opts.search) q = q.ilike("keyword_text", `%${opts.search}%`);
          return q.range(from, to);
        };
        const rows = exhaustAll
          ? await fetchAllPages<Keyword>(buildScoped)
          : await fetchLimitedOrderedRows<Keyword>(buildScoped, limit);
        for (const row of rows) byId.set(row.id, row);
      }
      let merged = [...byId.values()].sort(
        (a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0),
      );
      if (opts.ownerUserId && !opts.filterUserId) {
        merged = await restrictRowsToOwnedCampaigns(merged, opts.ownerUserId);
      }
      if (!exhaustAll) merged = merged.slice(0, limit);
      if (opts.start && opts.end) {
        try {
          const enrich = () =>
            fetchMetricTotalsByEntity(
              "keyword_metrics",
              "keyword_id",
              merged.map((row) => row.id),
              opts.start,
              opts.end,
            );
          // Bound enrich on every path — unbounded exhaust enrich used to abort the
          // whole catalog fetch (Incomplete · first page only) when metrics timed out.
          const totals = await withQueryTimeout(enrich(), TARGETING_PAGE_METRICS_BUDGET_MS);
          merged = merged.map((row) => {
            const period = totals.get(row.id);
            return period ? applyMetricTotals(row, period) : row;
          });
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn("[inteliads:targeting] keyword metrics enrichment failed", error);
          // Soft-degrade: keep lifetime totals so entity catalog + ACoS cascade still paint.
          // Do not abort remaining / already-fetched entities (Incomplete after page-1).
        }
      }
      return attachParentEntityStates(merged);
    }
    const per = Math.max(40, Math.ceil(limit / Math.min(scopedCampaignIds.length, 12)));
    const batches = await Promise.all(
      scopedCampaignIds.map((campaignId) =>
        fetchKeywords(profileIds, {
          ...opts,
          campaignId,
          campaignIds: undefined,
          limit: per,
        }),
      ),
    );
    const byId = new Map<string, Keyword>();
    for (const batch of batches) {
      for (const row of batch) byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
      .slice(0, limit);
  }
  // Multi-profile fair quota only for unfiltered "All".
  // Active/Paused must use one status-filtered query across profiles so Load more
  // can exhaust the catalog — fair share under-fills and hides Load more (silent truncate).
  if (
    opts.limit &&
    profileIds.length > 1 &&
    !opts.campaignId &&
    !opts.adGroupId &&
    !scopedAdGroupIds.length &&
    !opts.status
  ) {
    const per = Math.max(80, Math.ceil(opts.limit / profileIds.length));
    const batches = await Promise.all(
      profileIds.map((id) => fetchKeywords([id], { ...opts, limit: per })),
    );
    const byId = new Map<string, Keyword>();
    for (const batch of batches) {
      for (const row of batch) byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
      .slice(0, opts.limit);
  }
  // Active/Paused/search: prefer Supabase for sellers (period enrichment + Load more
  // exhaust). Nest is still used for unfiltered All / admin view-as, with a budget so
  // hangs cannot consume the whole Targeting timeout before fallback.
  // Nest per_page clamp is fixed in dashboardApi (NEST_TARGETING_MAX_PAGE_SIZE=200).
  const preferSupabaseKeywordExhaust =
    Boolean(opts.status || opts.search) && !opts.filterUserId;
  if (
    !scopedAdGroupIds.length &&
    !preferSupabaseKeywordExhaust &&
    (await hasNestToken()) &&
    isNestKeywordSortAvailable()
  ) {
    // Nest period-ranked lists for sellers + admin (web replacement path).
    // Sellers fall back to Supabase when Nest fails — TF 69 Nest-only blocked Targets.
    // After Nest 408/timeout, skip Nest for a cooldown so Load more does not hammer.
    try {
      const nestRows = await withQueryTimeout(
        fetchNestKeywords({
          filterUserId: opts.filterUserId ?? undefined,
          startDate: opts.start,
          endDate: opts.end,
          profileIds,
          campaignId: opts.campaignId,
          adGroupId: opts.adGroupId,
          matchType: opts.matchType,
          status: opts.status,
          search: opts.search,
          limit: opts.limit,
        }),
        NEST_TARGETING_LIST_BUDGET_MS,
      );
      // Nest list is already pivot-scoped for filterUserId; still attach parent state.
      return await attachParentEntityStates(nestRows);
    } catch (error) {
      if (opts.filterUserId) throw error;
      noteNestKeywordSortFailure(error);
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] Nest keywords failed; falling back to Supabase", error);
    }
  }
  const buildQuery = (from: number, to: number) => {
    let q = supabase
      .from("keywords")
      .select("*")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false });

    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
    if (scopedAdGroupIds.length) q = q.in("ad_group_id", scopedAdGroupIds);
    if (opts.matchType) q = q.eq("match_type", opts.matchType);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.search) q = q.ilike("keyword_text", `%${opts.search}%`);
    return q.range(from, to);
  };

  // Seller list is profile-scoped; Nest PATCH requires user_campaigns — hide dead IDs.
  // Walk-fill owned rows so trim cannot shrink below listCap and claim false Complete.
  let rows: Keyword[];
  if (opts.limit != null && opts.ownerUserId && !opts.filterUserId) {
    rows = await fetchOwnedLimitedOrderedRows<Keyword>(buildQuery, opts.limit, opts.ownerUserId, {
      resumeFrom: opts.resumeFrom,
    });
  } else if (opts.limit != null) {
    rows = await fetchLimitedOrderedRows<Keyword>(buildQuery, opts.limit);
  } else {
    rows = await fetchAllPages<Keyword>(buildQuery);
    if (opts.ownerUserId && !opts.filterUserId) {
      rows = await restrictRowsToOwnedCampaigns(rows, opts.ownerUserId);
    }
  }

  if (opts.start && opts.end) {
    const enrich = () =>
      fetchMetricTotalsByEntity(
        "keyword_metrics",
        "keyword_id",
        rows.map((row) => row.id),
        opts.start,
        opts.end,
      );
    try {
      // Bound enrich on paged + exhaust so metrics hang cannot abort entity fetch.
      const totals = await withQueryTimeout(enrich(), TARGETING_PAGE_METRICS_BUDGET_MS);
      // Only overlay rows that actually have period totals — empty map must not
      // zero out lifetime spend/ACoS (looks like "No spend yet" + Incomplete).
      rows = rows.map((row) => {
        const period = totals.get(row.id);
        return period ? applyMetricTotals(row, period) : row;
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] keyword metrics enrichment failed", error);
      // Soft-degrade: keep lifetime totals; never abort catalog for metrics timeout.
    }
  }
  return attachParentEntityStates(rows);
}

/**
 * Append-only Active/Paused keyword page for Plan A grow.
 * Fetches `limit` newly owned rows starting at `resumeFrom` — does not re-read prior pages
 * or re-enrich the whole catalog (97 timeout at ~3k from full-window re-fetch).
 */
export async function fetchKeywordsOwnedWindow(
  profileIds: string[],
  opts: {
    campaignId?: string;
    adGroupId?: string;
    matchType?: string;
    status?: string;
    search?: string;
    start?: string;
    end?: string;
    ownerUserId: string;
    limit: number;
    resumeFrom?: number;
    signal?: AbortSignal;
    seenIds?: Set<string>;
    owned?: Set<string>;
  },
): Promise<OwnedOrderedWindow<Keyword>> {
  if (!profileIds.length || !opts.ownerUserId || opts.limit <= 0) {
    return { rows: [], nextFrom: Math.max(0, opts.resumeFrom ?? 0), exhausted: true };
  }
  const buildQuery = (from: number, to: number) => {
    let q = supabase
      .from("keywords")
      .select("*")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false });
    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
    if (opts.matchType) q = q.eq("match_type", opts.matchType);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.search) q = q.ilike("keyword_text", `%${opts.search}%`);
    return q.range(from, to);
  };
  const window = await fetchOwnedOrderedWindow<Keyword>(
    buildQuery,
    opts.limit,
    opts.ownerUserId,
    {
      signal: opts.signal,
      resumeFrom: opts.resumeFrom,
      seenIds: opts.seenIds,
      owned: opts.owned,
    },
  );
  let rows = window.rows;
  if (opts.start && opts.end && rows.length) {
    try {
      const totals = await withQueryTimeout(
        fetchMetricTotalsByEntity(
          "keyword_metrics",
          "keyword_id",
          rows.map((row) => row.id),
          opts.start,
          opts.end,
        ),
        TARGETING_PAGE_METRICS_BUDGET_MS,
      );
      rows = rows.map((row) => {
        const period = totals.get(row.id);
        return period ? applyMetricTotals(row, period) : row;
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] keyword window metrics enrichment failed", error);
    }
  }
  const withParents = await attachParentEntityStates(rows);
  return {
    rows: withParents,
    nextFrom: window.nextFrom,
    exhausted: window.exhausted,
  };
}

/**
 * Campaign IDs the signed-in user can mutate via Nest (user_campaigns pivot).
 * List reads are profile-scoped and can surface rows Nest will NotFound on write.
 */
export async function fetchOwnedCampaignIds(userId: string): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await fetchAllPages<any>((from, to) =>
    supabase
      .from("user_campaigns")
      .select("campaign_id")
      .eq("user_id", userId)
      .order("campaign_id", { ascending: true })
      .range(from, to),
  );
  return new Set(uniqueStrings(rows.map((row) => String(row.campaign_id || "")).filter(Boolean)));
}

export async function restrictRowsToOwnedCampaigns<T extends { campaign_id?: string | null }>(
  rows: T[],
  ownerUserId: string | null | undefined,
): Promise<T[]> {
  if (!ownerUserId || !rows.length) return rows;
  const owned = await fetchOwnedCampaignIds(ownerUserId);
  // Empty pivot ⇒ every Nest manual write NotFound; hide unwritable IDs.
  if (!owned.size) return [];
  return rows.filter((row) => {
    const campaignId = String(row.campaign_id || "");
    return !campaignId || owned.has(campaignId);
  });
}

export type ParentEntityState = {
  campaign_state?: string | null;
  ad_group_state?: string | null;
};

/** Batch-attach parent campaign/ad-group state for Active-parent filtering. */
export async function attachParentEntityStates<
  T extends { campaign_id?: string | null; ad_group_id?: string | null },
>(rows: T[]): Promise<Array<T & ParentEntityState>> {
  if (!rows.length) return rows as Array<T & ParentEntityState>;
  const campaignIds = uniqueStrings(rows.map((row) => String(row.campaign_id || "")).filter(Boolean));
  const adGroupIds = uniqueStrings(rows.map((row) => String(row.ad_group_id || "")).filter(Boolean));
  const campaignState = new Map<string, string | null>();
  const adGroupState = new Map<string, string | null>();

  try {
    await Promise.all([
      ...chunkArray(campaignIds, 200).map(async (chunk) => {
        const { data, error } = await supabase.from("campaigns").select("id, state").in("id", chunk);
        if (error) throw error;
        for (const row of data ?? []) {
          campaignState.set(String((row as any).id), ((row as any).state as string | null) ?? null);
        }
      }),
      ...chunkArray(adGroupIds, 200).map(async (chunk) => {
        const { data, error } = await supabase.from("ad_groups").select("id, state").in("id", chunk);
        if (error) throw error;
        for (const row of data ?? []) {
          adGroupState.set(String((row as any).id), ((row as any).state as string | null) ?? null);
        }
      }),
    ]);
  } catch (error) {
    // Soft-degrade: parent state is filter polish — never blank Keywords/Targets.
    // eslint-disable-next-line no-console
    console.warn("[inteliads:targeting] attachParentEntityStates failed", error);
    return rows as Array<T & ParentEntityState>;
  }

  return rows.map((row) => ({
    ...row,
    campaign_state: campaignState.get(String(row.campaign_id || "")) ?? null,
    ad_group_state: row.ad_group_id
      ? (adGroupState.get(String(row.ad_group_id)) ?? null)
      : null,
  }));
}

export type CampaignSettingsCooldownRow = {
  id: string;
  rule_last_modified_at: string | null;
  placement_adj_last_modified_at: string | Record<string, string> | null;
  placement_adj_change_source: string | Record<string, string> | null;
  bidding_strategy: string | null;
};

export async function fetchCampaignSettingsCooldownRows(
  campaignIds: string[],
): Promise<Map<string, CampaignSettingsCooldownRow>> {
  const out = new Map<string, CampaignSettingsCooldownRow>();
  const ids = uniqueStrings(campaignIds.map(String).filter(Boolean));
  if (!ids.length) return out;
  for (const chunk of chunkArray(ids, 200)) {
    const { data, error } = await supabase
      .from("campaigns")
      .select(
        "id, bidding_strategy, rule_last_modified_at, placement_adj_last_modified_at, placement_adj_change_source",
      )
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String((row as any).id);
      const stamp = (row as any).placement_adj_last_modified_at;
      const source = (row as any).placement_adj_change_source;
      out.set(id, {
        id,
        bidding_strategy: ((row as any).bidding_strategy as string | null) ?? null,
        rule_last_modified_at: ((row as any).rule_last_modified_at as string | null) ?? null,
        placement_adj_last_modified_at:
          typeof stamp === "string" || (stamp && typeof stamp === "object") ? stamp : null,
        placement_adj_change_source:
          typeof source === "string" || (source && typeof source === "object") ? source : null,
      });
    }
  }
  return out;
}

export type EntityParentNames = {
  campaign_name?: string | null;
  ad_group_name?: string | null;
  /** Ad group default bid — Amazon auto targets often inherit this when `bid` is null. */
  default_bid?: number | null;
};

async function fetchParentNames(campaignId?: string | null, adGroupId?: string | null): Promise<EntityParentNames> {
  const [campaignRes, adGroupRes] = await Promise.all([
    campaignId
      ? supabase.from("campaigns").select("name").eq("id", campaignId).maybeSingle()
      : Promise.resolve({ data: null }),
    adGroupId
      ? supabase.from("ad_groups").select("name, default_bid").eq("id", adGroupId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const rawDefault = Number((adGroupRes.data as { default_bid?: number | null } | null)?.default_bid);
  return {
    campaign_name: (campaignRes.data as { name?: string } | null)?.name ?? null,
    ad_group_name: (adGroupRes.data as { name?: string } | null)?.name ?? null,
    default_bid: Number.isFinite(rawDefault) && rawDefault > 0 ? rawDefault : null,
  };
}

export async function fetchKeywordById(
  id: string,
  profileIds: string[],
  range?: { start: string; end: string },
  filterUserId?: string | null,
): Promise<(Keyword & EntityParentNames) | null> {
  if (filterUserId && (await hasNestToken())) {
    const nest = await fetchNestKeywordById(id, range);
    if (!nest || !range?.start || !range?.end) return nest;
    try {
      const totals = await fetchMetricTotalsByEntity(
        "keyword_metrics",
        "keyword_id",
        [id],
        range.start,
        range.end,
      );
      const period = totals.get(id);
      return period ? applyMetricTotals(nest, period) : nest;
    } catch {
      return nest;
    }
  }
  if (!id || !profileIds.length) return null;
  let q = supabase.from("keywords").select("*").eq("id", id).in("amazon_profile_id", profileIds);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const totals = await fetchMetricTotalsByEntity("keyword_metrics", "keyword_id", [id], range?.start, range?.end);
  const parents = await fetchParentNames((data as Keyword).campaign_id, (data as Keyword).ad_group_id);
  return {
    ...applyMetricTotals(data as Keyword, range?.start && range?.end ? totals.get(id) ?? emptyTotals() : undefined),
    ...parents,
  };
}

export async function fetchProductTargetById(
  id: string,
  profileIds: string[],
  range?: { start: string; end: string },
  filterUserId?: string | null,
): Promise<(ProductTarget & EntityParentNames) | null> {
  if (filterUserId && (await hasNestToken())) {
    const nest = await fetchNestProductTargetById(id, range);
    if (!nest) return null;
    let scoped = nest;
    if (range?.start && range?.end) {
      try {
        const totals = await fetchMetricTotalsByEntity(
          "product_target_metrics",
          "product_target_id",
          [id],
          range.start,
          range.end,
        );
        const period = totals.get(id);
        if (period) scoped = applyMetricTotals(nest, period);
      } catch {
        scoped = nest;
      }
    }
    const enrichIds = profileIds.length
      ? profileIds
      : [nest.amazon_profile_id].filter(Boolean);
    // Nest admin detail historically skipped cover/title enrichment (blank BookCover).
    const [enriched] = await enrichProductTargetDisplay([scoped], enrichIds);
    const base = enriched ?? scoped;
    // Same ad-group default bid inheritance as campaign Auto Targeting rows.
    const parents = await fetchParentNames(base.campaign_id, base.ad_group_id);
    return { ...base, ...parents };
  }
  if (!id || !profileIds.length) return null;
  const { data, error } = await supabase
    .from("product_targets")
    .select("*")
    .eq("id", id)
    .in("amazon_profile_id", profileIds)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const totals = await fetchMetricTotalsByEntity("product_target_metrics", "product_target_id", [id], range?.start, range?.end);
  const parents = await fetchParentNames((data as ProductTarget).campaign_id, (data as ProductTarget).ad_group_id);
  const withMetrics = {
    ...applyMetricTotals(data as ProductTarget, range?.start && range?.end ? totals.get(id) ?? emptyTotals() : undefined),
    ...parents,
  };
  // Same cover/title enrichment as the Targets list (ASIN ads → KDP titles → campaign product).
  const [enriched] = await enrichProductTargetDisplay([withMetrics], profileIds);
  return enriched ?? withMetrics;
}

export async function fetchSearchTermById(
  id: string,
  profileIds: string[],
  range?: { start: string; end: string },
): Promise<(SearchTerm & EntityParentNames) | null> {
  if (!id || !profileIds.length) return null;
  const { data, error } = await supabase.from("search_terms").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const campaignId = (data as SearchTerm).campaign_id;
  const campaign = campaignId ? await fetchCampaignById(campaignId, profileIds) : null;
  if (!campaign) return null;
  const totals = await fetchMetricTotalsByEntity("search_term_metrics", "search_term_id", [id], range?.start, range?.end);
  const parents = await fetchParentNames(campaignId, (data as SearchTerm).ad_group_id);
  return {
    ...applyMetricTotals(data as SearchTerm, range?.start && range?.end ? totals.get(id) ?? emptyTotals() : undefined),
    campaign_name: parents.campaign_name ?? campaign.name,
    ad_group_name: parents.ad_group_name,
  };
}

export type EntityDailyPoint = {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
};

export async function fetchEntityDailyMetrics(
  table: "keyword_metrics" | "product_target_metrics" | "search_term_metrics",
  entityColumn: "keyword_id" | "product_target_id" | "search_term_id",
  entityId: string,
  start: string,
  end: string,
): Promise<EntityDailyPoint[]> {
  if (!entityId || !start || !end) return [];
  const routes: Record<typeof table, { column: typeof entityColumn; path: string }> = {
    keyword_metrics: { column: "keyword_id", path: "keywords" },
    product_target_metrics: { column: "product_target_id", path: "product-targets" },
    search_term_metrics: { column: "search_term_id", path: "search-terms" },
  };
  const route = routes[table];
  if (route.column !== entityColumn) throw new Error("Invalid metric entity type.");
  const rows: Record<string, unknown>[] = [];
  // Nest verifies ownership and reads metric evidence with its service role.
  // The raw tables are deliberately unavailable to the mobile RLS role.
  for (let page = 1; page <= 50; page += 1) {
    const params = new URLSearchParams({
      startDate: start,
      endDate: end,
      sortBy: "date",
      sortOrder: "asc",
      per_page: "1000",
      page: String(page),
    });
    const result = await nestApiJson<{ data?: Record<string, unknown>[] }>(
      `/${route.path}/${encodeURIComponent(entityId)}/metrics?${params.toString()}`,
      { method: "GET" },
      "Couldn't load daily metrics.",
    );
    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < 1000) {
      return aggregateDailyMetrics(rows.map((row) => ({
        id: `${entityId}-${row.date}`,
        campaign_id: entityId,
        date: String(row.date).slice(0, 10),
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        orders: Number(row.orders) || 0,
        spend: Number(row.spend) || 0,
        sales: Number(row.sales) || 0,
        ctr: null,
        acos: null,
        roas: null,
        cpc: null,
        conversion_rate: null,
      })));
    }
  }
  throw new Error("Daily metrics exceed the supported page limit.");
}

// ---------- Product Targets ----------
export async function fetchProductTargets(
  profileIds: string[],
  opts: {
    campaignId?: string;
    /** Book filter: top spend within these campaigns (not global top-500). */
    campaignIds?: string[];
    adGroupId?: string;
    adGroupIds?: string[];
    state?: string;
    limit?: number;
    start?: string;
    end?: string;
    filterUserId?: string | null;
    /** Skip KDP title lookups — product_ads + campaign covers only (faster Category/Auto lists). */
    skipKdpEnrich?: boolean;
    /** Signed-in user — drop rows Nest would NotFound (missing user_campaigns). */
    ownerUserId?: string | null;
    /**
     * Targets tab segment — fetch top-N within this kind so Auto/Category are not
     * starved by ASIN-heavy lifetime spend ranking.
     */
    targetKind?: ProductTargetKind;
  } = {},
): Promise<ProductTarget[]> {
  if (!profileIds.length) return [];
  const scopedAdGroupIds = uniqueStrings((opts.adGroupIds ?? []).map(String).filter(Boolean));
  if (opts.adGroupIds && scopedAdGroupIds.length === 0) return [];
  const scopedCampaignIds = uniqueStrings(
    (opts.campaignIds ?? []).map(String).filter(Boolean),
  );
  // Book / multi-campaign scope — Active/Paused exhausts via campaign IN chunks (no fair-quota hide).
  // `limit` omitted ⇒ full kind catalog for Targets exhaust honesty.
  if (scopedCampaignIds.length > 0 && !opts.campaignId && !opts.adGroupId && !scopedAdGroupIds.length) {
    const exhaustAll = opts.limit == null;
    const limit = exhaustAll ? Number.POSITIVE_INFINITY : (opts.limit ?? TARGETING_LIST_LIMIT);
    const exhaustive = Boolean(opts.state);
    if (exhaustive) {
      const kindTypes = opts.targetKind ? PRODUCT_TARGET_KIND_EXPRESSION_TYPES[opts.targetKind] : null;
      const byId = new Map<string, ProductTarget>();
      const fetchLimit = opts.targetKind && !exhaustAll ? limit * 3 : limit;
      for (const chunk of chunkArray(scopedCampaignIds, 80)) {
        const buildScoped = (from: number, to: number) => {
          let q = supabase
            .from("product_targets")
            .select("*")
            .in("amazon_profile_id", profileIds)
            .in("campaign_id", chunk)
            .order("total_spend", { ascending: false });
          if (opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
          if (opts.state) q = q.eq("state", opts.state);
          if (kindTypes?.length) q = q.in("expression_type", kindTypes);
          return q.range(from, to);
        };
        const rows = exhaustAll
          ? await fetchAllPages<ProductTarget>(buildScoped)
          : await fetchLimitedOrderedRows<ProductTarget>(buildScoped, fetchLimit);
        for (const row of rows) byId.set(row.id, row);
      }
      let merged = [...byId.values()].sort(
        (a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0),
      );
      if (opts.targetKind) {
        merged = merged.filter((row) => productTargetMatchesKind(row, opts.targetKind!));
        if (!exhaustAll) merged = merged.slice(0, limit);
      } else if (!exhaustAll) {
        merged = merged.slice(0, limit);
      }
      if (opts.ownerUserId && !opts.filterUserId) {
        merged = await restrictRowsToOwnedCampaigns(merged, opts.ownerUserId);
      }
      let totals = new Map<string, MetricsTotals>();
      if (opts.start && opts.end) {
        try {
          totals = await withQueryTimeout(
            fetchMetricTotalsByEntity(
              "product_target_metrics",
              "product_target_id",
              merged.map((row) => row.id),
              opts.start,
              opts.end,
            ),
            TARGETING_PAGE_METRICS_BUDGET_MS,
          );
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn("[inteliads:targeting] product target metrics enrichment failed", error);
          // Soft-degrade: keep lifetime totals; do not abort entity catalog.
        }
      }
      const enriched = merged.map((row) => {
        const period = totals.get(row.id);
        return period ? applyMetricTotals(row, period) : row;
      });
      const displayed = await enrichProductTargetDisplay(enriched, profileIds, {
        skipKdp: opts.skipKdpEnrich === true,
      });
      return attachParentEntityStates(displayed);
    }
    const per = Math.max(40, Math.ceil(limit / Math.min(scopedCampaignIds.length, 12)));
    const batches = await Promise.all(
      scopedCampaignIds.map((campaignId) =>
        fetchProductTargets(profileIds, {
          ...opts,
          campaignId,
          campaignIds: undefined,
          limit: per,
        }),
      ),
    );
    const byId = new Map<string, ProductTarget>();
    for (const batch of batches) {
      for (const row of batch) byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
      .slice(0, limit);
  }
  // Multi-profile fair quota only for unfiltered "All" — Active/Paused uses one
  // state-filtered query so Load more can exhaust the catalog.
  if (
    opts.limit &&
    profileIds.length > 1 &&
    !opts.campaignId &&
    !opts.adGroupId &&
    !scopedAdGroupIds.length &&
    !opts.state
  ) {
    const per = Math.max(80, Math.ceil(opts.limit / profileIds.length));
    const batches = await Promise.all(
      profileIds.map((id) => fetchProductTargets([id], { ...opts, limit: per })),
    );
    const byId = new Map<string, ProductTarget>();
    for (const batch of batches) {
      for (const row of batch) byId.set(row.id, row);
    }
    return [...byId.values()]
      .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
      .slice(0, opts.limit);
  }
  // Kind-scoped Active/Paused (ASIN/Auto/Category): Supabase expression_type filter is
  // the honesty path — Nest targetType gaps caused Auto Complete · 72 vs DB 128.
  // Unfiltered product lists still try Nest (budgeted) first.
  const preferSupabaseProductKindExhaust =
    Boolean(opts.state && opts.targetKind) && !opts.filterUserId;
  if (!scopedAdGroupIds.length && !preferSupabaseProductKindExhaust && (await hasNestToken())) {
    try {
      const nestRows = await withQueryTimeout(
        fetchNestProductTargets({
          filterUserId: opts.filterUserId ?? undefined,
          startDate: opts.start,
          endDate: opts.end,
          profileIds,
          campaignId: opts.campaignId,
          adGroupId: opts.adGroupId,
          state: opts.state,
          limit: opts.limit,
        }),
        NEST_TARGETING_LIST_BUDGET_MS,
      );
      const kindFiltered = opts.targetKind
        ? nestRows.filter((row) => productTargetMatchesKind(row, opts.targetKind!))
        : nestRows;
      const enriched = await enrichProductTargetDisplay(kindFiltered, profileIds, {
        skipKdp: opts.skipKdpEnrich === true,
      });
      return await attachParentEntityStates(enriched);
    } catch (error) {
      if (opts.filterUserId) throw error;
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] Nest product targets failed; falling back to Supabase", error);
    }
  }
  const kindTypes = opts.targetKind ? PRODUCT_TARGET_KIND_EXPRESSION_TYPES[opts.targetKind] : null;
  const buildQuery = (from: number, to: number) => {
    let q = supabase
      .from("product_targets")
      .select("*")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false });

    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
    if (scopedAdGroupIds.length) q = q.in("ad_group_id", scopedAdGroupIds);
    if (opts.state) q = q.eq("state", opts.state);
    if (kindTypes?.length) q = q.in("expression_type", kindTypes);
    return q.range(from, to);
  };

  let rows: ProductTarget[];
  if (opts.limit) {
    // Oversample when kind-filtering — expression_type codes vary; client verifies.
    // Ownership: walk-fill so trim cannot hide Load more / false-Complete.
    if (opts.ownerUserId && !opts.filterUserId && !opts.targetKind) {
      rows = await fetchOwnedLimitedOrderedRows<ProductTarget>(
        buildQuery,
        opts.limit,
        opts.ownerUserId,
      );
    } else {
      const kindMul = opts.targetKind ? 3 : 1;
      const ownerMul = opts.ownerUserId && !opts.filterUserId ? 3 : 1;
      const fetchLimit = Math.min(opts.limit * Math.max(kindMul, ownerMul), Math.max(opts.limit, 1500));
      rows = await fetchLimitedOrderedRows<ProductTarget>(buildQuery, fetchLimit);
      if (opts.targetKind) {
        rows = rows.filter((row) => productTargetMatchesKind(row, opts.targetKind!));
      }
      if (opts.ownerUserId && !opts.filterUserId) {
        rows = await restrictRowsToOwnedCampaigns(rows, opts.ownerUserId);
      }
      rows = rows.slice(0, opts.limit);
    }
  } else {
    rows = await fetchAllPages<ProductTarget>(buildQuery);
    if (opts.targetKind) {
      rows = rows.filter((row) => productTargetMatchesKind(row, opts.targetKind!));
    }
    if (opts.ownerUserId && !opts.filterUserId) {
      rows = await restrictRowsToOwnedCampaigns(rows, opts.ownerUserId);
    }
  }

  let totals = new Map<string, MetricsTotals>();
  if (opts.start && opts.end) {
    try {
      const enrich = () =>
        fetchMetricTotalsByEntity(
          "product_target_metrics",
          "product_target_id",
          rows.map((row) => row.id),
          opts.start,
          opts.end,
        );
      // Bound enrich on paged + exhaust — metrics timeout must not abort catalog.
      totals = await withQueryTimeout(enrich(), TARGETING_PAGE_METRICS_BUDGET_MS);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[inteliads:targeting] product target metrics enrichment failed", error);
      // Soft-degrade: keep lifetime totals so ACoS cascade can still paint.
    }
  }
  const enriched = rows.map((row) => {
    const period = totals.get(row.id);
    return period ? applyMetricTotals(row, period) : row;
  });
  const displayed = await enrichProductTargetDisplay(enriched, profileIds, {
    skipKdp: opts.skipKdpEnrich === true,
  });
  return attachParentEntityStates(displayed);
}

/** Shared ASIN key for retail title fill + Targets merge — keep UI and queries in sync. */
export function productTargetDisplayAsin(row: ProductTarget): string {
  return (
    extractTargetAsin(row.resolved_expression) ||
    extractTargetAsin(row.expression) ||
    extractAsinFromExpression(row.expression) ||
    ""
  ).toUpperCase();
}

function productTargetNeedsDisplayMeta(row: ProductTarget): boolean {
  return !row.image_url || !isUsableBookTitle(row.title);
}

function applyProductTargetDisplayMeta(
  row: ProductTarget,
  match: { title?: string | null; image_url?: string | null } | null | undefined,
): void {
  if (!match) return;
  if (!row.image_url && match.image_url) (row as any).image_url = pickUsableCoverUrl(match.image_url);
  // Overwrite blank / ASIN-as-title placeholders so heading can use the real name.
  if (!isUsableBookTitle(row.title) && isUsableBookTitle(match.title)) {
    (row as any).title = String(match.title).trim();
  }
}

/**
 * Post-paint retail title fill for Targets → ASINs (and product rows on Auto/Category).
 * Page load uses skipRetail so the spinner never hangs; this finishes competitor
 * titles after the list is already visible. Mutates row copies — callers patch
 * React Query cache with the returned array.
 */
export async function fillMissingProductTargetTitlesFromRetail(
  rows: ProductTarget[],
  opts: {
    countryCode?: string | null;
    signal?: AbortSignal;
    /** Cap per wave so we never re-block the UI thread for minutes. */
    maxAsins?: number;
  } = {},
): Promise<{ rows: ProductTarget[]; filled: number }> {
  if (!rows.length) return { rows, filled: 0 };
  if (opts.signal?.aborted) return { rows, filled: 0 };

  const need: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const asin = productTargetDisplayAsin(row);
    if (!asin || isUsableBookTitle(row.title)) continue;
    const key = asin.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    need.push(asin);
  }
  const maxAsins = Math.max(1, Math.floor(opts.maxAsins ?? 60));
  const wave = need.slice(0, maxAsins);
  if (!wave.length) return { rows, filled: 0 };

  const { fetchAmazonRetailTitles } = await import("./amazonCampaignSuggestions");
  const primaryCc = opts.countryCode ? String(opts.countryCode).trim().toUpperCase() : "US";
  const titles = await fetchAmazonRetailTitles(wave, {
    concurrency: 3,
    retries: 2,
    timeoutMs: 10_000,
    countryCode: primaryCc,
  });
  // US+CA (and similar): retry missing on the sibling .com/.ca host.
  const stillNeed = wave.filter((asin) => !titles.has(asin.toUpperCase()) && !titles.has(asin));
  if (stillNeed.length && !opts.signal?.aborted) {
    const altCc =
      primaryCc === "CA" ? "US" : primaryCc === "US" ? "CA" : null;
    if (altCc) {
      const alt = await fetchAmazonRetailTitles(stillNeed, {
        concurrency: 3,
        retries: 2,
        timeoutMs: 10_000,
        countryCode: altCc,
      });
      for (const [asin, title] of alt) {
        if (!titles.has(asin)) titles.set(asin, title);
      }
    }
  }
  if (opts.signal?.aborted || !titles.size) return { rows, filled: 0 };

  let filled = 0;
  const next = rows.map((row) => {
    const asin = productTargetDisplayAsin(row);
    if (!asin || isUsableBookTitle(row.title)) return row;
    const title =
      titles.get(asin.toUpperCase()) ??
      titles.get(asin) ??
      null;
    if (!isUsableBookTitle(title)) return row;
    filled += 1;
    return { ...row, title: String(title).trim() };
  });
  return { rows: next, filled };
}

/** Fill missing book title/cover for ASINs; for Auto/Category use the campaign's advertised product. */
export async function enrichProductTargetDisplay(
  enriched: ProductTarget[],
  profileIds: string[],
  opts: { skipKdp?: boolean; skipRetail?: boolean; skipRemoteGapFill?: boolean } = {},
): Promise<ProductTarget[]> {
  if (!enriched.length || !profileIds.length) return enriched;

  const rowsNeedingAsinData = enriched.filter((row) => productTargetNeedsDisplayMeta(row));
  if (rowsNeedingAsinData.length) {
    const extractedAsins = uniqueStrings(
      rowsNeedingAsinData.map((row) => productTargetDisplayAsin(row)).filter(Boolean),
    );
    if (extractedAsins.length) {
      const { data: adImages } = await supabase
        .from("product_ads")
        .select("asin, image_url, title")
        .in("amazon_profile_id", profileIds)
        .in("asin", extractedAsins);
      if (adImages) {
        const imageByAsin = new Map(
          (adImages as any[]).map((a) => [
            String(a.asin ?? "").toUpperCase(),
            { image_url: a.image_url as string | null, title: a.title as string | null },
          ]),
        );
        for (const row of enriched) {
          const asin = productTargetDisplayAsin(row);
          applyProductTargetDisplayMeta(row, asin ? imageByAsin.get(asin.toUpperCase()) : null);
        }
      }

      const stillMissing = enriched.filter((row) => {
        const asin = productTargetDisplayAsin(row);
        return asin && productTargetNeedsDisplayMeta(row);
      });
      // skipKdp was meant for Category/Auto campaign-cover lookups. ASIN rows
      // still need kdp_titles — otherwise Targets → ASINs shows bare ASIN codes.
      const asinStillMissing = stillMissing.filter((row) => Boolean(productTargetDisplayAsin(row)));
      const shouldLookupKdp = asinStillMissing.length > 0 || (stillMissing.length > 0 && !opts.skipKdp);
      if (shouldLookupKdp) {
        const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
        if (kdpAccountIds.length) {
          const { data: kdpTitles } = await supabase
            .from("kdp_titles")
            .select("asin, title, cover_url, amazon_image_url")
            .in("account_id", kdpAccountIds)
            .in("asin", extractedAsins);

          if (kdpTitles) {
            const titleByAsin = new Map<string, { title: string | null; image_url: string | null }>();
            for (const title of kdpTitles as any[]) {
              const asin = String(title.asin ?? "").toUpperCase();
              const existing = titleByAsin.get(asin);
              titleByAsin.set(asin, {
                title: existing?.title ?? title.title ?? null,
                image_url: pickUsableCoverUrl(existing?.image_url, title.cover_url, title.amazon_image_url),
              });
            }
            for (const row of enriched) {
              const asin = productTargetDisplayAsin(row);
              // When skipKdp, only fill rows that are product ASINs (not auto/category).
              if (opts.skipKdp && !asin) continue;
              applyProductTargetDisplayMeta(row, asin ? titleByAsin.get(asin.toUpperCase()) : null);
            }
          }
        }
      }

      // Competitor / non-owned ASINs: amazon_catalog (never invent titles).
      const catalogNeed = uniqueStrings(
        enriched
          .filter((row) => {
            const asin = productTargetDisplayAsin(row);
            return asin && productTargetNeedsDisplayMeta(row);
          })
          .map((row) => productTargetDisplayAsin(row)),
      );
      if (catalogNeed.length) {
        const { data: catalogRows } = await supabase
          .from("amazon_catalog")
          .select("asin, title, image_url")
          .in("asin", catalogNeed)
          .not("title", "is", null)
          .neq("title", "")
          .limit(Math.min(catalogNeed.length * 3, 800));
        if (catalogRows?.length) {
          const byAsin = new Map<string, { title: string | null; image_url: string | null }>();
          for (const row of catalogRows as any[]) {
            const asin = String(row.asin ?? "").toUpperCase();
            if (!asin) continue;
            const existing = byAsin.get(asin);
            // Prefer a usable bibliographic title over ASIN-as-title catalog noise.
            const nextTitle = isUsableBookTitle(row.title)
              ? String(row.title).trim()
              : existing?.title ?? null;
            byAsin.set(asin, {
              title: isUsableBookTitle(existing?.title) ? existing!.title : nextTitle,
              image_url: pickUsableCoverUrl(existing?.image_url, row.image_url),
            });
          }
          for (const row of enriched) {
            const asin = productTargetDisplayAsin(row);
            applyProductTargetDisplayMeta(row, asin ? byAsin.get(asin.toUpperCase()) : null);
          }
        }
      }

      // product_ads / amazon_catalog are often RLS-blocked on the client; kdp_titles
      // only covers owned ASINs. Gap-fill remaining Exact/Expanded titles the same
      // way Create does (Open Library + optional retail). Targets page load passes
      // skipRetail: true so retail HTML never blocks the list spinner.
      if (!opts.skipRemoteGapFill) {
        const gapAsins = uniqueStrings(
          enriched
            .filter((row) => {
              const asin = productTargetDisplayAsin(row);
              return asin && !isUsableBookTitle(row.title);
            })
            .map((row) => productTargetDisplayAsin(row)),
        );
        if (gapAsins.length) {
          try {
            const { fetchAsinDisplayMeta } = await import("./amazonCampaignSuggestions");
            const applyMeta = (
              meta: Map<string, { title?: string | null; coverUrl?: string | null }>,
            ) => {
              for (const row of enriched) {
                const asin = productTargetDisplayAsin(row);
                if (!asin || isUsableBookTitle(row.title)) continue;
                const key = asin.toUpperCase();
                const hit = meta.get(key) ?? meta.get(asin);
                if (!hit) continue;
                applyProductTargetDisplayMeta(row, {
                  title: hit.title,
                  image_url: hit.coverUrl,
                });
              }
            };
            applyMeta(
              await fetchAsinDisplayMeta({
                asins: gapAsins,
                profileIds,
                skipRetail: true,
              }),
            );
            if (!opts.skipRetail) {
              const stillGap = uniqueStrings(
                enriched
                  .filter((row) => {
                    const asin = productTargetDisplayAsin(row);
                    return asin && !isUsableBookTitle(row.title);
                  })
                  .map((row) => productTargetDisplayAsin(row)),
              );
              const RETAIL_CHUNK = 40;
              for (let i = 0; i < stillGap.length; i += RETAIL_CHUNK) {
                const slice = stillGap.slice(i, i + RETAIL_CHUNK);
                applyMeta(
                  await fetchAsinDisplayMeta({
                    asins: slice,
                    profileIds,
                    skipRetail: false,
                  }),
                );
              }
            }
          } catch {
            // Soft-degrade: keep CDN covers; titles may stay "Title unavailable".
          }
        }
      }
    }
  }

  // Auto / Category only (no product ASIN): cover + title from the campaign's advertised product.
  // Never paint a product-ASIN row with the sponsored book — resolve that ASIN or leave bare.
  // Title is display-only for covers; Auto/Category headings use the targeting label only.
  const stillNeedCampaignCover = enriched.filter((row) => {
    if (row.image_url && isUsableBookTitle(row.title)) return false;
    return !productTargetDisplayAsin(row);
  });
  if (stillNeedCampaignCover.length) {
    const campaignIds = uniqueStrings(
      stillNeedCampaignCover.map((row) => row.campaign_id).filter(Boolean) as string[],
    );
    if (campaignIds.length) {
      const { data: campaignAds } = await supabase
        .from("product_ads")
        .select("campaign_id, asin, image_url, title")
        .in("amazon_profile_id", profileIds)
        .in("campaign_id", campaignIds);
      if (campaignAds?.length) {
        const byCampaign = new Map<
          string,
          { asin: string | null; image_url: string | null; title: string | null }
        >();
        for (const ad of campaignAds as any[]) {
          const campaignId = String(ad.campaign_id ?? "");
          if (!campaignId) continue;
          const current = byCampaign.get(campaignId);
          const next = {
            asin: ad.asin ? String(ad.asin).toUpperCase() : null,
            image_url: pickUsableCoverUrl(ad.image_url as string | null) ?? null,
            title: isUsableBookTitle(ad.title) ? String(ad.title).trim() : null,
          };
          if (!current) {
            byCampaign.set(campaignId, next);
            continue;
          }
          // Prefer the first ad that actually has a cover or title.
          if (!current.image_url && next.image_url) current.image_url = next.image_url;
          if (!isUsableBookTitle(current.title) && next.title) current.title = next.title;
          if (!current.asin && next.asin) current.asin = next.asin;
        }

        const missingCoverAsins = uniqueStrings(
          Array.from(byCampaign.values())
            .filter((v) => v.asin && (!v.image_url || !isUsableBookTitle(v.title)))
            .map((v) => v.asin as string),
        );
        if (missingCoverAsins.length) {
          const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
          if (kdpAccountIds.length) {
            const { data: kdpTitles } = await supabase
              .from("kdp_titles")
              .select("asin, title, cover_url, amazon_image_url")
              .in("account_id", kdpAccountIds)
              .in("asin", missingCoverAsins);
            for (const title of kdpTitles ?? []) {
              const asin = String((title as any).asin ?? "").toUpperCase();
              for (const meta of byCampaign.values()) {
                if (meta.asin !== asin) continue;
                if (!meta.image_url) {
                  meta.image_url = pickUsableCoverUrl((title as any).cover_url, (title as any).amazon_image_url);
                }
                if (!isUsableBookTitle(meta.title) && isUsableBookTitle((title as any).title)) {
                  meta.title = String((title as any).title).trim();
                }
              }
            }
          }
        }

        for (const row of enriched) {
          if (productTargetDisplayAsin(row)) continue;
          if (row.image_url && isUsableBookTitle(row.title)) continue;
          const meta = row.campaign_id ? byCampaign.get(row.campaign_id) : null;
          if (!meta) continue;
          applyProductTargetDisplayMeta(row, meta);
          if (!(row as any).cover_asin && meta.asin) {
            (row as any).cover_asin = meta.asin;
          }
        }
      }
    }
  }

  return enriched;
}

/**
 * Placement RPC rows often omit book_* — fill from product_ads without inventing
 * ASINs or titles. Covers use real product_ads / KDP URLs only.
 */
export async function enrichPlacementPageBookCovers(
  rows: Array<Record<string, unknown>>,
  profileIds: string[],
): Promise<Array<Record<string, unknown>>> {
  if (!rows.length || !profileIds.length) return rows;

  const need = rows.filter((row) => {
    const asin = String(row.book_asin ?? "").trim();
    const image = String(row.book_image_url ?? "").trim();
    const title = String(row.book_title ?? "").trim();
    return !asin || !image || !title;
  });
  if (!need.length) return rows;

  const campaignIds = uniqueStrings(
    need.map((row) => {
      const id = String(row.campaign_id || row.id || "");
      return id.includes("::") ? id.split("::")[0] : id;
    }),
  );
  if (!campaignIds.length) return rows;

  const { data: campaignAds } = await supabase
    .from("product_ads")
    .select("campaign_id, asin, image_url, title")
    .in("amazon_profile_id", profileIds)
    .in("campaign_id", campaignIds);
  if (!campaignAds?.length) return rows;

  const byCampaign = new Map<
    string,
    { asin: string | null; image_url: string | null; title: string | null }
  >();
  for (const ad of campaignAds as any[]) {
    const campaignId = String(ad.campaign_id ?? "");
    if (!campaignId) continue;
    const current = byCampaign.get(campaignId);
    const next = {
      asin: ad.asin ? String(ad.asin).toUpperCase() : null,
      image_url: pickUsableCoverUrl(ad.image_url as string | null) ?? null,
      title: (ad.title as string | null) ?? null,
    };
    if (!current) {
      byCampaign.set(campaignId, next);
      continue;
    }
    if (!current.image_url && next.image_url) current.image_url = next.image_url;
    if (!current.title && next.title) current.title = next.title;
    if (!current.asin && next.asin) current.asin = next.asin;
  }

  const missingAsins = uniqueStrings(
    [...byCampaign.values()].filter((v) => v.asin && (!v.image_url || !v.title)).map((v) => v.asin as string),
  );
  if (missingAsins.length) {
    const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
    if (kdpAccountIds.length) {
      const { data: kdpTitles } = await supabase
        .from("kdp_titles")
        .select("asin, title, cover_url, amazon_image_url")
        .in("account_id", kdpAccountIds)
        .in("asin", missingAsins);
      for (const title of kdpTitles ?? []) {
        const asin = String((title as any).asin ?? "").toUpperCase();
        for (const meta of byCampaign.values()) {
          if (meta.asin !== asin) continue;
          if (!meta.image_url) {
            meta.image_url = pickUsableCoverUrl((title as any).cover_url, (title as any).amazon_image_url);
          }
          if (!meta.title && (title as any).title) meta.title = (title as any).title;
        }
      }
    }
  }

  return rows.map((row) => {
    const rawId = String(row.campaign_id || row.id || "");
    const campaignId = rawId.includes("::") ? rawId.split("::")[0] : rawId;
    const meta = campaignId ? byCampaign.get(campaignId) : null;
    if (!meta) return row;
    return {
      ...row,
      book_asin: String(row.book_asin || meta.asin || "")
        .trim()
        .toUpperCase() || null,
      book_title: String(row.book_title || meta.title || "").trim() || null,
      book_image_url: String(row.book_image_url || meta.image_url || "").trim() || null,
    };
  });
}

export type TargetingBookOption = {
  asin: string;
  title: string;
  image_url: string | null;
  campaignIds: string[];
  campaignCount?: number;
  /** Real KDP royalty/daily evidence — not catalog-title-only. */
  hasKdpData?: boolean;
  /** Nest Create / purchased in-stock shelf. */
  inStock?: boolean;
  formatAsins?: string[];
  groupKey?: string | null;
};

/**
 * Books for Targets / Campaigns filter sheets (default) or create-style pickers.
 *
 * Targets (`purpose: "targets"`, default):
 *   Books with **enabled campaign activity** only. KDP daily rows enrich
 *   titles/covers + format siblings for parent rollup, then eligibility drops
 *   anything without campaign IDs — empty published / stock-only stay out.
 *
 * Create (`purpose: "create"`):
 *   Nest in-stock shelf **and** (meaningful KDP signal **or** Ads campaign
 *   activity). Stock-only empties and KDP/Ads-only without stock stay out.
 *
 * Nest `GET /campaigns/books` is profile-scoped for campaign IDs. Always union
 * Nest + local enabled campaigns + KDP — never return Nest alone.
 */
export async function fetchTargetingBookOptions(
  profileIds: string[],
  limitOrOpts:
    | number
    | {
        limit?: number;
        filterUserId?: string | null;
        purpose?: TargetingBookEligibilityContext;
      } = 0,
): Promise<TargetingBookOption[]> {
  if (!profileIds.length) return [];
  const opts =
    typeof limitOrOpts === "number"
      ? { limit: limitOrOpts, purpose: "targets" as const }
      : {
          limit: limitOrOpts.limit ?? 0,
          filterUserId: limitOrOpts.filterUserId,
          purpose: limitOrOpts.purpose ?? "targets",
        };
  const limit = opts.limit ?? 0;
  const purpose: TargetingBookEligibilityContext = opts.purpose ?? "targets";

  const finish = (books: TargetingBookOption[]) => {
    const eligible = selectEligibleTargetingBookOptions(books, purpose).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    return limit > 0 ? eligible.slice(0, limit) : eligible;
  };

  // Nest `/campaigns/books` is authoritative for campaign IDs when it works, but
  // it is often incomplete. Always union Nest + local enabled campaigns + KDP
  // — never return Nest alone (including successful empty payloads).
  let nestBooks: TargetingBookOption[] = [];
  try {
    const search = new URLSearchParams();
    if (opts.filterUserId) search.set("filterUserId", String(opts.filterUserId));
    search.set("profileIds", uniqueStrings(profileIds.map(String)).sort().join(","));
    const q = search.toString() ? `?${search.toString()}` : "";
    const payload = await nestApiJson<{ books?: Array<{
      asin?: string;
      title?: string | null;
      imageUrl?: string | null;
      image_url?: string | null;
      campaignCount?: number;
      campaignIds?: string[];
      campaign_ids?: string[];
    }> }>(`/campaigns/books${q}`, { method: "GET" }, "Couldn't load books for filter.");
    nestBooks = dedupeTargetingBookOptions(
      (payload.books ?? [])
        .map((row) => {
          const asin = String(row.asin || "")
            .trim()
            .toUpperCase();
          if (!/^[A-Z0-9]{10}$/.test(asin)) return null;
          const campaignIds = Array.isArray(row.campaignIds)
            ? row.campaignIds.map(String)
            : Array.isArray(row.campaign_ids)
              ? row.campaign_ids.map(String)
              : [];
          return {
            asin,
            title: String(row.title || "").trim() || asin,
            image_url: pickUsableCoverUrl(row.imageUrl, row.image_url),
            campaignIds,
            campaignCount: Number(row.campaignCount) || campaignIds.length || 0,
            hasKdpData: false,
          } satisfies TargetingBookOption;
        })
        .filter(Boolean) as TargetingBookOption[],
    );
  } catch {
    // Nest optional — local product_ads + KDP paths still fill the filter.
  }

  const [campaignBooks, kdpBooks] = await Promise.all([
    fetchEnabledSponsoredBooksForProfiles(profileIds),
    fetchKdpBooksForTargetingFilter(profileIds),
  ]);

  // Create pickers may include purchased in-stock shelf. Targets must not —
  // stock-only published titles are useless for filtering campaigns.
  let stockBooks: TargetingBookOption[] = [];
  if (purpose === "create") {
    try {
      const shelf = await nestShelfCatalogRows();
      stockBooks = shelf
        .filter((row) => row.in_stock)
        .map((row) => {
          const asin = String(row.asin || "")
            .trim()
            .toUpperCase();
          const formatAsins = identityAsinsForBookRow(row);
          return {
            asin,
            title: String(row.title || "").trim() || asin,
            image_url: row.image_url ?? null,
            campaignIds: [] as string[],
            campaignCount: 0,
            hasKdpData: false,
            inStock: true,
            formatAsins,
            groupKey: row.book_key || null,
          } satisfies TargetingBookOption;
        })
        .filter((book) => /^[A-Z0-9]{10}$/.test(book.asin));
    } catch {
      // Nest Create shelf optional — KDP signal path still fills create filters.
    }
  }

  return finish(
    dedupeTargetingBookOptions([
      ...nestBooks,
      ...campaignBooks,
      ...kdpBooks,
      ...stockBooks,
    ]),
  );
}

/**
 * KDP ASINs with **meaningful** daily evidence for filter enrichment / create.
 * Catalog titles alone must NOT enter (empty old published books).
 * Zeroed daily stubs (no royalties, orders, KENP, format cents) stay out.
 * Format siblings ride along via group_key / kdp_book_formats for parent rollup.
 */
async function fetchKdpBooksForTargetingFilter(
  profileIds: string[],
): Promise<TargetingBookOption[]> {
  const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
  if (!kdpAccountIds.length) return [];

  type Acc = {
    title: string;
    image_url: string | null;
    groupKey: string | null;
    formatAsins: Set<string>;
  };
  const byAsin = new Map<string, Acc>();

  let dailyRows: Array<{
    asin?: string | null;
    group_key?: string | null;
    royalties?: unknown;
    orders?: unknown;
    ebook_royalties?: unknown;
    paperback_royalties?: unknown;
    kenp_royalties?: unknown;
  }> = [];
  try {
    dailyRows = await fetchOptionalInPages<any>(
      "targeting_filter_kdp_daily",
      kdpAccountIds,
      (chunk, from, to) =>
        supabase
          .from("kdp_book_daily_data")
          .select(
            "asin, group_key, royalties, orders, ebook_royalties, paperback_royalties, kenp_royalties",
          )
          .in("account_id", chunk)
          .order("asin", { ascending: true })
          .range(from, to),
    );
  } catch {
    // Older schemas may lack format columns — fall back to royalties/orders.
    try {
      dailyRows = await fetchOptionalInPages<any>(
        "targeting_filter_kdp_daily_legacy",
        kdpAccountIds,
        (chunk, from, to) =>
          supabase
            .from("kdp_book_daily_data")
            .select("asin, group_key, royalties, orders")
            .in("account_id", chunk)
            .order("asin", { ascending: true })
            .range(from, to),
      );
    } catch {
      // Daily table may be unavailable under some RLS shapes.
    }
  }

  // Only seed ASINs that have at least one meaningful daily row.
  const signalAsins = new Set<string>();
  for (const row of dailyRows) {
    const asin = String((row as any).asin || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    if (hasMeaningfulKdpDailySignal(row)) signalAsins.add(asin);
  }

  const signalDailyRows = dailyRows.filter((row) => {
    const asin = String((row as any).asin || "")
      .trim()
      .toUpperCase();
    return signalAsins.has(asin);
  });
  const dailyAsinToGroup = verifiedAsinGroupsFromDailyRows(signalDailyRows);
  for (const row of signalDailyRows) {
    const asin = String((row as any).asin || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const groupKey =
      dailyAsinToGroup.get(asin) ||
      String((row as any).group_key || "").trim() ||
      null;
    const cur = byAsin.get(asin) ?? {
      title: asin,
      image_url: null as string | null,
      groupKey,
      formatAsins: new Set<string>([asin]),
    };
    if (groupKey) cur.groupKey = groupKey;
    cur.formatAsins.add(asin);
    byAsin.set(asin, cur);
  }

  // Expand siblings from format catalog without inventing orphan catalog-only books.
  try {
    const catalogRows = await fetchOptionalInPages<any>(
      "targeting_filter_kdp_formats",
      kdpAccountIds,
      (chunk, from, to) =>
        supabase
          .from("kdp_book_formats")
          .select("account_id, book_id, asin")
          .in("account_id", chunk)
          .order("account_id", { ascending: true })
          .order("book_id", { ascending: true })
          .order("asin", { ascending: true })
          .range(from, to),
    );
    const catalogIdentity = verifiedKdpBookCatalog(catalogRows);
    const asinToGroup = mergeCatalogIntoDailyAsinGroups(dailyAsinToGroup, catalogIdentity);
    for (const [asin, groupKey] of asinToGroup) {
      if (!byAsin.has(asin) && !dailyAsinToGroup.has(asin)) {
        // Sibling of a proven daily ASIN — attach for parent collapse only when
        // at least one daily sibling already opened the group.
        const siblings = [...asinToGroup.entries()]
          .filter(([, key]) => key === groupKey)
          .map(([sib]) => sib);
        if (!siblings.some((sib) => byAsin.has(sib))) continue;
      }
      const cur = byAsin.get(asin) ?? {
        title: asin,
        image_url: null as string | null,
        groupKey,
        formatAsins: new Set<string>([asin]),
      };
      cur.groupKey = groupKey;
      for (const [sib, key] of asinToGroup) {
        if (key === groupKey) cur.formatAsins.add(sib);
      }
      byAsin.set(asin, cur);
    }
  } catch {
    // Formats optional — daily ASINs alone still qualify.
  }

  const asins = [...byAsin.keys()];
  if (asins.length) {
    try {
      for (let i = 0; i < asins.length; i += 200) {
        const chunk = asins.slice(i, i + 200);
        const { data: kdpTitles } = await supabase
          .from("kdp_titles")
          .select("asin, title, cover_url, amazon_image_url")
          .in("account_id", kdpAccountIds)
          .in("asin", chunk);
        for (const title of kdpTitles ?? []) {
          const asin = String((title as any).asin ?? "").toUpperCase();
          const cur = byAsin.get(asin);
          if (!cur) continue;
          if ((title as any).title) {
            cur.title =
              preferEditionTitle(cur.title, String((title as any).title).trim()) ||
              cur.title;
          }
          cur.image_url = pickUsableCoverUrl(
            cur.image_url,
            (title as any).cover_url,
            (title as any).amazon_image_url,
          );
        }
      }
    } catch {
      // Titles enrich only.
    }
  }

  return [...byAsin.entries()].map(([asin, v]) => ({
    asin,
    title: v.title,
    image_url: v.image_url,
    campaignIds: [] as string[],
    campaignCount: 0,
    // Only ASINs seeded from meaningful daily signal (or their format siblings)
    // enter this map — siblings inherit hasKdpData for parent rollup / create.
    hasKdpData: true,
    inStock: false,
    formatAsins: [...v.formatAsins],
    groupKey: v.groupKey,
  }));
}

/** Sponsored books for targeting filter — enabled campaigns + ads only (paused/archived out). */
async function fetchEnabledSponsoredBooksForProfiles(
  profileIds: string[],
): Promise<TargetingBookOption[]> {
  // Paginate product_ads so Nest placement rows aren't left "No linked book"
  // just because their ads fell outside an arbitrary first-N sample.
  // Active-only: book filter scopes Keywords/Targets to campaigns that can run.
  const liveAdStates = new Set(["enabled"]);
  const liveCampaignStates = new Set(["enabled"]);
  let data: any[] = [];
  try {
    data = await fetchAllPages<any>((from, to) =>
      supabase
        .from("product_ads")
        .select("asin, title, campaign_id, image_url, status, campaigns!inner(state)")
        .in("amazon_profile_id", profileIds)
        .in("status", ["enabled"])
        .in("campaigns.state", ["enabled"])
        .not("asin", "is", null)
        .order("asin", { ascending: true })
        .range(from, to),
    );
  } catch {
    // Join may be unavailable under some RLS shapes — filter campaigns in a second pass.
    const ads = await fetchAllPages<any>((from, to) =>
      supabase
        .from("product_ads")
        .select("asin, title, campaign_id, image_url, status")
        .in("amazon_profile_id", profileIds)
        .in("status", ["enabled"])
        .not("asin", "is", null)
        .order("asin", { ascending: true })
        .range(from, to),
    );
    const campaignIds = [
      ...new Set(ads.map((row) => String(row.campaign_id || "").trim()).filter(Boolean)),
    ];
    const liveCampaignIds = new Set<string>();
    for (let i = 0; i < campaignIds.length; i += 200) {
      const chunk = campaignIds.slice(i, i + 200);
      const { data: campaigns, error } = await supabase
        .from("campaigns")
        .select("id, state")
        .in("id", chunk)
        .in("state", ["enabled"]);
      if (error) throw error;
      for (const row of campaigns ?? []) {
        liveCampaignIds.add(String((row as any).id));
      }
    }
    data = ads.filter((row) => liveCampaignIds.has(String(row.campaign_id || "").trim()));
  }

  const byAsin = new Map<
    string,
    { title: string; image_url: string | null; campaignIds: Set<string>; hasKdpData: boolean }
  >();
  for (const row of data ?? []) {
    const asin = String((row as any).asin || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const adStatus = String((row as any).status || "").toLowerCase();
    if (!liveAdStates.has(adStatus)) continue;
    const title = String((row as any).title || "").trim() || asin;
    const campaignId = String((row as any).campaign_id || "").trim();
    const imageUrl = String((row as any).image_url || "").trim() || null;
    const campaignState = String((row as any).campaigns?.state || "").toLowerCase();
    if (campaignState && !liveCampaignStates.has(campaignState)) continue;
    const cur = byAsin.get(asin) ?? {
      title,
      image_url: null as string | null,
      campaignIds: new Set<string>(),
      hasKdpData: false,
    };
    if (!cur.title || cur.title === asin) cur.title = title;
    if (!cur.image_url && imageUrl) cur.image_url = imageUrl;
    if (campaignId) cur.campaignIds.add(campaignId);
    byAsin.set(asin, cur);
  }

  // Prefer KDP covers; for titles prefer the newer edition-year so Ads
  // "Alaska … (2027)" is not overwritten by an older KDP sibling title.
  const asins = [...byAsin.keys()];
  if (asins.length) {
    const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
    if (kdpAccountIds.length) {
      for (let i = 0; i < asins.length; i += 200) {
        const chunk = asins.slice(i, i + 200);
        const { data: kdpTitles } = await supabase
          .from("kdp_titles")
          .select("asin, title, cover_url, amazon_image_url")
          .in("account_id", kdpAccountIds)
          .in("asin", chunk);
        for (const title of kdpTitles ?? []) {
          const asin = String((title as any).asin ?? "").toUpperCase();
          const cur = byAsin.get(asin);
          if (!cur) continue;
          cur.hasKdpData = true;
          if ((title as any).title) {
            cur.title =
              preferEditionTitle(cur.title, String((title as any).title).trim()) || cur.title;
          }
          cur.image_url = pickUsableCoverUrl(
            cur.image_url,
            (title as any).cover_url,
            (title as any).amazon_image_url,
          );
        }
      }
      // Royalty/daily rows also count as KDP data even without a titles row.
      try {
        for (let i = 0; i < asins.length; i += 200) {
          const chunk = asins.slice(i, i + 200);
          const { data: daily } = await supabase
            .from("kdp_book_daily_data")
            .select("asin")
            .in("account_id", kdpAccountIds)
            .in("asin", chunk);
          for (const row of daily ?? []) {
            const asin = String((row as any).asin ?? "").toUpperCase();
            const cur = byAsin.get(asin);
            if (cur) cur.hasKdpData = true;
          }
        }
      } catch {
        // Optional enrich.
      }
    }
  }

  return [...byAsin.entries()]
    .map(([asin, v]) => ({
      asin,
      title: v.title,
      image_url: v.image_url,
      campaignIds: [...v.campaignIds],
      campaignCount: v.campaignIds.size,
      hasKdpData: v.hasKdpData,
    }))
    .filter((book) => book.campaignIds.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function extractAsinFromExpression(expression: any): string | null {
  if (!expression) return null;
  try {
    // Prefer shared extractor so array/object value shapes stay in sync with UI.
    const fromShared = extractTargetAsin(expression);
    if (fromShared) return fromShared;
    const parsed = typeof expression === "string" ? JSON.parse(expression) : expression;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (typeof item === "string" && /^[A-Z0-9]{10}$/i.test(item)) {
        return item.toUpperCase();
      }
      for (const key of ["value", "asin", "targetAsin", "target_asin"]) {
        const value = item?.[key];
        if (typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value)) {
          return value.toUpperCase();
        }
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === "string" && /^[A-Z0-9]{10}$/i.test(entry)) {
              return entry.toUpperCase();
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

// ---------- Product Ads ----------
const VALID_ASIN_RE = /^[A-Z0-9]{10}$/;

function pickAsinFromProductAdRows(
  rows: readonly { asin?: string | null; sku?: string | null; status?: string | null }[],
): string | null {
  const enabled = rows.find(
    (row) =>
      String(row.status || "")
        .trim()
        .toLowerCase() === "enabled" &&
      String(row.asin || row.sku || "").trim(),
  );
  const pick = enabled ?? rows.find((row) => String(row.asin || row.sku || "").trim());
  const asin = String(pick?.asin || pick?.sku || "")
    .trim()
    .toUpperCase();
  return asin || null;
}

/**
 * ASIN this campaign advertises — Nest `primaryAsin` is often empty for older
 * campaigns; fall back to product_ads then campaign_asin_links (Nest
 * `resolveCampaignAsin`) so Add keywords/products can suggest.
 */
export async function fetchCampaignAdvertisedAsin(
  campaignId: string,
  profileIds: string[],
): Promise<string | null> {
  const id = String(campaignId || "").trim();
  if (!id) return null;
  const profiles = uniqueStrings((profileIds ?? []).map(String).filter(Boolean));

  // 1) product_ads filtered by profile (when profiles provided)
  if (profiles.length) {
    const rows = await fetchProductAds(profiles, { campaignId: id, limit: 40 });
    const fromProfiles = pickAsinFromProductAdRows(rows);
    if (fromProfiles) return fromProfiles;
  }

  // 2) Retry product_ads by campaign_id alone (no profile filter) — covers
  // null amazon_profile_id rows and profile-selection mismatches.
  {
    const { data, error } = await supabase
      .from("product_ads")
      .select("asin,sku,status")
      .eq("campaign_id", id)
      .order("total_spend", { ascending: false })
      .limit(40);
    if (error) throw error;
    const fromCampaign = pickAsinFromProductAdRows(data ?? []);
    if (fromCampaign) return fromCampaign;
  }

  // 3) campaign_asin_links (explicit link; Nest resolveCampaignAsin fallback)
  {
    const { data, error } = await supabase
      .from("campaign_asin_links")
      .select("asin")
      .eq("campaign_id", id)
      .limit(5);
    if (error) throw error;
    for (const row of data ?? []) {
      const asin = String((row as { asin?: string | null }).asin || "")
        .trim()
        .toUpperCase();
      if (VALID_ASIN_RE.test(asin)) return asin;
    }
  }

  return null;
}

export async function fetchProductAds(
  profileIds: string[],
  opts: { campaignId?: string; adGroupIds?: string[]; status?: string; limit?: number; search?: string; start?: string; end?: string } = {},
): Promise<ProductAd[]> {
  if (!profileIds.length) return [];
  const scopedAdGroupIds = uniqueStrings((opts.adGroupIds ?? []).map(String).filter(Boolean));
  if (opts.adGroupIds && scopedAdGroupIds.length === 0) return [];
  const buildQuery = (from?: number, to?: number) => {
    let q = supabase
      .from("product_ads")
      .select("*")
      .in("amazon_profile_id", profileIds)
      .order("total_spend", { ascending: false });

    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (scopedAdGroupIds.length) q = q.in("ad_group_id", scopedAdGroupIds);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.search) q = q.or(`asin.ilike.%${opts.search}%,sku.ilike.%${opts.search}%,title.ilike.%${opts.search}%`);
    if (opts.limit) q = q.limit(opts.limit);
    else if (from != null && to != null) q = q.range(from, to);
    return q;
  };

  const limitedResult = opts.limit ? await buildQuery() : null;
  if (limitedResult?.error) throw limitedResult.error;
  const rows = opts.limit
    ? ((limitedResult?.data ?? []) as ProductAd[])
    : await fetchAllPages<ProductAd>((from, to) => buildQuery(from, to));
  const totals = await fetchMetricTotalsByEntity("product_ad_metrics", "product_ad_id", rows.map((row) => row.id), opts.start, opts.end);
  const enriched = rows.map((row) => applyMetricTotals(row, opts.start && opts.end ? totals.get(row.id) ?? emptyTotals() : undefined));

  // Always resolve title/cover from THIS row's ASIN (KDP catalog). Never leave a
  // wrong sponsored-book image from Amazon sync if we have the product ASIN metadata.
  const asins = uniqueStrings(enriched.map((row) => row.asin?.toUpperCase()).filter(Boolean) as string[]);
  if (asins.length) {
    const kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
    if (kdpAccountIds.length) {
      const { data: kdpTitles } = await supabase
        .from("kdp_titles")
        .select("asin, title, cover_url, amazon_image_url")
        .in("account_id", kdpAccountIds)
        .in("asin", asins);

      const titleByAsin = new Map<string, { title: string | null; image_url: string | null }>();
      for (const title of kdpTitles ?? []) {
        const asin = String((title as any).asin ?? "").toUpperCase();
        const existing = titleByAsin.get(asin);
        titleByAsin.set(asin, {
          title: existing?.title ?? (title as any).title ?? null,
          image_url: pickUsableCoverUrl(existing?.image_url, (title as any).cover_url, (title as any).amazon_image_url),
        });
      }

      for (const row of enriched) {
        const match = row.asin ? titleByAsin.get(row.asin.toUpperCase()) : null;
        if (!match) continue;
        if (match.image_url) (row as any).image_url = match.image_url;
        if (match.title) (row as any).title = match.title;
      }
    }
  }

  return enriched;
}

// ---------- Search Terms ----------
function assertSearchTermsNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new IncompleteReadError("PostgREST read aborted");
  }
}

export async function fetchSearchTerms(
  profileIds: string[],
  opts: {
    campaignId?: string;
    adGroupId?: string;
    adGroupIds?: string[];
    termType?: string;
    limit?: number;
    start?: string;
    end?: string;
    signal?: AbortSignal;
  } = {},
): Promise<SearchTerm[]> {
  if (!profileIds.length) return [];
  const scopedAdGroupIds = uniqueStrings((opts.adGroupIds ?? []).map(String).filter(Boolean));
  if (opts.adGroupIds && scopedAdGroupIds.length === 0) return [];
  const signal = opts.signal;
  assertSearchTermsNotAborted(signal);

  // Campaign IDs for selected profiles — page so a hung/oversized read can abort between pages.
  // Trace ENTER/OK/FAIL/ABORT so Documents/searchterms-trace.txt never stalls on ENTER alone.
  const { withSearchTermsHttpTrace } = await import("./searchTermsTrace");
  const campaignRows = await withSearchTermsHttpTrace("ST11_HTTP", signal, () =>
    fetchAllPages<any>(
      (from, to) =>
        supabase
          .from("campaigns")
          .select("id,name")
          .in("amazon_profile_id", profileIds)
          .range(from, to),
      POSTGREST_PAGE_SIZE,
      { signal },
    ),
  );
  assertSearchTermsNotAborted(signal);
  const campaignIds = uniqueStrings(campaignRows.map((c: any) => c.id));
  if (!campaignIds.length) return [];
  const campaignNameById = new Map(campaignRows.map((c: any) => [c.id, c.name]));
  const scopedCampaignIds = opts.campaignId
    ? campaignIds.includes(opts.campaignId)
      ? [opts.campaignId]
      : []
    : campaignIds;
  if (!scopedCampaignIds.length) return [];

  const fetchForCampaignChunk = async (chunk: string[], useAdGroupColumn: boolean) => {
    assertSearchTermsNotAborted(signal);
    if (opts.limit) {
      let q = supabase
        .from("search_terms")
        .select("*")
        .in("campaign_id", chunk)
        .order("total_spend", { ascending: false })
        .limit(opts.limit);
      if (opts.termType) q = q.eq("term_type", opts.termType);
      if (useAdGroupColumn && opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
      if (useAdGroupColumn && scopedAdGroupIds.length) q = q.in("ad_group_id", scopedAdGroupIds);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SearchTerm[];
    }
    return fetchAllPages<SearchTerm>(
      (from, to) => {
        let q = supabase
          .from("search_terms")
          .select("*")
          .in("campaign_id", chunk)
          .order("total_spend", { ascending: false })
          .range(from, to);
        if (opts.termType) q = q.eq("term_type", opts.termType);
        if (useAdGroupColumn && opts.adGroupId) q = q.eq("ad_group_id", opts.adGroupId);
        if (useAdGroupColumn && scopedAdGroupIds.length) q = q.in("ad_group_id", scopedAdGroupIds);
        return q;
      },
      POSTGREST_PAGE_SIZE,
      { signal },
    );
  };

  let rows: SearchTerm[] = [];
  if (opts.adGroupId || scopedAdGroupIds.length) {
    try {
      for (const chunk of chunkArray(scopedCampaignIds, 300)) {
        rows.push(...(await fetchForCampaignChunk(chunk, true)));
      }
    } catch (error) {
      assertSearchTermsNotAborted(signal);
      if (error instanceof IncompleteReadError) throw error;
      // Older schemas may not have search_terms.ad_group_id. Fall back through keyword_id.
      rows = [];
      const keywords = await fetchKeywords(profileIds, {
        adGroupId: opts.adGroupId,
        adGroupIds: scopedAdGroupIds.length ? scopedAdGroupIds : undefined,
      });
      const keywordIds = uniqueStrings(keywords.map((kw) => kw.id));
      if (!keywordIds.length) rows = [];
      for (const keywordChunk of chunkArray(keywordIds, 300)) {
        rows.push(
          ...(await fetchAllPages<SearchTerm>(
            (from, to) => {
              let q = supabase
                .from("search_terms")
                .select("*")
                .in("keyword_id", keywordChunk)
                .in("campaign_id", scopedCampaignIds)
                .order("total_spend", { ascending: false })
                .range(from, to);
              if (opts.termType) q = q.eq("term_type", opts.termType);
              return q;
            },
            POSTGREST_PAGE_SIZE,
            { signal },
          )),
        );
      }
    }
  } else if (opts.limit && !opts.campaignId) {
    // Exact account-wide top-N without the expensive PostgREST embedded campaign join.
    // A row outside a chunk's top N cannot belong to the global top N, so taking N
    // from every campaign-ID chunk and ranking the union is complete and unbiased.
    for (const chunk of chunkArray(scopedCampaignIds, 300)) {
      rows.push(...(await fetchForCampaignChunk(chunk, false)));
    }
  } else {
    for (const chunk of chunkArray(scopedCampaignIds, 300)) {
      rows.push(...(await fetchForCampaignChunk(chunk, false)));
    }
  }

  const totals = await fetchMetricTotalsByEntity("search_term_metrics", "search_term_id", rows.map((row) => row.id), opts.start, opts.end);

  const keywordIds = uniqueStrings(rows.map((row: any) => row.keyword_id));
  const adGroupIdsFromRows = uniqueStrings(rows.map((row: any) => row.ad_group_id));
  const keywordAdGroupById = new Map<string, string>();
  if (keywordIds.length) {
    for (const chunk of chunkArray(keywordIds, 500)) {
      const { data: keywordRows, error: kwErr } = await supabase
        .from("keywords")
        .select("id,ad_group_id")
        .in("id", chunk);
      if (kwErr) throw kwErr;
      for (const row of keywordRows ?? []) {
        const keywordId = (row as any).id;
        const adGroupId = (row as any).ad_group_id;
        if (keywordId && adGroupId) keywordAdGroupById.set(keywordId, adGroupId);
      }
    }
  }

  const adGroupIds = uniqueStrings([
    ...adGroupIdsFromRows,
    ...rows.map((row: any) => keywordAdGroupById.get(row.keyword_id)),
  ]);
  const adGroupNameById = new Map<string, string>();
  if (adGroupIds.length) {
    for (const chunk of chunkArray(adGroupIds, 500)) {
      const { data: adGroupRows, error: agErr } = await supabase
        .from("ad_groups")
        .select("id,name")
        .in("id", chunk);
      if (agErr) throw agErr;
      for (const row of adGroupRows ?? []) {
        if ((row as any).id) adGroupNameById.set((row as any).id, (row as any).name ?? "Ad group");
      }
    }
  }

  const enriched = rows.map((row: any) => {
    const adGroupId = row.ad_group_id ?? keywordAdGroupById.get(row.keyword_id) ?? null;
    return applyMetricTotals(
      {
        ...row,
        ad_group_id: adGroupId,
        campaign_name: campaignNameById.get(row.campaign_id) ?? null,
        ad_group_name: adGroupId ? adGroupNameById.get(adGroupId) ?? null : null,
      },
      opts.start && opts.end ? totals.get(row.id) ?? emptyTotals() : undefined,
    );
  });

  const { enrichSearchTermsCrossCampaignTargeted } = await import("./searchTermHarvest.ts");
  const withTargeted = await enrichSearchTermsCrossCampaignTargeted(enriched, {
    campaignId: opts.campaignId,
  });

  return withTargeted
    .sort((a, b) => Number(b.total_spend ?? 0) - Number(a.total_spend ?? 0))
    .slice(0, opts.limit ?? withTargeted.length);
}

// ---------- Campaign Placement Metrics (per campaign) ----------
export interface CampaignPlacementRow {
  placement: string;
  label: string;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
  ctr: number;
  share: number; // % of total spend
}

export async function fetchCampaignPlacements(
  campaignId: string,
  startDate: string,
  endDate: string,
): Promise<CampaignPlacementRow[]> {
  const data = await fetchAllPages<any>((from, to) =>
    supabase
      .from("campaign_placement_metrics")
      .select("date,placement,impressions,clicks,orders,spend,sales")
      .eq("campaign_id", campaignId)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true })
      .order("placement", { ascending: true })
      .range(from, to),
  );

  const totals = new Map<string, CampaignPlacementRow>();
  for (const row of data) {
    const placement = normalizePlacement(String((row as any).placement ?? "other"));
    const cur = totals.get(placement) ?? { placement, label: placementLabel(placement), impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0, acos: 0, ctr: 0, share: 0 };
    cur.impressions += toNumber((row as any).impressions);
    cur.clicks += toNumber((row as any).clicks);
    cur.orders += toNumber((row as any).orders);
    cur.spend += toNumber((row as any).spend);
    cur.sales += toNumber((row as any).sales);
    totals.set(placement, cur);
  }

  const totalSpend = Array.from(totals.values()).reduce((s, r) => s + r.spend, 0);
  return Array.from(totals.values())
    .map((r) => ({
      ...r,
      acos: safeDivide(r.spend, r.sales) * 100,
      ctr: safeDivide(r.clicks, r.impressions) * 100,
      share: totalSpend > 0 ? safeDivide(r.spend, totalSpend) * 100 : 0,
    }))
    .filter((r) => r.spend > 0 || r.clicks > 0)
    .sort((a, b) => b.spend - a.spend);
}

// ---------- Negative Keywords ----------
async function attachNegativeParentNames<
  T extends { campaign_id: string; ad_group_id: string | null },
>(rows: T[]): Promise<(T & EntityParentNames)[]> {
  if (!rows.length) return rows;

  const campaignIds = Array.from(new Set(rows.map((row) => row.campaign_id).filter(Boolean)));
  const adGroupIds = Array.from(new Set(rows.map((row) => row.ad_group_id).filter((id): id is string => !!id)));
  const campaignNames = new Map<string, string>();
  const adGroupNames = new Map<string, string>();

  await Promise.all([
    (async () => {
      for (const ids of chunkArray(campaignIds, 100)) {
        try {
          const { data } = await supabase.from("campaigns").select("id, name").in("id", ids);
          for (const row of data ?? []) {
            if (row.id && row.name) campaignNames.set(String(row.id), String(row.name));
          }
        } catch {}
      }
    })(),
    (async () => {
      for (const ids of chunkArray(adGroupIds, 100)) {
        try {
          const { data } = await supabase.from("ad_groups").select("id, name").in("id", ids);
          for (const row of data ?? []) {
            if (row.id && row.name) adGroupNames.set(String(row.id), String(row.name));
          }
        } catch {}
      }
    })(),
  ]);

  return rows.map((row) => ({
    ...row,
    campaign_name: campaignNames.get(row.campaign_id) ?? null,
    ad_group_name: row.ad_group_id ? adGroupNames.get(row.ad_group_id) ?? null : null,
  }));
}

export async function fetchNegativeKeywords(profileIds: string[]): Promise<NegativeKeyword[]> {
  if (!profileIds.length) return [];
  const { data, error } = await supabase
    .from("negative_keywords")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("created_at", { ascending: false })
    .limit(NEGATIVE_RESULT_LIMIT);
  if (error) throw error;
  return attachNegativeParentNames((data ?? []) as NegativeKeyword[]);
}

export async function fetchNegativeProductTargets(profileIds: string[]): Promise<NegativeProductTarget[]> {
  if (!profileIds.length) return [];
  const { data, error } = await supabase
    .from("negative_product_targets")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("created_at", { ascending: false })
    .limit(NEGATIVE_RESULT_LIMIT);
  if (error) throw error;
  return attachNegativeParentNames((data ?? []) as NegativeProductTarget[]);
}

import { buildFxRateMap, addFxCalendarDays, convertAdsAmount, type FxRateRow } from "./fxRates.ts";

// ---------- Daily Campaign Metrics for chart ----------
export async function fetchFxDailyRates(input: {
  startDate: string;
  endDate: string;
  fromCurrencies: string[];
  toCurrency?: string;
}): Promise<Map<string, number>> {
  const to = String(input.toCurrency || "USD").trim().toUpperCase() || "USD";
  const fromList = [
    ...new Set(
      input.fromCurrencies
        .map((c) => String(c || "").trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c) && c !== to),
    ),
  ];
  if (!fromList.length) return new Map();
  const lookbackStart = addFxCalendarDays(input.startDate, -10);
  const rows = await fetchAllPages<FxRateRow>((from, toRow) =>
    supabase
      .from("fx_daily_rates")
      .select("rate_date, from_currency, to_currency, rate")
      .eq("to_currency", to)
      .in("from_currency", fromList)
      .gte("rate_date", lookbackStart)
      .lte("rate_date", input.endDate)
      .order("rate_date", { ascending: true })
      .order("from_currency", { ascending: true })
      .range(from, toRow),
  );
  return buildFxRateMap(rows);
}

export async function fetchCampaignMetricsRange(
  profileIds: string[],
  startDate: string,
  endDate: string,
): Promise<CampaignMetric[]> {
  if (!profileIds.length) return [];

  const campaignIds = await fetchAllPages<{ id: string; amazon_profile_id: string | null }>((from, to) =>
    supabase
      .from("campaigns")
      .select("id, amazon_profile_id")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = campaignIds.map((row) => row.id);
  const profileByCampaign = new Map(
    campaignIds.map((row) => [row.id, String(row.amazon_profile_id || "")]),
  );
  if (!ids.length) return [];
  debugDataScope("campaign-metrics-range", {
    profiles: profileIds.length,
    campaigns: ids.length,
    start: startDate,
    end: endDate,
  });

  const rows: CampaignMetric[] = [];
  for (const chunk of chunkArray(ids, 200)) {
    const page = await fetchAllPages<CampaignMetric>((from, to) =>
      supabase
        .from("campaign_metrics")
        .select("id,campaign_id,date,impressions,clicks,ctr,spend,sales,orders,acos,roas,cpc,conversion_rate")
        .in("campaign_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("campaign_id", { ascending: true })
        .range(from, to),
    );
    for (const row of page) {
      const profileId = profileByCampaign.get(row.campaign_id);
      rows.push(profileId ? { ...row, amazon_profile_id: profileId } : row);
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.campaign_id.localeCompare(b.campaign_id));
}

export async function fetchCampaignMetricsForCampaign(
  profileIds: string[],
  campaignId: string,
  startDate: string,
  endDate: string,
): Promise<CampaignMetric[]> {
  const campaign = await fetchCampaignById(campaignId, profileIds);
  if (!campaign) return [];

  const { data, error } = await supabase
    .from("campaign_metrics")
    .select("*")
    .eq("campaign_id", campaignId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CampaignMetric[];
}

export interface PlacementMixRow {
  placement: string;
  label: string;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  share: number;
  acos: number;
  ctr: number;
  cvr: number;
}

function placementLabel(placement: string): string {
  if (placement === "top_of_search") return "Top of search";
  if (placement === "product_pages") return "Product pages";
  if (placement === "rest_of_search") return "Rest of search";
  return "Other";
}

function normalizePlacement(placement: string): string {
  // Historical sync rows used "other" for Amazon's rest-of-search bucket.
  if (placement === "other") return "rest_of_search";
  return placement;
}

export async function fetchPlacementMixRange(
  profileIds: string[],
  startDate: string,
  endDate: string,
): Promise<PlacementMixRow[]> {
  if (!profileIds.length) return [];

  const camps = await fetchAllPages<{ id: string }>((from, to) =>
    supabase
      .from("campaigns")
      .select("id")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const campaignIds = uniqueStrings(camps.map((campaign) => campaign.id));
  if (!campaignIds.length) return [];

  const totals = new Map<string, Omit<PlacementMixRow, "label" | "share" | "acos" | "ctr" | "cvr">>();
  for (const chunk of chunkArray(campaignIds, 500)) {
    const data = await fetchAllPages<any>((from, to) =>
      supabase
        .from("campaign_placement_metrics")
        .select("date,placement,impressions,clicks,orders,spend,sales")
        .in("campaign_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("placement", { ascending: true })
        .range(from, to),
    );

    for (const row of data) {
      const placement = normalizePlacement(String((row as any).placement ?? "other"));
      const current =
        totals.get(placement) ??
        {
          placement,
          impressions: 0,
          clicks: 0,
          orders: 0,
          spend: 0,
          sales: 0,
        };
      current.impressions += toNumber((row as any).impressions);
      current.clicks += toNumber((row as any).clicks);
      current.orders += toNumber((row as any).orders);
      current.spend += toNumber((row as any).spend);
      current.sales += toNumber((row as any).sales);
      totals.set(placement, current);
    }
  }

  const totalSpend = Array.from(totals.values()).reduce((sum, row) => sum + row.spend, 0);
  const totalImpressions = Array.from(totals.values()).reduce((sum, row) => sum + row.impressions, 0);

  return Array.from(totals.values())
    .map((row) => ({
      ...row,
      label: placementLabel(row.placement),
      share: totalSpend > 0 ? safeDivide(row.spend, totalSpend) * 100 : safeDivide(row.impressions, totalImpressions) * 100,
      acos: safeDivide(row.spend, row.sales) * 100,
      ctr: safeDivide(row.clicks, row.impressions) * 100,
      cvr: safeDivide(row.orders, row.clicks) * 100,
    }))
    .filter((row) => row.impressions > 0 || row.clicks > 0 || row.orders > 0 || row.spend > 0 || row.sales > 0)
    .sort((a, b) => b.share - a.share);
}

// ---------- Top performers in a date range ----------
// Aggregates daily *_metrics across the selected range and joins entity meta.

interface RangeOpts {
  profileIds: string[];
  start: string;
  end: string;
  limit?: number;
  filterUserId?: string | null;
  /** Amazon entity state. When set, filter before aggregation/pagination. */
  state?: string;
  /** Book filter: load these campaigns (not global top-N by spend). */
  campaignIds?: string[];
  /**
   * Skip placement-share enrichment (multi-profile children). Parent attaches
   * placement once after merge so we don't burn 8s×N nested soft budgets.
   */
  skipPlacementShares?: boolean;
}

/** A book/campaign association is valid only when Amazon Ads exposes its advertised ASIN/SKU. */
export type BookCampaignMatchSource = "product_ad";

export interface TopCampaignRow {
  id: string;
  name: string;
  type: string | null;
  targeting_type?: string | null;
  state: string | null;
  budget: number | null;
  bidding_strategy: string | null;
  amazon_profile_id?: string | null;
  rule_last_modified_at?: string | null;
  placement_adj_last_modified_at?: string | Record<string, string> | null;
  placement_adj_change_source?: string | Record<string, string> | null;
  placement_top_share: number | null;
  placement_product_share: number | null;
  placement_rest_share: number | null;
  /** Per-placement metrics from campaign_placement_metrics (not campaign totals). */
  placement_top_spend?: number;
  placement_top_impressions?: number;
  placement_top_clicks?: number;
  placement_top_orders?: number;
  placement_top_sales?: number;
  placement_product_spend?: number;
  placement_product_impressions?: number;
  placement_product_clicks?: number;
  placement_product_orders?: number;
  placement_product_sales?: number;
  placement_rest_spend?: number;
  placement_rest_impressions?: number;
  placement_rest_clicks?: number;
  placement_rest_orders?: number;
  placement_rest_sales?: number;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number | null;
  roas: number | null;
  net: number | null; // computed later with royalty rate; null when Nest omits royalties
  updated_at?: string | null;
  metrics_updated_at?: string | null;
  book_key?: string | null;
  book_asin?: string | null;
  book_title?: string | null;
  book_image_url?: string | null;
  book_match_source?: BookCampaignMatchSource | null;
}

async function enrichTopCampaignsWithSettingsCooldown(
  rows: TopCampaignRow[],
): Promise<TopCampaignRow[]> {
  if (!rows.length) return rows;
  try {
    const cooldownById = await fetchCampaignSettingsCooldownRows(rows.map((row) => row.id));
    if (!cooldownById.size) return rows;
    return rows.map((row) => {
      const meta = cooldownById.get(row.id);
      if (!meta) return row;
      return {
        ...row,
        bidding_strategy: row.bidding_strategy ?? meta.bidding_strategy,
        rule_last_modified_at: meta.rule_last_modified_at,
        placement_adj_last_modified_at: meta.placement_adj_last_modified_at,
        placement_adj_change_source: meta.placement_adj_change_source,
      };
    });
  } catch {
    return rows;
  }
}

async function fetchCampaignPlacementShares(
  campaignIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, CampaignPlacementShares>> {
  const raw = new Map<
    string,
    Record<string, { spend: number; impressions: number; clicks: number; orders: number; sales: number }>
  >();
  if (!campaignIds.length) return new Map();

  for (const chunk of chunkArray(campaignIds, 500)) {
    const data = await fetchAllPages<any>((from, to) =>
      supabase
        .from("campaign_placement_metrics")
        .select("date,campaign_id,placement,impressions,clicks,orders,spend,sales")
        .in("campaign_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("campaign_id", { ascending: true })
        .order("placement", { ascending: true })
        .range(from, to),
    );

    for (const row of data) {
      const campaignId = (row as any).campaign_id as string | null;
      if (!campaignId) continue;
      const placement = normalizePlacement(String((row as any).placement ?? "other"));
      const current = raw.get(campaignId) ?? {};
      const bucket = current[placement] ?? { spend: 0, impressions: 0, clicks: 0, orders: 0, sales: 0 };
      bucket.spend += toNumber((row as any).spend);
      bucket.impressions += toNumber((row as any).impressions);
      bucket.clicks += toNumber((row as any).clicks);
      bucket.orders += toNumber((row as any).orders);
      bucket.sales += toNumber((row as any).sales);
      current[placement] = bucket;
      raw.set(campaignId, current);
    }
  }

  const shares = new Map<string, CampaignPlacementShares>();
  for (const [campaignId, placements] of raw) {
    shares.set(campaignId, campaignPlacementSharesFromBuckets(placements, safeDivide));
  }

  return shares;
}

/** Attach per-placement shares + metrics onto campaign rows (Nest or Supabase). */
async function withCampaignPlacementShares(
  rows: TopCampaignRow[],
  startDate: string,
  endDate: string,
): Promise<TopCampaignRow[]> {
  if (!rows.length) return rows;
  // Soft budget: placement bars are decorative. Hard-waiting here made
  // Campaigns tab hit HOME 20s timeout on multi-profile Nest lists.
  try {
    const shares = await withQueryTimeout(
      fetchCampaignPlacementShares(
        rows.map((row) => row.id),
        startDate,
        endDate,
      ),
      CAMPAIGNS_PLACEMENT_BUDGET_MS,
    );
    return rows.map((row) => ({
      ...row,
      ...(shares.get(row.id) ?? emptyCampaignPlacementShares()),
    }));
  } catch {
    return rows.map((row) => ({
      ...row,
      ...emptyCampaignPlacementShares(),
    }));
  }
}

export async function fetchTopCampaignsRange(
  opts: RangeOpts & { royaltyRate?: number },
): Promise<TopCampaignRow[]> {
  const {
    profileIds,
    start,
    end,
    limit = 5,
    royaltyRate = 0,
    filterUserId,
    state,
    skipPlacementShares = false,
  } = opts;
  if (!profileIds.length) return [];
  const scopedCampaignIds = uniqueStrings((opts.campaignIds ?? []).map(String).filter(Boolean));
  /** `limit <= 0` = complete Campaigns list (no silent Nest/app truncate). */
  const capped = typeof limit === "number" && Number.isFinite(limit) && limit > 0;

  const attachPlacement = async (rows: TopCampaignRow[]): Promise<TopCampaignRow[]> => {
    if (skipPlacementShares) return rows;
    return withCampaignPlacementShares(rows, start, end);
  };

  const fairSlice = (rows: TopCampaignRow[]): TopCampaignRow[] => {
    if (!capped) return rows;
    if (profileIds.length <= 1) return rows.slice(0, limit);
    const per = Math.max(80, Math.ceil(limit / profileIds.length));
    const taken = new Map<string, number>();
    const out: TopCampaignRow[] = [];
    for (const row of rows) {
      const pid = String((row as any).amazon_profile_id ?? "");
      const n = taken.get(pid) ?? 0;
      if (n >= per) continue;
      taken.set(pid, n + 1);
      out.push(row);
      if (out.length >= limit) break;
    }
    // If some profiles had fewer than `per`, fill remaining slots from leftovers.
    if (out.length < limit) {
      const picked = new Set(out.map((r) => r.id));
      for (const row of rows) {
        if (picked.has(row.id)) continue;
        out.push(row);
        if (out.length >= limit) break;
      }
    }
    return out;
  };

  const sortCampaignRows = (rows: TopCampaignRow[]) =>
    [...rows].sort((a, b) =>
      royaltyRate > 0 ? (Number(b.net) || 0) - (Number(a.net) || 0) : b.spend - a.spend,
    );

  try {
    // Book scope needs exact campaign IDs — Nest top-N by spend can omit quiet books.
    if (!scopedCampaignIds.length) {
      // Prefer Nest period aggregation for every seller (not only admin filterUserId).
      // Multi-profile: fair-share via per-profile fetches — Nest often omits amazon_profile_id.
      if (profileIds.length > 1) {
        const per = capped ? Math.max(80, Math.ceil(limit / profileIds.length)) : 0;
        const byId = new Map<string, TopCampaignRow>();
        // A failed profile must invalidate the whole list. Bounded reads also
        // avoid six simultaneous heavy Nest aggregations on the same account.
        for (let i = 0; i < profileIds.length; i += 2) {
          const profileBatch = profileIds.slice(i, i + 2);
          const batches = await Promise.all(
            profileBatch.map(async (id) => {
              const rows = await fetchTopCampaignsRange({
                ...opts,
                profileIds: [id],
                limit: per,
                // Parent attaches placement once after merge.
                skipPlacementShares: true,
              });
              // The Nest aggregation response does not currently echo the
              // profile id. This request is scoped to exactly one profile, so
              // attaching that id is authoritative and lets currency/flag UI
              // resolve the campaign marketplace without guessing from names.
              return rows.map((row) => ({
                ...row,
                amazon_profile_id: row.amazon_profile_id || id,
              }));
            }),
          );
          for (const rows of batches) {
            for (const row of rows) byId.set(row.id, row);
          }
        }
        const merged = sortCampaignRows([...byId.values()]);
        const limited = capped ? merged.slice(0, limit) : merged;
        return enrichTopCampaignsWithSettingsCooldown(await attachPlacement(limited));
      }
      const rows = await fetchAggregatedCampaigns({
        startDate: start,
        endDate: end,
        profileIds,
        filterUserId,
        state,
      });
      const limited = capped ? rows.slice(0, limit) : rows;
      return enrichTopCampaignsWithSettingsCooldown(await attachPlacement(limited));
    }
  } catch (error) {
    console.warn("[inteliads] Nest campaign aggregation failed; falling back to Supabase", error);
  }
  const effectiveRoyaltyRate = royaltyRate > 0 ? royaltyRate : 0;

  const campaigns = await fetchAllPages<any>((from, to) => {
    let q = supabase
      .from("campaigns")
      .select("id, name, type, targeting_type, state, budget, bidding_strategy, amazon_profile_id, updated_at, metrics_updated_at, rule_last_modified_at, placement_adj_last_modified_at, placement_adj_change_source")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true });
    if (scopedCampaignIds.length) q = q.in("id", scopedCampaignIds);
    if (state) q = q.eq("state", state);
    return q.range(from, to);
  });
  if (!campaigns.length) return [];

  const campaignIds = campaigns.map((c: any) => c.id);
  let placementShares = new Map<string, CampaignPlacementShares>();
  if (!skipPlacementShares) {
    try {
      placementShares = await withQueryTimeout(
        fetchCampaignPlacementShares(campaignIds, start, end),
        CAMPAIGNS_PLACEMENT_BUDGET_MS,
      );
    } catch {
      // Soft: Supabase fallback list still paints without placement mix.
    }
  }
  const campaignBookById = new Map<
    string,
    {
      book_key: string;
      book_asin: string | null;
      book_title: string | null;
      book_image_url: string | null;
      book_match_source: BookCampaignMatchSource;
    }
  >();

  const adRows = await fetchAllPages<any>((from, to) =>
    supabase
      .from("product_ads")
      .select("id, campaign_id, asin, sku, title, image_url")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const adAsins = uniqueStrings(
    (adRows as any[])
      .flatMap((ad) => [ad.asin, ad.sku])
      .filter(Boolean)
      .map((asin) => String(asin).toUpperCase()),
  );
  const asinToGroup = new Map<string, string>();
  const bookMetaByKey = new Map<
    string,
    { book_asin: string | null; book_title: string | null; book_image_url: string | null }
  >();
  const kdpAccountIds = adAsins.length ? await fetchLinkedKdpAccountIds(profileIds) : [];

  if (kdpAccountIds.length && adAsins.length) {
    const { data: kdpBookRows, error: kdpBookErr } = await supabase
      .from("kdp_book_daily_data")
      .select("asin, group_key")
      .in("account_id", kdpAccountIds)
      .in("asin", adAsins);
    if (kdpBookErr) throw kdpBookErr;

    for (const row of kdpBookRows ?? []) {
      const asin = String((row as any).asin ?? "").toUpperCase();
      if (!asin) continue;
      asinToGroup.set(asin, String((row as any).group_key ?? asin).toUpperCase());
    }

    const { data: kdpTitles, error: kdpTitlesErr } = await supabase
      .from("kdp_titles")
      .select("asin, title, cover_url, amazon_image_url")
      .in("account_id", kdpAccountIds)
      .in("asin", adAsins);
    if (kdpTitlesErr) throw kdpTitlesErr;

    for (const title of kdpTitles ?? []) {
      const asin = String((title as any).asin ?? "").toUpperCase();
      if (!asin) continue;
      const bookKey = asinToGroup.get(asin) ?? asin;
      const current = bookMetaByKey.get(bookKey);
      bookMetaByKey.set(bookKey, {
        book_asin: current?.book_asin ?? asin,
        book_title: current?.book_title ?? (title as any).title ?? null,
        book_image_url: pickUsableCoverUrl(current?.book_image_url, (title as any).cover_url, (title as any).amazon_image_url),
      });
    }
  }

  const setCampaignBook = (
    campaignId: string | null | undefined,
    bookKey: string,
    meta: { book_asin?: string | null; book_title?: string | null; book_image_url?: string | null },
    source: BookCampaignMatchSource,
  ) => {
    if (!campaignId || !bookKey) return;
    const current = campaignBookById.get(campaignId);
    if (current?.book_match_source === "product_ad") return;
    campaignBookById.set(campaignId, {
      book_key: bookKey,
      book_asin: meta.book_asin ?? null,
      book_title: meta.book_title ?? null,
      book_image_url: meta.book_image_url ?? null,
      book_match_source: source,
    });
  };

  for (const ad of adRows as any[]) {
    const asin = String(ad.asin || ad.sku || "").toUpperCase();
    if (!asin) continue;
    const bookKey = asinToGroup.get(asin) ?? asin;
    const kdpMeta = bookMetaByKey.get(bookKey);
    const meta = {
      book_asin: kdpMeta?.book_asin ?? asin,
      book_title: kdpMeta?.book_title ?? ad.title ?? null,
      book_image_url: kdpMeta?.book_image_url ?? ad.image_url ?? null,
    };
    if (!bookMetaByKey.has(bookKey)) bookMetaByKey.set(bookKey, meta);
    setCampaignBook(ad.campaign_id, bookKey, meta, "product_ad");
  }

  const metrics = await fetchCampaignMetricRows(campaignIds, start, end);

  const totals = new Map<string, TopCampaignRow>();
  for (const c of campaigns as any[]) {
    totals.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type,
      targeting_type: c.targeting_type ?? null,
      state: c.state,
      budget: c.budget,
      bidding_strategy: c.bidding_strategy,
      amazon_profile_id: c.amazon_profile_id ?? null,
      rule_last_modified_at: typeof c.rule_last_modified_at === "string" ? c.rule_last_modified_at : null,
      placement_adj_last_modified_at:
        typeof c.placement_adj_last_modified_at === "string" ||
        (c.placement_adj_last_modified_at && typeof c.placement_adj_last_modified_at === "object")
          ? (c.placement_adj_last_modified_at as string | Record<string, string>)
          : null,
      placement_adj_change_source:
        typeof c.placement_adj_change_source === "string" ||
        (c.placement_adj_change_source && typeof c.placement_adj_change_source === "object")
          ? (c.placement_adj_change_source as string | Record<string, string>)
          : null,
      updated_at: typeof c.updated_at === "string" ? c.updated_at : null,
      metrics_updated_at: typeof c.metrics_updated_at === "string" ? c.metrics_updated_at : null,
      ...(campaignBookById.get(c.id) ?? {
        book_key: null,
        book_asin: null,
        book_title: null,
        book_image_url: null,
        book_match_source: null,
      }),
      ...emptyCampaignPlacementShares(),
      impressions: 0,
      clicks: 0,
      orders: 0,
      spend: 0,
      sales: 0,
      acos: 0,
      roas: 0,
      net: 0,
    });
  }
  for (const m of (metrics ?? []) as any[]) {
    const row = totals.get(m.campaign_id);
    if (!row) continue;
    row.impressions += Number(m.impressions) || 0;
    row.clicks += Number(m.clicks) || 0;
    row.orders += Number(m.orders) || 0;
    row.spend += Number(m.spend) || 0;
    row.sales += Number(m.sales) || 0;
  }
  const rows = Array.from(totals.values()).map((r) => ({
    ...r,
    ...(placementShares.get(r.id) ?? emptyCampaignPlacementShares()),
    acos: r.sales > 0 ? (r.spend / r.sales) * 100 : 0,
    roas: r.spend > 0 ? r.sales / r.spend : 0,
    // Ads-domain estimate only when a rate is supplied. Not KDP Net Royalties.
    net: r.sales * (effectiveRoyaltyRate / 100) - r.spend,
  }));

  return fairSlice(
    rows
      .filter((r) => shouldShowActiveOrPausedWithData(r as any, r.state))
      .sort((a, b) => (effectiveRoyaltyRate > 0 ? b.net - a.net : b.sales - a.sales)),
  );
}

export interface BookCampaignRow extends TopCampaignRow {
  match_source: BookCampaignMatchSource;
}

export async function fetchBookCampaignsRange(
  opts: RangeOpts & { asin: string; title?: string | null; displayCurrency: string },
): Promise<BookCampaignRow[]> {
  const { profileIds, start, end, asin } = opts;
  const normalizedAsin = String(asin ?? "").trim().toUpperCase();
  if (!profileIds.length || !normalizedAsin) return [];

  const bookAsins = await fetchLogicalBookAsins(profileIds, normalizedAsin);
  if (!bookAsins.length) return [];

  // Case variants so PostgREST `.in` still hits mixed-case ASIN/SKU rows;
  // client matcher remains case-normalized via asinBelongsToLogicalBook.
  const asinFilterValues = uniqueStrings(
    bookAsins.flatMap((value) => {
      const upper = String(value || "").trim().toUpperCase();
      const lower = upper.toLowerCase();
      return upper ? [upper, lower] : [];
    }),
  );
  if (!asinFilterValues.length) return [];

  const matchSourceByCampaignId = new Map<string, BookCampaignMatchSource>();
  const setMatch = (campaignId: string | null | undefined) => {
    if (!campaignId) return;
    matchSourceByCampaignId.set(campaignId, "product_ad");
  };

  // Ownership-scoped: only product ads for this logical book's ASINs/SKUs —
  // never scan every product ad across all selected profiles.
  const orFilter = `asin.in.(${asinFilterValues.join(",")}),sku.in.(${asinFilterValues.join(",")})`;
  const productAds = await fetchAllPages<any>((from, to) =>
    supabase
      .from("product_ads")
      .select("id, campaign_id, asin, sku")
      .in("amazon_profile_id", profileIds)
      .or(orFilter)
      .order("id", { ascending: true })
      .range(from, to),
  );

  for (const ad of productAds) {
    const adAsin = String((ad as any).asin ?? "").toUpperCase();
    const adSku = String((ad as any).sku ?? "").toUpperCase();
    if (asinBelongsToLogicalBook(adAsin, bookAsins) || asinBelongsToLogicalBook(adSku, bookAsins)) {
      setMatch((ad as any).campaign_id);
    }
  }

  const matchedCampaignIds = Array.from(matchSourceByCampaignId.keys());
  if (!matchedCampaignIds.length) return [];

  const campaigns = await fetchAllPages<any>((from, to) =>
    supabase
      .from("campaigns")
      .select("id, name, type, state, budget, bidding_strategy, amazon_profile_id")
      .in("id", matchedCampaignIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (!campaigns.length) return [];

  const { data: currencyRows, error: currencyError } = await supabase
    .from("amazon_profiles")
    .select("id, profile_id, currency_code")
    .in("id", profileIds);
  if (currencyError) throw new BooksReadError("book_campaign_currency", booksErrorCode(currencyError));
  const currencyByProfileId = new Map<string, string>();
  for (const profile of currencyRows ?? []) {
    const currency = String(profile.currency_code || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) {
      currencyByProfileId.set(String(profile.id), currency);
      if (profile.profile_id) currencyByProfileId.set(String(profile.profile_id), currency);
    }
  }
  if (profileIds.some((id) => !currencyByProfileId.has(id))) {
    throw new BooksReadError("book_campaign_currency", "currency_unavailable");
  }
  const nativeCurrencies = [...new Set(profileIds.map((id) => currencyByProfileId.get(id)!))];
  const displayCurrency = String(opts.displayCurrency || "").trim().toUpperCase();
  if (nativeCurrencies.length > 1 ? displayCurrency !== "USD" : nativeCurrencies[0] !== displayCurrency) {
    throw new BooksReadError("book_campaign_currency", "currency_scope_mismatch");
  }
  const fxRates = nativeCurrencies.length > 1
    ? await fetchFxDailyRates({ startDate: start, endDate: end, fromCurrencies: nativeCurrencies, toCurrency: "USD" })
    : new Map<string, number>();

  const campaignById = new Map((campaigns as any[]).map((campaign) => [campaign.id, campaign]));
  // Placement + metrics are soft — never let either hold the book Campaigns
  // spinner open until the outer 45s abort. Rows paint with zeros if metrics lag.
  const [placementShares, metricRows] = await Promise.all([
    withQueryTimeout(
      fetchCampaignPlacementShares(matchedCampaignIds, start, end),
      BOOK_CAMPAIGN_PLACEMENT_BUDGET_MS,
    ).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[inteliads:book-campaigns] placement shares skipped", error);
      return new Map<string, CampaignPlacementShares>();
    }),
    withQueryTimeout(
      fetchCampaignMetricRows(matchedCampaignIds, start, end),
      BOOK_CAMPAIGN_METRICS_BUDGET_MS,
    ).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[inteliads:book-campaigns] metrics soft-timed out", error);
      return [] as Awaited<ReturnType<typeof fetchCampaignMetricRows>>;
    }),
  ]);

  const totals = new Map<string, TopCampaignRow>();
  for (const id of matchedCampaignIds) {
    const campaign = campaignById.get(id) as any;
    if (!campaign) continue;
    totals.set(id, {
      id,
      name: campaign.name,
      type: campaign.type,
      state: campaign.state,
      budget: campaign.budget,
      bidding_strategy: campaign.bidding_strategy,
      amazon_profile_id: campaign.amazon_profile_id ?? null,
      ...(placementShares.get(id) ?? emptyCampaignPlacementShares()),
      impressions: 0,
      clicks: 0,
      orders: 0,
      spend: 0,
      sales: 0,
      acos: 0,
      roas: 0,
      net: 0,
    });
  }

  for (const metric of metricRows) {
    const row = totals.get((metric as any).campaign_id);
    if (!row) continue;
    const nativeCurrency = currencyByProfileId.get(String(row.amazon_profile_id || ""));
    if (!nativeCurrency) throw new BooksReadError("book_campaign_currency", "currency_unavailable");
    const moneyForDisplay = (amount: unknown): number => {
      const native = toNumber(amount);
      if (!native || nativeCurrencies.length === 1) return native;
      const converted = convertAdsAmount(native, String((metric as any).date || "").slice(0, 10), nativeCurrency, "USD", fxRates);
      if (converted == null) throw new BooksReadError("book_campaign_fx", "rate_unavailable");
      return converted;
    };
    row.impressions += toNumber((metric as any).impressions);
    row.clicks += toNumber((metric as any).clicks);
    row.orders += toNumber((metric as any).orders);
    row.spend += moneyForDisplay((metric as any).spend);
    row.sales += moneyForDisplay((metric as any).sales);
  }

  return Array.from(totals.values())
    .map((row) => ({
      ...row,
      acos: row.sales > 0 ? (row.spend / row.sales) * 100 : 0,
      roas: row.spend > 0 ? row.sales / row.spend : 0,
      // Ads-attributed sales minus spend. Not publisher Net Royalties.
      net: row.sales - row.spend,
      match_source: "product_ad" as const,
    }))
    .filter((row) => shouldShowActiveOrPausedWithData(row as any, row.state))
    .sort((a, b) => {
      const activeDelta =
        Number(b.spend > 0 || b.sales > 0 || b.orders > 0 || b.clicks > 0 || b.impressions > 0) -
        Number(a.spend > 0 || a.sales > 0 || a.orders > 0 || a.clicks > 0 || a.impressions > 0);
      if (activeDelta !== 0) return activeDelta;
      return b.spend - a.spend || b.sales - a.sales || a.name.localeCompare(b.name);
    });
}

export interface TopKeywordRow {
  id: string;
  text: string | null;
  match_type: string | null;
  bid: number | null;
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
  roas: number;
}

export async function fetchTopKeywordsRange(opts: RangeOpts): Promise<TopKeywordRow[]> {
  const { profileIds, start, end, limit = 5 } = opts;
  if (!profileIds.length) return [];

  const keywords = await fetchAllPages<{
    id: string;
    keyword_text: string | null;
    match_type: string | null;
    bid_amount: number | null;
    amazon_profile_id: string | null;
  }>((from, to) =>
    supabase
      .from("keywords")
      .select("id,keyword_text,match_type,bid_amount,amazon_profile_id")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (!keywords.length) return [];

  const ids = keywords.map((k) => k.id);

  // Chunk in to avoid URL length issues
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));

  const metrics: any[] = [];
  for (const c of chunks) {
    const page = await fetchAllPages<any>((from, to) =>
      supabase
        .from("keyword_metrics")
        .select("keyword_id,impressions,clicks,orders,spend,sales")
        .in("keyword_id", c)
        .gte("date", start)
        .lte("date", end)
        .order("keyword_id", { ascending: true })
        .range(from, to),
    );
    metrics.push(...page);
  }

  const totals = new Map<string, TopKeywordRow>();
  for (const k of keywords) {
    totals.set(k.id, {
      id: k.id,
      text: k.keyword_text,
      match_type: k.match_type,
      bid: k.bid_amount,
      impressions: 0,
      clicks: 0,
      orders: 0,
      spend: 0,
      sales: 0,
      acos: 0,
      roas: 0,
    });
  }
  for (const m of metrics) {
    const row = totals.get(m.keyword_id);
    if (!row) continue;
    row.impressions += Number(m.impressions) || 0;
    row.clicks += Number(m.clicks) || 0;
    row.orders += Number(m.orders) || 0;
    row.spend += Number(m.spend) || 0;
    row.sales += Number(m.sales) || 0;
  }
  const rows = Array.from(totals.values()).map((r) => ({
    ...r,
    acos: r.sales > 0 ? (r.spend / r.sales) * 100 : 0,
    roas: r.spend > 0 ? r.sales / r.spend : 0,
  }));

  return rows
    .filter((r) => r.spend > 0)
    .sort((a, b) => b.roas - a.roas)
    .slice(0, limit);
}

export interface TopBookRow {
  book_key: string;
  asin: string;
  sku: string | null;
  /** Sibling format ASINs (Kindle/paperback/hardcover/audiobook) for this logical book. */
  format_asins?: string[];
  title: string | null;
  image_url: string | null;
  impressions: number;
  clicks: number;
  orders: number;
  /** KDP store units; separate from Amazon Ads attributed orders. */
  kdp_orders?: number;
  spend: number;
  sales: number;
  royalties: number | null;
  acos: number;
  roas: number | null;
  net: number | null;
  breakeven_acos: number;
  ads_state?: "ready" | "pending" | "missing";
  kdp_state?: "ready" | "partial" | "missing";
  /** ≥1 enabled Amazon Ads campaign (Books visibility). */
  has_campaign?: boolean;
  /** Nest create / Ads-eligible soft or confirmed stock (not sufficient alone). */
  sponsorable?: boolean;
  /** Nest/live confirmed in stock for owned edition (Books visibility). */
  in_stock?: boolean;
  /** Format-group royalties or KDP units in range (Books visibility). */
  has_format_activity?: boolean;
  published_at?: string | null;
  first_seen_at?: string | null;
  created_at?: string | null;
}

/** Book keys (group_key / asin / sku) with KDP or Ads signal in the activity window. */
export async function fetchActiveBookKeysForProfiles(profileIds: string[]): Promise<Set<string>> {
  if (!profileIds.length) return new Set();
  let kdpAccountIds: string[] = [];
  try {
    kdpAccountIds = await fetchLinkedKdpAccountIds(profileIds);
  } catch {
    kdpAccountIds = [];
  }
  const { start, end } = booksListActivityRange();
  return fetchActiveBookKeysInRange(profileIds, start, end, kdpAccountIds);
}

async function fetchActiveBookKeysInRange(
  profileIds: string[],
  start: string,
  end: string,
  kdpAccountIds: string[],
): Promise<Set<string>> {
  const keys = new Set<string>();

  if (kdpAccountIds.length) {
    const kdpRows = await fetchOptionalInPages<any>("kdp_book_daily_activity", kdpAccountIds, (chunk, from, to) =>
      supabase
        .from("kdp_book_daily_data")
        .select("asin, group_key, royalties, orders")
        .in("account_id", chunk)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("asin", { ascending: true })
        .range(from, to),
    );
    for (const row of kdpRows) {
      const royalties = toNumber((row as any).royalties);
      const orders = toNumber((row as any).orders);
      if (royalties === 0 && orders === 0) continue;
      const asin = String((row as any).asin ?? "").trim();
      const groupKey = String((row as any).group_key ?? "").trim() || asin;
      if (groupKey) keys.add(groupKey);
      if (asin) keys.add(asin);
    }
  }

  const adRows = await fetchOptionalInPages<any>("product_ads_activity", profileIds, (chunk, from, to) =>
    supabase
      .from("product_ads")
      .select("id, asin, sku")
      .in("amazon_profile_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const adById = new Map(adRows.map((ad: any) => [ad.id, ad]));
  const adIds = uniqueStrings(adRows.map((ad: any) => ad.id));
  if (adIds.length) {
    const metrics = await fetchOptionalInPages<any>("product_ad_metrics_activity", adIds, (chunk, from, to) =>
      supabase
        .from("product_ad_metrics")
        .select("product_ad_id, impressions, clicks, orders, spend, sales")
        .in("product_ad_id", chunk)
        .gte("date", start)
        .lte("date", end)
        .order("product_ad_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, to),
    );
    for (const metric of metrics) {
      const hasMetric =
        toNumber((metric as any).spend) > 0 ||
        toNumber((metric as any).sales) > 0 ||
        toNumber((metric as any).impressions) > 0 ||
        toNumber((metric as any).clicks) > 0 ||
        toNumber((metric as any).orders) > 0;
      if (!hasMetric) continue;
      const ad = adById.get((metric as any).product_ad_id) as any;
      const key = ad?.asin || ad?.sku;
      if (key) keys.add(String(key));
    }
  }

  return keys;
}

async function finalizeTopBooksList(
  rows: TopBookRow[],
  profileIds: string[],
  kdpAccountIds: string[],
  limit: number,
  activityDays = BOOKS_LIST_ACTIVITY_DAYS,
): Promise<TopBookRow[]> {
  // Keep KDP/Ads evidence even when catalog title is blank — UI shows
  // "Title unavailable". Still drop blank-title zero-signal noise here;
  // filterBooksListVisibility then hides remaining stock-only / empty shelves.
  const listed = rows.filter(
    (row) =>
      String(row.title ?? "").trim().length > 0 || bookHasKdpOrAdsEvidence(row),
  );
  // activityDays <= 0 = Books / products catalog mode. Always apply KDP|Ads
  // visibility here so Nest early-return paths cannot leak stock-only / zero-
  // signal rows. Do NOT apply the 6-month stale-dead Create suggestion filter.
  if (activityDays <= 0) {
    const visible = filterBooksListVisibility(collapseTopBooksByFormatGroup(listed));
    // limit <= 0 → full catalog (Book Detail must resolve outside a top-N window).
    return limit > 0 ? visible.slice(0, limit) : visible;
  }
  const withSignal = listed.filter(bookHasSignalInRange);
  const { start, end } = booksListActivityRange();
  const activeKeys = await fetchActiveBookKeysInRange(profileIds, start, end, kdpAccountIds);
  if (activeKeys.size === 0 && withSignal.length > 0) {
    return withSignal.slice(0, limit);
  }
  return filterTopBooksByRecentActivity(withSignal, activeKeys).slice(0, limit);
}

/**
 * Nest create-candidate shelf → Books catalog rows.
 * Same Nest book-candidates / #468 stock signals Create uses (shared mapper).
 * Also seeds ASINs Create live-confirmed via /marketplaces cache when the
 * bulk candidates union omitted them (ISBN-10 batch miss → Create “In stock · N
 * profiles” while Books would otherwise stay empty).
 *
 * Do NOT gate on hasNestToken() — Create loads book-candidates with Nest JWT
 * *or* Supabase Amazon bearer via nestApiJson; Books must use the same path.
 */
async function nestShelfCatalogRows(): Promise<TopBookRow[]> {
  try {
    const { fetchCampaignCreationBooks } = await import("./mutations.ts");
    const {
      CAMPAIGN_CREATION_BOOKS_QUERY_KEY,
      CAMPAIGN_CREATION_SELECTED_BOOK_KEY,
      creationBooksToShelfCatalogRows,
      amazonAdsStockConfirmed,
      adsStockSoftListed,
    } = await import("./campaignCreationStock.ts");
    const { appQueryClient } = await import("./queryClient.ts");

    // Prefer Create STEP 1 in-memory cache when warm; otherwise fetch Nest
    // directly. Do NOT nest queryClient.fetchQuery inside Books' queryFn —
    // that can deadlock / drop the Nest shelf under products-range.
    let data: Awaited<ReturnType<typeof fetchCampaignCreationBooks>> | undefined =
      appQueryClient.getQueryData(CAMPAIGN_CREATION_BOOKS_QUERY_KEY);
    if (!data?.books?.length) {
      data = await fetchCampaignCreationBooks();
      try {
        appQueryClient.setQueryData(CAMPAIGN_CREATION_BOOKS_QUERY_KEY, data);
      } catch {
        // Cache write is best-effort.
      }
    }

    const shelf = creationBooksToShelfCatalogRows(data?.books ?? []);
    const known = new Set(shelf.map((row) => row.asin));

    // Live /marketplaces Create confirmed after select — close Create↔Books gap
    // when book-candidates bulk omitted the ASIN (Alaska 2027 path).
    const liveSeed: TopBookRow[] = [];
    for (const [queryKey, mkt] of appQueryClient.getQueriesData<{
      asin?: string;
      marketplaces?: Array<{
        availabilityEvidence?: string | null;
        stockStatus?: string | null;
      }>;
    }>({ queryKey: ["campaign-creation-marketplaces"] })) {
      const asin = String(
        (Array.isArray(queryKey) ? queryKey[1] : null) ?? mkt?.asin ?? "",
      )
        .trim()
        .toUpperCase();
      if (!asin || known.has(asin) || !mkt?.marketplaces?.length) continue;
      const liveInStock = mkt.marketplaces.some((row) =>
        amazonAdsStockConfirmed(row),
      );
      const liveSoft = mkt.marketplaces.some((row) => adsStockSoftListed(row));
      if (!liveInStock && !liveSoft) continue;
      const fromCandidates = (data?.books ?? []).find(
        (book) => String(book.asin ?? "").toUpperCase() === asin,
      );
      const selectedMeta = appQueryClient.getQueryData<{
        asin: string;
        title: string | null;
        coverUrl: string | null;
        workKey: string | null;
        sku: string | null;
        publishedAt: string | null;
      }>([CAMPAIGN_CREATION_SELECTED_BOOK_KEY, asin]);
      known.add(asin);
      liveSeed.push({
        book_key: String(
          fromCandidates?.workKey ?? selectedMeta?.workKey ?? asin,
        ),
        asin,
        sku: fromCandidates?.sku ?? selectedMeta?.sku ?? null,
        title: fromCandidates?.title || selectedMeta?.title || null,
        image_url: fromCandidates?.coverUrl ?? selectedMeta?.coverUrl ?? null,
        impressions: 0,
        clicks: 0,
        orders: 0,
        kdp_orders: 0,
        spend: 0,
        sales: 0,
        royalties: null,
        acos: 0,
        roas: null,
        net: null,
        breakeven_acos: 0,
        ads_state: "missing",
        kdp_state: "missing",
        sponsorable: true,
        has_campaign: false,
        in_stock: true,
        has_format_activity: false,
        published_at:
          fromCandidates?.publishedAt ?? selectedMeta?.publishedAt ?? null,
      });
    }

    // Create-selected paperbacks (persisted after selectBook) when Nest bulk
    // later omits the ASIN. Create only selects ads-eligible rows.
    for (const [queryKey, meta] of appQueryClient.getQueriesData<{
      asin?: string;
      title?: string | null;
      coverUrl?: string | null;
      workKey?: string | null;
      sku?: string | null;
      publishedAt?: string | null;
    }>({ queryKey: [CAMPAIGN_CREATION_SELECTED_BOOK_KEY] })) {
      const asin = String(
        (Array.isArray(queryKey) ? queryKey[1] : null) ?? meta?.asin ?? "",
      )
        .trim()
        .toUpperCase();
      if (!asin || known.has(asin) || !meta) continue;
      known.add(asin);
      liveSeed.push({
        book_key: String(meta.workKey ?? asin),
        asin,
        sku: meta.sku ?? null,
        title: meta.title || null,
        image_url: meta.coverUrl ?? null,
        impressions: 0,
        clicks: 0,
        orders: 0,
        kdp_orders: 0,
        spend: 0,
        sales: 0,
        royalties: null,
        acos: 0,
        roas: null,
        net: null,
        breakeven_acos: 0,
        ads_state: "missing",
        kdp_state: "missing",
        sponsorable: true,
        has_campaign: false,
        in_stock: true,
        has_format_activity: false,
        published_at: meta.publishedAt ?? null,
      });
    }

    return [
      ...shelf.map(
        (row): TopBookRow => ({
          book_key: row.book_key,
          asin: row.asin,
          sku: row.sku,
          title: row.title,
          image_url: row.image_url,
          impressions: 0,
          clicks: 0,
          orders: 0,
          kdp_orders: 0,
          spend: 0,
          sales: 0,
          royalties: null,
          acos: 0,
          roas: null,
          net: null,
          breakeven_acos: 0,
          ads_state: "missing",
          kdp_state: "missing",
          sponsorable: row.sponsorable,
          has_campaign: row.has_campaign,
          in_stock: row.in_stock,
          has_format_activity: false,
          published_at: row.published_at,
        }),
      ),
      ...liveSeed,
    ];
  } catch {
    return [];
  }
}

async function finalizeCatalogBooksList(
  periodRows: TopBookRow[],
  profileIds: string[],
  kdpAccountIds: string[],
  limit: number,
  preloadedShelf?: TopBookRow[] | null,
): Promise<TopBookRow[]> {
  const shelf = preloadedShelf ?? (await nestShelfCatalogRows());
  const sponsorableAsins = new Set<string>();
  const inStockAsins = new Set<string>();
  for (const row of shelf) {
    const asin = String(row.asin ?? "")
      .trim()
      .toUpperCase();
    if (asin) sponsorableAsins.add(asin);
    const sku = String(row.sku ?? "")
      .trim()
      .toUpperCase();
    if (sku) sponsorableAsins.add(sku);
    if (row.in_stock) {
      if (asin) inStockAsins.add(asin);
      if (sku) inStockAsins.add(sku);
    }
  }
  const campaignAsins = new Set<string>();
  for (const row of periodRows) {
    if (!row.has_campaign) continue;
    const asin = String(row.asin ?? "")
      .trim()
      .toUpperCase();
    if (asin) campaignAsins.add(asin);
    const sku = String(row.sku ?? "")
      .trim()
      .toUpperCase();
    if (sku) campaignAsins.add(sku);
    // Also stamp ASINs embedded in KDP group keys so Nest PRINT siblings match.
    for (const id of identityAsinsForBookRow(row)) campaignAsins.add(id);
  }
  // Nest-only Create paperbacks (e.g. Alaska 2027 / 180797376X) often lack a
  // KDP period group. Stamp enabled Ads campaign ASINs so they still qualify
  // via active campaign without treating soft existing_product_ad as enough.
  // Also synthesize catalog rows for enabled-campaign ASINs missing from Nest
  // Create + KDP period (Create list often omits books that already have ads).
  const campaignOnlyShelf: TopBookRow[] = [];
  if (profileIds.length) {
    try {
      const enabled = await fetchEnabledSponsoredBooksForProfiles(profileIds);
      const knownAsins = new Set<string>();
      for (const row of [...shelf, ...periodRows]) {
        for (const id of identityAsinsForBookRow(row)) knownAsins.add(id);
      }
      for (const book of enabled) {
        const asin = String(book.asin ?? "")
          .trim()
          .toUpperCase();
        if (!asin) continue;
        campaignAsins.add(asin);
        if (knownAsins.has(asin)) continue;
        knownAsins.add(asin);
        campaignOnlyShelf.push({
          book_key: asin,
          asin,
          sku: null,
          title: book.title || null,
          image_url: book.image_url ?? null,
          impressions: 0,
          clicks: 0,
          orders: 0,
          kdp_orders: 0,
          spend: 0,
          sales: 0,
          royalties: null,
          acos: 0,
          roas: null,
          net: null,
          breakeven_acos: 0,
          ads_state: "ready",
          kdp_state: "missing",
          sponsorable: true,
          has_campaign: true,
          in_stock: false,
          has_format_activity: false,
        });
      }
    } catch {
      // Soft-fail — periodRows has_campaign stamps still apply.
    }
  }
  const merged = mergeTopBookCatalogRows([...shelf, ...campaignOnlyShelf], periodRows);
  // Annotate by ASIN so Nest create keys (ASIN) stamp local KDP group rows.
  const annotated = annotateBooksListVisibility(merged, {
    sponsorableAsins,
    inStockAsins,
    campaignAsins,
  });
  // Collapse format siblings first so KDP/Ads evidence on any edition keeps the group.
  const grouped = collapseTopBooksByFormatGroup(annotated);
  const visible = filterBooksListVisibility(grouped);
  return finalizeTopBooksList(visible, profileIds, kdpAccountIds, limit, 0);
}

export async function fetchTopBooksRange(
  opts: RangeOpts & {
    royaltyRate?: number;
    onCoreRows?: (rows: TopBookRow[]) => void;
    /** Rolling activity window for list eligibility. Default 60 days. Set 0 to disable. */
    activityDays?: number;
    /**
     * Ads stay on `profileIds` (current view). KDP totals follow royalty scope
     * when provided — including `[]` + `kdpScope: "user_accounts"` for KDP-only.
     */
    kdpProfileIds?: string[];
    kdpScope?: KdpRoyaltyQueryScope;
    /** When true, include paused KDP↔Ads links (deduped by shelf). Default false. */
    includePausedLinks?: boolean;
    /** When false, skip legacy kdp_accounts.amazon_profile_id matching. */
    allowLegacyProfileLinks?: boolean;
  },
): Promise<TopBookRow[]> {
  const { profileIds, start, end, limit = 5, filterUserId, activityDays = BOOKS_LIST_ACTIVITY_DAYS } = opts;
  const kdpLinkProfileIds = opts.kdpProfileIds !== undefined ? opts.kdpProfileIds : profileIds;
  const kdpScope = opts.kdpScope ?? "linked_profiles";
  const kdpOnlySession = kdpScope === "user_accounts";
  if (!profileIds.length && !kdpOnlySession) return [];

  // Only start the expensive Create-candidate shelf if the web/Nest books read
  // cannot answer this request. Running both paths for the same six-profile
  // portfolio made Books exceed its 60-second guard on a physical device.
  let nestShelfPromise: Promise<TopBookRow[]> | null = null;
  /** Nest break-even rows kept for Books catalog union (not used as sole source). */
  let nestBooksCatalogSeed: TopBookRow[] = [];

  let kdpAccountIds: string[] = [];
  try {
    kdpAccountIds = await fetchKdpAccountIdsForRoyaltyQuery(kdpLinkProfileIds, kdpScope, {
      includePausedLinks: opts.includePausedLinks,
      allowLegacyProfileLinks: opts.allowLegacyProfileLinks,
    });
  } catch (error) {
    if (await hasNestToken()) {
      const nestRows = await fetchNestTopBooks({
        filterUserId,
        startDate: start,
        endDate: end,
        profileIds,
        limit,
      });
      return finalizeTopBooksList(nestRows, profileIds, [], limit, activityDays);
    }
    logBooksStage("kdp_account_links", error);
    throw new BooksReadError("kdp_account_links", booksErrorCode(error));
  }

  if (await hasNestToken()) {
    try {
      const nestRows = await fetchNestTopBooks({
        filterUserId,
        startDate: start,
        endDate: end,
        profileIds,
        limit,
      });
      // Admin view-as cannot safely use the local exact-ASIN catalog merge.
      if (filterUserId) {
        return finalizeTopBooksList(nestRows, profileIds, kdpAccountIds, limit, activityDays);
      }
      // Ranked/activity lists (Overview widgets): Nest book-profitability is the
      // web-owned read — prefer it and skip the heavier Create/KDP catalog path.
      // Books tab catalog (activityDays <= 0): Nest alone omits titles still on
      // the KDP/Create shelf — fall through and union in finalizeCatalogBooksList.
      if (nestRows.length && activityDays > 0) {
        return finalizeTopBooksList(nestRows, profileIds, kdpAccountIds, limit, activityDays);
      }
      if (nestRows.length && activityDays <= 0) {
        nestBooksCatalogSeed = nestRows;
      }
    } catch (error) {
      if (filterUserId) throw error;
      logBooksStage("nest_top_books", error);
    }
  }

  if (activityDays <= 0) {
    // Start the fallback shelf in parallel with local KDP/Ads assembly.
    nestShelfPromise = nestShelfCatalogRows();
  }

  if (kdpAccountIds.length) {
    const kdpCoveragePromise = fetchRequiredPages<any>("kdp_daily_coverage", (from, to) =>
      supabase
        .from("kdp_daily_data")
        .select("account_id, date")
        .in("account_id", kdpAccountIds)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("account_id", { ascending: true })
        .range(from, to),
    ).catch((error) => {
      logBooksStage("kdp_coverage", error);
      return null;
    });
    const kdpRowsRaw = await fetchRequiredPages<any>("kdp_book_daily_data", (from, to) =>
      supabase
        .from("kdp_book_daily_data")
        .select(
          "account_id, asin, group_key, royalties, orders, ebook_royalties, paperback_royalties, kenp_royalties",
        )
        .in("account_id", kdpAccountIds)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("asin", { ascending: true })
        .range(from, to),
    );
    const quarantineEntries = await loadShelfHealQuarantineEntries();
    const { filterRowsExcludingQuarantine } = await import("./kdp/shelfHeal.ts");
    const kdpRows = filterRowsExcludingQuarantine(kdpRowsRaw, quarantineEntries);

    const catalogRows = await fetchRequiredPages<any>("kdp_book_formats", (from, to) =>
      supabase
        .from("kdp_book_formats")
        .select("account_id, book_id, asin")
        .in("account_id", kdpAccountIds)
        .order("account_id", { ascending: true })
        .order("book_id", { ascending: true })
        .order("asin", { ascending: true })
        .range(from, to),
    );
    const catalogIdentity = verifiedKdpBookCatalog(catalogRows);
    // Keep DIGITAL=/PRINT= daily keys; catalog only expands siblings / fills gaps.
    const asinToGroup = mergeCatalogIntoDailyAsinGroups(
      verifiedAsinGroupsFromDailyRows(kdpRows),
      catalogIdentity,
    );

    if (kdpRows.length || asinToGroup.size) {
      const groups = new Map<string, LogicalBookAccumulator>();
      const kdpGroupKeys = new Set<string>();

      for (const [catalogKey, catalogAsins] of catalogIdentity.asinsByGroup) {
        const remappedKey =
          catalogAsins.map((asin) => asinToGroup.get(asin)).find((key) => !!key) || catalogKey;
        const primary = primaryAsinFromGroupKey(remappedKey, catalogAsins) || catalogAsins[0];
        if (!primary) continue;
        const group = groups.get(remappedKey) ?? emptyLogicalBook(primary);
        for (const catalogAsin of catalogAsins) group.asins.add(catalogAsin);
        groups.set(remappedKey, group);
        kdpGroupKeys.add(remappedKey);
      }

      for (const row of kdpRows) {
        const asin = String((row as any).asin ?? "").trim().toUpperCase();
        if (!asin) continue;
        const groupKey = asinToGroup.get(asin) || String((row as any).group_key ?? "").trim() || asin;
        kdpGroupKeys.add(groupKey);
        const current = groups.get(groupKey) ?? emptyLogicalBook(asin);
        current.asins.add(asin);
        current.royalties += bookDailyRoyaltiesTotal(row as any);
        current.kdp_orders += toNumber((row as any).orders);
        groups.set(groupKey, current);
      }

      const allAsins = uniqueStrings(Array.from(groups.values()).flatMap((group) => Array.from(group.asins)));
      const kdpCoverageRows = await kdpCoveragePromise;
      const kdpCoverage = kdpCoverageRows
        ? aggregateKdpDailyRows(kdpCoverageRows, kdpAccountIds.length, {
            start,
            end,
            source: "kdp_daily_data",
          })
        : null;
      const rangeKdpState = kdpCoverage?.coverage === "complete" ? "ready" : "partial";
      /** Logical book keys with ≥1 product_ad that has a campaign_id. */
      const booksWithCampaigns = new Set<string>();

      const { data: bookProfileRows, error: bookProfileError } = await supabase
        .from("amazon_profiles")
        .select("id, profile_id, currency_code")
        .in("id", profileIds);
      if (bookProfileError) throw new BooksReadError("book_profile_currency", booksErrorCode(bookProfileError));
      const bookCurrencyByProfileId = new Map<string, string>();
      for (const profile of bookProfileRows ?? []) {
        const currency = String(profile.currency_code || "").trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(currency)) {
          bookCurrencyByProfileId.set(String(profile.id), currency);
          if (profile.profile_id) bookCurrencyByProfileId.set(String(profile.profile_id), currency);
        }
      }
      const bookCurrencies = [...new Set(bookCurrencyByProfileId.values())];
      if (!kdpOnlySession && profileIds.some((id) => !bookCurrencyByProfileId.has(id))) {
        throw new BooksReadError("book_profile_currency", "currency_unavailable");
      }
      const bookKdpComparable = kdpOnlySession || (bookCurrencies.length === 1
        ? bookCurrencies[0] === "USD"
        : bookCurrencies.includes("USD"));
      const bookFxRates = bookCurrencies.length > 1
        ? await fetchFxDailyRates({ startDate: start, endDate: end, fromCurrencies: bookCurrencies, toCurrency: "USD" })
        : undefined;
      const bookAdsAmount = (amount: unknown, date: unknown, profileId: unknown): number => {
        const native = toNumber(amount);
        if (!native || bookCurrencies.length < 2) return native;
        const from = bookCurrencyByProfileId.get(String(profileId || ""));
        const converted = from
          ? convertAdsAmount(native, String(date || "").slice(0, 10), from, "USD", bookFxRates ?? new Map())
          : null;
        if (converted == null) throw new BooksReadError("book_fx", "rate_unavailable");
        return converted;
      };

      const finalizeBook = (row: ReturnType<typeof assembleLogicalBookRows>[number], adsState: "ready" | "pending"): TopBookRow => {
        const hasBookKdp = bookKdpComparable && (kdpGroupKeys.has(row.book_key) || row.royalties > 0);
        const kdpState = hasBookKdp ? rangeKdpState : "missing";
        const royalties = hasBookKdp ? row.royalties : null;
        const hasFormatActivity = (royalties != null && royalties !== 0) || toNumber(row.kdp_orders) > 0;
        const hasCampaign = booksWithCampaigns.has(row.book_key);
        return {
          ...row,
          royalties,
          net:
            hasBookKdp && adsState === "ready" && royalties != null
              ? netRoyaltiesKnown(royalties, row.spend)
              : null,
          ads_state: adsState,
          kdp_state: kdpState,
          has_format_activity: hasFormatActivity,
          has_campaign: hasCampaign,
          sponsorable: false,
        };
      };

      const adsPromise = fetchOptionalInPages<any>("product_ads", profileIds, (chunk, from, to) =>
        supabase
          .from("product_ads")
          .select("id, asin, sku, title, image_url, amazon_profile_id, campaign_id, status, total_sales, total_orders")
          .in("amazon_profile_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const titlesRaw = await fetchOptionalInPages<any>("kdp_titles", allAsins, (chunk, from, to) =>
        supabase
          .from("kdp_titles")
          .select("asin, title, cover_url, amazon_image_url, kdp_list_price, net_royalty_per_sale, target_break_even_acos, account_id")
          .in("account_id", kdpAccountIds)
          .in("asin", chunk)
          .order("asin", { ascending: true })
          .range(from, to),
      );
      const titles = filterRowsExcludingQuarantine(titlesRaw, quarantineEntries);

      for (const title of titles) {
        const asin = String((title as any).asin ?? "").trim().toUpperCase();
        const mappedKey = logicalBookKeyForAdvertisedAsin(asin, asinToGroup);
        if (!mappedKey) continue;
        const group = groups.get(mappedKey);
        if (!group) continue;
        const bibliographic = typeof (title as any).title === "string" ? (title as any).title : null;
        // Prefer newer edition-year title (Print 2027 over Kindle 2026 sibling).
        group.title = preferEditionTitle(group.title, bibliographic);
        group.image_url = pickUsableCoverUrl(group.image_url, (title as any).cover_url, (title as any).amazon_image_url);
        const calculatorBe = calculatorBreakEvenFromKdpTitle(title as any);
        if (calculatorBe != null) group.breakeven_candidates.push(calculatorBe);
      }

      if (opts.onCoreRows) {
        const core = assembleLogicalBookRows(groups)
          .filter((row) => row.royalties !== 0 || row.orders > 0)
          .sort((a, b) => (b.royalties ?? Number.NEGATIVE_INFINITY) - (a.royalties ?? Number.NEGATIVE_INFINITY))
          .slice(0, limit)
          .map((row) => finalizeBook(row, "pending"));
        if (core.length) opts.onCoreRows(core);
      }

      const adRows = await adsPromise;
      if ((adRows as any[]).some((ad) =>
        !bookCurrencyByProfileId.has(String(ad.amazon_profile_id || "")),
      )) {
        throw new BooksReadError("book_profile_currency", "currency_unavailable");
      }
      const adById = new Map(adRows.map((ad: any) => [ad.id, ad]));
      const adIds = uniqueStrings(adRows.map((ad: any) => ad.id));

      const campaignIdsFromAds = uniqueStrings(
        (adRows as any[]).map((ad) => String(ad.campaign_id || "").trim()).filter(Boolean),
      );
      const enabledCampaignIds = new Set<string>();
      for (let i = 0; i < campaignIdsFromAds.length; i += 200) {
        const chunk = campaignIdsFromAds.slice(i, i + 200);
        const { data: campaigns, error } = await supabase
          .from("campaigns")
          .select("id, state")
          .in("id", chunk)
          .in("state", ["enabled"]);
        if (error) throw error;
        for (const row of campaigns ?? []) {
          enabledCampaignIds.add(String((row as any).id));
        }
      }

      for (const ad of adRows as any[]) {
        const asin = String(ad.asin || ad.sku || "").trim().toUpperCase();
        if (!asin) continue;
        const mappedKey = logicalBookKeyForAdvertisedAsin(asin, asinToGroup);
        if (!mappedKey) continue;
        const group = groups.get(mappedKey);
        if (!group) continue;
        group.title = preferEditionTitle(
          group.title,
          typeof ad.title === "string" ? ad.title : null,
        );
        group.image_url = pickUsableCoverUrl(group.image_url, ad.image_url);
        const campaignId = String(ad.campaign_id || "").trim();
        const adStatus = String(ad.status || ad.state || "")
          .trim()
          .toLowerCase();
        // Active campaign only: enabled campaign + enabled product ad when status known.
        const adLive = !adStatus || adStatus === "enabled";
        if (campaignId && enabledCampaignIds.has(campaignId) && adLive) {
          booksWithCampaigns.add(mappedKey);
        }
      }

      const metrics = await fetchOptionalInPages<any>("product_ad_metrics", adIds, (chunk, from, to) =>
        supabase
          .from("product_ad_metrics")
          .select("product_ad_id, date, impressions, clicks, orders, spend, sales")
          .in("product_ad_id", chunk)
          .gte("date", start)
          .lte("date", end)
          .order("product_ad_id", { ascending: true })
          .order("date", { ascending: true })
          .range(from, to),
      );

      const campaignsWithProductAdMetrics = new Set<string>();

      /** Ads ASINs without a KDP bridge still get a list row when period metrics exist. */
      const ensureAdsMetricGroup = (asin: string): LogicalBookAccumulator | null => {
        const normalized = String(asin || "")
          .trim()
          .toUpperCase();
        if (!normalized) return null;
        let mappedKey = logicalBookKeyForAdvertisedAsin(normalized, asinToGroup);
        if (!mappedKey) {
          mappedKey = normalized;
          if (!asinToGroup.has(normalized)) asinToGroup.set(normalized, mappedKey);
        }
        let group = groups.get(mappedKey);
        if (!group) {
          group = emptyLogicalBook(normalized);
          groups.set(mappedKey, group);
        }
        return group;
      };

      for (const metric of metrics) {
        const ad = adById.get((metric as any).product_ad_id) as any;
        const asin = String(ad?.asin || ad?.sku || "").trim().toUpperCase();
        if (!asin) continue;
        const hasMetricValue =
          toNumber((metric as any).spend) > 0 ||
          toNumber((metric as any).sales) > 0 ||
          toNumber((metric as any).impressions) > 0 ||
          toNumber((metric as any).clicks) > 0 ||
          toNumber((metric as any).orders) > 0;
        // Only open an ads-only group when the period actually has a number.
        const group = hasMetricValue
          ? ensureAdsMetricGroup(asin)
          : (() => {
              const mappedKey = logicalBookKeyForAdvertisedAsin(asin, asinToGroup);
              return mappedKey ? groups.get(mappedKey) ?? null : null;
            })();
        if (!group) continue;
        if (hasMetricValue && ad?.campaign_id) campaignsWithProductAdMetrics.add(String(ad.campaign_id));
        group.spend += bookAdsAmount((metric as any).spend, (metric as any).date, ad?.amazon_profile_id);
        group.sales += bookAdsAmount((metric as any).sales, (metric as any).date, ad?.amazon_profile_id);
        group.impressions += toNumber((metric as any).impressions);
        group.clicks += toNumber((metric as any).clicks);
        group.orders += toNumber((metric as any).orders);
        if (hasMetricValue) {
          group.title = preferEditionTitle(
            group.title,
            typeof ad?.title === "string" ? ad.title : null,
          );
          group.image_url = pickUsableCoverUrl(group.image_url, ad?.image_url);
        }
      }

      // A verified single-book campaign can safely supply totals when Amazon's
      // product-ad report has no period rows. This never uses campaign names.
      const verifiedCampaignBooks = verifiedCampaignLogicalBooks(adRows, asinToGroup);
      const campaignProfileById = new Map<string, string>();
      for (const ad of adRows as any[]) {
        const campaignId = String(ad.campaign_id || "");
        const profileId = String(ad.amazon_profile_id || "");
        if (!campaignId || !profileId) continue;
        const prior = campaignProfileById.get(campaignId);
        if (prior && prior !== profileId) {
          throw new BooksReadError("book_profile_currency", "ambiguous_campaign_profile");
        }
        campaignProfileById.set(campaignId, profileId);
      }
      const fallbackCampaignIds = [...verifiedCampaignBooks.keys()].filter(
        (campaignId) => !campaignsWithProductAdMetrics.has(campaignId),
      );
      const campaignMetrics = await fetchOptionalInPages<any>("verified_book_campaign_metrics", fallbackCampaignIds, (chunk, from, to) =>
        supabase
          .from("campaign_metrics")
          .select("campaign_id, date, impressions, clicks, orders, spend, sales")
          .in("campaign_id", chunk)
          .gte("date", start)
          .lte("date", end)
          .order("campaign_id", { ascending: true })
          .order("date", { ascending: true })
          .range(from, to),
      );
      for (const metric of campaignMetrics) {
        const campaignId = String((metric as any).campaign_id ?? "");
        const mappedKey = verifiedCampaignBooks.get(campaignId);
        const group = mappedKey ? groups.get(mappedKey) : undefined;
        if (!group) continue;
        group.spend += bookAdsAmount((metric as any).spend, (metric as any).date, campaignProfileById.get(campaignId));
        group.sales += bookAdsAmount((metric as any).sales, (metric as any).date, campaignProfileById.get(campaignId));
        group.impressions += toNumber((metric as any).impressions);
        group.clicks += toNumber((metric as any).clicks);
        group.orders += toNumber((metric as any).orders);
      }

      const assembled = assembleLogicalBookRows(groups)
        .map((row) => finalizeBook(row, "ready"))
        // Catalog mode keeps zero-signal shelf titles; ranked mode keeps activity only.
        .filter(
          (row) =>
            activityDays <= 0 || row.royalties !== 0 || row.spend > 0 || row.orders > 0,
        )
        .sort((a, b) => {
          if (a.net == null && b.net == null) return b.spend - a.spend;
          return (b.net ?? Number.NEGATIVE_INFINITY) - (a.net ?? Number.NEGATIVE_INFINITY);
        });
      if (activityDays <= 0) {
        return finalizeCatalogBooksList(
          nestBooksCatalogSeed.length
            ? mergeTopBookCatalogRows(assembled, nestBooksCatalogSeed)
            : assembled,
          profileIds,
          kdpAccountIds,
          limit,
          await (nestShelfPromise ?? Promise.resolve([])),
        );
      }
      return finalizeTopBooksList(assembled, profileIds, kdpAccountIds, limit, activityDays);
    }
  }

  // Catalog mode: union Nest shelf + break-even metrics so Books is not limited
  // to Nest activity-ranked rows (and never applies stale-dead suggestion filters).
  if (activityDays <= 0) {
    return finalizeCatalogBooksList(
      nestBooksCatalogSeed,
      profileIds,
      kdpAccountIds,
      limit,
      await (nestShelfPromise ?? Promise.resolve([])),
    );
  }

  // Catalog mode with no KDP daily rows: Nest break-even + Create shelf still
  // union in finalizeCatalogBooksList. Ads-only ASINs with period metrics are
  // opened via ensureAdsMetricGroup when KDP groups exist above.
  return [];
}

// ---------- Optimization Rules ----------
export interface CreateRuleInput {
  name: string;
  targetEntity: string;
  conditions: { metric: string; comparison: string; value: number; days: number; placement?: string }[];
  action: { type: string; [key: string]: unknown };
  checkFrequencyHours: number;
  amazonProfileIds?: string[] | null;
  targetEntityType?: unknown;
  priority?: number;
}

// Nest RuleActionDto has no `matchType` (match lives on `value`) and rejects unknown keys.
function nestRuleAction(action: CreateRuleInput["action"]): Record<string, unknown> {
  const { matchType, ...rest } = action;
  if (rest.value == null && typeof matchType === "string") {
    rest.value = matchType;
  }
  return rest;
}

// Create an optimization rule through the backend (POST /rules), NOT a direct
// Supabase insert — so the server runs plan + compatibility validation first and
// writes with the service role (same path the web app uses). Auth uses the Nest
// API token (see rulesApi.ts), refreshed automatically on 401.
// Rules are ALWAYS created disabled: an enabled rule can change real bids/budgets,
// so the author reviews and turns it on afterwards.
export async function createOptimizationRule(input: CreateRuleInput): Promise<unknown> {
  const payload = {
    name: input.name,
    enabled: false,
    priority: input.priority ?? 1,
    targetEntity: input.targetEntity,
    targetEntityType: input.targetEntityType ?? { by_group: "all" },
    campaignFilter: null,
    amazonProfileIds: input.amazonProfileIds ?? undefined,
    conditions: input.conditions,
    action: nestRuleAction(input.action),
    checkFrequencyHours: input.checkFrequencyHours,
  };

  const res = await rulesApiFetch("/rules", { method: "POST", body: JSON.stringify(payload) });

  if (!res.ok) throw await parseNestError(res, "Couldn't create that rule.");
  return res.json();
}

async function rulesApiError(res: Response, fallback: string): Promise<Error> {
  return parseNestError(res, fallback);
}

// Enable / pause a rule via the backend (validated server-side, incl. plan limits on enable).
export async function toggleOptimizationRule(id: string, enabled: boolean): Promise<unknown> {
  const res = await rulesApiFetch(`/rules/${id}/toggle`, { method: "PATCH", body: JSON.stringify({ enabled }) });
  if (!res.ok) throw await rulesApiError(res, enabled ? "Couldn't enable rule" : "Couldn't pause rule");
  return res.json();
}

// Edit a rule's name / conditions / action / frequency. Leaves enabled + target entity unchanged.
export async function updateOptimizationRule(id: string, input: Partial<CreateRuleInput>): Promise<unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.conditions !== undefined) payload.conditions = input.conditions;
  if (input.action !== undefined) payload.action = nestRuleAction(input.action);
  if (input.checkFrequencyHours !== undefined) payload.checkFrequencyHours = input.checkFrequencyHours;
  if (input.priority !== undefined) payload.priority = input.priority;
  const res = await rulesApiFetch(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  if (!res.ok) throw await rulesApiError(res, "Couldn't save rule");
  return res.json();
}

export async function deleteOptimizationRule(id: string): Promise<void> {
  const res = await rulesApiFetch(`/rules/${id}`, { method: "DELETE" });
  if (!res.ok) throw await rulesApiError(res, "Couldn't delete rule");
}

export async function fetchOptimizationRules(userId: string, profileIds?: string[]): Promise<OptimizationRule[]> {
  const { data, error } = await supabase
    .from("optimization_rules")
    .select("*")
    .eq("user_id", userId)
    .order("priority", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as OptimizationRule[]).filter((rule) => ruleAppliesToProfiles(rule, profileIds));
}

export async function fetchRuleExecutions(opts: { ruleId?: string; userId?: string; profileIds?: string[] } = {}): Promise<RuleExecutionWithName[]> {
  const { ruleId, userId, profileIds } = opts;
  if (!userId && !ruleId) return [];
  let q = supabase
    .from("rule_execution_history")
    .select("*, optimization_rules!rule_id(name, target_entity)")
    .order("executed_at", { ascending: false })
    .limit(RULE_ACTIVITY_LIMIT);

  if (userId) {
    const ruleIds = await fetchRuleIdsForUser(userId, profileIds);
    if (ruleId && !ruleIds.includes(ruleId)) return [];
    const scopedRuleIds = ruleId ? [ruleId] : ruleIds;
    if (!scopedRuleIds.length) return [];
    q = q.in("rule_id", scopedRuleIds);
  } else if (ruleId) {
    q = q.eq("rule_id", ruleId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RuleExecutionWithName[];
}

export async function fetchRuleExecutionEntities(executionIds: string[]): Promise<RuleExecutionEntity[]> {
  if (!executionIds.length) return [];
  const rows: RuleExecutionEntity[] = [];
  for (const chunk of chunkArray(executionIds, 200)) {
    const { data, error } = await supabase
      .from("rule_execution_entities")
      .select("*")
      .in("execution_id", chunk)
      .order("processed_at", { ascending: false });
    if (error) throw error;
    rows.push(...((data ?? []) as RuleExecutionEntity[]));
  }
  return enrichRuleExecutionEntities(rows);
}

function metaString(meta: any, keys: string[]): string | null {
  if (!meta || typeof meta !== "object") return null;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function enrichRuleExecutionEntities(rows: RuleExecutionEntity[]): Promise<RuleExecutionEntity[]> {
  if (!rows.length) return rows;

  const campaignIds = uniqueStrings([
    ...rows.map((row) => row.campaign_id),
    ...rows.map((row) => row.to_campaign_id),
    ...rows.map((row) => metaString(row.new_value_meta, ["campaign_id", "source_campaign_id"])),
    ...rows.map((row) => metaString(row.new_value_meta, ["to_campaign_id", "destination_campaign_id"])),
  ]);
  const adGroupIds = uniqueStrings([
    ...rows.map((row) => row.ad_group_id),
    ...rows.map((row) => metaString(row.new_value_meta, ["ad_group_id", "source_ad_group_id"])),
    ...rows.map((row) => metaString(row.new_value_meta, ["to_ad_group_id", "destination_ad_group_id"])),
  ]);

  const campaignNameById = new Map<string, string>();
  for (const chunk of chunkArray(campaignIds, 500)) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id,name")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as any).id;
      if (id) campaignNameById.set(id, (row as any).name ?? "Campaign");
    }
  }

  const adGroupNameById = new Map<string, string>();
  for (const chunk of chunkArray(adGroupIds, 500)) {
    const { data, error } = await supabase
      .from("ad_groups")
      .select("id,name")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as any).id;
      if (id) adGroupNameById.set(id, (row as any).name ?? "Ad group");
    }
  }

  return rows.map((row) => {
    const meta = row.new_value_meta ?? {};
    const sourceCampaignId = row.campaign_id ?? metaString(meta, ["campaign_id", "source_campaign_id"]);
    const destinationCampaignId = row.to_campaign_id ?? metaString(meta, ["to_campaign_id", "destination_campaign_id"]);
    const sourceAdGroupId = row.ad_group_id ?? metaString(meta, ["ad_group_id", "source_ad_group_id"]);
    const destinationAdGroupId = metaString(meta, ["to_ad_group_id", "destination_ad_group_id"]);
    const campaignName =
      metaString(meta, ["campaign_name", "source_campaign_name"]) ??
      (sourceCampaignId ? campaignNameById.get(sourceCampaignId) ?? null : null);
    const toCampaignName =
      metaString(meta, ["to_campaign_name", "destination_campaign_name"]) ??
      (destinationCampaignId ? campaignNameById.get(destinationCampaignId) ?? null : null);
    const adGroupName =
      metaString(meta, ["ad_group_name", "source_ad_group_name"]) ??
      (sourceAdGroupId ? adGroupNameById.get(sourceAdGroupId) ?? null : null);
    const toAdGroupName =
      metaString(meta, ["to_ad_group_name", "destination_ad_group_name"]) ??
      (destinationAdGroupId ? adGroupNameById.get(destinationAdGroupId) ?? null : null);
    const action = String(row.action_type ?? "").toLowerCase();
    const originLabel = metaString(meta, ["origin", "source", "from"]) ?? adGroupName ?? campaignName;
    const destinationLabel =
      metaString(meta, ["destination", "to"]) ??
      toAdGroupName ??
      toCampaignName ??
      (action.includes("negative") || action.includes("negat") ? "Negative targeting" : null);

    return {
      ...row,
      campaign_name: campaignName,
      to_campaign_name: toCampaignName,
      ad_group_name: adGroupName,
      origin_label: originLabel,
      destination_label: destinationLabel,
    };
  });
}

export async function fetchAdGroupAutomationHistory(
  profileIds: string[],
  adGroupId: string,
): Promise<Array<RuleExecutionEntity & { rule_name?: string | null; executed_at?: string | null }>> {
  if (!profileIds.length || !adGroupId) return [];

  const adGroup = await fetchAdGroups(profileIds).then((rows) => rows.find((row) => row.id === adGroupId));
  if (!adGroup) return [];

  const { data, error } = await supabase
    .from("rule_execution_entities")
    .select("*")
    .eq("ad_group_id", adGroupId)
    .order("processed_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  const rows = await enrichRuleExecutionEntities((data ?? []) as RuleExecutionEntity[]);
  const executionIds = uniqueStrings(rows.map((row) => row.execution_id));
  const runById = new Map<string, { rule_name: string | null; executed_at: string | null }>();
  if (executionIds.length) {
    for (const chunk of chunkArray(executionIds, 300)) {
      const { data: runs, error: runErr } = await supabase
        .from("rule_execution_history")
        .select("id,executed_at,optimization_rules!rule_id(name)")
        .in("id", chunk);
      if (runErr) throw runErr;
      for (const run of runs ?? []) {
        const rule = (run as any).optimization_rules;
        runById.set((run as any).id, {
          rule_name: Array.isArray(rule) ? rule[0]?.name ?? null : rule?.name ?? null,
          executed_at: (run as any).executed_at ?? null,
        });
      }
    }
  }

  return rows.map((row) => ({ ...row, ...(runById.get(row.execution_id) ?? {}) }));
}

// ---------- Profile Sync Logs ----------
export async function fetchProfileSyncLogs(profileIds: string[]): Promise<ProfileSyncLog[]> {
  if (!profileIds.length) return [];
  const { data, error } = await supabase
    .from("profile_sync_logs")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as ProfileSyncLog[];
}

export interface SyncOverview {
  sessions: SyncLog[];
  profiles: ProfileSyncLog[];
}

const SYNC_LOG_COLUMNS =
  "id,user_id,sync_type,status,records_synced,records_failed,error_message,started_at,completed_at,created_at";
const PROFILE_SYNC_LOG_COLUMNS =
  "id,amazon_profile_id,profile_name,status,campaigns_synced,campaigns_failed,keywords_synced,keywords_failed,product_ads_synced,product_ads_failed,ad_groups_synced,ad_groups_failed,product_targets_synced,product_targets_failed,error_message,started_at,completed_at";

export async function fetchSyncOverview(
  userId: string,
  profileIds: string[],
  options?: { includeSessions?: boolean },
): Promise<SyncOverview> {
  const includeSessions = options?.includeSessions !== false;
  // Narrow columns + modest limits: select(*) over wide log rows was stalling Sync.
  const [sessionsResult, profileResult] = await Promise.all([
    includeSessions
      ? supabase
          .from("sync_logs")
          .select(SYNC_LOG_COLUMNS)
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? supabase
          .from("profile_sync_logs")
          .select(PROFILE_SYNC_LOG_COLUMNS)
          .in("amazon_profile_id", profileIds)
          .order("started_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (sessionsResult.error) throw sessionsResult.error;
  if (profileResult.error) throw profileResult.error;
  return {
    sessions: (sessionsResult.data ?? []) as SyncLog[],
    profiles: (profileResult.data ?? []) as ProfileSyncLog[],
  };
}

export interface DataCoverageRow {
  key: string;
  label: string;
  count: number | null;
  status: "available" | "empty" | "missing" | "error";
  scope: "current" | "period";
}

export interface DataCoverageOverview {
  rows: DataCoverageRow[];
  ads: {
    status: "available" | "empty" | "missing" | "error";
    spend: number | null;
    attributedSales: number | null;
    attributedOrders: number | null;
    clicks: number | null;
    impressions: number | null;
    acos: number | null;
    ctr: number | null;
    activityDays: number | null;
    lastCompletedAt: string | null;
    syncStatus: "ok" | "needs_review" | "unknown" | "error";
  };
  kdp: {
    status: "available" | "empty" | "missing" | "error";
    linkedAccounts: number | null;
    royalties: number | null;
    orders: number | null;
    latestDataDate: string | null;
  };
}

export async function fetchDataCoverageOverview(
  profileIds: string[],
  start: string,
  end: string,
): Promise<DataCoverageOverview> {
  const [campaignsResult, kdpResult, kdpAccountsResult, metricRowsResult, syncRowsResult] =
    await Promise.allSettled([
      fetchCampaigns(profileIds),
      fetchKdpRoyaltiesRange(profileIds, start, end),
      fetchLinkedKdpAccountIds(profileIds),
      fetchCampaignMetricsRange(profileIds, start, end),
      fetchProfileSyncLogs(profileIds),
    ]);

  const campaigns = campaignsResult.status === "fulfilled" ? campaignsResult.value : [];
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const metrics =
    metricRowsResult.status === "fulfilled"
      ? aggregateDailyMetrics(metricRowsResult.value)
      : null;
  const totals = (metrics ?? []).reduce(
    (acc, row) => ({
      spend: acc.spend + row.spend,
      sales: acc.sales + row.sales,
      orders: acc.orders + row.orders,
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
    }),
    { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  );
  const kdp = kdpResult.status === "fulfilled" ? kdpResult.value : null;
  const kdpAccountIds =
    kdpAccountsResult.status === "fulfilled" ? kdpAccountsResult.value : null;
  const syncRows = syncRowsResult.status === "fulfilled" ? syncRowsResult.value : null;

  const countTable = async (
    key: string,
    label: string,
    scope: "current" | "period",
    query: PromiseLike<{ count: number | null; error: any }>,
    kind: "required" | "optional" = "optional",
  ): Promise<DataCoverageRow> => {
    try {
      const result = await query;
      if (result.error) return { key, label, count: null, status: "error", scope };
      const count = result.count ?? 0;
      return {
        key,
        label,
        count,
        status: count > 0 ? "available" : kind === "required" ? "missing" : "empty",
        scope,
      };
    } catch {
      return { key, label, count: null, status: "error", scope };
    }
  };

  const rows = await Promise.all([
    Promise.resolve({
      key: "profiles",
      label: "Selected Amazon profiles",
      count: profileIds.length,
      status: profileIds.length > 0 ? "available" : "missing",
      scope: "current",
    } as DataCoverageRow),
    Promise.resolve({
      key: "campaigns",
      label: "Campaigns",
      count: campaignsResult.status === "fulfilled" ? campaigns.length : null,
      status:
        campaignsResult.status === "rejected"
          ? "error"
          : campaigns.length > 0
            ? "available"
            : "missing",
      scope: "current",
    } as DataCoverageRow),
    Promise.resolve({
      key: "campaign_metrics",
      label: "Amazon Ads activity days",
      count: metricRowsResult.status === "rejected" ? null : (metrics?.length ?? 0),
      status:
        metricRowsResult.status === "rejected" || campaignsResult.status === "rejected"
          ? "error"
          : (metrics?.length ?? 0) > 0
            ? "available"
            : campaigns.length === 0
              ? "missing"
              : "empty",
      scope: "period",
    } as DataCoverageRow),
    campaignIds.length
      ? countTable(
          "campaign_placement_metrics",
          "Placement activity",
          "period",
          supabase
            .from("campaign_placement_metrics")
            .select("id", { count: "exact", head: true })
            .in("campaign_id", campaignIds)
            .gte("date", start)
            .lte("date", end),
        )
      : Promise.resolve({
          key: "campaign_placement_metrics",
          label: "Placement activity",
          count: campaignsResult.status === "rejected" ? null : 0,
          status: campaignsResult.status === "rejected" ? "error" : "missing",
          scope: "period",
        } as DataCoverageRow),
    Promise.resolve({
      key: "kdp_accounts",
      label: "Linked KDP accounts",
      count: kdpAccountIds?.length ?? null,
      status:
        kdpAccountsResult.status === "rejected"
          ? "error"
          : (kdpAccountIds?.length ?? 0) > 0
            ? "available"
            : "missing",
      scope: "current",
    } as DataCoverageRow),
    Promise.resolve({
      key: "kdp_daily_data",
      label: "KDP royalty days",
      count:
        kdpResult.status === "rejected" || kdpAccountsResult.status === "rejected"
          ? null
          : (kdp?.daily.length ?? 0),
      status:
        kdpResult.status === "rejected" || kdpAccountsResult.status === "rejected"
          ? "error"
          : (kdp?.daily.length ?? 0) > 0
            ? "available"
            : (kdpAccountIds?.length ?? 0) === 0
              ? "missing"
              : "empty",
      scope: "period",
    } as DataCoverageRow),
    countTable(
      "ad_groups",
      "Ad groups",
      "current",
      supabase
        .from("ad_groups")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
    countTable(
      "keywords",
      "Keywords",
      "current",
      supabase
        .from("keywords")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
    countTable(
      "product_ads",
      "Advertised products",
      "current",
      supabase
        .from("product_ads")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
    countTable(
      "product_targets",
      "Product targets",
      "current",
      supabase
        .from("product_targets")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
    campaignIds.length
      ? countTable(
          "search_terms",
          "Search terms",
          "current",
          supabase
            .from("search_terms")
            .select("id", { count: "exact", head: true })
            .in("campaign_id", campaignIds),
        )
      : Promise.resolve({
          key: "search_terms",
          label: "Search terms",
          count: campaignsResult.status === "rejected" ? null : 0,
          status: campaignsResult.status === "rejected" ? "error" : "missing",
          scope: "current",
        } as DataCoverageRow),
    countTable(
      "negative_keywords",
      "Negative keywords",
      "current",
      supabase
        .from("negative_keywords")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
    countTable(
      "negative_product_targets",
      "Negative product targets",
      "current",
      supabase
        .from("negative_product_targets")
        .select("id", { count: "exact", head: true })
        .in("amazon_profile_id", profileIds),
    ),
  ]);

  const adsStatus: DataCoverageOverview["ads"]["status"] =
    campaignsResult.status === "rejected" || metricRowsResult.status === "rejected"
      ? "error"
      : campaigns.length === 0
        ? "missing"
        : (metrics?.length ?? 0) === 0
          ? "empty"
          : "available";
  const kdpStatus: DataCoverageOverview["kdp"]["status"] =
    kdpAccountsResult.status === "rejected" || kdpResult.status === "rejected"
      ? "error"
      : (kdpAccountIds?.length ?? 0) === 0
        ? "missing"
        : !kdp?.hasKdpData
          ? "empty"
          : "available";
  const terminalFailures =
    syncRows?.some((row) => row.status === "failed" || row.status === "partial_failed") ??
    false;
  const lastCompletedAt =
    syncRows
      ?.filter((row) => row.status === "completed" && row.completed_at)
      .map((row) => row.completed_at as string)
      .sort()
      .at(-1) ?? null;

  return {
    rows,
    ads: {
      status: adsStatus,
      spend: adsStatus === "error" || adsStatus === "missing" ? null : totals.spend,
      attributedSales:
        adsStatus === "error" || adsStatus === "missing" ? null : totals.sales,
      attributedOrders:
        adsStatus === "error" || adsStatus === "missing" ? null : totals.orders,
      clicks: adsStatus === "error" || adsStatus === "missing" ? null : totals.clicks,
      impressions:
        adsStatus === "error" || adsStatus === "missing" ? null : totals.impressions,
      acos:
        adsStatus === "error" || adsStatus === "missing" || totals.sales <= 0
          ? null
          : safeDivide(totals.spend, totals.sales) * 100,
      ctr:
        adsStatus === "error" || adsStatus === "missing" || totals.impressions <= 0
          ? null
          : safeDivide(totals.clicks, totals.impressions) * 100,
      activityDays: metrics?.length ?? null,
      lastCompletedAt,
      syncStatus:
        syncRowsResult.status === "rejected"
          ? "error"
          : terminalFailures
            ? "needs_review"
            : lastCompletedAt
              ? "ok"
              : "unknown",
    },
    kdp: {
      status: kdpStatus,
      linkedAccounts: kdpAccountIds?.length ?? null,
      royalties: kdp?.hasKdpData ? kdp.totalRoyalties : null,
      orders: kdp?.hasKdpData ? kdp.totalOrders : null,
      latestDataDate: kdp?.daily.at(-1)?.date ?? null,
    },
  };
}

import { safeDivide } from "./format";

export function aggregateTotals<T extends MetricsTotals>(rows: T[]): MetricsTotals {
  const acc = rows.reduce(
    (a, r) => ({
      total_impressions: a.total_impressions + (Number(r.total_impressions) || 0),
      total_clicks: a.total_clicks + (Number(r.total_clicks) || 0),
      total_orders: a.total_orders + (Number(r.total_orders) || 0),
      total_sales: a.total_sales + (Number(r.total_sales) || 0),
      total_spend: a.total_spend + (Number(r.total_spend) || 0),
      total_acos: 0,
      total_ctr: 0,
      total_roas: 0,
      total_cpc: 0,
      total_conversion_rate: 0,
    }),
    {
      total_impressions: 0,
      total_clicks: 0,
      total_orders: 0,
      total_sales: 0,
      total_spend: 0,
      total_acos: 0,
      total_ctr: 0,
      total_roas: 0,
      total_cpc: 0,
      total_conversion_rate: 0,
    },
  );

  acc.total_acos = safeDivide(acc.total_spend, acc.total_sales) * 100;
  acc.total_roas = safeDivide(acc.total_sales, acc.total_spend);
  acc.total_ctr = safeDivide(acc.total_clicks, acc.total_impressions) * 100;
  acc.total_cpc = safeDivide(acc.total_spend, acc.total_clicks);
  acc.total_conversion_rate = safeDivide(acc.total_orders, acc.total_clicks) * 100;
  return acc;
}

/** Unused leftover. `total_sales * rate` is not KDP royalties and must not feed Home Net. */
export function toKpiSnapshot(t: MetricsTotals, royaltyRate: number, currency: string): KpiSnapshot {
  const royalties = t.total_sales * (royaltyRate / 100);
  return {
    spend: t.total_spend,
    sales: t.total_sales,
    orders: t.total_orders,
    impressions: t.total_impressions,
    clicks: t.total_clicks,
    acos: t.total_acos,
    roas: t.total_roas,
    ctr: t.total_ctr,
    cpc: t.total_cpc,
    net: royalties - t.total_spend,
    currency,
  };
}

// ---------- All enabled-campaign budgets (for budget pace widget) ----------
export async function fetchAllCampaignBudgets(profileIds: string[]): Promise<number> {
  if (!profileIds.length) return 0;
  const rows = await fetchAllPages<{ budget: number | null }>((from, to) =>
    supabase
      .from("campaigns")
      .select("budget")
      .in("amazon_profile_id", profileIds)
      .eq("state", "enabled")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.reduce((sum, c) => sum + (Number(c.budget) || 0), 0);
}

// ---------- Hourly metrics from ams_messages (real hour-level data) ----------
export async function fetchHourlyMetrics(
  profileIds: string[],
  startDate: string,
  endDate: string,
): Promise<HourlyMetric[]> {
  if (!profileIds.length) return [];

  const camps = await fetchAllPages<{ id: string }>((from, to) =>
    supabase
      .from("campaigns")
      .select("id")
      .in("amazon_profile_id", profileIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const campIds = camps.map((c) => c.id);
  if (!campIds.length) return [];

  // Chunk to avoid URL limits
  const chunks: string[][] = [];
  for (let i = 0; i < campIds.length; i += 200) chunks.push(campIds.slice(i, i + 200));

  const rows: HourlyMetric[] = [];
  for (const chunk of chunks) {
    const page = await fetchAllPages<HourlyMetric>((from, to) =>
      supabase
        .from("ams_messages")
        .select("date, hour, impressions, clicks, orders, spend, sales")
        .in("campaign_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("hour", { ascending: true })
        .range(from, to),
    );
    rows.push(...page);
  }
  return rows;
}

// ---------- Today's rule execution stats from rule_execution_batches ----------
export async function fetchTodayExecutionStats(userId: string, profileIds?: string[]): Promise<TodayExecutionStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (profileIds) {
    const ruleIds = await fetchRuleIdsForUser(userId, profileIds);
    if (!ruleIds.length) return { rulesRun: 0, entitiesEdited: 0, batchCount: 0 };

    const rows: any[] = [];
    for (const chunk of chunkArray(ruleIds, 500)) {
      const { data, error } = await supabase
        .from("rule_execution_history")
        .select("id, batch_id, entities")
        .in("rule_id", chunk)
        .gte("executed_at", todayStart.toISOString());
      if (error) throw error;
      rows.push(...(data ?? []));
    }

    const batchIds = uniqueStrings(rows.map((r) => r.batch_id));
    return {
      rulesRun: rows.length,
      entitiesEdited: rows.reduce((s, r) => s + (Number(r.entities) || 0), 0),
      batchCount: batchIds.length || rows.length,
    };
  }

  const { data, error } = await supabase
    .from("rule_execution_batches")
    .select("total_rules_to_execute, total_entities_affected, status")
    .eq("user_id", userId)
    .gte("started_at", todayStart.toISOString());
  if (error) throw error;

  const rows = (data ?? []) as any[];
  return {
    rulesRun: rows.reduce((s, r) => s + (Number(r.total_rules_to_execute) || 0), 0),
    entitiesEdited: rows.reduce((s, r) => s + (Number(r.total_entities_affected) || 0), 0),
    batchCount: rows.length,
  };
}

// ---------- User settings from user_settings table ----------
export async function fetchUserSettings(userId: string): Promise<Record<string, any>> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("field_name, value")
    .eq("user_id", userId);
  if (error) throw error;

  const result: Record<string, any> = {};
  for (const row of (data ?? []) as UserSetting[]) {
    // value is jsonb — unwrap primitive if needed
    result[row.field_name] = row.value;
  }

  const { data: kdpSettings, error: kdpErr } = await supabase
    .from("kdp_user_settings")
    .select("default_currency, timezone, dashboard_state, catchup_days, hourly_sync_interval_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (kdpErr) throw kdpErr;

  if (kdpSettings) {
    result.defaultCurrency = (kdpSettings as any).default_currency;
    result.timezone = (kdpSettings as any).timezone;
    result.catchupDays = (kdpSettings as any).catchup_days;
    result.hourlySyncIntervalMinutes = (kdpSettings as any).hourly_sync_interval_minutes;
    const dashboardState = (kdpSettings as any).dashboard_state;
    if (dashboardState && typeof dashboardState === "object") {
      Object.assign(result, dashboardState);
    }
  }
  return result;
}

// Persists a UI preference to user_settings. This is best-effort, non-critical
// cross-device persistence — if the remote write is blocked (e.g. RLS policy not
// configured) we log and continue rather than throwing an uncaught rejection.
// Returns true if the remote write succeeded.
export async function saveUserSetting(userId: string, fieldName: string, value: any): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, field_name: fieldName, value },
        { onConflict: "user_id,field_name" },
      );
    if (error) throw error;
    return true;
  } catch (err: any) {
    // Don't crash the app over a preference sync; surface quietly for debugging.
    // eslint-disable-next-line no-console
    console.warn(`[inteliads] saveUserSetting("${fieldName}") skipped:`, err?.message ?? err);
    return false;
  }
}

export { aggregateDailyMetrics, aggregateDailyMetricsForDisplay };
