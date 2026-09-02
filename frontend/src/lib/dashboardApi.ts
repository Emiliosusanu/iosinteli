// Nest dashboard reads — same filterUserId path as the web User dashboard.
// Admin JWTs cannot see another user's rows in Supabase RLS.

import { nestApiJson } from "./rulesApi";
import type { Campaign, CampaignMetric, Keyword, MetricsTotals, ProductTarget } from "./types";
import type { BookCampaignRow, KdpRoyaltyRange, TopBookRow, TopCampaignRow } from "./queries";
import type { MobileHomeSnapshot } from "./mobileHomeSnapshot";
import { netRoyaltiesKnown } from "./netRoyalties";

function qs(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type MetricsSummary = {
  totalSpend: number;
  totalSales: number;
  avgAcos: number;
  totalOrders: number;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgConversionRate: number;
  kdpRoyalties: number | null;
  kdpKenpPages: number | null;
  kdpDaysCovered: number;
  kdpDaysInRange: number;
  kdpDailyRoyalties?: Array<{ date: string; royalties: number }>;
};

export type DashboardMetrics = {
  activeCampaignsCount: number;
  totalCampaignsCount: number;
  metrics: MetricsSummary;
  previousMetrics: MetricsSummary;
};

export type DailyCombinedPoint = {
  date: string;
  royalties: number;
  spend: number;
  sales: number;
  clicks: number;
  impressions: number;
  orders: number;
};

export type KdpIncomeSpendNetPoint = {
  date: string;
  royalties: number;
  adSpend: number;
  net: number;
};

export type KdpBreakEvenBookRow = {
  asin: string;
  title: string | null;
  coverUrl: string | null;
  adSpend: number;
  adSales: number;
  orders: number;
  royalties: number;
  currentAcos: number | null;
  breakEvenAcos: number | null;
};

export type BleedingEntityRow = {
  id: string;
  kind: "keyword" | "asin" | "auto";
  label: string;
  spend: number;
  acos: number | null;
};

export type DashboardBootstrapResponse = {
  metrics: DashboardMetrics | null;
  netSeries: {
    data: KdpIncomeSpendNetPoint[];
    daysWithKdp?: number;
    daysInRange?: number;
    unavailable?: boolean;
  };
  topBooks: { data: KdpBreakEvenBookRow[]; daysInRange?: number; unavailable?: boolean };
  combinedDaily: { data: DailyCombinedPoint[]; unavailable?: boolean; adsIncomplete?: boolean };
  adsEngineDaily: { data: DailyCombinedPoint[]; unavailable?: boolean };
  bleedingEntities: {
    highAcos: BleedingEntityRow[];
    zeroSales: BleedingEntityRow[];
    rangeLabel: string;
    unavailable?: boolean;
  };
  partialFailures?: Array<{ section: string; message: string }>;
  cachedAt: string | null;
  stale: boolean;
};

export type EntityMetrics = {
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
  spend: number;
  acos: number;
  roas: number;
};

export type AggregatedEntityMetricsResponse = {
  data: Array<{ date: string }>;
  entities: Array<{
    id: string;
    name: string;
    state?: string;
    budget?: number;
    metrics: EntityMetrics;
  }>;
};

export function nestDashboardProfileIds(
  selectedIds: string[],
  profiles: Array<{ id: string; profile_id: string }>,
) {
  return selectedIds.map((id) => {
    const match = profiles.find((profile) => profile.id === id || profile.profile_id === id);
    return match?.profile_id || id;
  }).filter(Boolean);
}

export async function fetchDashboardBootstrap(params: {
  startDate: string;
  endDate: string;
  profileIds: string[];
  filterUserId?: string | null;
}): Promise<DashboardBootstrapResponse> {
  const path = `/dashboard/bootstrap${qs({
    startDate: params.startDate,
    endDate: params.endDate,
    profileIds: params.profileIds.join(","),
    filterUserId: params.filterUserId,
  })}`;
  return nestApiJson<DashboardBootstrapResponse>(path, { method: "GET" }, "Couldn't load dashboard.");
}

export async function fetchMobileOverview(params: {
  profileIds: string[];
  filterUserId?: string | null;
  timeZone?: string | null;
}): Promise<MobileHomeSnapshot> {
  const path = `/dashboard/mobile${qs({
    profileIds: params.profileIds.join(","),
    filterUserId: params.filterUserId,
    timeZone: params.timeZone,
  })}`;
  return nestApiJson<MobileHomeSnapshot>(path, { method: "GET" }, "Couldn't load Home.");
}

/** Nest compact snapshot when deployed; null if the route is missing or unusable. */
export async function tryFetchMobileOverview(params: {
  profileIds: string[];
  filterUserId?: string | null;
  timeZone?: string | null;
}): Promise<MobileHomeSnapshot | null> {
  try {
    const data = await fetchMobileOverview(params);
    if (data && data.schemaVersion === 1 && data.today?.date) return data;
    return null;
  } catch {
    return null;
  }
}

export async function fetchAggregatedCampaigns(params: {
  startDate: string;
  endDate: string;
  profileIds: string[];
  filterUserId?: string | null;
}): Promise<TopCampaignRow[]> {
  const data = await nestApiJson<AggregatedEntityMetricsResponse>(
    "/dashboard/aggregated-entity-metrics",
    {
      method: "POST",
      body: JSON.stringify({
        entityType: "campaigns",
        metrics: ["impressions", "clicks", "orders", "sales", "spend"],
        startDate: params.startDate,
        endDate: params.endDate,
        granularity: "day",
        profileIds: params.profileIds,
        includeAllStates: true,
        filterUserId: params.filterUserId || undefined,
      }),
    },
    "Couldn't load campaigns.",
  );
  return (data.entities ?? []).map((entity) => {
    const spend = n(entity.metrics?.spend);
    const sales = n(entity.metrics?.sales);
    return {
      id: entity.id,
      name: entity.name,
      type: null,
      state: entity.state ?? null,
      budget: entity.budget ?? null,
      bidding_strategy: null,
      placement_top_share: 0,
      placement_product_share: 0,
      placement_rest_share: 0,
      impressions: n(entity.metrics?.impressions),
      clicks: n(entity.metrics?.clicks),
      orders: n(entity.metrics?.orders),
      spend,
      sales,
      acos: sales > 0 ? (spend / sales) * 100 : n(entity.metrics?.acos),
      roas: spend > 0 ? sales / spend : n(entity.metrics?.roas),
      net: 0,
    };
  });
}

export function dailyPointsToMetrics(points: DailyCombinedPoint[]): CampaignMetric[] {
  return points.map((point) => {
    const spend = n(point.spend);
    const sales = n(point.sales);
    const clicks = n(point.clicks);
    const impressions = n(point.impressions);
    const orders = n(point.orders);
    return {
      id: `nest-${point.date}`,
      campaign_id: "nest",
      date: point.date,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : null,
      spend,
      sales,
      orders,
      acos: sales > 0 ? (spend / sales) * 100 : null,
      roas: spend > 0 ? sales / spend : null,
      cpc: clicks > 0 ? spend / clicks : null,
      conversion_rate: clicks > 0 ? orders / clicks : null,
    };
  });
}

export function bootstrapToCampaignMetrics(boot: DashboardBootstrapResponse | undefined): CampaignMetric[] {
  if (!boot) return [];
  const ads = boot.adsEngineDaily?.data ?? [];
  const combined = boot.combinedDaily?.data ?? [];
  return dailyPointsToMetrics(ads.length ? ads : combined);
}

export function bootstrapToRoyalties(boot: DashboardBootstrapResponse | undefined): KdpRoyaltyRange {
  if (!boot) return emptyKdpRange();

  const fromMetrics = boot.metrics?.metrics.kdpDailyRoyalties ?? [];
  const fromNet = boot.netSeries?.data ?? [];
  const fromCombined = boot.combinedDaily?.data ?? [];

  const byDate = new Map<string, { date: string; royalties: number; orders: number }>();
  const add = (date: string, royalties: number, orders = 0) => {
    if (!date) return;
    const current = byDate.get(date) ?? { date, royalties: 0, orders: 0 };
    if (royalties) current.royalties = royalties;
    if (orders) current.orders += orders;
    byDate.set(date, current);
  };

  for (const row of fromCombined) add(row.date, n(row.royalties), n(row.orders));
  for (const row of fromNet) add(row.date, n(row.royalties));
  for (const row of fromMetrics) add(row.date, n(row.royalties));

  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  const summary = boot.metrics?.metrics;
  const totalRoyalties = summary?.kdpRoyalties ?? daily.reduce((sum, row) => sum + row.royalties, 0);
  const coveredDays = Math.max(0, n(summary?.kdpDaysCovered));
  const daysInRange = Math.max(0, n(summary?.kdpDaysInRange));
  const hasKdpData = summary?.kdpRoyalties != null || daily.length > 0;
  const coverage = !hasKdpData
    ? "missing"
    : daysInRange > 0 && coveredDays >= daysInRange
      ? "complete"
      : "partial";
  return {
    hasKdpData,
    totalRoyalties: n(totalRoyalties),
    totalOrders: daily.reduce((sum, row) => sum + row.orders, 0),
    daily,
    coverage,
    coveredDays,
    daysInRange,
    coveredAccountDays: coveredDays,
    expectedAccountDays: daysInRange,
    completeness: coverage === "complete" ? "COMPLETE" : coverage === "partial" ? "PARTIAL" : "UNKNOWN",
  };
}

export function bootstrapToTopBooks(boot: DashboardBootstrapResponse | undefined): TopBookRow[] {
  return (boot?.topBooks?.data ?? []).map((book) => {
    const spend = n(book.adSpend);
    const sales = n(book.adSales);
    const royalties = n(book.royalties);
    return {
      book_key: book.asin,
      asin: book.asin,
      sku: null,
      title: book.title,
      image_url: book.coverUrl,
      impressions: 0,
      clicks: 0,
      orders: n(book.orders),
      spend,
      sales,
      royalties,
      acos: sales > 0 ? (spend / sales) * 100 : n(book.currentAcos),
      roas: spend > 0 ? sales / spend : 0,
      net: netRoyaltiesKnown(royalties, spend),
      breakeven_acos: n(book.breakEvenAcos),
      ads_state: "ready" as const,
      kdp_state: "ready" as const,
    };
  });
}

export function bootstrapToBleeders(boot: DashboardBootstrapResponse | undefined): Keyword[] {
  const rows = boot?.bleedingEntities?.zeroSales ?? [];
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (!row.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => ({
      id: row.id,
      campaign_id: null,
      ad_group_id: null,
      keyword_text: row.label,
      match_type: null,
      status: null,
      bid_amount: null,
      amazon_profile_id: null,
      created_at: "",
      updated_at: "",
      total_impressions: 0,
      total_clicks: 0,
      total_orders: 0,
      total_sales: 0,
      total_spend: n(row.spend),
      total_acos: n(row.acos),
      total_ctr: 0,
      total_roas: 0,
      total_cpc: 0,
      total_conversion_rate: 0,
    }));
}

export function previousMetricsToCampaignRows(
  prev: MetricsSummary | undefined,
  endDate: string,
): CampaignMetric[] {
  if (!prev) return [];
  return [{
    id: `nest-prev-${endDate}`,
    campaign_id: "nest",
    date: endDate,
    impressions: n(prev.totalImpressions),
    clicks: n(prev.totalClicks),
    ctr: n(prev.avgCtr),
    spend: n(prev.totalSpend),
    sales: n(prev.totalSales),
    orders: n(prev.totalOrders),
    acos: n(prev.avgAcos),
    roas: n(prev.totalSpend) > 0 ? n(prev.totalSales) / n(prev.totalSpend) : null,
    cpc: n(prev.totalClicks) > 0 ? n(prev.totalSpend) / n(prev.totalClicks) : null,
    conversion_rate: n(prev.avgConversionRate),
  }];
}

export function previousMetricsToRoyalties(prev: MetricsSummary | undefined, endDate: string): KdpRoyaltyRange {
  if (!prev) return emptyKdpRange();
  const royalties = n(prev.kdpRoyalties);
  const coveredDays = Math.max(0, n(prev.kdpDaysCovered));
  const daysInRange = Math.max(0, n(prev.kdpDaysInRange));
  const hasKdpData = prev.kdpRoyalties != null;
  const coverage = !hasKdpData
    ? "missing"
    : daysInRange > 0 && coveredDays >= daysInRange
      ? "complete"
      : "partial";
  return {
    hasKdpData,
    totalRoyalties: royalties,
    totalOrders: 0,
    daily: hasKdpData ? [{ date: endDate, royalties, orders: 0 }] : [],
    coverage,
    coveredDays,
    daysInRange,
    coveredAccountDays: coveredDays,
    expectedAccountDays: daysInRange,
    completeness: coverage === "complete" ? "COMPLETE" : coverage === "partial" ? "PARTIAL" : "UNKNOWN",
  };
}

function emptyKdpRange(): KdpRoyaltyRange {
  return {
    hasKdpData: false,
    totalRoyalties: 0,
    totalOrders: 0,
    daily: [],
    coverage: "missing",
    coveredDays: 0,
    daysInRange: 0,
    coveredAccountDays: 0,
    expectedAccountDays: 0,
    completeness: "UNKNOWN",
  };
}

export type NestEntityListOpts = {
  filterUserId: string;
  startDate?: string;
  endDate?: string;
  profileIds?: string[];
  campaignId?: string;
  adGroupId?: string;
  matchType?: string;
  status?: string;
  state?: string;
  search?: string;
  limit?: number;
};

function nestPageSize(limit?: number) {
  if (!limit || limit >= 500) return 500;
  if (limit <= 10) return 10;
  if (limit <= 25) return 25;
  if (limit <= 50) return 50;
  if (limit <= 100) return 100;
  if (limit <= 200) return 200;
  return 500;
}

function metricTotals(row: Record<string, unknown>): MetricsTotals {
  const spend = n(row.total_spend);
  const sales = n(row.total_sales);
  const clicks = n(row.total_clicks);
  const impressions = n(row.total_impressions);
  const orders = n(row.total_orders);
  return {
    total_impressions: impressions,
    total_clicks: clicks,
    total_orders: orders,
    total_sales: sales,
    total_spend: spend,
    total_acos: sales > 0 ? (spend / sales) * 100 : n(row.total_acos),
    total_ctr: impressions > 0 ? clicks / impressions : n(row.total_ctr),
    total_roas: spend > 0 ? sales / spend : n(row.total_roas),
    total_cpc: clicks > 0 ? spend / clicks : n(row.total_cpc),
    total_conversion_rate: clicks > 0 ? orders / clicks : n(row.total_conversion_rate),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown) {
  if (value == null) return "";
  return String(value);
}

function pickProfileId(row: Record<string, unknown>, allowed?: string[]) {
  const id = str(row.amazonProfileId ?? row.amazon_profile_id);
  if (!allowed?.length || allowed.length === 1) return true;
  return !id || allowed.includes(id);
}

export function mapNestKeyword(row: unknown): Keyword {
  const r = asRecord(row);
  return {
    id: str(r.id ?? r.keywordId),
    campaign_id: r.campaignId != null || r.campaign_id != null ? str(r.campaignId ?? r.campaign_id) : null,
    ad_group_id: r.adGroupId != null || r.ad_group_id != null ? str(r.adGroupId ?? r.ad_group_id) : null,
    keyword_text: (r.keywordText ?? r.keyword_text ?? null) as string | null,
    match_type: (r.matchType ?? r.match_type ?? null) as string | null,
    status: (r.status ?? null) as string | null,
    bid_amount: r.bid_amount != null || r.bid != null ? n(r.bid_amount ?? r.bid) : null,
    amazon_profile_id: (r.amazonProfileId ?? r.amazon_profile_id ?? null) as string | null,
    created_at: str(r.createdAt ?? r.created_at),
    updated_at: str(r.updatedAt ?? r.updated_at),
    ...metricTotals(r),
  };
}

export function mapNestProductTarget(row: unknown): ProductTarget {
  const r = asRecord(row);
  return {
    id: str(r.id ?? r.targetId),
    campaign_id: str(r.campaignId ?? r.campaign_id),
    ad_group_id: r.adGroupId != null || r.ad_group_id != null ? str(r.adGroupId ?? r.ad_group_id) : null,
    amazon_profile_id: str(r.amazonProfileId ?? r.amazon_profile_id),
    expression: r.expression ?? null,
    expression_type: (r.expressionType ?? r.expression_type ?? null) as string | null,
    resolved_expression: r.resolvedExpression ?? r.resolved_expression ?? null,
    state: (r.state ?? r.status ?? null) as string | null,
    bid: r.bid != null ? n(r.bid) : null,
    title: (r.title ?? null) as string | null,
    image_url: (r.imageUrl ?? r.image_url ?? null) as string | null,
    created_at: str(r.createdAt ?? r.created_at),
    updated_at: str(r.updatedAt ?? r.updated_at),
    ...metricTotals(r),
  };
}

export function mapNestCampaign(row: unknown): Campaign {
  const r = asRecord(row);
  const metrics = asRecord(r.metrics);
  return {
    id: str(r.id),
    amazon_profile_id: str(r.amazonProfileId ?? r.amazon_profile_id),
    name: str(r.name),
    type: (r.type ?? null) as string | null,
    targeting_type: (r.targetingType ?? r.targeting_type ?? r.type ?? null) as string | null,
    state: (r.state ?? r.status ?? null) as string | null,
    start_date: (r.startDate ?? r.start_date ?? null) as string | null,
    end_date: (r.endDate ?? r.end_date ?? null) as string | null,
    bidding_strategy: (r.biddingStrategy ?? r.bidding_strategy ?? null) as string | null,
    portfolio_id: (r.portfolioId ?? r.portfolio_id ?? null) as string | null,
    budget: r.budget != null ? n(r.budget) : null,
    budget_type: (r.budgetType ?? r.budget_type ?? null) as string | null,
    created_at: str(r.createdAt ?? r.created_at),
    updated_at: str(r.updatedAt ?? r.updated_at),
    metrics_updated_at: (r.metrics_updated_at ?? null) as string | null,
    total_impressions: n(r.total_impressions ?? metrics.impressions),
    total_clicks: n(r.total_clicks ?? metrics.clicks),
    total_orders: n(r.total_orders ?? metrics.orders),
    total_sales: n(r.total_sales ?? metrics.sales),
    total_spend: n(r.total_spend ?? metrics.spend),
    total_acos: n(r.total_acos ?? metrics.acos),
    total_ctr: n(r.total_ctr ?? metrics.ctr),
    total_roas: n(r.total_roas),
    total_cpc: n(r.total_cpc ?? metrics.cpc),
    total_conversion_rate: n(r.total_conversion_rate ?? metrics.cr),
  };
}

export async function fetchNestKeywords(params: NestEntityListOpts): Promise<Keyword[]> {
  const data = await nestApiJson<{ data?: unknown[] }>(
    `/keywords${qs({
      filterUserId: params.filterUserId,
      startDate: params.startDate,
      endDate: params.endDate,
      sortBy: "total_spend",
      sortOrder: "desc",
      per_page: nestPageSize(params.limit),
      page: 1,
      includeEnrichments: "false",
      campaignId: params.campaignId,
      adGroupId: params.adGroupId,
      matchType: params.matchType,
      status: params.status,
      search: params.search,
      amazonProfileId: params.profileIds?.length === 1 ? params.profileIds[0] : undefined,
    })}`,
    { method: "GET" },
    "Couldn't load keywords.",
  );
  let rows = (data.data ?? []).map(mapNestKeyword).filter((row) => pickProfileId(asRecord({
    amazonProfileId: row.amazon_profile_id,
  }), params.profileIds));
  if (params.limit) rows = rows.slice(0, params.limit);
  return rows;
}

export async function fetchNestProductTargets(params: NestEntityListOpts): Promise<ProductTarget[]> {
  const data = await nestApiJson<{ data?: unknown[] }>(
    `/product-targets${qs({
      filterUserId: params.filterUserId,
      startDate: params.startDate,
      endDate: params.endDate,
      sortBy: "total_spend",
      sortOrder: "desc",
      per_page: nestPageSize(params.limit),
      page: 1,
      includeEnrichments: "false",
      campaignId: params.campaignId,
      adGroupId: params.adGroupId,
      state: params.state,
      amazonProfileId: params.profileIds?.length === 1 ? params.profileIds[0] : undefined,
    })}`,
    { method: "GET" },
    "Couldn't load targets.",
  );
  let rows = (data.data ?? []).map(mapNestProductTarget).filter((row) => pickProfileId(asRecord({
    amazonProfileId: row.amazon_profile_id,
  }), params.profileIds));
  if (params.limit) rows = rows.slice(0, params.limit);
  return rows;
}

export async function fetchNestTopBooks(params: {
  filterUserId: string;
  startDate: string;
  endDate: string;
  profileIds: string[];
  limit?: number;
}): Promise<TopBookRow[]> {
  const data = await nestApiJson<{ data?: KdpBreakEvenBookRow[] }>(
    `/dashboard/kdp-break-even-by-book${qs({
      startDate: params.startDate,
      endDate: params.endDate,
      profileIds: params.profileIds.join(","),
      filterUserId: params.filterUserId,
    })}`,
    { method: "GET" },
    "Couldn't load books.",
  );
  const rows = bootstrapToTopBooks({ topBooks: { data: data.data ?? [] } } as DashboardBootstrapResponse);
  return params.limit ? rows.slice(0, params.limit) : rows;
}

export async function fetchNestBookCampaigns(params: {
  filterUserId: string;
  asin: string;
  startDate: string;
  endDate: string;
  profileIds: string[];
}): Promise<BookCampaignRow[]> {
  const data = await nestApiJson<{
    campaigns?: Array<{
      campaignId: string;
      campaignName: string | null;
      spend: number;
      sales: number;
      clicks: number;
      impressions: number;
      orders: number;
      acos: number | null;
    }>;
  }>(
    `/dashboard/book-profitability-detail${qs({
      asin: params.asin,
      startDate: params.startDate,
      endDate: params.endDate,
      profileIds: params.profileIds.join(","),
      filterUserId: params.filterUserId,
    })}`,
    { method: "GET" },
    "Couldn't load book campaigns.",
  );
  return (data.campaigns ?? []).map((row) => {
    const spend = n(row.spend);
    const sales = n(row.sales);
    return {
      id: row.campaignId,
      name: row.campaignName ?? row.campaignId,
      type: null,
      state: null,
      budget: null,
      bidding_strategy: null,
      ...{
        placement_top_share: 0,
        placement_product_share: 0,
        placement_rest_share: 0,
      },
      impressions: n(row.impressions),
      clicks: n(row.clicks),
      orders: n(row.orders),
      spend,
      sales,
      acos: sales > 0 ? (spend / sales) * 100 : n(row.acos),
      roas: spend > 0 ? sales / spend : 0,
      net: 0,
      match_source: "product_ad" as const,
    };
  });
}

export async function fetchNestCampaignById(id: string): Promise<Campaign | null> {
  const row = await nestApiJson<unknown>(`/campaigns/${id}`, { method: "GET" }, "Couldn't load campaign.");
  if (!row) return null;
  return mapNestCampaign(row);
}

export async function fetchNestKeywordById(id: string): Promise<(Keyword & { campaign_name?: string | null; ad_group_name?: string | null }) | null> {
  const row = await nestApiJson<unknown>(`/keywords/${id}`, { method: "GET" }, "Couldn't load keyword.");
  if (!row) return null;
  const r = asRecord(row);
  return {
    ...mapNestKeyword(row),
    campaign_name: (r.campaignName ?? r.campaign_name ?? null) as string | null,
    ad_group_name: (r.adGroupName ?? r.ad_group_name ?? null) as string | null,
  };
}

export async function fetchNestProductTargetById(id: string): Promise<(ProductTarget & { campaign_name?: string | null; ad_group_name?: string | null }) | null> {
  const row = await nestApiJson<unknown>(`/product-targets/${id}`, { method: "GET" }, "Couldn't load target.");
  if (!row) return null;
  const r = asRecord(row);
  return {
    ...mapNestProductTarget(row),
    campaign_name: (r.campaignName ?? r.campaign_name ?? null) as string | null,
    ad_group_name: (r.adGroupName ?? r.ad_group_name ?? null) as string | null,
  };
}
