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
 * Chunking covers the FULL Amazon list (no 50-row / page truncate). A failed
 * chunk throws — never silent keep-all for that slice.
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
  planRelevanceChunks,
  productPromptNeedsChunking,
  relevanceChunksCoverAll,
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
  planRelevanceChunks,
  productPromptNeedsChunking,
  relevanceChunksCoverAll,
  relevancePromptNeedsChunking,
  GROK_RELEVANCE_KEYWORD_CHUNK,
  GROK_RELEVANCE_PRODUCT_CHUNK,
  GROK_RELEVANCE_MAX_USER_CHARS,
} from "./suggestionRelevanceGrokLogic.ts";
export type { GrokRelevanceSelection } from "./suggestionRelevanceGrokLogic.ts";

const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const NEST_RELEVANCE_PATH = "/campaigns/creation/relevance-filter";

/**
 * Gap between serial relevance chunks.
 * Nest-first path must stay serial (see parallel gate below) — free-tier Groq
 * TPM (~8k) dies when 2–3 product chunks fan out in parallel after Nest miss.
 * 120ms was too short when Nest falls through to client Groq between chunks.
 */
const NEST_CHUNK_GAP_MS = 350;
const GROQ_CHUNK_GAP_MS = 2_500;

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

/** Pull a JSON object string from model text (content or reasoning). */
function extractRelevanceJsonText(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
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
      // Keep-lists are index arrays; headroom avoids mid-JSON cut on large chunks.
      max_tokens: 4096,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning?: string | null };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      body?.error?.message || `${input.label} API error (${res.status}).`,
    );
  }
  const message = body?.choices?.[0]?.message;
  const content = String(message?.content ?? "").trim();
  if (content) return content;

  // gpt-oss and some reasoning models put the JSON keep-list only in
  // `reasoning` / leave content blank — treat that as the response body.
  const reasoning = String(message?.reasoning ?? "").trim();
  const fromReasoning = extractRelevanceJsonText(reasoning);
  if (fromReasoning.includes("productIndexes") || fromReasoning.includes("keywordIndexes")) {
    return fromReasoning;
  }

  throw new Error(`${input.label} returned an empty relevance response.`);
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
  // Nest runs the LLM server-side (Groq/xAI). Allow a full chunk; aborting at
  // 2.5s forced every call onto flaky client free-tier Groq keys.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
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
 * Resolve one (chunk) relevance call.
 * Default: Nest → xAI → Groq.
 * `preferGroq`: try client Groq first, then Nest → xAI (never fail-closed
 * solely because prefer was set — 303 Create on device hit Confirm AI filter
 * when Groq-only threw after Amazon preview).
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
  let groqError: unknown;

  if (input.preferGroq && groqApiKey()) {
    try {
      const content = await callGroqChat(input.system, input.user, {
        key: input.groqKey,
      });
      selection = {
        ...parseGrokRelevanceJson(content, sizes),
        source: "groq",
      };
    } catch (error) {
      groqError = error;
    }
  }

  if (!selection) {
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
  }

  if (!selection && xaiApiKey()) {
    try {
      const content = await callXaiChat(input.system, input.user);
      selection = {
        ...parseGrokRelevanceJson(content, sizes),
        source: "xai",
      };
    } catch {
      // keep nest/groq errors for throw below
    }
  }

  // After Nest/xAI miss, always try Groq (including when preferGroq already
  // failed once — second key / cooler TPM often succeeds).
  if (!selection && groqApiKey()) {
    try {
      const content = await callGroqChat(input.system, input.user, {
        key: input.groqKey,
      });
      selection = {
        ...parseGrokRelevanceJson(content, sizes),
        source: "groq",
      };
    } catch (error) {
      groqError = error;
    }
  }

  if (!selection) {
    if (nestError instanceof Error) throw nestError;
    if (groqError instanceof Error) throw groqError;
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
  const slices = needsChunks
    ? planRelevanceChunks(products, GROK_RELEVANCE_PRODUCT_CHUNK)
    : products.length
      ? [{ slice: products, offset: 0 }]
      : [];
  if (!relevanceChunksCoverAll(slices, products.length)) {
    throw new Error(
      `Product relevance chunks missed rows (${slices.length} slices / ${products.length} products).`,
    );
  }

  // Parallel ONLY when preferGroq (explicit dual-key Groq bench). Default
  // Nest-first must stay serial — baked Groq keys alone used to force parallel
  // and latch Create/AGC on "AI unavailable" (Norway 235 ASINs / 3 chunks).
  const parallel =
    !opts?.forceSerial &&
    Boolean(opts?.preferGroq) &&
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
      // TPM/size: split once. Any other failure (or tiny slice still failing)
      // must surface — silent keep-all was painting "AI kept all" (CA NE cert).
      if (isTpmOrSizeError(error) && entry.slice.length > 12) {
        const mid = Math.ceil(entry.slice.length / 2);
        const left = await runOne(
          { slice: entry.slice.slice(0, mid), offset: entry.offset },
          key,
        );
        if (!parallel) {
          await sleep(
            left.source === "groq" ? GROQ_CHUNK_GAP_MS : NEST_CHUNK_GAP_MS,
          );
        }
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
      throw error instanceof Error
        ? error
        : new Error("Groq product relevance filter unavailable.");
    }
  };

  let usedGroq = false;
  const kept: number[] = [];
  let chunkFailures = 0;

  const runChunkWithRetry = async (
    entry: { slice: P[]; offset: number },
    key: string | undefined,
    index: number,
  ): Promise<{ indexes: number[]; source: GrokRelevanceSelection["source"] } | null> => {
    try {
      return await runOne(entry, key);
    } catch (firstErr) {
      // One cool-down retry for transient TPM — do not fail the whole filter
      // because a single tail chunk rate-limited (Norway 235 ASINs / 3 chunks).
      await sleep(GROQ_CHUNK_GAP_MS);
      try {
        return await runOne(entry, key);
      } catch (retryErr) {
        chunkFailures += 1;
        // eslint-disable-next-line no-console
        console.warn(
          `[inteliads:grok] product chunk ${index} soft-failed after retry`,
          retryErr ?? firstErr,
        );
        return null;
      }
    }
  };

  if (parallel) {
    const settled = await Promise.allSettled(
      slices.map((entry, i) => runChunkWithRetry(entry, keys[i % keys.length], i)),
    );
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue;
      if (result.value.source === "groq") usedGroq = true;
      kept.push(...result.value.indexes);
    }
  } else {
    for (let i = 0; i < slices.length; i += 1) {
      const r = await runChunkWithRetry(slices[i]!, keys[0], i);
      if (r) {
        if (r.source === "groq") usedGroq = true;
        kept.push(...r.indexes);
      }
      if (i + 1 < slices.length) {
        await sleep(
          r?.source === "groq" ? GROQ_CHUNK_GAP_MS : NEST_CHUNK_GAP_MS,
        );
      }
    }
  }

  if (chunkFailures > 0 && kept.length === 0 && products.length > 0) {
    throw new Error(
      `Groq product relevance filter unavailable (${chunkFailures}/${slices.length} chunks failed).`,
    );
  }

  const t1 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const ms = Math.round(t1 - t0);
  console.log(
    `[inteliads:groq] products keys=${keys.length} chunks=${slices.length} parallel=${parallel} softFails=${chunkFailures} ms=${ms} kept=${kept.length}/${products.length}`,
  );
  return { indexes: kept, usedGroq, parallel, ms };
}

/**
 * Rank/filter Amazon keyword + product suggestions with Grok/Groq.
 * Keywords: unique-phrase collapse → LLM → expand companions.
 * Products: compact title/subtitle/theme lines → chunked LLM keep-list.
 * Product/keyword chunks stay serial on Nest-first. Parallel only when
 * `preferGroq` + 2+ keys (explicit dual-key Groq path).
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

    const probe = buildGrokRelevanceMessages(
      { keywords: phrases, productTargets: [] },
      context,
    );
    const needsChunks = relevancePromptNeedsChunking(
      phrases.length,
      probe.user.length,
    );
    const phraseSlices = needsChunks
      ? planRelevanceChunks(phrases, GROK_RELEVANCE_KEYWORD_CHUNK)
      : phrases.length
        ? [{ slice: phrases, offset: 0 }]
        : [];
    if (!relevanceChunksCoverAll(phraseSlices, phrases.length)) {
      throw new Error(
        `Keyword relevance chunks missed rows (${phraseSlices.length} slices / ${phrases.length} phrases).`,
      );
    }

    const keys = groqApiKeys();
    // Same rule as products: never parallelize Nest-first just because keys exist.
    const parallelKw =
      !opts?.forceSerialGroq &&
      Boolean(opts?.preferGroq) &&
      keys.length >= 2 &&
      phraseSlices.length >= 2;

    const runPhraseEntry = async (
      entry: { slice: typeof phrases; offset: number },
      key?: string,
    ): Promise<number[]> => {
      try {
        const { indexes } = await runPhraseChunk(entry.slice, context, {
          preferGroq: opts?.preferGroq,
          groqKey: key,
        });
        return indexes.map((idx) => entry.offset + idx);
      } catch (error) {
        if (isTpmOrSizeError(error) && entry.slice.length > 20) {
          const mid = Math.ceil(entry.slice.length / 2);
          const left = await runPhraseEntry(
            { slice: entry.slice.slice(0, mid), offset: entry.offset },
            key,
          );
          if (!parallelKw) await sleep(GROQ_CHUNK_GAP_MS);
          const right = await runPhraseEntry(
            {
              slice: entry.slice.slice(mid),
              offset: entry.offset + mid,
            },
            key,
          );
          return [...left, ...right];
        }
        throw error instanceof Error
          ? error
          : new Error("Groq keyword relevance filter unavailable.");
      }
    };

    let keptPhraseIndexes: number[];
    if (parallelKw) {
      // Dual Groq keys: analyze ALL phrase chunks concurrently (full coverage).
      const parts = await Promise.all(
        phraseSlices.map((entry, i) =>
          runPhraseEntry(entry, keys[i % keys.length]),
        ),
      );
      keptPhraseIndexes = parts.flat();
    } else {
      const kept: number[] = [];
      for (let i = 0; i < phraseSlices.length; i += 1) {
        kept.push(...(await runPhraseEntry(phraseSlices[i]!, keys[0])));
        if (i + 1 < phraseSlices.length) await sleep(GROQ_CHUNK_GAP_MS);
      }
      keptPhraseIndexes = kept;
    }

    console.log(
      `[inteliads:groq] keywords phrases=${phrases.length} amazonRows=${suggestions.keywords.length} chunks=${phraseSlices.length} parallel=${parallelKw} keptPhrases=${keptPhraseIndexes.length}`,
    );

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
    console.log(
      `[inteliads:groq] products uniqueAsins=${asins.length} amazonRows=${suggestions.productTargets.length} — analyzing ALL (not UI page size)`,
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
