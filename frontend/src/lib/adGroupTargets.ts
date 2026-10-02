/** Shared helpers for create/edit ad-group targeting flows. */

export function parseCustomKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\n,]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => {
      const key = keyword.toLocaleLowerCase();
      if (!keyword || keyword.length > 80 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 1000);
}

/** Identity for Amazon keyword uniqueness: text + match type (case-insensitive). */
export function keywordDedupeKey(keyword: string, matchType: string): string {
  return `${String(keyword || "").trim().toLocaleLowerCase()}::${String(matchType || "")
    .trim()
    .toLowerCase()}`;
}

export type KeywordBidInput = {
  keyword: string;
  matchType: "broad" | "phrase" | "exact";
  bid: number;
  source: "suggested" | "custom";
};

/**
 * Drop empty/invalid bids and duplicates (same text+match), keeping first.
 * Also skips identities already on the ad group.
 */
export function prepareKeywordAdds(
  inputs: readonly KeywordBidInput[],
  existing: readonly { keyword_text?: string | null; match_type?: string | null }[] = [],
): { keywords: KeywordBidInput[]; skippedDuplicate: number; skippedBid: number } {
  const existingKeys = new Set(
    existing.map((row) => keywordDedupeKey(String(row.keyword_text ?? ""), String(row.match_type ?? ""))),
  );
  const seen = new Set<string>();
  const keywords: KeywordBidInput[] = [];
  let skippedDuplicate = 0;
  let skippedBid = 0;
  for (const row of inputs) {
    const keyword = String(row.keyword || "").trim();
    const rawMatch = String(row.matchType || "").trim().toLowerCase();
    const matchType: KeywordBidInput["matchType"] =
      rawMatch === "broad" || rawMatch === "phrase" || rawMatch === "exact"
        ? rawMatch
        : "exact";
    if (!keyword) continue;
    const bid = Number(row.bid);
    if (!Number.isFinite(bid) || bid < 0.02) {
      skippedBid += 1;
      continue;
    }
    const key = keywordDedupeKey(keyword, matchType);
    if (existingKeys.has(key) || seen.has(key)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(key);
    keywords.push({
      keyword,
      matchType,
      bid,
      source: row.source === "custom" ? "custom" : "suggested",
    });
  }
  return { keywords, skippedDuplicate, skippedBid };
}

export type ProductTargetBidInput = {
  asin: string;
  matchType?: "exact" | "expanded";
  bid: number;
  source: "suggested" | "custom";
};

/** Identity for Amazon product-target uniqueness: ASIN + match type. */
export function productTargetDedupeKey(
  asin: string,
  matchType?: string | null,
): string {
  const normalizedMatch =
    String(matchType ?? "exact").trim().toLowerCase() === "expanded"
      ? "expanded"
      : "exact";
  return `${String(asin || "").trim().toUpperCase()}::${normalizedMatch}`;
}

/**
 * Drop malformed/duplicate product targets and identities already present on
 * the destination ad group. The returned length is the exact request count.
 */
export function prepareProductTargetAdds(
  inputs: readonly ProductTargetBidInput[],
  existing: readonly {
    asin?: string | null;
    match_type?: string | null;
    expression_type?: string | null;
  }[] = [],
): {
  productTargets: ProductTargetBidInput[];
  skippedDuplicate: number;
  skippedBid: number;
  skippedAsin: number;
} {
  const existingKeys = new Set(
    existing.map((row) =>
      productTargetDedupeKey(
        String(row.asin ?? ""),
        row.match_type ?? row.expression_type ?? "exact",
      ),
    ),
  );
  const seen = new Set<string>();
  const productTargets: ProductTargetBidInput[] = [];
  let skippedDuplicate = 0;
  let skippedBid = 0;
  let skippedAsin = 0;
  for (const row of inputs) {
    const asin = String(row.asin || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      skippedAsin += 1;
      continue;
    }
    const bid = Number(row.bid);
    if (!Number.isFinite(bid) || bid < 0.02) {
      skippedBid += 1;
      continue;
    }
    const matchType = row.matchType === "expanded" ? "expanded" : "exact";
    const key = productTargetDedupeKey(asin, matchType);
    if (existingKeys.has(key) || seen.has(key)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(key);
    productTargets.push({
      asin,
      matchType,
      bid,
      source: row.source === "custom" ? "custom" : "suggested",
    });
  }
  return { productTargets, skippedDuplicate, skippedBid, skippedAsin };
}

export type AdGroupCreateTargeting = "auto" | "keywords" | "products";

/** Which create options a campaign targeting_type allows. */
export function allowedAdGroupTargetings(
  campaignTargetingType: string | null | undefined,
): AdGroupCreateTargeting[] {
  const n = String(campaignTargetingType ?? "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (n === "auto") return ["auto"];
  // Manual / asin / keyword / product campaigns: keyword or product ad groups.
  return ["keywords", "products"];
}

export function adGroupEditMode(
  targetingType: string | null | undefined,
  isAuto?: boolean,
): "keywords" | "products" | "auto" | "unknown" {
  if (isAuto) return "auto";
  const n = String(targetingType ?? "").toLowerCase();
  if (n === "auto_target" || n === "auto") return "auto";
  if (n === "keyword" || n === "keywords") return "keywords";
  if (n === "product_target" || n === "product" || n === "asin" || n === "asins") return "products";
  return "unknown";
}

/** Prefer explicit targeting_type; fall back to which entities already exist. */
export function resolveAdGroupAddMode(opts: {
  targetingType?: string | null;
  isAuto?: boolean;
  keywordCount?: number;
  productTargetCount?: number;
  nameHint?: string | null;
}): "keywords" | "products" | "auto" | "both" {
  const edited = adGroupEditMode(opts.targetingType, opts.isAuto);
  if (edited === "auto" || edited === "keywords" || edited === "products") return edited;
  const kw = Number(opts.keywordCount) || 0;
  const pt = Number(opts.productTargetCount) || 0;
  if (kw > 0 && pt === 0) return "keywords";
  if (pt > 0 && kw === 0) return "products";
  const name = String(opts.nameHint ?? "").toLowerCase();
  if (/\bkeyword/.test(name)) return "keywords";
  if (/\basin\b|\bproduct/.test(name)) return "products";
  return "both";
}
