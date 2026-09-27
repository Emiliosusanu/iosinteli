/**
 * Grok/Groq-backed filter/rank for Amazon Ads suggestions (Create / Ad Group / Add targets).
 *
 * Prefer Nest proxy (server holds XAI_API_KEY). Dev-only direct calls:
 *   - EXPO_PUBLIC_XAI_API_KEY → api.x.ai (Grok)
 *   - EXPO_PUBLIC_GROQ_API_KEY[+_2] → api.groq.com (OpenAI-compatible)
 *     Second key (or comma-separated keys) enables parallel Groq chunks and
 *     429 failover — free-tier TPM is per-key.
 *
 * Never invents rows — only reorders / subsets Amazon-provided suggestions.
 * Keywords: unique-phrase collapse → LLM → expand companions (TPM-safe).
 * Products: title/subtitle/theme lines → chunked LLM keep-list vs book meta.
 * A failed chunk keeps its Amazon slice (partial AI still applies).
 * Do not ship production keys in the app binary.
 */
import { nestApiJson, NestApiError } from "./rulesApi.ts";
import {
  GROK_RELEVANCE_MODEL,
  GROQ_RELEVANCE_MODEL,
} from "./suggestionRelevancePrompt.ts";
import type {
  BookRelevanceContext,
  FilterableSuggestions,
} from "./amazonCampaignSuggestions.ts";
import {
  applyGrokRelevanceSelection,
  buildGrokRelevanceMessages,
  buildGrokProductRelevanceMessages,
  collapseKeywordsToUniquePhrasesForGrok,
  collapseProductsToUniqueAsinsForGrok,
  expandGrokAsinIndexesToOriginal,
  expandGrokPhraseIndexesToOriginal,
  parseGrokRelevanceJson,
  productPromptNeedsChunking,
  relevancePromptNeedsChunking,
  uniqueValidIndexes,
  GROK_RELEVANCE_KEYWORD_CHUNK,
  GROK_RELEVANCE_PRODUCT_CHUNK,
  type GrokRelevanceSelection,
} from "./suggestionRelevanceGrokLogic.ts";

export {
  applyGrokRelevanceSelection,
  buildGrokRelevanceMessages,
  buildGrokProductRelevanceMessages,
  collapseKeywordsToUniquePhrasesForGrok,
  collapseProductsToUniqueAsinsForGrok,
  expandGrokAsinIndexesToOriginal,
  expandGrokPhraseIndexesToOriginal,
  parseGrokRelevanceJson,
  productPromptNeedsChunking,
  relevancePromptNeedsChunking,
  GROK_RELEVANCE_KEYWORD_CHUNK,
  GROK_RELEVANCE_PRODUCT_CHUNK,
  GROK_RELEVANCE_MAX_USER_CHARS,
} from "./suggestionRelevanceGrokLogic.ts";
export type { GrokRelevanceSelection } from "./suggestionRelevanceGrokLogic.ts";

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const NEST_RELEVANCE_PATH = "/campaigns/creation/relevance-filter";

/** Short pause only when falling back to Groq free-tier between serial chunks. */
const GROQ_CHUNK_GAP_MS = 120;

function xaiApiKey(): string {
  return String(process.env.EXPO_PUBLIC_XAI_API_KEY ?? "").trim();
}

/**
 * Groq key pool: primary + optional second key, or comma-separated list.
 * Multiple keys enable parallel chunk calls and 429 failover (TPM is per-key).
 */
export function groqApiKeys(): string[] {
  const primary = String(process.env.EXPO_PUBLIC_GROQ_API_KEY ?? "").trim();
  const second = String(process.env.EXPO_PUBLIC_GROQ_API_KEY_2 ?? "").trim();
  const fromPrimary = primary
    ? primary.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const keys = [...fromPrimary];
  if (second && !keys.includes(second)) keys.push(second);
  return keys;
}

function groqApiKey(): string {
  return groqApiKeys()[0] ?? "";
}

/** Round-robin counter for assigning Groq keys across parallel chunks. */
let groqKeyCursor = 0;

function nextGroqKey(): string {
  const keys = groqApiKeys();
  if (!keys.length) return "";
  const key = keys[groqKeyCursor % keys.length]!;
  groqKeyCursor += 1;
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTpmOrSizeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /tokens per minute|TPM|Request too large|rate_limit|413|429/i.test(msg);
}

async function callOpenAiCompatibleChat(input: {
  url: string;
  key: string;
  model: string;
  system: string;
  user: string;
  label: string;
}): Promise<string> {
  const res = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.key}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body?.error?.message || `${input.label} API error (${res.status}).`,
    );
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new Error(`${input.label} returned an empty relevance response.`);
  }
  return String(content);
}

async function callXaiChat(system: string, user: string): Promise<string> {
  const key = xaiApiKey();
  if (!key) throw new Error("EXPO_PUBLIC_XAI_API_KEY is not set.");
  return callOpenAiCompatibleChat({
    url: XAI_CHAT_URL,
    key,
    model: GROK_RELEVANCE_MODEL,
    system,
    user,
    label: "Grok",
  });
}

/**
 * Call Groq with an optional pinned key. On 429/TPM, retry once with another
 * key from the pool when available.
 */
async function callGroqChat(
  system: string,
  user: string,
  opts?: { key?: string },
): Promise<string> {
  const keys = groqApiKeys();
  if (!keys.length) throw new Error("EXPO_PUBLIC_GROQ_API_KEY is not set.");
  const preferred = (opts?.key ?? nextGroqKey()).trim() || keys[0]!;
  const order = [
    preferred,
    ...keys.filter((k) => k !== preferred),
  ];
  let lastError: unknown;
  for (let i = 0; i < order.length; i += 1) {
    const key = order[i]!;
    try {
      return await callOpenAiCompatibleChat({
        url: GROQ_CHAT_URL,
        key,
        model: GROQ_RELEVANCE_MODEL,
        system,
        user,
        label: "Groq",
      });
    } catch (error) {
      lastError = error;
      if (!isTpmOrSizeError(error) || i === order.length - 1) throw error;
      // Fail over to next key on rate limit.
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Groq relevance filter unavailable.");
}

async function callNestRelevanceFilter(input: {
  system: string;
  user: string;
  context: BookRelevanceContext;
  keywordCount: number;
  productCount: number;
}): Promise<GrokRelevanceSelection> {
  // Nest relevance can hang 30–60s; never block Groq that long.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  let raw: unknown;
  try {
    raw = await nestApiJson<unknown>(
      NEST_RELEVANCE_PATH,
      {
        method: "POST",
        body: JSON.stringify({
          model: GROK_RELEVANCE_MODEL,
          systemPrompt: input.system,
          userPrompt: input.user,
          book: {
            title: input.context.bookTitle ?? null,
            subtitle: input.context.bookSubtitle ?? null,
            author: input.context.bookAuthor ?? null,
            topic: input.context.bookTopic ?? null,
            asin: input.context.advertisedAsin ?? null,
          },
          marketplace: {
            countryCode: input.context.countryCode ?? null,
            currencyCode: input.context.currencyCode ?? null,
          },
          keywordCount: input.keywordCount,
          productCount: input.productCount,
        }),
        signal: controller.signal,
      },
      "Couldn't run Grok suggestion filter.",
    );
  } finally {
    clearTimeout(timer);
  }
  const row =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const nested =
    row.data && typeof row.data === "object" && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : row;

  if (
    Array.isArray(nested.keywordIndexes) ||
    Array.isArray(nested.productIndexes)
  ) {
    return {
      keywordIndexes: uniqueValidIndexes(
        nested.keywordIndexes,
        input.keywordCount,
      ),
      productIndexes: uniqueValidIndexes(
        nested.productIndexes,
        input.productCount,
      ),
      reason: typeof nested.reason === "string" ? nested.reason : undefined,
      source: "nest",
    };
  }
  const content =
    typeof nested.content === "string"
      ? nested.content
      : typeof nested.message === "string"
        ? nested.message
        : typeof nested.raw === "string"
          ? nested.raw
          : "";
  if (!content) {
    throw new NestApiError("Nest relevance filter returned no content.", 502);
  }
  const parsed = parseGrokRelevanceJson(content, {
    keywordCount: input.keywordCount,
    productCount: input.productCount,
  });
  return { ...parsed, source: "nest" };
}

/**
 * Resolve one (chunk) relevance call: Nest → xAI → Groq.
 * When `preferGroq` is set (bench / forced client path), skip Nest/xAI.
 */
async function resolveRelevanceSelection(input: {
  system: string;
  user: string;
  context: BookRelevanceContext;
  keywordCount: number;
  productCount?: number;
  preferGroq?: boolean;
  groqKey?: string;
}): Promise<GrokRelevanceSelection> {
  const sizes = {
    keywordCount: input.keywordCount,
    productCount: input.productCount ?? 0,
  };
  let selection: GrokRelevanceSelection | null = null;
  let nestError: unknown;

  if (!input.preferGroq) {
    try {
      selection = await callNestRelevanceFilter({
        system: input.system,
        user: input.user,
        context: input.context,
        ...sizes,
      });
    } catch (error) {
      nestError = error;
    }

    if (!selection && xaiApiKey()) {
      const content = await callXaiChat(input.system, input.user);
      selection = {
        ...parseGrokRelevanceJson(content, sizes),
        source: "xai",
      };
    }
  }

  if (!selection && groqApiKey()) {
    const content = await callGroqChat(input.system, input.user, {
      key: input.groqKey,
    });
    selection = {
      ...parseGrokRelevanceJson(content, sizes),
      source: "groq",
    };
  }

  if (!selection) {
    if (nestError instanceof Error) throw nestError;
    throw new Error("Grok relevance filter unavailable.");
  }
  return selection;
}

async function runPhraseChunk(
  phrases: Array<{
    keyword: string;
    matchType?: string;
    suggestedBid?: number | null;
  }>,
  context: BookRelevanceContext,
  opts?: { preferGroq?: boolean; groqKey?: string },
): Promise<{ indexes: number[]; source: GrokRelevanceSelection["source"] }> {
  const sub = { keywords: phrases, productTargets: [] as never[] };
  const { system, user } = buildGrokRelevanceMessages(sub, context);
  const selection = await resolveRelevanceSelection({
    system,
    user,
    context,
    keywordCount: phrases.length,
    productCount: 0,
    preferGroq: opts?.preferGroq,
    groqKey: opts?.groqKey,
  });
  return { indexes: selection.keywordIndexes, source: selection.source };
}

async function runProductChunk(
  products: Array<{
    asin: string;
    title?: string | null;
    subtitle?: string | null;
    matchType?: string | null;
    themes?: string[] | null;
  }>,
  context: BookRelevanceContext,
  opts?: { preferGroq?: boolean; groqKey?: string },
): Promise<{ indexes: number[]; source: GrokRelevanceSelection["source"] }> {
  const { system, user } = buildGrokProductRelevanceMessages(products, context);
  const selection = await resolveRelevanceSelection({
    system,
    user,
    context,
    keywordCount: 0,
    productCount: products.length,
    preferGroq: opts?.preferGroq,
    groqKey: opts?.groqKey,
  });
  return { indexes: selection.productIndexes, source: selection.source };
}

/**
 * Run product chunks serially (1 Groq key) or in parallel (2+ keys).
 * Returns absolute indexes into the full product list.
 */
async function runProductChunksBatched<
  P extends {
    asin: string;
    title?: string | null;
    subtitle?: string | null;
    matchType?: string | null;
    themes?: string[] | null;
  },
>(
  products: P[],
  context: BookRelevanceContext,
  opts?: { preferGroq?: boolean; forceSerial?: boolean },
): Promise<{ indexes: number[]; usedGroq: boolean; parallel: boolean; ms: number }> {
  const t0 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const keys = groqApiKeys();
  const probe = buildGrokProductRelevanceMessages(products, context);
  const needsChunks = productPromptNeedsChunking(
    products.length,
    probe.user.length,
  );
  const chunkSize = GROK_RELEVANCE_PRODUCT_CHUNK;
  const slices: Array<{ slice: P[]; offset: number }> = [];
  if (!needsChunks) {
    slices.push({ slice: products, offset: 0 });
  } else {
    for (let offset = 0; offset < products.length; offset += chunkSize) {
      slices.push({
        slice: products.slice(offset, offset + chunkSize),
        offset,
      });
    }
  }

  const parallel =
    !opts?.forceSerial &&
    Boolean(opts?.preferGroq || keys.length > 0) &&
    keys.length >= 2 &&
    slices.length >= 2;

  const runOne = async (
    entry: { slice: P[]; offset: number },
    key?: string,
  ): Promise<{ indexes: number[]; source: GrokRelevanceSelection["source"] }> => {
    try {
      const { indexes, source } = await runProductChunk(entry.slice, context, {
        preferGroq: opts?.preferGroq,
        groqKey: key,
      });
      return {
        indexes: indexes.map((i) => entry.offset + i),
        source,
      };
    } catch (error) {
      if (isTpmOrSizeError(error) && entry.slice.length > 12) {
        const mid = Math.ceil(entry.slice.length / 2);
        const left = await runOne(
          { slice: entry.slice.slice(0, mid), offset: entry.offset },
          key,
        );
        if (!parallel) await sleep(GROQ_CHUNK_GAP_MS);
        const right = await runOne(
          {
            slice: entry.slice.slice(mid),
            offset: entry.offset + mid,
          },
          key,
        );
        return {
          indexes: [...left.indexes, ...right.indexes],
          source: left.source,
        };
      }
      return {
        indexes: entry.slice.map((_, i) => entry.offset + i),
        source: "groq",
      };
    }
  };

  let usedGroq = false;
  const kept: number[] = [];
  if (parallel) {
    const results = await Promise.all(
      slices.map((entry, i) => runOne(entry, keys[i % keys.length])),
    );
    for (const r of results) {
      if (r.source === "groq") usedGroq = true;
      kept.push(...r.indexes);
    }
  } else {
    for (let i = 0; i < slices.length; i += 1) {
      const r = await runOne(slices[i]!, keys[0]);
      if (r.source === "groq") usedGroq = true;
      kept.push(...r.indexes);
      if (r.source === "groq" && i + 1 < slices.length) {
        await sleep(GROQ_CHUNK_GAP_MS);
      }
    }
  }

  const t1 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const ms = Math.round(t1 - t0);
  console.log(
    `[inteliads:groq] products keys=${keys.length} chunks=${slices.length} parallel=${parallel} ms=${ms} kept=${kept.length}/${products.length}`,
  );
  return { indexes: kept, usedGroq, parallel, ms };
}

/**
 * Rank/filter Amazon keyword + product suggestions with Grok/Groq.
 * Keywords: unique-phrase collapse → LLM → expand companions.
 * Products: compact title/subtitle/theme lines → chunked LLM keep-list.
 * With 2+ Groq keys, product chunks run in parallel (TPM per key).
 */
export async function filterSuggestionsWithGrok<
  K extends {
    keyword: string;
    matchType?: string;
    suggestedBid?: number | null;
  },
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
  opts?: { preferGroq?: boolean; forceSerialGroq?: boolean },
): Promise<FilterableSuggestions<K, P>> {
  if (
    suggestions.keywords.length === 0 &&
    suggestions.productTargets.length === 0
  ) {
    return suggestions;
  }

  let keywordIndexes: number[] = suggestions.keywords.map((_, i) => i);
  let productIndexes: number[] = suggestions.productTargets.map((_, i) => i);

  if (suggestions.keywords.length > 0) {
    const { phrases, phraseToOriginalIndexes } =
      collapseKeywordsToUniquePhrasesForGrok(suggestions.keywords);

    const runSlice = async (
      slice: K[],
      phraseOffset: number,
    ): Promise<number[]> => {
      try {
        const { indexes, source } = await runPhraseChunk(slice, context, {
          preferGroq: opts?.preferGroq,
        });
        if (source === "groq" && phraseOffset + slice.length < phrases.length) {
          await sleep(GROQ_CHUNK_GAP_MS);
        }
        return indexes.map((i) => phraseOffset + i);
      } catch (error) {
        if (isTpmOrSizeError(error) && slice.length > 20) {
          const mid = Math.ceil(slice.length / 2);
          const left = await runSlice(slice.slice(0, mid), phraseOffset);
          await sleep(GROQ_CHUNK_GAP_MS);
          const right = await runSlice(slice.slice(mid), phraseOffset + mid);
          return [...left, ...right];
        }
        return slice.map((_, i) => phraseOffset + i);
      }
    };

    const probe = buildGrokRelevanceMessages(
      { keywords: phrases, productTargets: [] },
      context,
    );
    const needsChunks = relevancePromptNeedsChunking(
      phrases.length,
      probe.user.length,
    );

    let keptPhraseIndexes: number[];
    if (!needsChunks) {
      keptPhraseIndexes = await runSlice(phrases, 0);
    } else {
      const kept: number[] = [];
      const chunk = GROK_RELEVANCE_KEYWORD_CHUNK;
      for (let offset = 0; offset < phrases.length; offset += chunk) {
        const slice = phrases.slice(offset, offset + chunk);
        kept.push(...(await runSlice(slice, offset)));
      }
      keptPhraseIndexes = kept;
    }

    keywordIndexes = expandGrokPhraseIndexesToOriginal(
      keptPhraseIndexes,
      phraseToOriginalIndexes,
    );
  }

  if (suggestions.productTargets.length > 0) {
    // One LLM row per ASIN (Exact/Expanded companions restored after keep).
    const { asins, asinToOriginalIndexes } = collapseProductsToUniqueAsinsForGrok(
      suggestions.productTargets,
    );
    const batched = await runProductChunksBatched(asins, context, {
      preferGroq: opts?.preferGroq,
      forceSerial: opts?.forceSerialGroq,
    });
    productIndexes = expandGrokAsinIndexesToOriginal(
      batched.indexes,
      asinToOriginalIndexes,
    );
  }

  return applyGrokRelevanceSelection(suggestions, {
    keywordIndexes,
    productIndexes,
  });
}
