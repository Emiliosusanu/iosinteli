/**
 * Pure Grok relevance helpers (no Nest / network imports).
 * Network lives in suggestionRelevanceGrok.ts.
 */
import {
  fillGrokRelevanceUserPrompt,
  GROK_RELEVANCE_SYSTEM_PROMPT,
  GROK_RELEVANCE_USER_PROMPT_TEMPLATE,
  GROK_PRODUCT_RELEVANCE_SYSTEM_PROMPT,
  GROK_PRODUCT_RELEVANCE_USER_PROMPT_TEMPLATE,
} from "./suggestionRelevancePrompt.ts";
import type {
  BookRelevanceContext,
  FilterableSuggestions,
} from "./amazonCampaignSuggestions.ts";

export type GrokRelevanceSelection = {
  keywordIndexes: number[];
  productIndexes: number[];
  reason?: string;
  source: "nest" | "xai" | "groq" | "parsed";
};

/**
 * Unique-phrase batch size for the LLM. Amazon often returns Broad+Phrase+Exact
 * (3× rows); we collapse to one line per phrase before the call so ~200 phrases
 * fit a single Groq free-tier request — fast, and no Amazon rows are dropped
 * (companions are restored after keep).
 */
export const GROK_RELEVANCE_KEYWORD_CHUNK = 120;

/** Product-ASIN batch size — compact title lines stay under Groq free TPM. */
/** Fit typical Amazon product lists (≈70) in one Groq call when possible. */
export const GROK_RELEVANCE_PRODUCT_CHUNK = 80;

/** Soft cap on user-message chars before we force chunking (~4.5k tokens). */
export const GROK_RELEVANCE_MAX_USER_CHARS = 18_000;

export function relevancePromptNeedsChunking(
  keywordCount: number,
  userCharCount: number,
): boolean {
  return (
    keywordCount > GROK_RELEVANCE_KEYWORD_CHUNK ||
    userCharCount > GROK_RELEVANCE_MAX_USER_CHARS
  );
}

export function productPromptNeedsChunking(
  productCount: number,
  userCharCount: number,
): boolean {
  return (
    productCount > GROK_RELEVANCE_PRODUCT_CHUNK ||
    userCharCount > GROK_RELEVANCE_MAX_USER_CHARS
  );
}

function cleanText(value: unknown): string {
  const s = String(value ?? "").trim();
  return s || "—";
}

function phraseKey(keyword: string): string {
  return String(keyword ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Collapse Broad/Phrase/Exact companions to one LLM row per phrase.
 * Prefer exact → phrase → broad as the representative (best search-intent signal).
 * After Grok keeps phrase indexes, map back to ALL Amazon companions for those phrases.
 */
export function collapseKeywordsToUniquePhrasesForGrok<
  K extends { keyword: string; matchType?: string; suggestedBid?: number | null },
>(keywords: K[]): {
  phrases: K[];
  /** phrase-list index → indexes into the original Amazon companion list */
  phraseToOriginalIndexes: number[][];
} {
  const order: string[] = [];
  const byPhrase = new Map<
    string,
    { rep: K; originalIndexes: number[]; rank: number }
  >();
  const matchRank = (match: string | undefined) => {
    const m = String(match ?? "")
      .trim()
      .toLowerCase();
    if (m === "exact") return 3;
    if (m === "phrase") return 2;
    if (m === "broad") return 1;
    return 0;
  };

  keywords.forEach((row, index) => {
    const key = phraseKey(row.keyword);
    if (!key) return;
    const rank = matchRank(row.matchType);
    const existing = byPhrase.get(key);
    if (!existing) {
      order.push(key);
      byPhrase.set(key, { rep: row, originalIndexes: [index], rank });
      return;
    }
    existing.originalIndexes.push(index);
    if (rank > existing.rank) {
      existing.rep = row;
      existing.rank = rank;
    }
  });

  const phrases: K[] = [];
  const phraseToOriginalIndexes: number[][] = [];
  for (const key of order) {
    const entry = byPhrase.get(key)!;
    phrases.push(entry.rep);
    phraseToOriginalIndexes.push(entry.originalIndexes);
  }
  return { phrases, phraseToOriginalIndexes };
}

/** Map kept unique-phrase indexes → original Amazon row indexes (all companions). */
export function expandGrokPhraseIndexesToOriginal(
  keptPhraseIndexes: number[],
  phraseToOriginalIndexes: number[][],
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const phraseIndex of keptPhraseIndexes) {
    const originals = phraseToOriginalIndexes[phraseIndex];
    if (!originals) continue;
    for (const i of originals) {
      if (seen.has(i)) continue;
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

export function uniqueValidIndexes(raw: unknown, length: number): number[] {
  if (!Array.isArray(raw) || length <= 0) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 0 || n >= length) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Strip fences and parse Grok JSON; tolerant of minor wrapper text. */
export function parseGrokRelevanceJson(
  raw: string,
  sizes: { keywordCount: number; productCount: number },
): GrokRelevanceSelection {
  const text = String(raw ?? "").trim();
  let jsonText = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) jsonText = fence[1].trim();
  else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) jsonText = text.slice(start, end + 1);
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error("Grok relevance response was not valid JSON.");
  }
  const keywordIndexes = uniqueValidIndexes(
    parsed.keywordIndexes ?? parsed.keyword_indexes ?? parsed.keywords,
    sizes.keywordCount,
  );
  const productIndexes = uniqueValidIndexes(
    parsed.productIndexes ?? parsed.product_indexes ?? parsed.products,
    sizes.productCount,
  );
  return {
    keywordIndexes,
    productIndexes,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    source: "parsed",
  };
}

export function buildGrokRelevanceMessages(
  suggestions: FilterableSuggestions<
    { keyword: string; matchType?: string; suggestedBid?: number | null },
    {
      asin: string;
      title?: string | null;
      matchType?: string | null;
      themes?: string[] | null;
    }
  >,
  context: BookRelevanceContext,
): { system: string; user: string } {
  // Compact lines: unique phrases only (caller collapses companions).
  // Drop bids — they burn tokens and are not needed for search-intent keep.
  const keywordLines =
    suggestions.keywords.length === 0
      ? "(none)"
      : suggestions.keywords
          .map((row, index) => `${index} | ${row.keyword}`)
          .join("\n");
  // Keyword prompt only. Product ASINs go through buildGrokProductRelevanceMessages
  // (separate product LLM pass) — do not embed ASIN lists here.
  const productLines =
    "(none — products use a separate product LLM pass; always return productIndexes: [])";

  const user = fillGrokRelevanceUserPrompt(GROK_RELEVANCE_USER_PROMPT_TEMPLATE, {
    BOOK_TITLE: cleanText(context.bookTitle),
    BOOK_SUBTITLE: cleanText(context.bookSubtitle),
    BOOK_AUTHOR: cleanText(context.bookAuthor),
    BOOK_TOPIC: cleanText(context.bookTopic),
    ASIN: cleanText(context.advertisedAsin),
    COUNTRY: cleanText(context.countryCode),
    CURRENCY: cleanText(context.currencyCode),
    KEYWORD_CANDIDATES: keywordLines,
    PRODUCT_CANDIDATES: productLines,
  });

  return { system: GROK_RELEVANCE_SYSTEM_PROMPT, user };
}

/** Compact product lines for the product-relevance LLM call. */
export function buildGrokProductRelevanceMessages(
  products: Array<{
    asin: string;
    title?: string | null;
    subtitle?: string | null;
    matchType?: string | null;
    themes?: string[] | null;
  }>,
  context: BookRelevanceContext,
): { system: string; user: string } {
  const productLines =
    products.length === 0
      ? "(none)"
      : products
          .map((row, index) => {
            const themes = Array.isArray(row.themes)
              ? row.themes.filter(Boolean).slice(0, 3).join(", ")
              : "";
            // Never send UI placeholder "Title unavailable" — treat as untitled so
            // the product prompt rule (themes-only keep) can still fire.
            const rawTitle = String(row.title ?? "").trim();
            const titleMissing =
              !rawTitle ||
              rawTitle.toLowerCase() === "title unavailable" ||
              rawTitle.toUpperCase() === String(row.asin ?? "").trim().toUpperCase();
            const title = titleMissing
              ? "(title missing)"
              : cleanText(row.title).slice(0, 80);
            const subtitle = titleMissing
              ? "—"
              : cleanText(row.subtitle).slice(0, 60);
            return `${index} | ${String(row.asin).toUpperCase()} | ${title} | ${subtitle} | ${themes || "—"}`;
          })
          .join("\n");

  const user = fillGrokRelevanceUserPrompt(
    GROK_PRODUCT_RELEVANCE_USER_PROMPT_TEMPLATE,
    {
      BOOK_TITLE: cleanText(context.bookTitle),
      BOOK_SUBTITLE: cleanText(context.bookSubtitle),
      BOOK_AUTHOR: cleanText(context.bookAuthor),
      BOOK_TOPIC: cleanText(context.bookTopic),
      ASIN: cleanText(context.advertisedAsin),
      COUNTRY: cleanText(context.countryCode),
      CURRENCY: cleanText(context.currencyCode),
      PRODUCT_CANDIDATES: productLines,
    },
  );

  return { system: GROK_PRODUCT_RELEVANCE_SYSTEM_PROMPT, user };
}

export function applyGrokRelevanceSelection<K, P>(
  suggestions: FilterableSuggestions<K, P>,
  selection: Pick<GrokRelevanceSelection, "keywordIndexes" | "productIndexes">,
): FilterableSuggestions<K, P> {
  const keywords = selection.keywordIndexes
    .map((i) => suggestions.keywords[i])
    .filter((row): row is K => row != null);
  const productTargets = selection.productIndexes
    .map((i) => suggestions.productTargets[i])
    .filter((row): row is P => row != null);

  // Empty keyword keep stays empty — finalize restores Amazon with restored_empty.
  // Empty product keep stays empty when input had products — finalizeProduct
  // decides restore vs curated keep. Do NOT auto-restore products here.
  return {
    keywords,
    productTargets,
  };
}
