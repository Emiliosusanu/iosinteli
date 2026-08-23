// Presentation-only labels for the Rules list. Does not evaluate or mutate rules.
import { formatCurrency, formatInt, formatPercent } from "./format";
import {
  ACTION_LABELS,
  ACTION_USES_VALUETYPE,
  FREQUENCY_PRESETS,
  HARVEST_ACTIONS,
  MATCH_TYPE_LABELS,
  METRIC_LABELS,
  PLACEMENT_KEY_LABELS,
  PLACEMENT_MODE_LABELS,
  RULE_ENTITIES,
} from "./ruleOptions";
import type { OptimizationRule } from "./types";

export const PERCENT_METRICS = new Set(["acos", "ctr", "conversion_rate", "placement_acos"]);
export const MONEY_METRICS = new Set([
  "spend",
  "sales",
  "cpc",
  "keyword_bid",
  "daily_budget",
  "target_bid",
  "ad_group_bid",
  "placement_spend",
]);
export const COUNT_METRICS = new Set(["impressions", "clicks", "orders", "placement_clicks", "placement_orders"]);

export type MetricUnit = "percent" | "money" | "count" | "ratio";

export function metricUnit(metric: string): MetricUnit {
  if (PERCENT_METRICS.has(metric)) return "percent";
  if (MONEY_METRICS.has(metric)) return "money";
  if (COUNT_METRICS.has(metric)) return "count";
  return "ratio";
}

export function metricUnitLabel(metric: string, currency = "USD"): string {
  const unit = metricUnit(metric);
  if (unit === "percent") return "percent";
  if (unit === "money") return currency;
  if (unit === "count") return "count";
  return "ratio";
}

export function metricUnitSuffix(metric: string, currency = "USD"): string {
  const unit = metricUnit(metric);
  if (unit === "percent") return "%";
  if (unit === "money") return currency === "USD" ? "$" : currency;
  return "";
}

const COMPARISON_SPOKEN: Record<string, string> = {
  ">": "exceeds",
  "<": "is below",
  ">=": "is at least",
  "<=": "is at most",
  "=": "equals",
};

export type ConditionLike = {
  metric?: string;
  comparison?: string;
  value?: unknown;
  days?: unknown;
  placement?: string;
};

export function relativeTime(value?: string | null): string {
  if (!value) return "Never";
  const diff = Date.now() - new Date(value).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "Just now";
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isConditionLike(value: unknown): value is ConditionLike {
  return !!value && typeof value === "object" && ("metric" in value || "comparison" in value);
}

export function normalizeConditions(raw: unknown): ConditionLike[] {
  const parsed = parseJsonish(raw);
  if (Array.isArray(parsed)) return parsed.filter(isConditionLike);
  if (isConditionLike(parsed)) return [parsed];
  return [];
}

export function parseAction(raw: unknown): Record<string, unknown> | null {
  const parsed = parseJsonish(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function formatMetricNumber(metric: string, value: unknown, currency: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "—");
  if (PERCENT_METRICS.has(metric)) return formatPercent(n, Number.isInteger(n) ? 0 : 1);
  if (MONEY_METRICS.has(metric)) return formatCurrency(n, currency);
  if (COUNT_METRICS.has(metric)) return formatInt(n);
  if (metric === "roas") return Number.isInteger(n) ? String(n) : n.toFixed(1);
  return Number.isInteger(n) ? String(n) : String(n);
}

export function formatCondition(condition: ConditionLike, currency: string): string {
  const metric = METRIC_LABELS[condition.metric ?? ""] ?? condition.metric ?? "Metric";
  const placement = condition.placement ? PLACEMENT_KEY_LABELS[condition.placement] ?? condition.placement : null;
  const subject = placement ? `${metric} (${placement})` : metric;
  const comparison = condition.comparison ?? ">";
  const value = formatMetricNumber(condition.metric ?? "", condition.value, currency);
  const n = Number(condition.days);
  const window = Number.isFinite(n) && n > 0 ? `${n}d` : null;
  return window ? `${subject} ${comparison} ${value} (${window})` : `${subject} ${comparison} ${value}`;
}

export function speakCondition(condition: ConditionLike, currency: string): string {
  const metric = METRIC_LABELS[condition.metric ?? ""] ?? condition.metric ?? "Metric";
  const placement = condition.placement ? PLACEMENT_KEY_LABELS[condition.placement] ?? condition.placement : null;
  const subject = placement ? `${metric} on ${placement}` : metric;
  const spoken = COMPARISON_SPOKEN[condition.comparison ?? ""] ?? condition.comparison ?? "exceeds";
  const value = formatMetricNumber(condition.metric ?? "", condition.value, currency);
  const days = Number(condition.days);
  const window = Number.isFinite(days) && days > 0 ? ` over the last ${days} days` : "";
  return `${subject} ${spoken} ${value}${window}`;
}

function harvestMatchLabel(value: unknown): string | null {
  const raw = String(value ?? "");
  if (!raw) return null;
  if (raw === "negativeExact" || raw === "exact") return MATCH_TYPE_LABELS.exact;
  if (raw === "negativePhrase" || raw === "phrase") return MATCH_TYPE_LABELS.phrase;
  if (raw === "broad") return MATCH_TYPE_LABELS.broad;
  return MATCH_TYPE_LABELS[raw] ?? raw;
}

function formatMoneyOrPercent(value: unknown, valueType: unknown, currency: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (valueType === "percent") return formatPercent(n, Number.isInteger(n) ? 0 : 1);
  return formatCurrency(n, currency);
}

export function formatAction(action: Record<string, unknown> | null, currency: string): string | null {
  if (!action) return null;
  const type = String(action.type ?? "");
  if (!type) return null;
  const label = ACTION_LABELS[type] ?? type.replace(/_/g, " ");

  if (type === "pause" || type === "enable") return label;

  if (HARVEST_ACTIONS.has(type)) {
    const match = harvestMatchLabel(action.value ?? action.matchType ?? action.match_type);
    return match ? `${label} · ${match}` : label;
  }

  if (type === "set_placement_adjustment") {
    const placement = action.placement ? PLACEMENT_KEY_LABELS[String(action.placement)] ?? String(action.placement) : null;
    const mode = action.mode ? PLACEMENT_MODE_LABELS[String(action.mode)] ?? String(action.mode) : null;
    const amount = Number(action.value);
    const amountLabel = Number.isFinite(amount) ? formatPercent(amount, Number.isInteger(amount) ? 0 : 1) : null;
    return [label, placement, mode && amountLabel ? `${mode} ${amountLabel}` : amountLabel].filter(Boolean).join(" · ");
  }

  if (type === "set_bid" || type === "set_budget") {
    const amount = formatMoneyOrPercent(action.value, "fixed", currency);
    return amount ? `${label} ${amount}` : label;
  }

  if (ACTION_USES_VALUETYPE.has(type)) {
    const amount = formatMoneyOrPercent(action.value, action.valueType ?? action.value_type, currency);
    return amount ? `${label} ${amount}` : label;
  }

  const amount = formatMoneyOrPercent(action.value, action.valueType ?? action.value_type ?? "fixed", currency);
  return amount ? `${label} ${amount}` : label;
}

export function entityLabel(target: string | null | undefined): string | null {
  if (!target) return null;
  return RULE_ENTITIES.find((row) => row.key === target)?.label ?? target.replace(/_/g, " ");
}

export function frequencyLabel(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  const n = Number(hours);
  const preset = FREQUENCY_PRESETS.find((row) => row.hours === n);
  if (preset) {
    return preset.label === "Daily" || preset.label === "Weekly" || preset.label === "2 days"
      ? preset.label
      : `Every ${preset.label}`;
  }
  return `Every ${n}h`;
}

export function executionStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  const key = status.toLowerCase();
  if (key === "completed" || key === "success") return "Completed";
  if (key === "failed") return "Failed";
  if (key === "partial_fail" || key === "partial_failed") return "Partial fail";
  if (key === "running") return "Running";
  if (key === "pending") return "Pending";
  if (key === "reapplied") return "Reapplied";
  return status.replace(/_/g, " ");
}

export function lastRunLine(rule: Pick<OptimizationRule, "last_executed_at" | "last_execution_status">): string {
  if (!rule.last_executed_at) return "Never run";
  const when = relativeTime(rule.last_executed_at);
  const status = executionStatusLabel(rule.last_execution_status);
  if (status && status !== "Completed") return `Last run ${when} · ${status}`;
  return `Last run ${when}`;
}

export function presentRule(rule: OptimizationRule, currency: string) {
  const conditions = normalizeConditions(rule.conditions);
  const action = parseAction(rule.action);
  const when = conditions.map((row) => formatCondition(row, currency)).join(" and ");
  const whenSpoken = conditions.map((row) => speakCondition(row, currency)).join(" and ");
  const then = formatAction(action, currency);
  const scope = entityLabel(rule.target_entity);
  const cadence = frequencyLabel(rule.check_frequency_hours);
  const enabled = !!rule.enabled;
  return {
    name: rule.name?.trim() || "Untitled rule",
    enabled,
    stateLabel: enabled ? "Enabled" : "Disabled",
    scope,
    cadence,
    when: when || null,
    whenSpoken: whenSpoken || null,
    then,
    lastRun: lastRunLine(rule),
  };
}
