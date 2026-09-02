// Mobile rule-builder options — mirrors the web rule engine's constants
// (server/src/rules/constants/rule-actions.constants.ts + create-rule.dto.ts) so
// rules created from the app are valid for the server-side executor.

import { Ionicons } from "@expo/vector-icons";

export type RuleEntity =
  | "campaign"
  | "ad_group"
  | "keyword"
  | "product_target"
  | "auto_targeting"
  | "search_term";

export type Comparison = ">" | "<" | ">=" | "<=" | "=";

export interface RuleConditionInput {
  metric: string;
  comparison: Comparison;
  value: string; // kept as string in the form, coerced on submit
  days: string;
  placement?: string;
}

export const RULE_ENTITIES: { key: RuleEntity; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "campaign", label: "Campaigns", icon: "megaphone-outline" },
  { key: "ad_group", label: "Ad groups", icon: "layers-outline" },
  { key: "keyword", label: "Keywords", icon: "key-outline" },
  { key: "product_target", label: "Product targets", icon: "cube-outline" },
  { key: "auto_targeting", label: "Auto targeting", icon: "options-outline" },
  { key: "search_term", label: "Search terms", icon: "search-outline" },
];

const SUPPORTED_ACTIONS = [
  "pause",
  "enable",
  "set_bid",
  "increase_bid",
  "decrease_bid",
  "set_budget",
  "add_negative_keyword",
  "add_positive_keyword",
  "set_placement_adjustment",
] as const;

const ENTITY_ACTIONS_FULL: Record<RuleEntity, string[]> = {
  campaign: ["pause", "enable", "set_budget", "set_placement_adjustment"],
  ad_group: ["pause", "enable", "set_bid", "increase_bid", "decrease_bid"],
  keyword: ["pause", "enable", "set_bid", "increase_bid", "decrease_bid", "add_negative_keyword"],
  product_target: ["pause", "enable", "set_bid", "increase_bid", "decrease_bid"],
  auto_targeting: ["pause", "enable", "set_bid", "increase_bid", "decrease_bid"],
  search_term: ["add_positive_keyword", "add_negative_keyword"],
};

export function actionsForEntity(entity: RuleEntity): string[] {
  return ENTITY_ACTIONS_FULL[entity].filter((a) => (SUPPORTED_ACTIONS as readonly string[]).includes(a));
}

const ENTITY_METRICS: Record<RuleEntity, string[]> = {
  campaign: [
    "acos",
    "ctr",
    "cpc",
    "spend",
    "sales",
    "impressions",
    "clicks",
    "orders",
    "conversion_rate",
    "roas",
    "daily_budget",
    "placement_acos",
    "placement_clicks",
    "placement_spend",
    "placement_orders",
  ],
  ad_group: ["acos", "ctr", "cpc", "spend", "sales", "impressions", "clicks", "orders", "conversion_rate", "roas", "ad_group_bid"],
  keyword: ["acos", "ctr", "cpc", "spend", "sales", "impressions", "clicks", "orders", "conversion_rate", "roas", "keyword_bid"],
  product_target: ["acos", "ctr", "cpc", "spend", "sales", "impressions", "clicks", "orders", "conversion_rate", "roas", "target_bid"],
  auto_targeting: ["acos", "ctr", "cpc", "spend", "sales", "impressions", "clicks", "orders", "conversion_rate", "roas", "target_bid"],
  search_term: ["acos", "ctr", "cpc", "spend", "sales", "impressions", "clicks", "orders", "conversion_rate", "roas"],
};

export function metricsForEntity(entity: RuleEntity): string[] {
  return ENTITY_METRICS[entity];
}

export const COMPARISONS: Comparison[] = [">", "<", ">=", "<=", "="];

export const PLACEMENT_KEYS = ["top_of_search", "product_pages", "rest_of_search"] as const;

export const MATCH_TYPES = ["exact", "phrase", "broad"] as const;

export type PlacementKey = (typeof PLACEMENT_KEYS)[number];
export type MatchType = (typeof MATCH_TYPES)[number];

export const PLACEMENT_MODES = ["set", "increase", "decrease"] as const;

export const PLACEMENT_KEY_LABELS: Record<string, string> = {
  top_of_search: "Top of search",
  product_pages: "Product pages",
  rest_of_search: "Rest of search",
};

export const PLACEMENT_MODE_LABELS: Record<string, string> = {
  set: "Set to",
  increase: "Increase by",
  decrease: "Decrease by",
};

export const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "Exact",
  phrase: "Phrase",
  broad: "Broad",
};

export const METRIC_LABELS: Record<string, string> = {
  acos: "ACoS",
  ctr: "CTR",
  cpc: "CPC",
  spend: "Spend",
  sales: "Sales",
  impressions: "Impressions",
  clicks: "Clicks",
  orders: "Orders",
  conversion_rate: "Conv. rate",
  roas: "ROAS",
  keyword_bid: "Keyword bid",
  daily_budget: "Daily budget",
  target_bid: "Target bid",
  ad_group_bid: "Ad group bid",
  placement_acos: "Placement ACoS",
  placement_clicks: "Placement clicks",
  placement_spend: "Placement spend",
  placement_orders: "Placement orders",
};

export const ACTION_LABELS: Record<string, string> = {
  pause: "Pause",
  enable: "Enable",
  set_bid: "Set bid to",
  increase_bid: "Increase bid by",
  decrease_bid: "Decrease bid by",
  set_budget: "Set daily budget to",
  add_negative_keyword: "Add as negative",
  add_positive_keyword: "Add as target",
  set_placement_adjustment: "Change placement %",
};

export const HARVEST_ACTIONS = new Set(["add_negative_keyword", "add_positive_keyword"]);

// Actions that require a numeric value.
export const ACTION_NEEDS_VALUE = new Set(["set_bid", "increase_bid", "decrease_bid", "set_budget", "set_placement_adjustment"]);
// Actions where the value can be a percent or a fixed amount (the rest are fixed).
export const ACTION_USES_VALUETYPE = new Set(["increase_bid", "decrease_bid"]);

export const FREQUENCY_PRESETS: { label: string; hours: number }[] = [
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "Daily", hours: 24 },
  { label: "2 days", hours: 48 },
  { label: "Weekly", hours: 168 },
];

export function isPlacementMetric(metric: string): boolean {
  return metric.startsWith("placement_");
}

/** Nest stores harvest match type on action.value (exact / phrase / broad, or negativeExact / negativePhrase). */
export function harvestMatchValue(actionType: string, matchType: string): string {
  if (actionType === "add_negative_keyword") {
    return matchType === "exact" ? "negativeExact" : "negativePhrase";
  }
  return matchType;
}

export function defaultConditionFor(entity: RuleEntity): RuleConditionInput {
  const metric = metricsForEntity(entity)[0] ?? "acos";
  return { metric, comparison: ">", value: "30", days: "14" };
}
