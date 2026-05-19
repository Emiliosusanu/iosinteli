// Supabase data access layer for inteliads
// All queries are filtered by selected profile IDs and date range when applicable.

import { supabase } from "./supabase";
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
  OptimizationRule,
  RuleExecution,
  ProfileSyncLog,
} from "./types";

// ---------- Amazon Profiles ----------
export async function fetchAmazonProfiles(): Promise<AmazonProfile[]> {
  const { data, error } = await supabase
    .from("amazon_profiles")
    .select("*")
    .order("account_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AmazonProfile[];
}

// ---------- Campaigns ----------
export async function fetchCampaigns(
  profileIds: string[],
  opts: { search?: string; state?: string; type?: string; limit?: number } = {},
): Promise<Campaign[]> {
  if (!profileIds.length) return [];
  let q = supabase
    .from("campaigns")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });

  if (opts.state) q = q.eq("state", opts.state);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.search) q = q.ilike("name", `%${opts.search}%`);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function fetchCampaignById(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase.from("campaigns").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Campaign | null;
}

// ---------- Ad Groups ----------
export async function fetchAdGroups(profileIds: string[], campaignId?: string): Promise<AdGroup[]> {
  if (!profileIds.length) return [];
  let q = supabase
    .from("ad_groups")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AdGroup[];
}

// ---------- Keywords ----------
export async function fetchKeywords(
  profileIds: string[],
  opts: { campaignId?: string; matchType?: string; status?: string; limit?: number; search?: string } = {},
): Promise<Keyword[]> {
  if (!profileIds.length) return [];
  let q = supabase
    .from("keywords")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });

  if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
  if (opts.matchType) q = q.eq("match_type", opts.matchType);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.search) q = q.ilike("keyword_text", `%${opts.search}%`);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Keyword[];
}

// ---------- Product Targets ----------
export async function fetchProductTargets(
  profileIds: string[],
  opts: { campaignId?: string; state?: string; limit?: number } = {},
): Promise<ProductTarget[]> {
  if (!profileIds.length) return [];
  let q = supabase
    .from("product_targets")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });

  if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProductTarget[];
}

// ---------- Product Ads ----------
export async function fetchProductAds(
  profileIds: string[],
  opts: { campaignId?: string; status?: string; limit?: number; search?: string } = {},
): Promise<ProductAd[]> {
  if (!profileIds.length) return [];
  let q = supabase
    .from("product_ads")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("total_spend", { ascending: false });

  if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.search) q = q.or(`asin.ilike.%${opts.search}%,sku.ilike.%${opts.search}%,title.ilike.%${opts.search}%`);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ProductAd[];
}

// ---------- Search Terms ----------
export async function fetchSearchTerms(
  profileIds: string[],
  opts: { campaignId?: string; termType?: string; limit?: number } = {},
): Promise<SearchTerm[]> {
  if (!profileIds.length) return [];

  // First find campaign IDs for selected profiles
  const { data: campaigns, error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .in("amazon_profile_id", profileIds);
  if (campErr) throw campErr;
  const campaignIds = (campaigns ?? []).map((c: any) => c.id);
  if (!campaignIds.length) return [];

  let q = supabase
    .from("search_terms")
    .select("*")
    .in("campaign_id", opts.campaignId ? [opts.campaignId] : campaignIds)
    .order("total_spend", { ascending: false });

  if (opts.termType) q = q.eq("term_type", opts.termType);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SearchTerm[];
}

// ---------- Negative Keywords ----------
export async function fetchNegativeKeywords(profileIds: string[]): Promise<NegativeKeyword[]> {
  if (!profileIds.length) return [];
  const { data, error } = await supabase
    .from("negative_keywords")
    .select("*")
    .in("amazon_profile_id", profileIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as NegativeKeyword[];
}

// ---------- Daily Campaign Metrics for chart ----------
export async function fetchCampaignMetricsRange(
  profileIds: string[],
  startDate: string,
  endDate: string,
): Promise<CampaignMetric[]> {
  if (!profileIds.length) return [];

  // First get campaign IDs for selected profiles
  const { data: camps, error: cErr } = await supabase
    .from("campaigns")
    .select("id")
    .in("amazon_profile_id", profileIds);
  if (cErr) throw cErr;
  const ids = (camps ?? []).map((c: any) => c.id);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("campaign_metrics")
    .select("*")
    .in("campaign_id", ids)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CampaignMetric[];
}

// ---------- Optimization Rules ----------
export async function fetchOptimizationRules(userId: string): Promise<OptimizationRule[]> {
  const { data, error } = await supabase
    .from("optimization_rules")
    .select("*")
    .eq("user_id", userId)
    .order("priority", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OptimizationRule[];
}

export async function fetchRuleExecutions(ruleId?: string): Promise<RuleExecution[]> {
  let q = supabase
    .from("rule_execution_history")
    .select("*")
    .order("executed_at", { ascending: false })
    .limit(30);
  if (ruleId) q = q.eq("rule_id", ruleId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RuleExecution[];
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

// ---------- Aggregated Overview ----------
import { Campaign as C, KpiSnapshot, MetricsTotals } from "./types";
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

export function aggregateDailyMetrics(rows: CampaignMetric[]) {
  // Group by date, sum spend/sales/orders/clicks/impressions
  const map = new Map<string, { date: string; spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  for (const r of rows) {
    const d = r.date;
    const existing = map.get(d) ?? { date: d, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
    existing.spend += Number(r.spend) || 0;
    existing.sales += Number(r.sales) || 0;
    existing.orders += Number(r.orders) || 0;
    existing.clicks += Number(r.clicks) || 0;
    existing.impressions += Number(r.impressions) || 0;
    map.set(d, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
