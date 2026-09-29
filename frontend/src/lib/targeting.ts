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
  asinsameas: { label: "Exact", tone: "primary", isAuto: false },
  asincategorysameas: { label: "Category", tone: "product", isAuto: false },
  asinbrandsameas: { label: "Brand", tone: "product", isAuto: false },
  asinexpandedfrom: { label: "Expanded", tone: "product", isAuto: false },
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

type Asin = string & { readonly __asin: unique symbol };

function isAsin(value: unknown): value is Asin {
  return typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value);
}

export function fallbackAsinCoverUrl(asin: string | null | undefined): string | null {
  if (!isAsin(asin)) return null;
  // SL500 is crisp at list sizes; SCLZZZZZZZ is a tiny thumbnail that looks soft on retina.
  return `https://images-na.ssl-images-amazon.com/images/P/${asin.toUpperCase()}.01._SL500_.jpg`;
}

function firstAsinCandidate(value: unknown): string {
  if (isAsin(value)) return value.toUpperCase();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = firstAsinCandidate(entry);
      if (hit) return hit;
    }
    return "";
  }
  if (value && typeof value === "object") {
    for (const key of ["value", "asin", "targetAsin", "target_asin"]) {
      const hit = firstAsinCandidate((value as Record<string, unknown>)[key]);
      if (hit) return hit;
    }
  }
  return "";
}

export function extractTargetAsin(expression: unknown): string {
  if (isAsin(expression)) return expression.toUpperCase();

  for (const item of parseExpressionItems(expression)) {
    const hit = firstAsinCandidate(item);
    if (hit) return hit;
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

/** Live Amazon bid: explicit target/keyword bid, else inherited ad-group default. */
export function readTargetBid(
  row: { bid?: unknown; bid_amount?: unknown; default_bid?: unknown } | null | undefined,
  inheritedDefaultBid?: unknown,
): number | null {
  for (const raw of [row?.bid, row?.bid_amount, row?.default_bid, inheritedDefaultBid]) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Real bibliographic title — not blank, not a bare ASIN / placeholder. */
export function isUsableBookTitle(value: unknown): boolean {
  const titled = String(value ?? "").trim();
  if (!titled) return false;
  if (/^title unavailable$/i.test(titled)) return false;
  return !/^[A-Z0-9]{10}$/i.test(titled);
}

/**
 * Shared match-type colors across Keywords + Product targets.
 * Exact = blue (primary), Expanded = purple (product),
 * Phrase = orange (warning), Broad = green (good).
 */
export function matchTypeTone(
  match: string | null | undefined,
): "primary" | "product" | "warning" | "good" | "inactive" {
  const n = String(match ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!n) return "inactive";
  if (n === "exact" || n === "asinsameas" || n.endsWith("exact")) return "primary";
  if (n === "expanded" || n === "asinexpandedfrom" || n.includes("expanded")) return "product";
  if (n === "phrase" || n.includes("phrase")) return "warning";
  if (n === "broad" || n.includes("broad")) return "good";
  return "inactive";
}

export function formatMatchTypeLabel(match: string | null | undefined): string {
  const raw = String(match ?? "").trim();
  if (!raw) return "";
  const n = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n === "exact" || n === "asinsameas") return "Exact";
  if (n === "expanded" || n === "asinexpandedfrom") return "Expanded";
  if (n === "phrase") return "Phrase";
  if (n === "broad") return "Broad";
  return raw.replace(/\basin\b/gi, "").replace(/\s+/g, " ").trim() || raw;
}

/** Exact is bold; Broad/Phrase/Expanded stay plain — no color coding. */
export function isExactMatchType(match: string | null | undefined): boolean {
  const n = String(match ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return n === "exact" || n === "asinsameas" || n.endsWith("exact");
}

export function productTargetHeading(item: {
  title?: string | null;
  campaign_name?: string | null;
  expression: unknown;
  expression_type?: string | null;
  resolved_expression?: unknown;
}): string {
  const described = describeProductTarget(item.expression, item.expression_type, item.resolved_expression);
  const titled = String(item.title ?? "").trim();
  const categoryName = String(described.name ?? "").trim();
  const named = categoryName || String(item.campaign_name ?? "").trim() || "";

  // Auto / Close-Loose-Complements-Substitutes: label only — no book subtitle.
  if (described.isAuto) {
    return described.label;
  }
  // Category: expression category name only — never campaign/book title.
  if (isCategoryTarget(item.expression, item.expression_type) || described.label === "Category") {
    if (isUsableBookTitle(categoryName)) return categoryName;
    return described.label;
  }
  // ASIN / Exact product targets: never paint the raw ASIN as the headline.
  if (isUsableBookTitle(titled)) return titled;
  if (isUsableBookTitle(named) && named !== described.asin) return named;
  if (described.asin) return "Title unavailable";
  return described.label;
}
