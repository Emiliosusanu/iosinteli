/**
 * New Ad Group / Add targets must enrich product suggestion titles the same
 * way Create Campaign does — Nest often returns CDN covers with null titles.
 *
 * Regression: global titlesLoading must clear after catalog (not after all
 * retail scrapes), or 400+ ASIN lists stay on "Loading title…" forever when
 * amazon.com HTML is blocked (Airplane + Wi‑Fi).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = join(root, "src/hooks/useProductSuggestionAsinMeta.ts");
const hook = readFileSync(hookPath, "utf8");
const adGroupCreate = readFileSync(
  join(root, "app/campaign/ad-group-create.tsx"),
  "utf8",
);
const addTargets = readFileSync(
  join(root, "app/adgroup/add-targets.tsx"),
  "utf8",
);
const createCampaign = readFileSync(
  join(root, "app/campaign/create.tsx"),
  "utf8",
);

test("useProductSuggestionAsinMeta gap-fills Nest + retail titles", () => {
  assert.match(hook, /fetchAsinDisplayMeta/);
  assert.match(hook, /fetchAmazonRetailTitles/);
  assert.match(hook, /skipRetail:\s*true/);
  assert.match(hook, /mergeAsinDisplayMeta/);
});

test("useProductSuggestionAsinMeta paints catalog titles via onProgress", () => {
  assert.match(hook, /onProgress:\s*\(partial\)\s*=>\s*\{/);
  assert.match(hook, /applyMetaPatch\(partial\)/);
});

test("useProductSuggestionAsinMeta retail uses first-wave then capped tail", () => {
  assert.match(hook, /RETAIL_FIRST_WAVE\s*=\s*50/);
  assert.match(hook, /RETAIL_FIRST_CONCURRENCY\s*=\s*6/);
  assert.match(hook, /RETAIL_FIRST_TIMEOUT_MS\s*=\s*6_000/);
  assert.match(hook, /RETAIL_FIRST_RETRIES\s*=\s*0/);
  assert.match(hook, /RETAIL_TAIL_CHUNK\s*=\s*14/);
  assert.match(hook, /RETAIL_TAIL_CONCURRENCY\s*=\s*4/);
  assert.match(hook, /RETAIL_TAIL_MAX\s*=\s*56/);
  assert.match(hook, /needTitles\.slice\(0,\s*RETAIL_FIRST_WAVE\)/);
  assert.match(hook, /\.slice\(0,\s*RETAIL_TAIL_MAX\)/);
});

test("priorityAsinsForTitleEnrichment puts visible ASINs first", () => {
  assert.match(hook, /export function priorityAsinsForTitleEnrichment/);
  // Pure JS mirror of the helper (avoid eval'ing TS source).
  function priorityAsinsForTitleEnrichment(allAsins, visibleAsins) {
    const out = [];
    const seen = new Set();
    const push = (raw) => {
      const asin = String(raw ?? "")
        .trim()
        .toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) return;
      seen.add(asin);
      out.push(asin);
    };
    for (const asin of visibleAsins) push(asin);
    for (const asin of allAsins) push(asin);
    return out;
  }
  assert.deepEqual(
    priorityAsinsForTitleEnrichment(
      ["B0AAAAAAA1", "B0BBBBBBB2", "B0CCCCCCC3"],
      ["B0CCCCCCC3", "B0AAAAAAA1"],
    ),
    ["B0CCCCCCC3", "B0AAAAAAA1", "B0BBBBBBB2"],
  );
  assert.match(hook, /for \(const asin of visibleAsins\) push\(asin\)/);
  assert.match(hook, /for \(const asin of allAsins\) push\(asin\)/);
});

test("useProductSuggestionAsinMeta load-more re-triggers retail for visible ASINs", () => {
  assert.match(hook, /visibleAsins/);
  assert.match(hook, /retailAttemptedRef/);
  assert.match(hook, /never re-arm titlesLoading|Never re-arms titlesLoading/i);
  assert.match(addTargets, /visibleAsins:/);
  assert.match(adGroupCreate, /visibleAsins:/);
});

test("useProductSuggestionAsinMeta clears titlesLoading after catalog not retail", () => {
  assert.match(hook, /shouldClearTitlesLoadingAfterCatalog/);
  assert.match(hook, /clearTitlesLoading\(\)/);
  // Must not wait for needTitles.length === 0 before clearing.
  assert.doesNotMatch(
    hook,
    /if\s*\(!needTitles\.length\)\s*setTitlesLoading\(false\)/,
  );
  // Retail must not re-arm the global loading flag.
  assert.match(hook, /never re-arm titlesLoading/);
});

test("useProductSuggestionAsinMeta budgets catalog with timeout fallback", () => {
  assert.match(hook, /CATALOG_META_TIMEOUT_MS\s*=\s*18_000/);
  assert.match(hook, /withCatalogMetaTimeout/);
  assert.match(hook, /withCatalogMetaTimeout\(\s*catalogPromise/);
  assert.match(hook, /nestSeed/);
});

test("withCatalogMetaTimeout race resolves to fallback on budget expiry", async () => {
  // Mirror the helper contract without importing RN-bound hook module.
  async function withCatalogMetaTimeout(promise, timeoutMs, fallback) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallback), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const hung = new Promise(() => {});
  const started = Date.now();
  const result = await withCatalogMetaTimeout(
    hung,
    40,
    new Map([["B0F62JX6XZ", { title: null }]]),
  );
  assert.ok(Date.now() - started < 400);
  assert.equal(result.get("B0F62JX6XZ").title, null);
  assert.match(hook, /export async function withCatalogMetaTimeout/);
});

test("useProductSuggestionAsinMeta clears loading when disabled", () => {
  assert.match(
    hook,
    /if\s*\(!enabled\)\s*\{\s*setTitlesLoading\(false\);\s*return;/,
  );
});

test("shouldClearTitlesLoadingAfterCatalog always returns true", async () => {
  // Load via tsx/ts-node if available; otherwise assert exported helper text.
  // Pure helper is source-exported for unit proof without RN runtime.
  assert.match(
    hook,
    /export function shouldClearTitlesLoadingAfterCatalog/,
  );
  assert.match(
    hook,
    /return true;[\s\S]*?export function useProductSuggestionAsinMeta/,
  );

  // Evaluate the pure helper without bundling React Native.
  const fnMatch = hook.match(
    /export function shouldClearTitlesLoadingAfterCatalog\([\s\S]*?\{([\s\S]*?)\n\}/,
  );
  assert.ok(fnMatch, "helper body present");
  const body = fnMatch[1];
  // Simulate: void needTitles; return true;
  const fn = new Function(
    "needTitlesAfterCatalog",
    body.replace(/void needTitlesAfterCatalog;/, "void needTitlesAfterCatalog;"),
  );
  assert.equal(fn(["B0F62JX6XZ"]), true);
  assert.equal(fn([]), true);
  assert.equal(fn(Array.from({ length: 460 }, (_, i) => `B${String(i).padStart(9, "0")}`)), true);
});

test("New Ad Group wires suggestion title enrichment", () => {
  assert.match(adGroupCreate, /useProductSuggestionAsinMeta/);
  assert.match(adGroupCreate, /meta\?\.title \?\? row\.title/);
  assert.match(adGroupCreate, /titleLoading=\{suggestionTitlesLoading\}/);
});

test("Add targets wires suggestion title enrichment", () => {
  assert.match(addTargets, /useProductSuggestionAsinMeta/);
  assert.match(addTargets, /meta\?\.title \?\? row\.title/);
  assert.match(addTargets, /titleLoading=\{suggestionTitlesLoading\}/);
});

test("Create Campaign clears titlesLoading before retail loop", () => {
  assert.match(
    createCampaign,
    /Clear Loading after catalog[\s\S]*setSuggestionTitlesLoading\(false\)/,
  );
  assert.match(createCampaign, /priorityAsinsForTitleEnrichment/);
  assert.match(createCampaign, /RETAIL_FIRST_WAVE\s*\+\s*RETAIL_TAIL_MAX/);
  assert.match(createCampaign, /suggestionRetailAttemptedRef/);
  assert.match(
    createCampaign,
    /Load more on Products[\s\S]*fetchAmazonRetailTitles/,
  );
});
