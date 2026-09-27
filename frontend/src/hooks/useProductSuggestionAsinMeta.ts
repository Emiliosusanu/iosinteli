import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAsinDisplayMeta,
  fetchAmazonRetailTitles,
  isAsinAsTitle,
  mergeAsinDisplayMeta,
  normalizeSuggestionStockStatus,
  type AsinDisplayMeta,
} from "@/src/lib/amazonCampaignSuggestions";

type SuggestionSeedRow = {
  asin: string;
  title?: string | null;
  subtitle?: string | null;
  coverUrl?: string | null;
  stockStatus?: string | null;
  publishedAt?: string | null;
};

/**
 * First retail wave covers the default visible window (~50 rows).
 * After this wave finishes (success or fail), titlesLoading clears so rows
 * fall through to "Title unavailable" instead of infinite "Loading title…".
 */
export const RETAIL_FIRST_WAVE = 50;
export const RETAIL_FIRST_CONCURRENCY = 6;
export const RETAIL_FIRST_TIMEOUT_MS = 6_000;
export const RETAIL_FIRST_RETRIES = 0;

/** Background gap-fill after the first wave — does not keep titlesLoading true. */
export const RETAIL_TAIL_CHUNK = 14;
export const RETAIL_TAIL_CONCURRENCY = 4;
export const RETAIL_TAIL_TIMEOUT_MS = 10_000;
export const RETAIL_TAIL_RETRIES = 1;
/** Cap long-tail retail so 400+ ASIN lists cannot hang the device for minutes. */
export const RETAIL_TAIL_MAX = 56;

/**
 * Catalog/OL have no per-request AbortController. Without a budget, a hung
 * supabase/Open Library await never reaches finally → eternal "Loading title…".
 */
export const CATALOG_META_TIMEOUT_MS = 18_000;

/**
 * After Nest/catalog/OL, clear the global Loading flag even when titles are
 * still missing. Retail HTML is best-effort background gap-fill — never gate
 * leaving "Loading title…" on retail success (airplane / soft-blocks).
 */
export function shouldClearTitlesLoadingAfterCatalog(
  needTitlesAfterCatalog: readonly string[],
): boolean {
  void needTitlesAfterCatalog;
  return true;
}

/** Soft-timeout a promise; on budget expiry return `fallback` (never throw). */
export async function withCatalogMetaTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Order ASINs for retail/catalog title enrichment: currently visible rows first
 * (Load more window), then the rest of the list. Dedupes while preserving order.
 */
export function priorityAsinsForTitleEnrichment(
  allAsins: readonly string[],
  visibleAsins: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
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

/**
 * Gap-fill product suggestion titles/covers (Nest catalog → retail HTML).
 * Create Campaign already does this; New Ad Group / Add targets reused raw Nest
 * rows where competitor ASINs often have CDN covers but null titles.
 */
export function useProductSuggestionAsinMeta(input: {
  productTargets: SuggestionSeedRow[];
  profileIds: string[];
  countryCode?: string | null;
  enabled?: boolean;
  /**
   * Currently visible ASINs (Load more window, possibly ranked/filtered).
   * When this set grows, kick off another small retail wave for missing titles
   * without re-arming the global Loading flag.
   */
  visibleAsins?: readonly string[];
}): {
  metaByAsin: Record<string, AsinDisplayMeta>;
  titlesLoading: boolean;
} {
  const [metaByAsin, setMetaByAsin] = useState<Record<string, AsinDisplayMeta>>(
    {},
  );
  const [titlesLoading, setTitlesLoading] = useState(false);
  const genRef = useRef(0);
  const retailAttemptedRef = useRef<Set<string>>(new Set());
  const metaByAsinRef = useRef(metaByAsin);
  metaByAsinRef.current = metaByAsin;

  const enabled = input.enabled !== false;
  const countryCode = input.countryCode ?? null;
  const profileKey = useMemo(
    () =>
      [...new Set(input.profileIds.map((id) => String(id).trim()).filter(Boolean))]
        .sort()
        .join(","),
    [input.profileIds],
  );
  const targetsKey = useMemo(
    () =>
      input.productTargets
        .map((row) => String(row.asin ?? "").trim().toUpperCase())
        .filter(Boolean)
        .join("|"),
    [input.productTargets],
  );
  const visibleAsinsKey = useMemo(
    () =>
      [...new Set(
        (input.visibleAsins ?? [])
          .map((asin) => String(asin ?? "").trim().toUpperCase())
          .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
      )].join("|"),
    [input.visibleAsins],
  );

  useEffect(() => {
    if (!enabled) {
      setTitlesLoading(false);
      return;
    }

    const rows = input.productTargets;
    const asins = [
      ...new Set(
        rows
          .map((row) => String(row.asin ?? "").trim().toUpperCase())
          .filter((asin) => /^[A-Z0-9]{10}$/.test(asin)),
      ),
    ];

    if (!asins.length) {
      setMetaByAsin({});
      setTitlesLoading(false);
      retailAttemptedRef.current = new Set();
      return;
    }

    const gen = ++genRef.current;
    retailAttemptedRef.current = new Set();
    const nestSeed = new Map<string, AsinDisplayMeta>();
    for (const row of rows) {
      const asin = String(row.asin ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const prev = nestSeed.get(asin);
      nestSeed.set(asin, {
        title:
          (prev?.title && !isAsinAsTitle(prev.title, asin)
            ? prev.title
            : null) ||
          (row.title && !isAsinAsTitle(row.title, asin) ? row.title : null),
        subtitle: prev?.subtitle ?? row.subtitle ?? null,
        coverUrl: prev?.coverUrl ?? row.coverUrl ?? null,
        stockStatus: normalizeSuggestionStockStatus(
          prev?.stockStatus ?? row.stockStatus,
        ),
        publishedAt: prev?.publishedAt ?? row.publishedAt ?? null,
      });
    }

    const seeded: Record<string, AsinDisplayMeta> = {};
    for (const [asin, value] of nestSeed) seeded[asin] = value;
    setMetaByAsin(seeded);
    setTitlesLoading(asins.some((asin) => !seeded[asin]?.title));

    const profileIds = profileKey ? profileKey.split(",") : [];
    const visibleSeed = visibleAsinsKey
      ? visibleAsinsKey.split("|")
      : asins.slice(0, RETAIL_FIRST_WAVE);

    const applyMetaPatch = (
      partial: Map<string, AsinDisplayMeta> | Record<string, AsinDisplayMeta>,
    ) => {
      if (gen !== genRef.current) return false;
      const entries =
        partial instanceof Map
          ? [...partial.entries()]
          : Object.entries(partial);
      if (!entries.length) return true;
      setMetaByAsin((prev) => {
        const next = { ...prev };
        for (const [asin, meta] of entries) {
          const key = String(asin).toUpperCase();
          next[key] = mergeAsinDisplayMeta(prev[key], meta);
        }
        return next;
      });
      return true;
    };

    const clearTitlesLoading = () => {
      if (gen !== genRef.current) return;
      setTitlesLoading(false);
    };

    void (async () => {
      try {
        const catalogPromise = fetchAsinDisplayMeta({
          asins,
          profileIds,
          nestMetaByAsin: nestSeed,
          skipRetail: true,
          onProgress: (partial) => {
            applyMetaPatch(partial);
          },
        });
        const meta = await withCatalogMetaTimeout(
          catalogPromise,
          CATALOG_META_TIMEOUT_MS,
          nestSeed,
        );
        if (!applyMetaPatch(meta)) return;

        const prioritized = priorityAsinsForTitleEnrichment(asins, visibleSeed);
        let needTitles = prioritized.filter((asin) => !meta.get(asin)?.title);

        if (shouldClearTitlesLoadingAfterCatalog(needTitles)) {
          clearTitlesLoading();
        }
        if (!needTitles.length) return;

        const applyRetailPatch = (retail: Map<string, string>) => {
          if (!retail.size) return true;
          const patch = new Map<string, AsinDisplayMeta>();
          for (const [asin, title] of retail) {
            const cur = meta.get(asin) ??
              nestSeed.get(asin) ?? {
                title: null,
                subtitle: null,
                coverUrl: null,
                stockStatus: "unknown" as const,
              };
            const next = { ...cur, title };
            patch.set(asin, next);
            meta.set(asin, next);
          }
          return applyMetaPatch(patch);
        };

        // Background retail only — never re-arm titlesLoading.
        const firstWave = needTitles.slice(0, RETAIL_FIRST_WAVE);
        for (const asin of firstWave) retailAttemptedRef.current.add(asin);
        if (firstWave.length) {
          if (gen !== genRef.current) return;
          const retail = await fetchAmazonRetailTitles(firstWave, {
            concurrency: RETAIL_FIRST_CONCURRENCY,
            retries: RETAIL_FIRST_RETRIES,
            timeoutMs: RETAIL_FIRST_TIMEOUT_MS,
            countryCode,
          });
          if (!applyRetailPatch(retail)) return;
          needTitles = prioritized.filter((asin) => !meta.get(asin)?.title);
          if (!needTitles.length) return;
        }

        const remaining = needTitles
          .filter((asin) => !firstWave.includes(asin))
          .slice(0, RETAIL_TAIL_MAX);
        for (const asin of remaining) retailAttemptedRef.current.add(asin);
        for (let i = 0; i < remaining.length; i += RETAIL_TAIL_CHUNK) {
          if (gen !== genRef.current) return;
          const chunk = remaining.slice(i, i + RETAIL_TAIL_CHUNK);
          const retail = await fetchAmazonRetailTitles(chunk, {
            concurrency: RETAIL_TAIL_CONCURRENCY,
            retries: RETAIL_TAIL_RETRIES,
            timeoutMs: RETAIL_TAIL_TIMEOUT_MS,
            countryCode,
          });
          if (!applyRetailPatch(retail)) return;
        }
      } catch {
        // Soft-fail: CDN covers still render; paste ASINs still works.
      } finally {
        if (gen === genRef.current) setTitlesLoading(false);
      }
    })();

    return () => {
      genRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by targetsKey
  }, [enabled, targetsKey, profileKey, countryCode]);

  // Load more: retail wave for newly visible ASINs still missing titles.
  useEffect(() => {
    if (!enabled || !visibleAsinsKey) return;
    const visibleAsins = visibleAsinsKey.split("|");
    // First page is covered by the initial wave; only act when window grows.
    if (visibleAsins.length <= RETAIL_FIRST_WAVE) return;

    const prevMeta = metaByAsinRef.current;
    const missing = visibleAsins.filter((asin) => {
      const title = prevMeta[asin]?.title;
      if (title && !isAsinAsTitle(title, asin)) return false;
      return !retailAttemptedRef.current.has(asin);
    });
    if (!missing.length) return;

    const gen = genRef.current;
    for (const asin of missing) retailAttemptedRef.current.add(asin);

    void (async () => {
      for (let i = 0; i < missing.length; i += RETAIL_TAIL_CHUNK) {
        if (gen !== genRef.current) return;
        const chunk = missing.slice(i, i + RETAIL_TAIL_CHUNK);
        const retail = await fetchAmazonRetailTitles(chunk, {
          concurrency: RETAIL_TAIL_CONCURRENCY,
          retries: RETAIL_TAIL_RETRIES,
          timeoutMs: RETAIL_TAIL_TIMEOUT_MS,
          countryCode,
        });
        if (gen !== genRef.current || !retail.size) continue;
        setMetaByAsin((prev) => {
          const next = { ...prev };
          for (const [asin, title] of retail) {
            const key = String(asin).toUpperCase();
            next[key] = mergeAsinDisplayMeta(prev[key], {
              title,
              subtitle: prev[key]?.subtitle ?? null,
              coverUrl: prev[key]?.coverUrl ?? null,
              stockStatus: prev[key]?.stockStatus ?? "unknown",
            });
          }
          return next;
        });
      }
    })();
  }, [enabled, visibleAsinsKey, countryCode]);

  return { metaByAsin, titlesLoading };
}
