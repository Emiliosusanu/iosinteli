// Type DTOs based on Supabase schema for inteliads

export interface AmazonProfile {
  id: string;
  profile_id: string;
  country_code: string | null;
  currency_code: string | null;
  marketplace_id: string | null;
  account_type: string | null;
  account_name: string | null;
  account_id: string | null;
  nickname: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricsTotals {
  total_impressions: number;
  total_clicks: number;
  total_orders: number;
  total_sales: number;
  total_spend: number;
  total_acos: number;
  total_ctr: number;
  total_roas: number;
  total_cpc: number;
  total_conversion_rate: number;
}

export interface Campaign extends MetricsTotals {
  id: string;
  amazon_profile_id: string;
  name: string;
  type: string | null;
  targeting_type: string | null;
  state: string | null;
  start_date: string | null;
  end_date: string | null;
  bidding_strategy: string | null;
  portfolio_id: string | null;
  budget: number | null;
  budget_type: string | null;
  created_at: string;
  updated_at: string;
  metrics_updated_at: string | null;
}

export interface AdGroup extends MetricsTotals {
  id: string;
  campaign_id: string;
  name: string | null;
  default_bid: number | null;
  state: string | null;
  amazon_profile_id: string | null;
  targeting_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Keyword extends MetricsTotals {
  id: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  keyword_text: string | null;
  match_type: string | null;
  status: string | null;
  bid_amount: number | null;
  amazon_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductTarget extends MetricsTotals {
  id: string;
  campaign_id: string;
  ad_group_id: string | null;
  amazon_profile_id: string;
  expression: any;
  expression_type: string | null;
  resolved_expression: any | null;
  state: string | null;
  bid: number | null;
  title: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductAd extends MetricsTotals {
  id: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  asin: string | null;
  sku: string | null;
  status: string | null;
  amazon_profile_id: string | null;
  title: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignMetric {
  id: string;
  campaign_id: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  spend: number | null;
  sales: number | null;
  orders: number;
  acos: number | null;
  roas: number | null;
  cpc: number | null;
  conversion_rate: number | null;
}

export interface SearchTerm extends MetricsTotals {
  id: string;
  campaign_id: string;
  keyword_id: string | null;
  search_term: string;
  match_type: string | null;
  status: string | null;
  term_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface NegativeKeyword {
  id: string;
  campaign_id: string;
  ad_group_id: string | null;
  keyword_text: string | null;
  match_type: string | null;
  state: string | null;
  amazon_profile_id: string | null;
  created_at: string;
}

export interface OptimizationRule {
  id: string;
  user_id: string;
  name: string;
  conditions: any;
  action: any;
  enabled: boolean;
  priority: number;
  target_entity: string | null;
  check_frequency_hours: number;
  last_executed_at: string | null;
  last_execution_status: string | null;
  execution_count: number;
  entities_affected: number;
  amazon_profile_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface RuleExecution {
  id: string;
  rule_id: string | null;
  executed_at: string | null;
  status: string | null;
  entities: number;
  errors_count: number;
  apply_status: string | null;
}

export interface ProfileSyncLog {
  id: string;
  amazon_profile_id: string;
  profile_name: string | null;
  status: string;
  campaigns_synced: number;
  campaigns_failed: number;
  keywords_synced: number;
  keywords_failed: number;
  product_ads_synced: number;
  product_ads_failed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// UI-derived types
export interface KpiSnapshot {
  spend: number;
  sales: number;
  orders: number;
  impressions: number;
  clicks: number;
  acos: number;
  roas: number;
  ctr: number;
  cpc: number;
  net: number;
  currency: string;
}

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string;
}

export interface ChartPoint {
  date: string;
  value: number;
  label?: string;
}
