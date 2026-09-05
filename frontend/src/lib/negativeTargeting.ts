import type { NegativeKeyword, NegativeProductTarget } from "./types";

export const NEGATIVE_RESULT_LIMIT = 500;

export type NegativeSegment = "keywords" | "products";

export type NegativeRowPresentation = {
  id: string;
  identity: string;
  typeLabel: string;
  scopeLabel: "Campaign level" | "Ad group level";
  contextLabel: string | null;
  stateLabel: string | null;
  searchText: string;
  accessibilityLabel: string;
  testID: string;
};

function normalizeCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function negativeKeywordTypeLabel(matchType: unknown): string {
  const code = normalizeCode(matchType);
  if (code === "exact" || code === "negativeexact") return "Negative exact";
  if (code === "phrase" || code === "negativephrase") return "Negative phrase";
  return "Negative keyword";
}

export function negativeStateLabel(state: unknown): string | null {
  const code = normalizeCode(state);
  if (code === "enabled" || code === "active") return "Enabled";
  if (code === "paused") return "Paused";
  if (code === "archived") return "Archived";
  if (code === "deleted") return "Deleted";
  return null;
}

function parseExpression(expression: unknown): unknown[] {
  if (expression == null) return [];
  if (typeof expression !== "string") return Array.isArray(expression) ? expression : [expression];
  const trimmed = expression.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [trimmed];
  }
}

function expressionValues(expression: unknown): string[] {
  const values: string[] = [];
  for (const item of parseExpression(expression)) {
    if (typeof item === "string" || typeof item === "number") {
      const value = String(item).trim();
      if (value) values.push(value);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    for (const key of ["asin", "value", "brand", "category", "targetAsin", "target_asin"]) {
      const value = record[key];
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).trim();
      if (text) {
        values.push(text);
        break;
      }
    }
  }
  return Array.from(new Set(values));
}

export function negativeProductIdentity(
  expression: unknown,
  _expressionType?: string | null,
): string {
  const values = expressionValues(expression);
  const asin = values.find((value) => /^[A-Z0-9]{10}$/i.test(value));
  if (asin) return asin.toUpperCase();
  return values.join(", ") || "Product target";
}

export function negativeProductTypeLabel(
  expression: unknown,
  expressionType?: string | null,
): string {
  const values = expressionValues(expression);
  if (values.some((value) => /^[A-Z0-9]{10}$/i.test(value))) return "Negative ASIN";

  const codes = [
    expressionType,
    ...parseExpression(expression).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return [record.type, record.expressionType, record.expression_type];
    }),
  ].map(normalizeCode);
  if (codes.some((code) => code.includes("category"))) {
    return "Negative product target · Category";
  }
  if (codes.some((code) => code.includes("brand"))) {
    return "Negative product target · Brand";
  }
  if (codes.some((code) => code.includes("expanded"))) {
    return "Negative product target · Expanded ASIN";
  }
  return "Negative product target";
}

function parentContext(item: {
  campaign_name?: string | null;
  ad_group_name?: string | null;
}): string | null {
  return [item.campaign_name, item.ad_group_name]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value)
    .join(" · ") || null;
}

function finalizePresentation(params: {
  id: string;
  identity: string;
  typeLabel: string;
  adGroupId?: string | null;
  campaignName?: string | null;
  adGroupName?: string | null;
  state?: unknown;
  testID: string;
}): NegativeRowPresentation {
  const scopeLabel = params.adGroupId ? "Ad group level" : "Campaign level";
  const contextLabel = parentContext({
    campaign_name: params.campaignName,
    ad_group_name: params.adGroupName,
  });
  const stateLabel = negativeStateLabel(params.state);
  const spoken = [
    params.identity,
    params.typeLabel,
    scopeLabel,
    contextLabel,
    stateLabel,
  ].filter(Boolean).join(". ");

  return {
    id: params.id,
    identity: params.identity,
    typeLabel: params.typeLabel,
    scopeLabel,
    contextLabel,
    stateLabel,
    searchText: [
      params.identity,
      params.typeLabel,
      scopeLabel,
      contextLabel,
      stateLabel,
    ].filter(Boolean).join(" ").toLowerCase(),
    accessibilityLabel: spoken,
    testID: params.testID,
  };
}

export function presentNegativeKeyword(item: NegativeKeyword): NegativeRowPresentation {
  return finalizePresentation({
    id: item.id,
    identity: item.keyword_text?.trim() || "Negative keyword",
    typeLabel: negativeKeywordTypeLabel(item.match_type),
    adGroupId: item.ad_group_id,
    campaignName: item.campaign_name,
    adGroupName: item.ad_group_name,
    state: item.state,
    testID: `negative-keyword-${item.id}`,
  });
}

export function presentNegativeProduct(
  item: NegativeProductTarget,
): NegativeRowPresentation {
  return finalizePresentation({
    id: item.id,
    identity: negativeProductIdentity(item.expression, item.expression_type),
    typeLabel: negativeProductTypeLabel(item.expression, item.expression_type),
    adGroupId: item.ad_group_id,
    campaignName: item.campaign_name,
    adGroupName: item.ad_group_name,
    state: item.state,
    testID: `negative-product-${item.id}`,
  });
}

function noun(segment: NegativeSegment, count: number): string {
  if (segment === "keywords") return count === 1 ? "negative keyword" : "negative keywords";
  return count === 1 ? "negative product target" : "negative product targets";
}

export function negativeCountLabel(params: {
  segment: NegativeSegment;
  sourceCount: number;
  filteredCount: number;
  searching: boolean;
}): string {
  if (params.searching) {
    return `${params.filteredCount} matching ${noun(params.segment, params.filteredCount)}`;
  }
  if (params.sourceCount >= NEGATIVE_RESULT_LIMIT) {
    return `Latest ${NEGATIVE_RESULT_LIMIT} ${noun(params.segment, NEGATIVE_RESULT_LIMIT)}`;
  }
  return `${params.sourceCount} ${noun(params.segment, params.sourceCount)}`;
}

export function negativeEmptyCopy(segment: NegativeSegment, searching: boolean) {
  if (searching) {
    return {
      title: "No matching negatives",
      subtitle: "Try different keyword, ASIN, campaign, or ad group text.",
    };
  }
  return segment === "keywords"
    ? {
        title: "No negative keywords",
        subtitle: "None are stored for the profiles in the current view.",
      }
    : {
        title: "No negative product targets",
        subtitle: "None are stored for the profiles in the current view.",
      };
}
