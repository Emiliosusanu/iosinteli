export type TargetingTone = "primary" | "product" | "warning" | "good";

interface TargetLabel {
  label: string;
  tone: TargetingTone;
  isAuto: boolean;
}

export interface ProductTargetDescriptor extends TargetLabel {
  asin: string;
  name: string;
}

const EXPRESSION_TYPE_LABELS: Record<string, TargetLabel> = {
  asinsameas: { label: "Exact ASIN", tone: "primary", isAuto: false },
  asincategorysameas: { label: "Category", tone: "product", isAuto: false },
  asinbrandsameas: { label: "Brand", tone: "product", isAuto: false },
  asinexpandedfrom: { label: "Expanded ASIN", tone: "product", isAuto: false },
  queryhighrelmatches: { label: "Close Match", tone: "primary", isAuto: true },
  querybroadrelmatches: { label: "Loose Match", tone: "warning", isAuto: true },
  asinaccessoryrelated: { label: "Complements", tone: "good", isAuto: true },
  asinsubstituterelated: { label: "Substitutes", tone: "warning", isAuto: true },
  asinsubstitutes: { label: "Substitutes", tone: "warning", isAuto: true },
  closematch: { label: "Close Match", tone: "primary", isAuto: true },
  loosematch: { label: "Loose Match", tone: "warning", isAuto: true },
  complements: { label: "Complements", tone: "good", isAuto: true },
  substitutes: { label: "Substitutes", tone: "warning", isAuto: true },
  auto: { label: "Auto", tone: "product", isAuto: true },
  manual: { label: "Exact", tone: "primary", isAuto: false },
  exact: { label: "Exact", tone: "primary", isAuto: false },
  asin: { label: "ASIN", tone: "primary", isAuto: false },
};

function normalizeExpressionCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseExpressionItems(expression: unknown): any[] {
  if (!expression) return [];
  try {
    const parsed = typeof expression === "string" ? JSON.parse(expression) : expression;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [expression];
  }
}

function findKnownLabel(expression: unknown, expressionType: string | null | undefined): TargetLabel | null {
  const items = parseExpressionItems(expression);
  const itemCodes = items.flatMap((item) => [
    item?.type,
    item?.expressionType,
    item?.expression_type,
    item?.matchType,
    item?.match_type,
    item?.value,
  ]);

  for (const code of [...itemCodes, expressionType]) {
    const label = EXPRESSION_TYPE_LABELS[normalizeExpressionCode(code)];
    if (label) return label;
  }

  return null;
}

function isAsin(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value);
}

export function fallbackAsinCoverUrl(asin: string | null | undefined): string | null {
  if (!isAsin(asin)) return null;
  return `https://images-na.ssl-images-amazon.com/images/P/${asin.toUpperCase()}.01._SCLZZZZZZZ_.jpg`;
}

export function extractTargetAsin(expression: unknown): string {
  if (isAsin(expression)) return expression.toUpperCase();

  for (const item of parseExpressionItems(expression)) {
    if (isAsin(item)) return item.toUpperCase();
    for (const key of ["value", "asin", "targetAsin", "target_asin"]) {
      const value = item?.[key];
      if (isAsin(value)) return value.toUpperCase();
    }
  }

  return "";
}

function humanizeExpressionType(expressionType: string | null | undefined): string {
  if (!expressionType) return "ASIN";
  return expressionType
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCategoryTarget(expression: unknown, expressionType: string | null | undefined): boolean {
  const code = normalizeExpressionCode(expressionType);
  if (code.includes("category")) return true;
  return parseExpressionItems(expression).some((item) =>
    normalizeExpressionCode(item?.type ?? item?.expressionType ?? item?.expression_type).includes("category"),
  );
}

function extractExpressionName(...sources: unknown[]): string {
  for (const source of sources) {
    for (const item of parseExpressionItems(source)) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed && !isAsin(trimmed) && !/^\d+$/.test(trimmed) && trimmed.length > 2) return trimmed;
        continue;
      }
      for (const key of ["name", "title", "category", "brand", "brandName", "localizedName", "displayName"]) {
        const value = item?.[key];
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed && !isAsin(trimmed) && !/^\d+$/.test(trimmed)) return trimmed;
        }
      }
      const value = item?.value;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed && !isAsin(trimmed) && !/^\d+$/.test(trimmed) && trimmed.length > 2) return trimmed;
      }
    }
  }
  return "";
}

export function describeProductTarget(
  expression: unknown,
  expressionType: string | null | undefined,
  resolvedExpression?: unknown,
): ProductTargetDescriptor {
  const known = findKnownLabel(expression, expressionType) ?? findKnownLabel(resolvedExpression, expressionType);
  const fallback: TargetLabel = {
    label: humanizeExpressionType(expressionType),
    tone: "primary",
    isAuto: normalizeExpressionCode(expressionType) === "auto",
  };

  return {
    ...(known ?? fallback),
    asin: extractTargetAsin(resolvedExpression) || extractTargetAsin(expression),
    name: extractExpressionName(resolvedExpression, expression),
  };
}

export function productTargetHeading(item: {
  title?: string | null;
  campaign_name?: string | null;
  expression: unknown;
  expression_type?: string | null;
  resolved_expression?: unknown;
}): string {
  const described = describeProductTarget(item.expression, item.expression_type, item.resolved_expression);
  const named = described.name || item.title?.trim() || item.campaign_name?.trim() || "";
  if (described.isAuto) {
    if (named && named.toLowerCase() !== described.label.toLowerCase()) return `${described.label} · ${named}`;
    return described.label;
  }
  if (isCategoryTarget(item.expression, item.expression_type) || described.label === "Category") {
    return named || described.label;
  }
  return item.title?.trim() || named || described.asin || described.label;
}
