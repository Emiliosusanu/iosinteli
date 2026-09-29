/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDIT THIS FILE to change what Grok does for Create Campaign / New Ad Group /
 * Add keywords suggestion filtering (keyword ranking only).
 *
 * Flow:
 *   1) Amazon Ads suggestions (full set — shown in UI first)
 *   2) AI search-intent filter (this prompt) — keep only keywords shoppers
 *      would use to find THIS book or close substitutes
 *   3) UI shows Amazon totals + Kept count
 *
 * Keywords: collapsed to unique phrases before the LLM; Broad/Phrase/Exact
 *   companions restored after keep. Chunked on overflow.
 * Products: separate AI pass compares each ASIN title/subtitle/themes to THIS
 *   book (title/subtitle/topic/marketplace). Compact lines + chunking for Groq
 *   free TPM. Titles enriched before the LLM when Nest omitted them.
 *
 * Rules enforced in code (not only the prompt):
 *   - Never invent keywords or ASINs Amazon did not return
 *   - Empty Grok keyword/product keep-lists restore the Amazon list labeled
 *     `restored_empty` — never claim "AI curated"
 *   - On Grok/Nest failure → Amazon rows + `failed_unfiltered` (UI confirms)
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const GROK_RELEVANCE_MODEL = "grok-3-mini";

/**
 * Groq OpenAI-compatible model when EXPO_PUBLIC_GROQ_API_KEY is set.
 * Used only for the direct Groq path — Nest/xAI still use GROK_RELEVANCE_MODEL.
 *
 * Prefer a model that puts the JSON keep-list in `message.content`.
 * `openai/gpt-oss-20b` often leaves content empty and only fills `reasoning`,
 * which made Create show "AI unavailable" on device (build 303).
 */
export const GROQ_RELEVANCE_MODEL = "qwen/qwen3.8-27b";

/** System instruction — edit tone / strictness here. */
export const GROK_RELEVANCE_SYSTEM_PROMPT = `You are a senior Amazon Sponsored Products keyword strategist for KDP authors.

Your job is STEP 2 of a two-step pipeline:
  1) Amazon already returned raw keyword suggestions (often noisy / tangential).
  2) YOU curate a high-intent shortlist for THIS book — keywords a shopper would
     type when looking to buy this book or a very close substitute.

Optimize for paid-search quality, not coverage. A smaller accurate set beats a
bloated Amazon dump. Drop weak, tangential, celebrity, wrong-genre, wrong-place,
and generic-noise terms even if Amazon suggested them.

Use title, subtitle, topic/category, and author. Rank the strongest commercial
intent first.

Rules:
1. Never invent keywords. Only return indexes into the provided Amazon list.
2. Prefer buyer search intent for THIS book (or a close substitute), not topical drift.
3. Drop celebrity names, wrong genres, wrong places, and generic noise.
4. Each list row is one unique phrase (Broad/Phrase/Exact companions are restored on the client after you keep a phrase).
5. Prefer precision over recall. If unsure a keyword helps this book's ads, omit it.
6. This call is keywords-only. Return "productIndexes": [].
7. Respond with JSON only — no markdown fences, no commentary.`;

/**
 * User message template (keywords).
 * Placeholders: {{BOOK_TITLE}} {{BOOK_SUBTITLE}} {{BOOK_AUTHOR}} {{BOOK_TOPIC}}
 *   {{ASIN}} {{COUNTRY}} {{CURRENCY}} {{KEYWORD_CANDIDATES}} {{PRODUCT_CANDIDATES}}
 */
export const GROK_RELEVANCE_USER_PROMPT_TEMPLATE = `Book to advertise
- Title: {{BOOK_TITLE}}
- Subtitle: {{BOOK_SUBTITLE}}
- Author: {{BOOK_AUTHOR}}
- Topic / category signals: {{BOOK_TOPIC}}
- ASIN: {{ASIN}}
- Marketplace: {{COUNTRY}} ({{CURRENCY}})

STEP 1 — Amazon Ads keyword phrases (unique; Broad/Phrase/Exact restored client-side after keep)
(index | keyword):
{{KEYWORD_CANDIDATES}}

Amazon Ads product-target suggestions:
{{PRODUCT_CANDIDATES}}

STEP 2 — AI search-intent filter
Return JSON with this exact shape:
{
  "keywordIndexes": [<0-based indexes into the phrase list, best commercial intent first>],
  "productIndexes": [],
  "reason": "<one short sentence>"
}

Select only phrases worth bidding for THIS book. Omit clear mismatches and low-intent noise.
Do NOT return nearly all indexes just because Amazon suggested them.
If the list is thin and everything is on-topic, you may keep all.
Always return "productIndexes": [] — products use a separate product LLM pass.`;

/** System prompt for product-ASIN relevance (Sponsored Products targets). */
export const GROK_PRODUCT_RELEVANCE_SYSTEM_PROMPT = `You are a senior Amazon Sponsored Products strategist for KDP authors.

Your job is STEP 2 after Amazon returned raw product-target (ASIN) suggestions:
  Keep only ASINs that are commercially relevant to advertise ALONGSIDE THIS book
  in the given marketplace — same niche/topic/audience, substitutes, or close
  companions. Drop wrong-genre, celebrity, hardware, and unrelated titles.

Compare each candidate's title, subtitle, and Amazon themes to THIS book's
title, subtitle, topic, and marketplace.

Rules:
1. Never invent ASINs. Only return indexes into the provided list.
2. Prefer precision over recall. If unsure, omit.
3. Keep the advertised ASIN itself if present.
4. Untitled / ASIN-only rows: keep only when themes clearly match this book.
5. Respond with JSON only — no markdown fences, no commentary.`;

/**
 * Product user template.
 * Placeholders: {{BOOK_TITLE}} {{BOOK_SUBTITLE}} {{BOOK_AUTHOR}} {{BOOK_TOPIC}}
 *   {{ASIN}} {{COUNTRY}} {{CURRENCY}} {{PRODUCT_CANDIDATES}}
 */
export const GROK_PRODUCT_RELEVANCE_USER_PROMPT_TEMPLATE = `Book to advertise
- Title: {{BOOK_TITLE}}
- Subtitle: {{BOOK_SUBTITLE}}
- Author: {{BOOK_AUTHOR}}
- Topic / category signals: {{BOOK_TOPIC}}
- ASIN: {{ASIN}}
- Marketplace: {{COUNTRY}} ({{CURRENCY}})

STEP 1 — Amazon Ads product-target suggestions (raw)
(index | ASIN | title | subtitle | themes):
{{PRODUCT_CANDIDATES}}

STEP 2 — AI title/theme relevance filter
Return JSON with this exact shape:
{
  "keywordIndexes": [],
  "productIndexes": [<0-based indexes into the product list, strongest relevance first>],
  "reason": "<one short sentence>"
}

Select only ASINs worth targeting for THIS book. Omit clear mismatches.
Do NOT return nearly all indexes just because Amazon suggested them.
If the list is thin and everything is on-topic, you may keep all.
Always return "keywordIndexes": [].`;

export function fillGrokRelevanceUserPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value || "—");
  }
  return out;
}
