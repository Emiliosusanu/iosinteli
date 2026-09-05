// Form serialization for the Rule Builder. Presentation/validation only.
// Does not evaluate rules or call Amazon.
import { parseLocaleNumber } from "./format";
import {
  ACTION_NEEDS_VALUE,
  ACTION_USES_VALUETYPE,
  HARVEST_ACTIONS,
  MATCH_TYPES,
  PLACEMENT_KEYS,
  harvestMatchValue,
  isPlacementMetric,
  type RuleConditionInput,
} from "./ruleOptions";

export { parseLocaleNumber };

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function hydrateRuleParam(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    return {
      ...row,
      conditions: parseMaybeJson(row.conditions),
      action: parseMaybeJson(row.action),
    };
  } catch {
    return null;
  }
}

export function matchTypesForAction(actionType: string): readonly string[] {
  if (actionType === "add_negative_keyword") return ["exact", "phrase"];
  return MATCH_TYPES;
}

export function resolveMatchType(
  action: { matchType?: unknown; match_type?: unknown; value?: unknown; type?: string } | null | undefined,
  actionType?: string,
): string {
  const allowed = matchTypesForAction(actionType ?? (typeof action?.type === "string" ? action.type : ""));
  const raw = action?.matchType ?? action?.match_type ?? action?.value;
  if (typeof raw !== "string") return allowed[0] ?? "exact";
  const v = raw.toLowerCase();
  if (v === "negativeexact" || v === "exact") return allowed.includes("exact") ? "exact" : allowed[0] ?? "exact";
  if (v === "negativephrase" || v === "phrase") return allowed.includes("phrase") ? "phrase" : allowed[0] ?? "exact";
  // Engine stores negative Broad as phrase. Do not remap leftover "broad" to Exact.
  if (v === "broad") return allowed.includes("broad") ? "broad" : allowed.includes("phrase") ? "phrase" : allowed[0] ?? "exact";
  return allowed.includes(raw) ? raw : allowed[0] ?? "exact";
}

export function resolveValueType(action: { valueType?: unknown; value_type?: unknown } | null | undefined): "percent" | "fixed" {
  const raw = action?.valueType ?? action?.value_type;
  return raw === "fixed" ? "fixed" : "percent";
}

export function resolveNegateInSource(action: { negateInSource?: unknown; negate_in_source?: unknown } | null | undefined): boolean {
  return !!(action?.negateInSource ?? action?.negate_in_source);
}

export function buildRuleConditions(conditions: RuleConditionInput[]) {
  return conditions.map((c) => ({
    metric: c.metric,
    comparison: c.comparison,
    value: parseLocaleNumber(c.value),
    days: Math.round(parseLocaleNumber(c.days)),
    ...(isPlacementMetric(c.metric) ? { placement: c.placement || PLACEMENT_KEYS[0] } : {}),
  }));
}

export function buildRuleAction(input: {
  actionType: string;
  actionValue: string;
  valueType: "percent" | "fixed";
  matchType: string;
  negateInSource: boolean;
  placementKey: string;
  placementMode: string;
}): { type: string; [key: string]: unknown } {
  const { actionType, actionValue, valueType, matchType, negateInSource, placementKey, placementMode } = input;

  if (HARVEST_ACTIONS.has(actionType)) {
    return {
      type: actionType,
      matchType,
      negateInSource,
      value: harvestMatchValue(actionType, matchType),
    };
  }

  if (actionType === "set_placement_adjustment") {
    return {
      type: actionType,
      placement: placementKey,
      mode: placementMode,
      value: parseLocaleNumber(actionValue),
    };
  }

  const action: { type: string; value?: number; valueType?: "percent" | "fixed" } = { type: actionType };
  if (ACTION_NEEDS_VALUE.has(actionType)) {
    action.value = parseLocaleNumber(actionValue);
    action.valueType = ACTION_USES_VALUETYPE.has(actionType) ? valueType : "fixed";
  }
  return action;
}

export function actionNeedsNumericValue(actionType: string): boolean {
  return ACTION_NEEDS_VALUE.has(actionType);
}

export function actionUsesValueType(actionType: string): boolean {
  return ACTION_USES_VALUETYPE.has(actionType);
}
