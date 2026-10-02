/**
 * Create-campaign Amazon product suggestion helpers: theme labels, title
 * similarity sort, bid display, ASIN title/cover enrichment, stale-target
 * filtering, and suggestion stock captions.
 */
import { formatCurrency } from "./format.ts";
import { fallbackAsinCoverUrl } from "./targeting.ts";

export type SuggestionReasonKey =
  | "top_clicks"
  | "top_converting"
  | "frequently_viewed"
  | "complements"
  | "substitutes"
  | "similar_readership"
  | "other";

/**
 * Amazon theme classes that imply niche correlation. Title-token similarity
 * alone drops good competitors (different titles, same niche) — keep these.
 */
export const CORRELATED_PRODUCT_THEME_KEYS: ReadonlySet<SuggestionReasonKey> =
  new Set([
    "similar_readership",
    "complements",
    "substitutes",
    "frequently_viewed",
    "top_clicks",
    "top_converting",
  ]);

export type HumanizedTheme = {
  reasonKey: SuggestionReasonKey;
  /** Short chip label */
  label: string;
  /** Optional clarifying subtitle (opaque Amazon jargon) */
  subtitle: string | null;
};

export type SuggestionStockStatus =
  | "in_stock"
  | "out_of_stock"
  | "unknown";

export type AsinDisplayMeta = {
  title: string | null;
  /** Book subtitle when available (not Amazon theme copy). */
  subtitle: string | null;
  coverUrl: string | null;
  stockStatus?: SuggestionStockStatus;
  /** ISO date or YYYY-MM-DD when known. */
  publishedAt?: string | null;
};

export type ProductSuggestionLike = {
  asin: string;
  themes: string[];
  suggestedBid: number | null;
  matchType?: string | null;
  title?: string | null;
  subtitle?: string | null;
  coverUrl?: string | null;
  stockStatus?: SuggestionStockStatus | null;
  publishedAt?: string | null;
};

/** Lookback for royalty / ads activity when filtering stale dead targets. */
export const SUGGESTION_ACTIVITY_LOOKBACK_DAYS = 180;
/** Hide targets older than this with no royalty and no ads activity. */
export const SUGGESTION_STALE_AGE_MONTHS = 6;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "by",
  "from",
  "at",
  "as",
  "is",
  "are",
  "be",
  "edition",
  "paperback",
  "hardcover",
  "kindle",
  "book",
  "books",
  "vol",
  "volume",
  "part",
]);

const TITLE_UNAVAILABLE = "Title unavailable";

/** Normalize + tokenize a book title for overlap scoring. */
export function tokenizeTitle(title: string | null | undefined): string[] {
  const raw = String(title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return [...new Set(raw)];
}

/**
 * Fuzzy/token overlap in [0, 1]. Shared tokens / max(token counts), with
 * boosts for shared distinctive tokens (place/topic words) and contiguous
 * phrase containment. Missing titles score 0 so related titled rows float up.
 */
export function titleSimilarityScore(
  candidateTitle: string | null | undefined,
  selectedTitle: string | null | undefined,
): number {
  const a = tokenizeTitle(candidateTitle);
  const b = tokenizeTitle(selectedTitle);
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  let shared = 0;
  for (const token of a) {
    if (bSet.has(token)) shared += 1;
  }
  if (shared === 0) return 0;
  const overlap = shared / Math.max(a.length, b.length);
  // Distinctive tokens (len ≥ 5) matter more for travel-guide style titles
  // ("Croatia", "Iceland") than stop-ish short stems already filtered out.
  const distinctiveA = a.filter((t) => t.length >= 5);
  const distinctiveB = new Set(b.filter((t) => t.length >= 5));
  let distinctiveShared = 0;
  for (const token of distinctiveA) {
    if (distinctiveB.has(token)) distinctiveShared += 1;
  }
  const distinctiveBoost =
    distinctiveShared > 0
      ? 0.25 *
        (distinctiveShared /
          Math.max(distinctiveA.length, distinctiveB.size, 1))
      : 0;
  const cand = String(candidateTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sel = String(selectedTitle ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const phraseBoost =
    cand.length >= 8 && sel.length >= 8 && (cand.includes(sel) || sel.includes(cand))
      ? 0.2
      : 0;
  // Lead token match (often the place/series name) is a strong relatedness signal.
  const leadBoost = a[0] && b[0] && a[0] === b[0] ? 0.12 : 0;
  return Math.min(1, overlap + distinctiveBoost + phraseBoost + leadBoost);
}

export type BookRelevanceContext = {
  bookTitle?: string | null;
  bookSubtitle?: string | null;
  bookAuthor?: string | null;
  /** Free-text topic / BISAC / category hints when available. */
  bookTopic?: string | null;
  advertisedAsin?: string | null;
  countryCode?: string | null; // marketplace
  currencyCode?: string | null;
};

export type FilterableSuggestions<K = any, P = any> = {
  keywords: K[];
  productTargets: P[];
};

export type SuggestionRelevanceMode = "identity" | "heuristic" | "openai" | "grok";

/**
 * Honest Step-2 outcome for Create / Ad Group / Add targets UI.
 * Never label pass-through or empty-restore as "AI curated".
 */
export type SuggestionRelevanceOutcome =
  | "identity"
  | "heuristic"
  | "filtered"
  | "kept_all"
  | "restored_empty"
  | "failed_unfiltered";

export type SuggestionRelevanceResult<K = any, P = any> =
  FilterableSuggestions<K, P> & {
    relevanceOutcome: SuggestionRelevanceOutcome;
    relevanceError?: string;
  };

/**
 * Default: Grok ranks Amazon Ads suggestions by book metadata.
 * On Nest/xAI failure keywords stay Amazon-raw with `failed_unfiltered`
 * (UI must not auto-select or claim AI curated).
 */
export const SUGGESTION_RELEVANCE_DEFAULT_MODE: SuggestionRelevanceMode =
  "grok";

/**
 * Legacy default when neither preferAmazonOnThin nor minKeepRatio is set.
 * Keywords use preferAmazonOnThin + KEYWORD_*; products pass PRODUCT_*.
 */
const RELEVANCE_SAFETY_KEEP_RATIO = 0.3;
/**
 * Keyword AI filter: trust Grok's curated keep-list.
 * Ratio 0 → only an empty keep restores the full Amazon set (failure safety).
 * Amazon totals stay visible in UI before this step; AI may thin aggressively
 * for search-intent quality.
 */
export const KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO = 0;
/** Product lists: never thin Amazon ASINs aggressively (correlated themes + titles). */
export const PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO = 0.6;
const PRODUCT_TITLE_SIMILARITY_FLOOR = 0.12;

function keywordRelevantToBook(
  keyword: string,
  bookTitle: string | null | undefined,
): boolean {
  const bookTokens = tokenizeTitle(bookTitle);
  if (!bookTokens.length) return false;
  const keywordTokens = tokenizeTitle(keyword);
  const bookSet = new Set(bookTokens);
  if (keywordTokens.some((t) => bookSet.has(t))) return true;
  const keywordLower = String(keyword ?? "").toLowerCase();
  for (const token of bookTokens) {
    if (token.length >= 5 && keywordLower.includes(token)) return true;
  }
  return false;
}

/** True when any Amazon theme maps to a correlated niche class. */
export function productHasCorrelatedTheme(
  themes: string[] | null | undefined,
): boolean {
  for (const theme of themes ?? []) {
    const key = classifyTheme(String(theme ?? ""));
    if (CORRELATED_PRODUCT_THEME_KEYS.has(key)) return true;
  }
  return false;
}

function productRelevantToBook<
  P extends {
    asin: string;
    title?: string | null;
    themes?: string[] | null;
  },
>(row: P, context: BookRelevanceContext): boolean {
  const asin = String(row.asin ?? "")
    .trim()
    .toUpperCase();
  const advertised = String(context.advertisedAsin ?? "")
    .trim()
    .toUpperCase();
  if (advertised && asin && asin === advertised) return true;
  // Untitled / ASIN-as-title: keep unknowns rather than over-filtering.
  if (isAsinAsTitle(row.title, asin)) return true;
  // Amazon-correlated themes (similar readership, complements, substitutes,
  // viewed-together, etc.) — keep even when titles share few tokens.
  if (productHasCorrelatedTheme(row.themes)) return true;
  // No book title to score against — keep Amazon's marketplace list intact
  // (common when Nest preview omits title on thin CA/UK responses).
  if (!context.bookTitle) return true;
  return (
    titleSimilarityScore(row.title, context.bookTitle) >=
    PRODUCT_TITLE_SIMILARITY_FLOOR
  );
}

/**
 * Safe ASIN / product-target filter (title + correlated themes — no Grok drop).
 * Rules:
 *   - Advertised ASIN: always keep
 *   - Untitled / ASIN-as-title: always keep (cannot safely judge)
 *   - Correlated Amazon theme (similar readership / complements / substitutes /
 *     frequently viewed / top clicks / top converting): always keep
 *   - Real title, no keep-theme: drop only when clearly off-topic vs bookTitle
 *     (`titleSimilarityScore` < PRODUCT_TITLE_SIMILARITY_FLOOR)
 *   - Never invent ASINs; never replace a non-empty Amazon list with []
 *     (`withRelevanceSafetyRestore` at PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO)
 */
export function safeFilterProductTargets<
  P extends {
    asin: string;
    title?: string | null;
    themes?: string[] | null;
  },
>(productTargets: P[], context: BookRelevanceContext): P[] {
  if (!context.bookTitle && !context.advertisedAsin) {
    return productTargets;
  }
  const kept = productTargets.filter((row) =>
    productRelevantToBook(row, context),
  );
  return withRelevanceSafetyRestore(productTargets, kept, {
    minKeepRatio: PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO,
  });
}

/**
 * After Grok keeps product ASINs: honor the curated keep-list (like keywords).
 * Only restore the full Amazon set when AI returns empty (`restored_empty`).
 * Heuristic path still uses PRODUCT_RELEVANCE_SAFETY_KEEP_RATIO (0.6).
 */
export function finalizeProductRelevanceKeep<
  P extends {
    asin: string;
    title?: string | null;
    themes?: string[] | null;
  },
>(
  input: P[],
  kept: P[],
): { productTargets: P[]; restoredEmpty: boolean } {
  const restoredEmpty = input.length > 0 && kept.length === 0;
  return {
    productTargets: withRelevanceSafetyRestore(input, kept, {
      preferAmazonOnThin: true,
    }),
    restoredEmpty,
  };
}

/**
 * Best-effort title fill before product AI. Hard wall-clock budget so Groq
 * is not blocked on slow Amazon retail scrapes (was ~50s on CA missing titles).
 * Untitled rows still filter via themes (product prompt rule 4).
 */
export async function enrichProductTargetsForRelevanceFilter<
  P extends {
    asin: string;
    title?: string | null;
    subtitle?: string | null;
    themes?: string[] | null;
  },
>(
  productTargets: P[],
  opts?: {
    countryCode?: string | null;
    maxRetail?: number;
    /** Cap total enrich wait before calling Groq (default 2s). */
    budgetMs?: number;
  },
): Promise<P[]> {
  if (!productTargets.length) return productTargets;
  // Prefer speed: a handful of retail titles + themes beats waiting on all 70.
  const maxRetail = opts?.maxRetail ?? 16;
  const budgetMs = opts?.budgetMs ?? 2_000;
  const need: string[] = [];
  for (const row of productTargets) {
    const asin = String(row.asin ?? "")
      .trim()
      .toUpperCase();
    if (!asin) continue;
    if (productTitleNeedsEnrichment(row.title, asin)) {
      need.push(asin);
    }
  }
  if (!need.length) return productTargets;
  const retailAsins = need.slice(0, maxRetail);

  const applyTitles = (titles: Map<string, string>): P[] => {
    if (!titles.size) return productTargets;
    return productTargets.map((row) => {
      const asin = String(row.asin ?? "")
        .trim()
        .toUpperCase();
      const title = titles.get(asin);
      if (!title) return row;
      if (!productTitleNeedsEnrichment(row.title, asin)) return row;
      return { ...row, title };
    });
  };

  const fetchWork = fetchAmazonRetailTitles(retailAsins, {
    concurrency: 6,
    timeoutMs: 1_200,
    retries: 0,
    countryCode: opts?.countryCode ?? null,
  }).catch(() => new Map<string, string>());

  try {
    const titles = await Promise.race([
      fetchWork,
      new Promise<Map<string, string>>((resolve) =>
        setTimeout(() => resolve(new Map()), budgetMs),
      ),
    ]);
    // If budget won, still merge any titles that finished afterward is skipped —
    // Groq must start now. Background fetch is abandoned (mapPool in-flight).
    return applyTitles(titles);
  } catch {
    return productTargets;
  }
}

/**
 * Restore Amazon's list when a relevance pass keeps too few rows.
 * `preferAmazonOnThin` (keywords): KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO (0) —
 * only empty keeps restore the full Amazon set so AI can curate a real
 * search-intent shortlist. Products use `minKeepRatio` (default 0.6).
 */
export function withRelevanceSafetyRestore<T>(
  input: T[],
  kept: T[],
  opts?: { preferAmazonOnThin?: boolean; minKeepRatio?: number },
): T[] {
  if (input.length === 0) return kept;
  // Never wipe a non-empty Amazon list via empty AI/heuristic output.
  if (kept.length === 0) return input;
  const ratio = opts?.preferAmazonOnThin
    ? KEYWORD_RELEVANCE_SAFETY_KEEP_RATIO
    : (opts?.minKeepRatio ?? RELEVANCE_SAFETY_KEEP_RATIO);
  // ratio 0 → minKeep 1: any non-empty curated keep sticks.
  const minKeep = Math.max(1, Math.ceil(input.length * ratio));
  if (kept.length < minKeep) return input;
  return kept;
}

/**
 * After Grok keeps some keyword rows, pull in Broad/Phrase/Exact siblings for
 * the same phrase from Amazon's list so match-type companions stay intact.
 */
export function expandKeptKeywordsWithMatchCompanions<
  K extends { keyword: string; matchType?: string },
>(input: K[], kept: K[]): K[] {
  if (!input.length || !kept.length) return kept;
  const keptPhrases = new Set<string>();
  for (const row of kept) {
    const phrase = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    if (phrase) keptPhrases.add(phrase);
  }
  if (!keptPhrases.size) return kept;

  const out: K[] = [];
  const seen = new Set<string>();
  const rowKey = (row: K) => {
    const phrase = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    const match = String(row.matchType ?? "exact")
      .trim()
      .toLowerCase();
    return `${phrase}|${match}`;
  };
  for (const row of kept) {
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  for (const row of input) {
    const phrase = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    if (!keptPhrases.has(phrase)) continue;
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Apply companion expand + keyword safety restore after a Grok/OpenAI pass. */
function finalizeKeywordRelevanceKeep<
  K extends { keyword: string; matchType?: string },
>(
  input: K[],
  kept: K[],
): { keywords: K[]; restoredEmpty: boolean } {
  const expanded = expandKeptKeywordsWithMatchCompanions(input, kept);
  const restoredEmpty = input.length > 0 && expanded.length === 0;
  return {
    keywords: withRelevanceSafetyRestore(input, expanded, {
      preferAmazonOnThin: true,
    }),
    restoredEmpty,
  };
}

function outcomeAfterKeywordKeep(
  amazonCount: number,
  keptCount: number,
  restoredEmpty: boolean,
): SuggestionRelevanceOutcome {
  if (restoredEmpty) return "restored_empty";
  if (amazonCount > 0 && keptCount < amazonCount) return "filtered";
  if (amazonCount > 0) return "kept_all";
  return "kept_all";
}

function applyHeuristicRelevanceFilter<
  K extends { keyword: string; matchType?: string },
  P extends {
    asin: string;
    title?: string | null;
    matchType?: string | null;
    themes?: string[] | null;
  },
>(
  suggestions: FilterableSuggestions<K, P>,
  context: BookRelevanceContext,
): FilterableSuggestions<K, P> {
  const bookTitle = context.bookTitle;
  const advertisedAsin = context.advertisedAsin;
  if (!bookTitle && !advertisedAsin) {
    return suggestions;
  }

  // Keywords: pass through Amazon's full marketplace list.
  // CA/UK/etc. already return thinner SP recommendation sets than US — do not
  // title-token drop them here (long-tail KWs rarely share book-title tokens).
  // OpenAI / Nest proxy (mode "openai") is the place to rank/filter keywords.
  return {
    keywords: suggestions.keywords,
    productTargets: safeFilterProductTargets(
      suggestions.productTargets,
      context,
    ),
  };
}

/**
 * Transient Nest/Groq/xAI failures that should soft-retry (see
 * RELEVANCE_SOFT_RETRY_GAPS_MS) before painting "AI unavailable"
 * (`failed_unfiltered`). Auth / config / hard 4xx stay fail-fast.
 */
export function isTransientRelevanceError(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (status === 401 || status === 403 || status === 400 || status === 404) {
    return false;
  }
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (
    /sign in|unauthorized|forbidden|not configured|EXPO_PUBLIC_GROQ_API_KEY is not set/i.test(
      msg,
    )
  ) {
    return false;
  }
  if (status === 408 || status === 429 || status >= 500) return true;
  return /aborted|timed out|timeout|429|TPM|rate.?limit|Request too large|network|ECONNRESET|fetch failed|502|503|504|Couldn't run Grok|Nest relevance|Groq relevance|Grok relevance filter unavailable|AI search-intent filter unavailable/i.test(
    msg,
  );
}

/** In-filter soft-retry gaps (ms) for transient Nest/Groq TPM/timeouts. */
export const RELEVANCE_SOFT_RETRY_GAPS_MS = [800] as const;

async function withRelevanceSoftRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RELEVANCE_SOFT_RETRY_GAPS_MS.length; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientRelevanceError(error)) throw error;
      if (attempt === RELEVANCE_SOFT_RETRY_GAPS_MS.length - 1) break;
      const gap = RELEVANCE_SOFT_RETRY_GAPS_MS[attempt] ?? 1_200;
      await new Promise((resolve) => setTimeout(resolve, gap));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("AI search-intent filter unavailable.");
}

/**
 * Filter Amazon keyword/ASIN suggestions for the sponsored book + marketplace.
 * - identity: return unchanged (never invent)
 * - heuristic: filter product ASINs by title similarity; **keywords pass through**
 *   (Amazon marketplace APIs already scope CA/US/…; token overlap wrongly empties
 *   thin CA keyword lists below the safety restore floor)
 * - grok / openai: Grok **search-intent filters** keywords (step 2 after Amazon).
 *   Product ASINs get a separate Grok title/theme relevance pass (chunked).
 *   On Grok failure → Amazon rows with `failed_unfiltered` (UI must not
 *   auto-select / claim AI curated). Empty AI keep → Amazon restore with
 *   `restored_empty` (honest label). Edit prompts in suggestionRelevancePrompt.ts.
 *   The server already retries provider rate limits. The client performs one
 *   bounded attempt, then keeps the real Amazon rows available for selection;
 *   it never starts a minutes-long retry chain or invents replacement rows.
 */
export async function filterSuggestionsForBookRelevance<
  K extends { keyword: string; matchType?: string },
  P extends {
    asin: string;
    title?: string | null;
    subtitle?: string | null;
    matchType?: string | null;
    themes?: string[] | null;
  },
>(
  suggestions: FilterableSuggestions<K, P>,
  context: BookRelevanceContext,
  opts?: {
    mode?: SuggestionRelevanceMode;
    /** Injected filter (tests / Nest-side precompute). Must not invent rows. */
    openaiFilter?: (
      suggestions: FilterableSuggestions<K, P>,
      context: BookRelevanceContext,
    ) => Promise<FilterableSuggestions<K, P>>;
    grokFilter?: (
      suggestions: FilterableSuggestions<K, P>,
      context: BookRelevanceContext,
    ) => Promise<FilterableSuggestions<K, P>>;
  },
): Promise<SuggestionRelevanceResult<K, P>> {
  const mode = opts?.mode ?? SUGGESTION_RELEVANCE_DEFAULT_MODE;
  if (mode === "identity") {
    return { ...suggestions, relevanceOutcome: "identity" };
  }

  const finishGrokKeep = (
    filtered: FilterableSuggestions<K, P>,
  ): SuggestionRelevanceResult<K, P> => {
    const finalizedKw = finalizeKeywordRelevanceKeep(
      suggestions.keywords,
      filtered.keywords,
    );
    const finalizedProducts = finalizeProductRelevanceKeep(
      suggestions.productTargets,
      filtered.productTargets,
    );
    const kwOutcome = outcomeAfterKeywordKeep(
      suggestions.keywords.length,
      finalizedKw.keywords.length,
      finalizedKw.restoredEmpty,
    );
    // Products-only: drive outcome from product keep. Mixed: prefer keyword
    // outcome when keywords existed (create KW chrome); products still curated.
    const productOnly =
      suggestions.keywords.length === 0 &&
      suggestions.productTargets.length > 0;
    let relevanceOutcome: SuggestionRelevanceOutcome = kwOutcome;
    if (productOnly) {
      if (finalizedProducts.restoredEmpty) relevanceOutcome = "restored_empty";
      else if (
        finalizedProducts.productTargets.length <
        suggestions.productTargets.length
      ) {
        relevanceOutcome = "filtered";
      } else {
        relevanceOutcome = "kept_all";
      }
    }
    return {
      keywords: finalizedKw.keywords,
      productTargets: finalizedProducts.productTargets,
      relevanceOutcome,
    };
  };

  const failUnfiltered = (error: unknown): SuggestionRelevanceResult<K, P> => {
    const heuristic = applyHeuristicRelevanceFilter(suggestions, context);
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "AI search-intent filter unavailable.";
    return {
      ...heuristic,
      relevanceOutcome: "failed_unfiltered",
      relevanceError: message,
    };
  };

  if (mode === "grok" || mode === "openai") {
    if (opts?.grokFilter) {
      try {
        return finishGrokKeep(
          await withRelevanceSoftRetry(() =>
            opts.grokFilter!(suggestions, context),
          ),
        );
      } catch (error) {
        return failUnfiltered(error);
      }
    }
    if (opts?.openaiFilter) {
      try {
        return finishGrokKeep(
          await withRelevanceSoftRetry(() =>
            opts.openaiFilter!(suggestions, context),
          ),
        );
      } catch (error) {
        return failUnfiltered(error);
      }
    }
    try {
      // Skip retail scrape before Groq — Nest titles + themes are enough for
      // the keep-list; UI fills missing titles via useProductSuggestionAsinMeta.
      // (Retail enrich was adding tens of seconds for little keep quality.)
      const preferGroqEnv =
        String(process.env.EXPO_PUBLIC_SUGGESTION_PREFER_GROQ ?? "")
          .trim()
          .toLowerCase() === "1" ||
        String(process.env.EXPO_PUBLIC_SUGGESTION_PREFER_GROQ ?? "")
          .trim()
          .toLowerCase() === "true";
      // Default Nest → xAI → Groq. Only skip Nest when explicitly benching
      // client Groq (EXPO_PUBLIC_SUGGESTION_PREFER_GROQ=1). Baked Groq keys
      // alone must NOT force preferGroq — that made Create AI fail-closed on
      // free-tier TPM while Nest relevance-filter was healthy.
      return finishGrokKeep(
        await withRelevanceSoftRetry(async () => {
          const { filterSuggestionsWithGrok } = await import(
            "./suggestionRelevanceGrok.ts"
          );
          return filterSuggestionsWithGrok(
            suggestions,
            context,
            preferGroqEnv ? { preferGroq: true } : undefined,
          );
        }),
      );
    } catch (error) {
      return failUnfiltered(error);
    }
  }
  const heuristic = applyHeuristicRelevanceFilter(suggestions, context);
  return { ...heuristic, relevanceOutcome: "heuristic" };
}

export function classifyTheme(theme: string): SuggestionReasonKey {
  const t = theme.toLowerCase();
  if (t.includes("frequently viewed") || t.includes("viewed together")) {
    return "frequently_viewed";
  }
  if (t.includes("top click")) return "top_clicks";
  if (t.includes("top convert") || t.includes("converting")) return "top_converting";
  if (t.includes("complement")) return "complements";
  if (t.includes("substitut")) return "substitutes";
  if (
    t.includes("similar readership") ||
    t.includes("similar audience") ||
    (t.includes("readership") && t.includes("similar"))
  ) {
    return "similar_readership";
  }
  return "other";
}

/** Map opaque Amazon theme strings to short human labels + subtitles. */
export function humanizeAmazonTheme(theme: string): HumanizedTheme {
  const trimmed = String(theme ?? "").trim();
  const reasonKey = classifyTheme(trimmed);
  switch (reasonKey) {
    case "frequently_viewed":
      return {
        reasonKey,
        label: "Often viewed together",
        subtitle: "Shoppers often view this with your book",
      };
    case "top_clicks":
      return {
        reasonKey,
        label: "Top clicks",
        subtitle: "Shoppers click this when they see your book",
      };
    case "top_converting":
      return {
        reasonKey,
        label: "Top converting",
        subtitle: "Shoppers buy this along with similar books",
      };
    case "complements":
      return {
        reasonKey,
        label: "Complements",
        subtitle: "Often bought as a companion title",
      };
    case "substitutes":
      return {
        reasonKey,
        label: "Substitutes",
        subtitle: "Shoppers consider this instead of your book",
      };
    case "similar_readership":
      return {
        reasonKey,
        label: "Similar readership",
        subtitle: "Readers of your book also buy this",
      };
    default:
      return {
        reasonKey,
        label: trimmed || "Amazon suggestion",
        subtitle: null,
      };
  }
}

export function primaryThemeLabel(themes: string[] | null | undefined): HumanizedTheme {
  const first = (themes ?? []).map((t) => String(t).trim()).find(Boolean);
  if (!first) {
    return { reasonKey: "other", label: "Amazon suggestion", subtitle: null };
  }
  return humanizeAmazonTheme(first);
}

/** Reason priority when title similarity ties (lower = higher). */
export function themeSortRank(themes: string[] | null | undefined): number {
  const keys = (themes ?? []).map((t) => classifyTheme(String(t)));
  if (keys.includes("frequently_viewed")) return 0;
  if (keys.includes("top_converting")) return 1;
  if (keys.includes("top_clicks")) return 2;
  if (keys.includes("similar_readership")) return 3;
  if (keys.includes("complements")) return 4;
  if (keys.includes("substitutes")) return 5;
  return 6;
}

/**
 * Sort suggestions: title relatedness to the sponsored book first, then
 * titled-over-untitled, then Amazon reason. Stable on original index.
 */
export function sortProductSuggestionsByTitleSimilarity<T extends ProductSuggestionLike>(
  rows: T[],
  selectedBookTitle: string | null | undefined,
  titleByAsin?: ReadonlyMap<string, string | null | undefined>,
): Array<T & { originalIndex: number; similarity: number }> {
  return rows
    .map((row, originalIndex) => {
      const metaTitle =
        titleByAsin?.get(String(row.asin).toUpperCase()) ??
        row.title ??
        null;
      const similarity = titleSimilarityScore(metaTitle, selectedBookTitle);
      return { ...row, originalIndex, similarity };
    })
    .sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      const aHasTitle = !isAsinAsTitle(
        titleByAsin?.get(String(a.asin).toUpperCase()) ?? a.title,
        a.asin,
      )
        ? 1
        : 0;
      const bHasTitle = !isAsinAsTitle(
        titleByAsin?.get(String(b.asin).toUpperCase()) ?? b.title,
        b.asin,
      )
        ? 1
        : 0;
      if (bHasTitle !== aHasTitle) return bHasTitle - aHasTitle;
      const reason = themeSortRank(a.themes) - themeSortRank(b.themes);
      if (reason !== 0) return reason;
      return a.originalIndex - b.originalIndex;
    });
}

export type BidMode = "default" | "custom";

export type KeywordMatchType = "broad" | "phrase" | "exact";

/**
 * Return only selected indexes that are still eligible for submission.
 * Suggestions can be re-ranked, removed as duplicates, or hidden after an
 * asynchronous existing-entity read. Counts and payloads must share this
 * exact ordered set so the UI never promises more rows than it sends.
 */
export function selectedEligibleSuggestionIndexes(
  selected: ReadonlySet<number>,
  eligibleIndexes: Iterable<number>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const index of eligibleIndexes) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      seen.has(index) ||
      !selected.has(index)
    ) {
      continue;
    }
    seen.add(index);
    out.push(index);
  }
  return out;
}

/**
 * Normalize Amazon / Nest keyword match codes. Never drop a keyword for an
 * unknown code — CA/UK payloads sometimes omit or send BROAD_MATCH-style enums.
 */
export function normalizeKeywordMatchType(value: unknown): KeywordMatchType {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return "exact";
  if (raw.includes("broad")) return "broad";
  if (raw.includes("phrase")) return "phrase";
  if (raw.includes("exact") || raw.includes("close")) return "exact";
  return "exact";
}
export type ProductMatchType = "exact" | "expanded";

const KEYWORD_MATCH_ORDER: KeywordMatchType[] = ["broad", "phrase", "exact"];
const PRODUCT_MATCH_ORDER: ProductMatchType[] = ["exact", "expanded"];

function keywordMatchRank(matchType: string | null | undefined): number {
  const m = String(matchType ?? "").toLowerCase();
  const idx = KEYWORD_MATCH_ORDER.indexOf(m as KeywordMatchType);
  return idx >= 0 ? idx : KEYWORD_MATCH_ORDER.length;
}

/**
 * Keep Amazon's first-seen keyword order, but cluster Broad/Phrase/Exact for
 * the same phrase together (Broad → Phrase → Exact).
 */
export function clusterKeywordSuggestionsByPhrase<
  T extends { keyword: string; matchType?: string | null },
>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }
  const out: T[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    group.sort(
      (a, b) => keywordMatchRank(a.matchType) - keywordMatchRank(b.matchType),
    );
    out.push(...group);
  }
  return out;
}

/**
 * Cluster Exact + Expanded companions for the same ASIN adjacently.
 */
export function clusterProductSuggestionsByAsin<
  T extends { asin: string; matchType?: string | null },
>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = String(row.asin ?? "")
      .trim()
      .toUpperCase();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }
  const out: T[] = [];
  for (const key of order) {
    const group = groups.get(key) ?? [];
    group.sort((a, b) => {
      const am = normalizeProductMatchType(a.matchType);
      const bm = normalizeProductMatchType(b.matchType);
      return (
        PRODUCT_MATCH_ORDER.indexOf(am) - PRODUCT_MATCH_ORDER.indexOf(bm)
      );
    });
    out.push(...group);
  }
  return out;
}

/**
 * Amazon SP keyword recommendations return bids in **cents** (minor units).
 * Nest converts to major units; this client path only repairs clearly-unconverted
 * whole numbers (≥50 ≈ Amazon raw cents like 97/111) so Nest-fixed `$1` / `$2`
 * integers are not divided again.
 */
export function recommendationBidMajorUnits(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  let major = n;
  const whole =
    Number.isInteger(n) || Math.abs(n - Math.round(n)) < 1e-9;
  if (whole) {
    const asInt = Math.round(n);
    if (asInt >= 10_000) major = asInt / 1_000_000;
    else if (asInt >= 50) major = asInt / 100;
  }
  if (major < 0.02 || major > 1000) return null;
  return Number(major.toFixed(2));
}

/**
 * Amazon SP product target expression codes:
 * - asinSameAs / ASIN_SAME_AS / exact → Exact
 * - asinExpandedFrom / ASIN_EXPANDED_FROM / expanded → Expanded
 * Returns null when the API omitted match type.
 */
export function parseProductMatchTypeOrNull(
  value: unknown,
): ProductMatchType | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (
    raw.includes("expanded") ||
    raw.includes("asin_expanded") ||
    raw === "asinexpandedfrom" ||
    raw === "asin_expanded_from"
  ) {
    return "expanded";
  }
  if (
    raw.includes("same_as") ||
    raw === "asinsameas" ||
    raw === "asin_same_as" ||
    raw === "exact" ||
    raw === "close_match" ||
    raw === "closematch"
  ) {
    return "exact";
  }
  // Unknown non-empty codes: treat as exact (legacy Nest payloads).
  return "exact";
}

/** Normalize product expression / match codes to exact | expanded. */
export function normalizeProductMatchType(value: unknown): ProductMatchType {
  return parseProductMatchTypeOrNull(value) ?? "exact";
}

/**
 * Preserve Amazon's product-recommendation entities without inventing rows.
 * Amazon's recommendation endpoint commonly returns one ASIN without an
 * expression type. In that case we keep one row and use Exact as the safe
 * creation default. Explicit Exact/Expanded rows are retained independently.
 * Exact duplicate entities are merged; an absent Expanded row is never
 * synthesized here — use `offerExpandedCompanionsForExactOnly` for create UX.
 */
export function expandProductSuggestionsWithMatchTypes<
  T extends { matchType?: string | null; asin: string },
>(
  rows: T[],
  opts?: { matchTypeWasExplicit?: (row: T, index: number) => boolean },
): Array<T & { matchType: ProductMatchType }> {
  const byEntity = new Map<string, T & { matchType: ProductMatchType }>();
  rows.forEach((row, index) => {
    const asin = String(row.asin ?? "")
      .trim()
      .toUpperCase();
    if (!asin) return;
    const explicit = opts?.matchTypeWasExplicit?.(row, index) ?? Boolean(row.matchType);
    const parsed = explicit
      ? parseProductMatchTypeOrNull(row.matchType) ?? "exact"
      : "exact";
    const key = `${asin}|${parsed}`;
    const previous = byEntity.get(key);
    if (!previous) {
      byEntity.set(key, { ...row, asin, matchType: parsed });
      return;
    }
    // Preserve the first Amazon entity order while filling fields from a
    // repeated payload occurrence. Never create a second UI suggestion.
    byEntity.set(key, {
      ...row,
      ...previous,
      asin,
      matchType: parsed,
    });
  });
  return [...byEntity.values()];
}

/**
 * Create UX: when Amazon only returned Exact (or omitted match type → Exact),
 * offer Expanded companions so "Select by match type" can show Expanded.
 * Never invent ASINs Amazon did not recommend — only duplicate match type.
 * Skips ASINs that already have an Expanded row from Amazon.
 */
export function offerExpandedCompanionsForExactOnly<
  T extends { matchType: ProductMatchType; asin: string },
>(rows: T[]): T[] {
  if (!rows.length) return rows;
  const hasExpanded = rows.some((row) => row.matchType === "expanded");
  if (hasExpanded) return rows;
  const expandedAsins = new Set(
    rows.filter((row) => row.matchType === "expanded").map((row) => row.asin),
  );
  const companions: T[] = [];
  for (const row of rows) {
    if (row.matchType !== "exact") continue;
    if (expandedAsins.has(row.asin)) continue;
    companions.push({ ...row, matchType: "expanded" });
    expandedAsins.add(row.asin);
  }
  return companions.length ? [...rows, ...companions] : rows;
}

/**
 * Create UX: Amazon CA/UK often returns one match type per phrase. Offer the
 * missing Broad/Phrase/Exact companions so "Select by match type" works.
 * Never invent keyword text Amazon did not recommend.
 */
export function offerKeywordMatchCompanions<
  T extends { keyword: string; matchType: KeywordMatchType },
>(rows: T[]): T[] {
  if (!rows.length) return rows;
  const typesByPhrase = new Map<string, Set<KeywordMatchType>>();
  const templateByPhrase = new Map<string, T>();
  const uniqueRows: T[] = [];
  const seenEntities = new Set<string>();
  for (const row of rows) {
    const key = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const match = normalizeKeywordMatchType(row.matchType);
    const entityKey = `${key}::${match}`;
    if (seenEntities.has(entityKey)) continue;
    seenEntities.add(entityKey);
    uniqueRows.push({ ...row, matchType: match });
    if (!typesByPhrase.has(key)) {
      typesByPhrase.set(key, new Set());
      templateByPhrase.set(key, { ...row, matchType: match });
    }
    typesByPhrase.get(key)!.add(match);
  }
  const companions: T[] = [];
  for (const [key, types] of typesByPhrase) {
    const template = templateByPhrase.get(key);
    if (!template) continue;
    for (const match of KEYWORD_MATCH_ORDER) {
      if (types.has(match)) continue;
      companions.push({ ...template, matchType: match });
    }
  }
  return companions.length ? [...uniqueRows, ...companions] : uniqueRows;
}

/** Unique keyword phrases (case-insensitive), for honest UI counts. */
export function uniqueKeywordPhraseCount(
  rows: Array<{ keyword: string }>,
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = String(row.keyword ?? "")
      .trim()
      .toLowerCase();
    if (key) seen.add(key);
  }
  return seen.size;
}

/**
 * Honest pre/post Grok keyword counts for Create / Add keywords UI.
 * `amazonApi*` = Nest/Amazon rows before Broad/Phrase/Exact companions
 * (console Broad-only ≈ phrase count when Amazon returns one match type).
 * `amazon*` = after companions (console all match types).
 * `kept*` = after Grok + companion expand + safety restore.
 */
export type KeywordSuggestionCountStats = {
  amazonApiRowCount: number;
  amazonApiPhraseCount: number;
  amazonRowCount: number;
  amazonPhraseCount: number;
  keptRowCount: number;
  keptPhraseCount: number;
  /** Kept is a proper subset of Amazon companion rows (Grok dropped some). */
  grokFiltered: boolean;
  /**
   * True while Amazon rows are visible and Grok has not finished yet.
   * UI shows live Amazon totals immediately (e.g. "Amazon · {N} phrases · {M} · Ranking…").
   */
  grokPending?: boolean;
  /**
   * Honest Step-2 outcome. Prefer this over inferring from grokFiltered alone.
   * `failed_unfiltered` / `restored_empty` must not auto-select or claim curated.
   */
  relevanceOutcome?: SuggestionRelevanceOutcome | "pending" | "user_accepted_unfiltered";
  relevanceError?: string;
};

export function buildKeywordSuggestionCountStats(input: {
  amazonApiRowCount: number;
  amazonApiPhraseCount: number;
  amazonRows: Array<{ keyword: string }>;
  keptRows: Array<{ keyword: string }>;
  relevanceOutcome?: KeywordSuggestionCountStats["relevanceOutcome"];
  relevanceError?: string;
}): KeywordSuggestionCountStats {
  const amazonRowCount = input.amazonRows.length;
  const amazonPhraseCount = uniqueKeywordPhraseCount(input.amazonRows);
  const keptRowCount = input.keptRows.length;
  const keptPhraseCount = uniqueKeywordPhraseCount(input.keptRows);
  const grokFiltered = keptRowCount < amazonRowCount;
  let relevanceOutcome = input.relevanceOutcome;
  if (!relevanceOutcome) {
    relevanceOutcome = grokFiltered ? "filtered" : "kept_all";
  }
  return {
    amazonApiRowCount: Math.max(0, input.amazonApiRowCount),
    amazonApiPhraseCount: Math.max(0, input.amazonApiPhraseCount),
    amazonRowCount,
    amazonPhraseCount,
    keptRowCount,
    keptPhraseCount,
    grokFiltered,
    relevanceOutcome,
    ...(input.relevanceError ? { relevanceError: input.relevanceError } : {}),
  };
}

/**
 * Product-targeting chrome reuses KeywordSuggestionCountStats: each ASIN is one
 * "row" / "phrase" so formatKeywordSuggestionCountLabel stays honest
 * ("Amazon · N · Kept K" / "AI kept all").
 */
export function buildProductSuggestionCountStats(input: {
  amazonProducts: Array<{ asin: string }>;
  keptProducts: Array<{ asin: string }>;
  relevanceOutcome?: KeywordSuggestionCountStats["relevanceOutcome"];
  relevanceError?: string;
}): KeywordSuggestionCountStats {
  const toRows = (rows: Array<{ asin: string }>) =>
    rows.map((row) => ({
      keyword: String(row.asin ?? "")
        .trim()
        .toUpperCase(),
    }));
  const amazonRows = toRows(input.amazonProducts);
  const keptRows = toRows(input.keptProducts);
  return buildKeywordSuggestionCountStats({
    amazonApiRowCount: amazonRows.length,
    amazonApiPhraseCount: amazonRows.length,
    amazonRows,
    keptRows,
    relevanceOutcome: input.relevanceOutcome,
    relevanceError: input.relevanceError,
  });
}

/**
 * Surface Amazon totals always; always disclose AI stage after Amazon paints.
 * Counts are always from the live suggestion set — never book-specific constants.
 * Shape examples:
 *   "Amazon · {N} phrases · {M} · Ranking…"
 *   "Amazon · {N} phrases · {M} · Kept {K}"
 *   "Amazon · {N} phrases · {M} · AI kept all"  (Grok finished, no thin)
 *   "Amazon · {N} · Amazon suggestions"
 *   "Amazon · {N} · Amazon restored (AI empty)"
 */
export function formatKeywordSuggestionCountLabel(
  stats: KeywordSuggestionCountStats,
  opts?: { selectedCount?: number; shownCount?: number },
): string {
  const phrases =
    stats.amazonPhraseCount > 0
      ? stats.amazonPhraseCount
      : stats.amazonApiPhraseCount;
  const amazonRows =
    stats.amazonRowCount > 0 ? stats.amazonRowCount : stats.amazonApiRowCount;
  const parts: string[] = [];
  // Compact: "Amazon · 186 · 558" (phrases · rows) — no "phrases" word clutter.
  if (phrases > 0 && phrases < amazonRows) {
    parts.push(`Amazon · ${phrases} · ${amazonRows}`);
  } else if (amazonRows > 0) {
    parts.push(`Amazon · ${amazonRows}`);
  } else {
    parts.push("Amazon · 0");
  }
  const outcome = stats.grokPending
    ? "pending"
    : stats.relevanceOutcome;
  if (stats.grokPending || outcome === "pending") {
    parts.push("Ranking…");
  } else if (outcome === "failed_unfiltered") {
    parts.push("Amazon suggestions");
  } else if (outcome === "restored_empty") {
    parts.push("Amazon restored (AI empty)");
  } else if (outcome === "user_accepted_unfiltered") {
    parts.push("Using Amazon unfiltered");
  } else if (
    (outcome === "filtered" || stats.grokFiltered) &&
    stats.keptRowCount < amazonRows
  ) {
    parts.push(`Kept ${stats.keptRowCount}`);
  } else if (amazonRows > 0) {
    // Grok finished without thinning — still disclose AI ran.
    parts.push("AI kept all");
  }
  // amazonRows === 0: leave "Amazon · 0" alone — do not claim AI kept anything.
  if (
    opts?.shownCount != null &&
    opts.shownCount >= 0 &&
    opts.shownCount !== stats.keptRowCount &&
    !(opts.shownCount === amazonRows && !stats.grokFiltered && !stats.grokPending)
  ) {
    parts.push(`${opts.shownCount} shown`);
  }
  if (opts?.selectedCount != null && opts.selectedCount > 0) {
    parts.push(`${opts.selectedCount} selected`);
  }
  return parts.join(" · ");
}

/**
 * Raw Amazon rows remain visible after provider failure, but they are not an AI
 * result. Keep selection blocked until the user retries or explicitly chooses
 * the unfiltered Amazon set.
 */
export function suggestionRelevanceNeedsUserConfirm(
  stats: KeywordSuggestionCountStats | null | undefined,
): boolean {
  if (!stats || stats.grokPending) return false;
  const outcome = stats.relevanceOutcome;
  return outcome === "failed_unfiltered" || outcome === "restored_empty";
}

export function uniqueKeywordMatchTypes(
  rows: Array<{ matchType: string }>,
): KeywordMatchType[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const m = String(row.matchType ?? "").toLowerCase();
    if (m === "broad" || m === "phrase" || m === "exact") seen.add(m);
  }
  return KEYWORD_MATCH_ORDER.filter((k) => seen.has(k));
}

export function uniqueProductMatchTypes(
  rows: Array<{ matchType?: string | null }>,
): ProductMatchType[] {
  const seen = new Set<ProductMatchType>();
  for (const row of rows) {
    seen.add(normalizeProductMatchType(row.matchType));
  }
  return PRODUCT_MATCH_ORDER.filter((k) => seen.has(k));
}

export function productMatchSelectLabel(key: ProductMatchType): string {
  return key === "expanded" ? "Expanded" : "Exact";
}

/** Effective bid for create payload. */
export function resolveSuggestionBid(input: {
  mode: BidMode;
  customBid: number | null;
  suggestedBid: number | null;
  defaultBid: number;
  useSuggestedBids: boolean;
}): number {
  const suggested = recommendationBidMajorUnits(input.suggestedBid);
  if (input.mode === "custom" && input.customBid != null && Number.isFinite(input.customBid)) {
    return input.customBid;
  }
  if (input.useSuggestedBids && suggested != null) {
    return suggested;
  }
  return input.defaultBid;
}

/**
 * Display string for the bid chip / control.
 * Labels Amazon suggested vs app default; never shows raw cents as dollars.
 */
export function formatSuggestionBidDisplay(input: {
  mode: BidMode;
  customBid: number | null;
  suggestedBid: number | null;
  defaultBid: number;
  useSuggestedBids?: boolean;
  currency?: string | null;
}): string {
  if (input.mode === "custom" && input.customBid != null && Number.isFinite(input.customBid)) {
    return formatCurrency(input.customBid, input.currency);
  }
  const suggested = recommendationBidMajorUnits(input.suggestedBid);
  const useSuggested = input.useSuggestedBids !== false;
  if (useSuggested && suggested != null) {
    return `Amazon suggested ${formatCurrency(suggested, input.currency)}`;
  }
  return `Default ${formatCurrency(input.defaultBid, input.currency)}`;
}

export function uniqueReasonKeys(
  rows: Array<{ themes: string[] }>,
): SuggestionReasonKey[] {
  const order: SuggestionReasonKey[] = [
    "frequently_viewed",
    "top_converting",
    "top_clicks",
    "similar_readership",
    "complements",
    "substitutes",
    "other",
  ];
  const seen = new Set<SuggestionReasonKey>();
  for (const row of rows) {
    const first = (row.themes ?? []).map((t) => String(t).trim()).find(Boolean);
    seen.add(first ? classifyTheme(first) : "other");
  }
  return order.filter((k) => seen.has(k));
}

export function reasonSelectLabel(key: SuggestionReasonKey): string {
  switch (key) {
    case "frequently_viewed":
      return "Often viewed together";
    case "top_converting":
      return "Top converting";
    case "top_clicks":
      return "Top clicks";
    case "similar_readership":
      return "Similar readership";
    case "complements":
      return "Complements";
    case "substitutes":
      return "Substitutes";
    default:
      return "Other";
  }
}

export function rowMatchesReasonKey(
  themes: string[] | null | undefined,
  key: SuggestionReasonKey,
): boolean {
  const first = (themes ?? []).map((t) => String(t).trim()).find(Boolean);
  return (first ? classifyTheme(first) : "other") === key;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function normalizeSuggestionAsin(value: unknown): string | null {
  const asin = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

/** ISBN-10 shape (digits / trailing X) — Amazon often uses these as ASINs for print. */
export function isIsbn10Asin(value: string | null | undefined): boolean {
  const asin = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^\d{9}[\dX]$/.test(asin);
}

/** True when a candidate title is empty or just repeats the ASIN/ISBN. */
export function isAsinAsTitle(
  title: string | null | undefined,
  asin: string | null | undefined,
): boolean {
  const id = normalizeSuggestionAsin(asin);
  const t = String(title ?? "").trim();
  if (!t) return true;
  if (!id) return false;
  return t.toUpperCase() === id;
}

/**
 * True when Groq / retail enrich should treat the title as missing.
 * UI placeholder "Title unavailable" is not a real title — without this,
 * enrich skips those rows and the LLM sees a useless label.
 */
export function productTitleNeedsEnrichment(
  title: string | null | undefined,
  asin: string | null | undefined,
): boolean {
  const t = String(title ?? "").trim();
  if (!t) return true;
  if (t.toLowerCase() === TITLE_UNAVAILABLE.toLowerCase()) return true;
  return isAsinAsTitle(t, asin);
}

/**
 * Row primary label: real book title, never ASIN-as-title.
 * Missing meta → "Title unavailable" (ASIN stays secondary in the UI).
 */
export function displaySuggestionTitle(
  title: string | null | undefined,
  asin: string | null | undefined,
): string {
  if (isAsinAsTitle(title, asin)) return TITLE_UNAVAILABLE;
  return String(title).trim();
}

export function normalizeSuggestionStockStatus(
  value: unknown,
): SuggestionStockStatus {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return "unknown";
  if (
    raw.includes("out_of_stock") ||
    raw.includes("outofstock") ||
    raw.includes("unavailable") ||
    raw.includes("ineligible")
  ) {
    return "out_of_stock";
  }
  if (
    raw.includes("in_stock") ||
    raw === "instock" ||
    raw.includes("eligible") ||
    raw === "available"
  ) {
    return "in_stock";
  }
  return "unknown";
}

export function suggestionStockCaption(
  status: SuggestionStockStatus | null | undefined,
): string {
  if (status === "in_stock") return "In stock";
  if (status === "out_of_stock") return "Out of stock";
  if (status === "unknown") return "Stock unknown";
  return "";
}

/** Year from title ("Iceland Travel Guide 2026") — null when absent. */
export function publicationYearFromTitle(
  title: string | null | undefined,
): number | null {
  const match = String(title ?? "").match(/\b(20\d{2}|19\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

export function parsePublicationDate(
  value: string | null | undefined,
): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) {
    const year = Number(raw);
    if (year >= 1900 && year <= 2100) return new Date(Date.UTC(year, 0, 1));
    return null;
  }
  if (/^\d{4}-\d{2}(-\d{2})?/.test(raw)) {
    const d = new Date(raw.length === 7 ? `${raw}-01` : raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Age in whole months from publishedAt / title year. Null when unknown —
 * unknown age is never treated as stale.
 * Year-only dates use July 1 (mid-year) so a "Guide 2026" title in Sep 2026
 * is not falsely marked >6 months old.
 */
export function suggestionAgeMonths(input: {
  publishedAt?: string | null;
  title?: string | null;
  now?: Date;
}): number | null {
  const now = input.now ?? new Date();
  const rawPublished = String(input.publishedAt ?? "").trim();
  let published = parsePublicationDate(rawPublished);
  let yearOnly = /^\d{4}$/.test(rawPublished);
  if (!published) {
    const year = publicationYearFromTitle(input.title);
    if (year != null) {
      published = new Date(Date.UTC(year, 6, 1)); // July 1
      yearOnly = true;
    }
  } else if (yearOnly) {
    published = new Date(Date.UTC(published.getUTCFullYear(), 6, 1));
  }
  if (!published) return null;
  // Same calendar year as now is never "stale" for year-only signals.
  if (yearOnly && published.getUTCFullYear() >= now.getUTCFullYear()) {
    return 0;
  }
  const months =
    (now.getUTCFullYear() - published.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - published.getUTCMonth());
  return Math.max(0, months);
}

/**
 * Hide when age > 6 months AND no KDP royalty activity AND no ads metrics
 * in the lookback window. Keep newer books; keep older books with history;
 * keep unknown-age books.
 */
export function isStaleDeadSuggestionTarget(input: {
  publishedAt?: string | null;
  title?: string | null;
  hasRoyaltyActivity: boolean;
  hasAdsActivity: boolean;
  now?: Date;
  staleAgeMonths?: number;
}): boolean {
  if (input.hasRoyaltyActivity || input.hasAdsActivity) return false;
  const age = suggestionAgeMonths(input);
  if (age == null) return false;
  const threshold = input.staleAgeMonths ?? SUGGESTION_STALE_AGE_MONTHS;
  return age > threshold;
}

export function filterStaleDeadSuggestions<
  T extends {
    asin: string;
    title?: string | null;
    publishedAt?: string | null;
  },
>(
  rows: T[],
  activity: ReadonlyMap<
    string,
    { hasRoyaltyActivity: boolean; hasAdsActivity: boolean }
  >,
  now?: Date,
): T[] {
  return rows.filter((row) => {
    const asin = normalizeSuggestionAsin(row.asin);
    if (!asin) return false;
    const flags = activity.get(asin) ?? {
      hasRoyaltyActivity: false,
      hasAdsActivity: false,
    };
    return !isStaleDeadSuggestionTarget({
      publishedAt: row.publishedAt,
      title: row.title,
      hasRoyaltyActivity: flags.hasRoyaltyActivity,
      hasAdsActivity: flags.hasAdsActivity,
      now,
    });
  });
}

function humanTitleFromRow(title: unknown, asin: string): string | null {
  const raw = String(title ?? "").trim();
  if (!raw || isAsinAsTitle(raw, asin)) return null;
  return raw;
}

/** Decode common HTML entities from Amazon / Open Library titles. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    );
}

/**
 * Pull a usable book title from Amazon retail HTML. Ads `/product/metadata`
 * only covers owned ASINs — competitor suggestion covers still load via CDN
 * while titles need this (or Nest catalog / Open Library) gap fill.
 */
export function titleFromAmazonRetailHtml(
  html: string,
  asin: string,
): string | null {
  const raw = String(html ?? "");
  if (!raw || raw.length < 8_000) {
    // Soft-block / interstitial pages are tiny and titled "Amazon.com".
    return null;
  }
  const patterns = [
    /<span[^>]*id=["']productTitle["'][^>]*>\s*([^<]+?)\s*<\/span>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>\s*([^<]+?)\s*<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    let title = decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
    title = title
      .replace(/^Amazon\.com\s*:\s*/i, "")
      .replace(/\s*[|:]\s*Amazon\.c(?:om|o\.uk).*$/i, "")
      .replace(/\s*[|:]\s*Books\s*$/i, "")
      .replace(/\s+Amazon\.com\s*$/i, "")
      .replace(
        /\s+:\s+[^:]{2,100}\s+:\s+(?:Kindle Store|Books|Audible Books[^:]*)\s*$/i,
        "",
      )
      // Drop trailing ": Author Name: 13-digit ISBN/ASIN" Amazon page suffix.
      .replace(/\s*:\s*[^:]{2,80}:\s*[A-Z0-9]{10,13}\s*$/i, "")
      .trim();
    if (/^amazon\.com$/i.test(title)) continue;
    if (/^amazon\.com\s*:/i.test(title) && title.length < 24) continue;
    const cleaned = humanTitleFromRow(title, asin);
    if (cleaned && cleaned.length >= 3) return cleaned;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

/**
 * Retail Amazon host for suggestion title gap-fill.
 * Keyed by marketplace country — never guessed from book title.
 */
export function amazonRetailHostForCountry(
  countryCode: string | null | undefined,
): string {
  const cc = String(countryCode ?? "")
    .trim()
    .toUpperCase();
  switch (cc) {
    case "US":
      return "www.amazon.com";
    case "CA":
      return "www.amazon.ca";
    case "GB":
    case "UK":
      return "www.amazon.co.uk";
    case "DE":
      return "www.amazon.de";
    case "FR":
      return "www.amazon.fr";
    case "IT":
      return "www.amazon.it";
    case "ES":
      return "www.amazon.es";
    case "JP":
      return "www.amazon.co.jp";
    case "AU":
      return "www.amazon.com.au";
    case "MX":
      return "www.amazon.com.mx";
    case "IN":
      return "www.amazon.in";
    default:
      // Fail closed to .com only when marketplace is unknown — caller should
      // prefer Nest/catalog titles for non-US when country is missing.
      return "www.amazon.com";
  }
}

/**
 * Resolve missing titles from Amazon retail product pages (batch + retry).
 * Soft-fails per ASIN; never blocks the Create screen forever.
 */
export async function fetchAmazonRetailTitles(
  asins: string[],
  opts: {
    concurrency?: number;
    timeoutMs?: number;
    retries?: number;
    /** Exact Ads marketplace country for the selected profile (US, CA, …). */
    countryCode?: string | null;
  } = {},
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [
    ...new Set(
      asins
        .map((a) => normalizeSuggestionAsin(a))
        .filter((a): a is string => Boolean(a)),
    ),
  ];
  if (!unique.length) return result;

  // Keep concurrency low — Amazon soft-blocks bursty Node/RN fetches.
  const concurrency = opts.concurrency ?? 2;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const retries = opts.retries ?? 2;
  const host = amazonRetailHostForCountry(opts.countryCode);

  const urlsFor = (asin: string) => [
    `https://${host}/gp/aw/d/${asin}`,
    `https://${host}/dp/${asin}`,
  ];

  await mapPool(unique, concurrency, async (asin) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(400 * attempt);
      const url = urlsFor(asin)[attempt % urlsFor(asin).length];
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
          },
          signal: controller?.signal,
        });
        if (!response.ok) continue;
        const html = await response.text();
        const title = titleFromAmazonRetailHtml(html, asin);
        if (title) {
          result.set(asin, title);
          return;
        }
      } catch {
        // retry
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  });

  return result;
}

async function fetchOpenLibraryMeta(
  asins: string[],
): Promise<Map<string, AsinDisplayMeta>> {
  const result = new Map<string, AsinDisplayMeta>();
  if (!asins.length) return result;

  const bibkeys: string[] = [];
  const keyToAsin = new Map<string, string>();
  for (const asin of asins) {
    if (isIsbn10Asin(asin)) {
      const key = `ISBN:${asin}`;
      bibkeys.push(key);
      keyToAsin.set(key, asin);
    }
    // Open Library also indexes many Amazon identifiers.
    const amazonKey = `ASIN:${asin}`;
    bibkeys.push(amazonKey);
    keyToAsin.set(amazonKey, asin);
  }

  const olHeaders = {
    Accept: "application/json",
    "User-Agent": "InteliAds/1.0 (campaign-suggestion-titles)",
  };

  try {
    for (const keyChunk of chunk(bibkeys, 40)) {
      const url =
        `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(keyChunk.join(","))}` +
        `&format=json&jscmd=data`;
      let payload: Record<string, any> | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, { headers: olHeaders });
          if (!response.ok) continue;
          payload = (await response.json()) as Record<string, any>;
          break;
        } catch {
          // retry once
        }
      }
      if (!payload) continue;
      for (const [key, book] of Object.entries(payload ?? {})) {
        const asin = keyToAsin.get(key);
        if (!asin || !book) continue;
        const title = humanTitleFromRow(book.title, asin);
        const subtitle = String(book.subtitle ?? "").trim() || null;
        const cover =
          book.cover?.medium ||
          book.cover?.large ||
          book.cover?.small ||
          null;
        const publishedAt =
          String(book.publish_date ?? book.publishDate ?? "").trim() || null;
        const cur = result.get(asin) ?? {
          title: null,
          subtitle: null,
          coverUrl: fallbackAsinCoverUrl(asin),
        };
        result.set(asin, {
          title: cur.title || title,
          subtitle: cur.subtitle || subtitle,
          coverUrl: cover || cur.coverUrl,
          publishedAt: cur.publishedAt || publishedAt,
          stockStatus: cur.stockStatus,
        });
      }
    }
  } catch {
    // Soft-fail Open Library — CDN covers and Nest meta still apply.
  }

  // ISBN-10 direct path when Books API misses (common for print ISBNs).
  const stillNeed = asins.filter((a) => isIsbn10Asin(a) && !result.get(a)?.title);
  for (const asin of stillNeed.slice(0, 30)) {
    try {
      const response = await fetch(
        `https://openlibrary.org/isbn/${encodeURIComponent(asin)}.json`,
        { headers: olHeaders },
      );
      if (!response.ok) continue;
      const book = (await response.json()) as Record<string, unknown>;
      const title = humanTitleFromRow(book.title, asin);
      if (!title) continue;
      const subtitle = String(book.subtitle ?? "").trim() || null;
      const publishedAt = String(book.publish_date ?? "").trim() || null;
      result.set(asin, {
        title,
        subtitle,
        coverUrl:
          `https://covers.openlibrary.org/b/isbn/${asin}-M.jpg` ||
          fallbackAsinCoverUrl(asin),
        publishedAt,
        stockStatus: "unknown",
      });
    } catch {
      // ignore
    }
  }

  return result;
}

function lookbackIsoDate(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Royalty (KDP daily) + ads target metrics flags for suggestion ASINs.
 * Used to keep older books that still have activity.
 */
export async function fetchSuggestionActivityFlags(input: {
  asins: string[];
  profileIds: string[];
  lookbackDays?: number;
}): Promise<
  Map<string, { hasRoyaltyActivity: boolean; hasAdsActivity: boolean }>
> {
  const { supabase } = await import("./supabase.ts");
  const asins = [
    ...new Set(
      input.asins
        .map((a) => normalizeSuggestionAsin(a))
        .filter((a): a is string => Boolean(a)),
    ),
  ];
  const result = new Map<
    string,
    { hasRoyaltyActivity: boolean; hasAdsActivity: boolean }
  >();
  for (const asin of asins) {
    result.set(asin, { hasRoyaltyActivity: false, hasAdsActivity: false });
  }
  if (!asins.length) return result;

  const since = lookbackIsoDate(
    input.lookbackDays ?? SUGGESTION_ACTIVITY_LOOKBACK_DAYS,
  );
  const profileIds = [
    ...new Set(input.profileIds.map((id) => String(id).trim()).filter(Boolean)),
  ];

  try {
    for (const asinChunk of chunk(asins, 80)) {
      const { data: royaltyRows } = await supabase
        .from("kdp_book_daily_data")
        .select("asin, royalties, paperback_royalties, ebook_royalties")
        .in("asin", asinChunk)
        .gte("date", since)
        .limit(2000);
      for (const row of royaltyRows ?? []) {
        const asin = normalizeSuggestionAsin((row as { asin?: string }).asin);
        if (!asin) continue;
        const royalties =
          Number((row as { royalties?: number }).royalties) ||
          Number((row as { paperback_royalties?: number }).paperback_royalties) ||
          Number((row as { ebook_royalties?: number }).ebook_royalties) ||
          0;
        if (royalties > 0) {
          const cur = result.get(asin) ?? {
            hasRoyaltyActivity: false,
            hasAdsActivity: false,
          };
          result.set(asin, { ...cur, hasRoyaltyActivity: true });
        }
      }
    }

    if (profileIds.length) {
      for (const asinChunk of chunk(asins, 80)) {
        const { data: targets } = await supabase
          .from("product_targets")
          .select("id, target_value")
          .in("amazon_profile_id", profileIds)
          .in("target_value", asinChunk)
          .limit(2000);
        const targetIds = (targets ?? [])
          .map((row: { id?: string }) => String(row.id ?? "").trim())
          .filter(Boolean);
        const asinByTargetId = new Map<string, string>();
        for (const row of targets ?? []) {
          const id = String((row as { id?: string }).id ?? "").trim();
          const asin = normalizeSuggestionAsin(
            (row as { target_value?: string }).target_value,
          );
          if (id && asin) asinByTargetId.set(id, asin);
        }
        if (!targetIds.length) continue;
        for (const idChunk of chunk(targetIds, 80)) {
          const { data: metrics } = await supabase
            .from("product_target_metrics")
            .select("product_target_id, impressions, clicks, cost, spend")
            .in("product_target_id", idChunk)
            .gte("date", since)
            .limit(4000);
          for (const row of metrics ?? []) {
            const tid = String(
              (row as { product_target_id?: string }).product_target_id ?? "",
            ).trim();
            const asin = asinByTargetId.get(tid);
            if (!asin) continue;
            const impressions =
              Number((row as { impressions?: number }).impressions) || 0;
            const clicks = Number((row as { clicks?: number }).clicks) || 0;
            const cost =
              Number((row as { cost?: number }).cost) ||
              Number((row as { spend?: number }).spend) ||
              0;
            if (impressions > 0 || clicks > 0 || cost > 0) {
              const cur = result.get(asin) ?? {
                hasRoyaltyActivity: false,
                hasAdsActivity: false,
              };
              result.set(asin, { ...cur, hasAdsActivity: true });
            }
          }
        }
      }
    }
  } catch {
    // Soft-fail: keep all suggestions rather than over-filtering.
  }

  return result;
}

/**
 * Batch-resolve titles/covers from Nest-cached catalogs, KDP, Amazon CDN,
 * and Open Library (ISBN-10 / ASIN). Never stores ASIN-as-title.
 *
 * @param skipRetail When true, return after catalog/OL so the UI can paint
 *   Nest titles immediately; caller runs `fetchAmazonRetailTitles` progressively.
 * @param onProgress Optional callback after each enrichment phase (catalog/OL,
 *   then retail) so Create can merge titles without waiting for the full batch.
 */
export async function fetchAsinDisplayMeta(input: {
  asins: string[];
  profileIds: string[];
  nestMetaByAsin?: ReadonlyMap<string, AsinDisplayMeta> | null;
  skipRetail?: boolean;
  onProgress?: (partial: Map<string, AsinDisplayMeta>) => void;
}): Promise<Map<string, AsinDisplayMeta>> {
  const { supabase } = await import("./supabase.ts");
  const { pickUsableCoverUrl } = await import("./kdpTitlePresentation.ts");
  const asins = [
    ...new Set(
      input.asins
        .map((a) => normalizeSuggestionAsin(a))
        .filter((a): a is string => Boolean(a)),
    ),
  ];
  const result = new Map<string, AsinDisplayMeta>();
  for (const asin of asins) {
    const nest = input.nestMetaByAsin?.get(asin);
    result.set(asin, {
      title: nest?.title && !isAsinAsTitle(nest.title, asin) ? nest.title : null,
      subtitle: nest?.subtitle ?? null,
      coverUrl:
        nest?.coverUrl ||
        fallbackAsinCoverUrl(asin),
      stockStatus: nest?.stockStatus ?? "unknown",
      publishedAt: nest?.publishedAt ?? null,
    });
  }
  if (!asins.length) return result;

  const profileIds = [
    ...new Set(input.profileIds.map((id) => String(id).trim()).filter(Boolean)),
  ];

  const mergeRow = (
    asin: string,
    patch: {
      title?: string | null;
      subtitle?: string | null;
      coverUrl?: string | null;
      stockStatus?: SuggestionStockStatus;
      publishedAt?: string | null;
    },
  ) => {
    const cur = result.get(asin) ?? {
      title: null,
      subtitle: null,
      coverUrl: fallbackAsinCoverUrl(asin),
      stockStatus: "unknown" as SuggestionStockStatus,
    };
    const title = humanTitleFromRow(patch.title, asin);
    result.set(asin, {
      title: cur.title || title,
      subtitle: cur.subtitle || patch.subtitle || null,
      coverUrl:
        pickUsableCoverUrl(patch.coverUrl, cur.coverUrl) ?? cur.coverUrl,
      stockStatus:
        cur.stockStatus && cur.stockStatus !== "unknown"
          ? cur.stockStatus
          : patch.stockStatus ?? cur.stockStatus ?? "unknown",
      publishedAt: cur.publishedAt || patch.publishedAt || null,
    });
  };

  const emitProgress = () => {
    input.onProgress?.(new Map(result));
  };

  try {
    // 1) Profile-scoped amazon_catalog (Nest /product/metadata cache)
    if (profileIds.length) {
      for (const asinChunk of chunk(asins, 80)) {
        const { data } = await supabase
          .from("amazon_catalog")
          .select("asin, title, image_url")
          .in("amazon_profile_id", profileIds)
          .in("asin", asinChunk);
        for (const row of data ?? []) {
          const asin = normalizeSuggestionAsin((row as { asin?: string }).asin);
          if (!asin) continue;
          mergeRow(asin, {
            title: (row as { title?: string }).title,
            coverUrl: (row as { image_url?: string }).image_url,
          });
        }
      }
      emitProgress();
    }

    // 2) product_ads titles/covers
    if (profileIds.length) {
      for (const asinChunk of chunk(asins, 80)) {
        const { data } = await supabase
          .from("product_ads")
          .select("asin, image_url, title")
          .in("amazon_profile_id", profileIds)
          .in("asin", asinChunk);
        for (const row of data ?? []) {
          const asin = normalizeSuggestionAsin((row as { asin?: string }).asin);
          if (!asin) continue;
          mergeRow(asin, {
            title: (row as { title?: string }).title,
            coverUrl: (row as { image_url?: string }).image_url,
          });
        }
      }
      emitProgress();
    }

    // 3) Cross-profile amazon_catalog retry for still-missing titles
    const needCatalog = asins.filter((a) => !result.get(a)?.title);
    if (needCatalog.length) {
      for (const asinChunk of chunk(needCatalog, 80)) {
        const { data } = await supabase
          .from("amazon_catalog")
          .select("asin, title, image_url")
          .in("asin", asinChunk)
          .not("title", "is", null)
          .neq("title", "")
          .limit(500);
        for (const row of data ?? []) {
          const asin = normalizeSuggestionAsin((row as { asin?: string }).asin);
          if (!asin) continue;
          mergeRow(asin, {
            title: (row as { title?: string }).title,
            coverUrl: (row as { image_url?: string }).image_url,
          });
        }
      }
      emitProgress();
    }

    // 4) KDP titles for linked accounts
    const stillNeedTitle = asins.filter((a) => !result.get(a)?.title);
    if (stillNeedTitle.length && profileIds.length) {
      const { data: links } = await supabase
        .from("kdp_account_amazon_profiles")
        .select("kdp_account_id")
        .in("amazon_profile_id", profileIds);
      const kdpIds = [
        ...new Set(
          (links ?? [])
            .map((r: { kdp_account_id?: string }) =>
              String(r.kdp_account_id ?? "").trim(),
            )
            .filter(Boolean),
        ),
      ];
      if (kdpIds.length) {
        for (const asinChunk of chunk(stillNeedTitle, 80)) {
          const { data: titles } = await supabase
            .from("kdp_titles")
            .select("asin, title, cover_url, amazon_image_url")
            .in("account_id", kdpIds)
            .in("asin", asinChunk);
          for (const row of titles ?? []) {
            const asin = normalizeSuggestionAsin(
              (row as { asin?: string }).asin,
            );
            if (!asin) continue;
            mergeRow(asin, {
              title: (row as { title?: string }).title,
              coverUrl: pickUsableCoverUrl(
                (row as { cover_url?: string }).cover_url,
                (row as { amazon_image_url?: string }).amazon_image_url,
              ),
            });
          }
        }
        emitProgress();
      }
    }
  } catch {
    // Soft-fail: covers still work via Amazon CDN; titles may stay blank.
  }

  // 5) Open Library for remaining gaps (ISBN-10 + ASIN)
  const openLibraryNeed = asins.filter((a) => !result.get(a)?.title);
  if (openLibraryNeed.length) {
    const ol = await fetchOpenLibraryMeta(openLibraryNeed);
    for (const [asin, meta] of ol) {
      mergeRow(asin, meta);
    }
  }

  // Final pass before optional retail: never leave ASIN-as-title in the map
  for (const asin of asins) {
    const cur = result.get(asin);
    if (!cur) continue;
    if (isAsinAsTitle(cur.title, asin)) {
      result.set(asin, { ...cur, title: null });
    }
  }

  emitProgress();

  if (input.skipRetail) {
    return result;
  }

  // 6) Amazon retail HTML titles for competitor ASINs Ads metadata won't cover.
  // Covers already work via images-na CDN; titles need this when Nest/OL miss.
  const retailNeed = asins.filter((a) => !result.get(a)?.title);
  if (retailNeed.length) {
    // Prefer first-page ASINs so visible rows fill before the long tail.
    const retail = await fetchAmazonRetailTitles(retailNeed, {
      concurrency: 2,
      retries: 2,
    });
    for (const [asin, title] of retail) {
      mergeRow(asin, { title });
    }
    input.onProgress?.(new Map(result));
  }

  return result;
}

/** Merge title/cover patches without clobbering an already-resolved title. */
export function mergeAsinDisplayMeta(
  prev: AsinDisplayMeta | null | undefined,
  patch: AsinDisplayMeta,
): AsinDisplayMeta {
  return {
    title: prev?.title || patch.title || null,
    subtitle: prev?.subtitle || patch.subtitle || null,
    coverUrl: patch.coverUrl || prev?.coverUrl || null,
    stockStatus:
      prev?.stockStatus && prev.stockStatus !== "unknown"
        ? prev.stockStatus
        : patch.stockStatus ?? prev?.stockStatus ?? "unknown",
    publishedAt: prev?.publishedAt || patch.publishedAt || null,
  };
}
