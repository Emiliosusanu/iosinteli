/**
 * iOS helper paperback pricing capture — Chrome parity for break-even ACoS.
 *
 * Royalties stay on kdpreports; pricing hits kdp.amazon.com get-setup-page,
 * then upserts the same calculator columns Chrome writes. Auth failures are
 * non-fatal: royalties already succeeded; UI prompts for one-time print-setup login.
 */
import { supabase } from "../supabase.ts";
import { storage } from "@/src/utils/storage";
import {
  createPricingCheckpointStore, pricingCandidateKey, pricingRequestTimeout,
  PricingSliceExpiredError, resumePricingCandidates,
} from "./pricingCheckpoint.ts";
import { appendKdpActivity } from "./activity.ts";
import { applyBookshelfPrimaryPriceChanges } from "./bookshelfPrimaryPricing.ts";
import { collectPricingCandidatesForIos } from "./pricingCandidates.ts";
import {
  bookshelfHtmlLooksSeeded,
  loadPricingBootstrap,
  patchPricingBootstrap,
} from "./pricingBootstrap.ts";
import {
  clearDirtyPricingSetupIds,
  loadDirtyPricingSetupIds,
  markPricingSetupDirty,
} from "./pricingDirty.ts";
import {
  getKdpHelperStatus,
  isKdpWebViewActive,
  kdpPageFetch,
  navigateKdpWebView,
  setKdpHelperError,
  setKdpHelperPricingAuth,
  setKdpHelperRunning,
} from "./runtime.ts";
import { isKdpHelperScreenFocused } from "./helperUi.ts";
import { writeKdpPricing } from "./upsert.ts";
import { looksLikeHtmlErrorPage } from "./vendor/kdpVendor.generated.js";
import {
  buildKdpGetSetupPageUrlCandidates,
  buildPricingAuthActionTabUrl,
  diagnoseKdpSetupPageFailure,
  extractAsinFromSetupPageJson,
  extractKdpBookshelfLocale,
  hasKdpSetupPagePricing,
  isKdpSetupPageAuthFailure,
  isKdpSetupPagePermanentMiss,
  isKdpSetupPageTransportFailure,
  looksLikeAmazonAsin,
  looksLikeKdpSetupBookId,
  extractBookshelfPrintRowsFromHtml,
  parseAllMarketplacePricingFromSetupPage,
  parseKdpGetSetupPage,
  pickPrimaryMarketplacePricing,
  resolveAsinFromSetupPairMaps,
  resolvePricingMarketplaceKey,
  shouldClearPricingGateForTabUrl,
} from "./vendor/kdpPricingCapture.js";

const pricingCheckpoints = createPricingCheckpointStore(storage);

type AnyRow = Record<string, unknown>;

export type { PricingCandidate } from "./pricingCandidates.ts";
export { collectPricingCandidatesForIos } from "./pricingCandidates.ts";

export type PricingSyncResult = {
  ok: boolean;
  synced: number;
  skipped: number;
  candidates: number;
  /** Paperbacks still missing calculator pricing — keep background wakes alive. */
  pending: number;
  skippedAuth?: boolean;
  authRequired?: boolean;
  authBookId?: string | null;
  message?: string;
};

/**
 * A paperback price is only fresh for one iOS metronome interval.  The
 * lightweight Bookshelf pass runs on every wake, while the setup-page
 * second gate is re-read at least once per 15-minute wake.  This catches a
 * price changed outside the app without waiting for a dirty-save event.
 */
const PRICING_FRESH_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BOOKS = 20;
/** First-time / onboarding: price more per wake so user can leave the helper. */
const ONBOARDING_MAX_BOOKS = 40;
const FETCH_GAP_MS = 350;

export const KDP_PRICING_AUTH_REQUIRED_MSG =
  "Paperback pricing needs Amazon login (open print-setup once)";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSetupId(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function bookshelfUrlForLocale(locale: string): string {
  const loc = String(locale || "en_US").trim() || "en_US";
  return `https://kdp.amazon.com/${loc}/bookshelf`;
}

/** True when WebView is already on kdp.amazon.com (not kdpreports / sign-in). */
function isOnKdpBookshelfHost(url: string): boolean {
  const u = String(url || "").toLowerCase();
  if (!u.includes("kdp.amazon.")) return false;
  if (u.includes("kdpreports.")) return false;
  if (u.includes("/ap/signin") || u.includes("signin.amazon")) return false;
  return true;
}

/**
 * Seed kdp.amazon.com session for hands-free pricing.
 * 1) Put the WebView on kdp bookshelf when attached (kdpreports → kdp is
 *    cross-origin; WebKit returns status-0 "Load failed" otherwise).
 * 2) Keychain-fetch bookshelf (merges Set-Cookie into jar).
 * 3) If still unseeded and WebView is attached, quiet navigate + re-fetch.
 * Never opens print-setup auth unless allowAuthNavigate (helper UI only).
 */
async function ensureKdpBookshelfContext(
  accountId: string,
  locale: string,
  opts: { allowAuthNavigate: boolean; deadlineAtMs?: number },
): Promise<string> {
  const canSilentNav = isKdpWebViewActive();

  // Cross-origin get-setup-page from kdpreports yields WebKit "Load failed".
  // Move onto kdp.amazon.com before any pricing API probe when we can.
  if (canSilentNav && !isOnKdpBookshelfHost(getKdpHelperStatus().currentUrl)) {
    navigateKdpWebView(bookshelfUrlForLocale(locale));
    const deadline = Date.now() + 14_000;
    while (Date.now() < deadline) {
      pricingRequestTimeout(opts.deadlineAtMs);
      await sleep(350);
      if (isOnKdpBookshelfHost(getKdpHelperStatus().currentUrl)) break;
    }
  }

  if (isOnKdpBookshelfHost(getKdpHelperStatus().currentUrl)) {
    try {
      const html = await fetchBookshelfHtml(locale, opts.deadlineAtMs);
      if (bookshelfHtmlLooksSeeded(html)) {
        await patchPricingBootstrap(accountId, {
          bookshelfSeededAt: nowIso(),
          authBlockedAt: null,
        });
      }
      return html;
    } catch (error) {
      if (error instanceof PricingSliceExpiredError) throw error;
      return "";
    }
  }

  let html = "";
  try {
    html = await fetchBookshelfHtml(locale, opts.deadlineAtMs);
  } catch (error) {
    if (error instanceof PricingSliceExpiredError) throw error;
    html = "";
  }

  if (bookshelfHtmlLooksSeeded(html)) {
    await patchPricingBootstrap(accountId, {
      bookshelfSeededAt: nowIso(),
      authBlockedAt: null,
    });
    return html;
  }

  const boot = await loadPricingBootstrap(accountId);
  if (canSilentNav && (!boot.bookshelfSeededAt || !html)) {
    const target = bookshelfUrlForLocale(locale);
    navigateKdpWebView(target);
    const deadline = Date.now() + 14_000;
    while (Date.now() < deadline) {
      pricingRequestTimeout(opts.deadlineAtMs);
      await sleep(350);
      if (isOnKdpBookshelfHost(getKdpHelperStatus().currentUrl)) break;
    }
    try {
      html = await fetchBookshelfHtml(locale, opts.deadlineAtMs);
    } catch (error) {
      if (error instanceof PricingSliceExpiredError) throw error;
      /* keep prior */
    }
    if (bookshelfHtmlLooksSeeded(html)) {
      await patchPricingBootstrap(accountId, {
        bookshelfSeededAt: nowIso(),
        authBlockedAt: null,
      });
    }
  }

  // Auth step-up only when the user is on the helper screen (one-time).
  if (
    opts.allowAuthNavigate &&
    isKdpHelperScreenFocused() &&
    isKdpWebViewActive() &&
    !bookshelfHtmlLooksSeeded(html)
  ) {
    /* caller may still probe get-setup-page and surface CTA */
  }

  return html;
}

async function countPendingPricing(
  accountId: string,
  paperbackAsins: readonly string[],
): Promise<number> {
  const asins = [
    ...new Set(
      paperbackAsins
        .map((a) => String(a || "").trim().toUpperCase())
        .filter((a) => looksLikeAmazonAsin(a)),
    ),
  ];
  if (!asins.length) {
    const dirty = await loadDirtyPricingSetupIds(accountId).catch(() => []);
    return dirty.length;
  }
  const { data, error } = await supabase
    .from("kdp_titles")
    .select("asin,pricing_captured_at")
    .eq("account_id", accountId)
    .in("asin", asins);
  if (error) return asins.length;
  const priced = new Set(
    (data || [])
      .filter((row) => (row as AnyRow).pricing_captured_at)
      .map((row) =>
        String((row as AnyRow).asin || "")
          .trim()
          .toUpperCase(),
      ),
  );
  const missing = asins.filter((a) => !priced.has(a)).length;
  const dirty = await loadDirtyPricingSetupIds(accountId).catch(() => []);
  return missing + dirty.length;
}

async function loadStoredPricingRows(accountId: string): Promise<AnyRow[]> {
  const { data, error } = await supabase
    .from("kdp_titles")
    .select("account_id,asin,kdp_setup_book_id,kdp_list_price,printing_cost,net_royalty_per_sale,royalty_rate,target_break_even_acos,pricing_marketplace,pricing_currency,pricing_captured_at")
    .eq("account_id", accountId)
    .not("kdp_setup_book_id", "is", null);
  if (error) throw new Error(`kdp_titles setup ids: ${error.message}`);
  return (data || []) as AnyRow[];
}

function setupMapFromStoredPricing(rows: AnyRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const asin = String((row as AnyRow).asin || "")
      .trim()
      .toUpperCase();
    const setupId = normalizeSetupId((row as AnyRow).kdp_setup_book_id);
    if (looksLikeAmazonAsin(asin) && looksLikeKdpSetupBookId(setupId)) {
      map.set(asin, setupId);
    }
  }
  return map;
}

async function loadFreshPricingAsins(accountId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - PRICING_FRESH_MS).toISOString();
  const { data, error } = await supabase
    .from("kdp_titles")
    .select("asin,pricing_captured_at")
    .eq("account_id", accountId)
    .not("pricing_captured_at", "is", null)
    .gte("pricing_captured_at", since);
  if (error) throw new Error(`kdp_titles fresh pricing: ${error.message}`);
  const set = new Set<string>();
  for (const row of data || []) {
    const asin = String((row as AnyRow).asin || "")
      .trim()
      .toUpperCase();
    if (looksLikeAmazonAsin(asin)) set.add(asin);
  }
  return set;
}

async function fetchBookshelfHtml(locale: string, deadlineAtMs?: number): Promise<string> {
  const base = bookshelfUrlForLocale(locale);
  const htmlPages: string[] = [];
  const seenRows = new Set<string>();
  let previous = "";

  // KDP's Bookshelf view selector uses `ALL`; native replay cannot click the
  // selector, so request the equivalent view first.  If Amazon ignores that
  // hint, walk numbered pages until a page contributes no new setup IDs.
  const urls = [
    `${base}?view=ALL`,
    base,
    ...Array.from({ length: 20 }, (_, index) => `${base}?page=${index + 2}`),
  ];
  for (const url of urls) {
    const timeoutMs = pricingRequestTimeout(deadlineAtMs);
    let html = "";
    try {
      const result = await kdpPageFetch({
        url,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        body: null,
        authScope: "pricing",
        timeoutMs,
      });
      html = String(result.text || "");
    } catch {
      if (!htmlPages.length) throw new Error("KDP Bookshelf fetch failed");
      break;
    }
    if (!html) break;
    const pageMatch = /[?&]page=(\d+)/i.exec(url);
    const pageNumber = pageMatch ? Number(pageMatch[1]) : 0;
    // The `view=ALL` hint and the unqualified Bookshelf URL can legitimately
    // return the same document.  Keep walking after that duplicate; only a
    // repeated numbered page proves that Amazon ignored pagination.
    if (html === previous && pageNumber >= 2) break;
    previous = html;
    const rows = extractBookshelfPrintRowsFromHtml(html);
    const newRows = rows.filter((row) => {
      const key = `${String(row.kdpBookId || "").toUpperCase()}:${String(row.printAsin || "").toUpperCase()}`;
      if (seenRows.has(key)) return false;
      seenRows.add(key);
      return true;
    });
    htmlPages.push(html);
    // A server that ignores `page=` repeats the same setup rows.  Stop there
    // rather than issuing a long request storm on every 15-minute wake.
    if (pageNumber >= 2 && newRows.length === 0) break;
  }
  return htmlPages.join("\n<!-- inteliads-bookshelf-page -->\n");
}

type SetupFetchResult = {
  ok: boolean;
  status: number;
  text: string;
  json: unknown | null;
  url: string;
  attempts: Array<{ status: number; url?: string; text?: string; snippet?: string; json?: unknown }>;
  pricing: ReturnType<typeof parseKdpGetSetupPage>;
  marketplaceKey: string;
};

function marketplaceKeyFromLocale(locale: string): string {
  const region = String(locale || "en_US")
    .trim()
    .split(/[_-]/)[1]
    ?.toUpperCase();
  if (!region || region.length !== 2) return "US";
  if (region === "UK") return "GB";
  return region;
}

function setupPageLooksUnauthenticated(fetched: {
  status: number;
  text: string;
  json: unknown | null;
}): boolean {
  if (isKdpSetupPageAuthFailure({ fetchResult: fetched, json: fetched.json })) return true;
  if (isKdpSetupPageTransportFailure(fetched)) return true;
  if (fetched.status === 401 || fetched.status === 403) return true;
  const text = String(fetched.text || "");
  if (looksLikeHtmlErrorPage(text) || /<html/i.test(text)) return true;
  // HTML / empty / opaque non-JSON with a real HTTP status — treat as gate.
  if (!fetched.json && fetched.status > 0) return true;
  return false;
}

function isExhaustedSetupPageMiss(fetched: SetupFetchResult): boolean {
  if (isKdpSetupPagePermanentMiss(fetched)) return true;
  // The modern V2 endpoint is the browser's authoritative request. A plain
  // 404 from that route means this individual setup ID is stale/deleted, even
  // when Amazon omits the older `ItemSetId is not found` message. Isolate the
  // book and keep walking; never let three stale editions starve live titles.
  return fetched.attempts.some(
    (attempt) =>
      Number(attempt.status || 0) === 404 &&
      /\/v2\/get-setup-page(?:$|[?#])/i.test(String(attempt.url || "")),
  );
}

async function fetchSetupPage(kdpBookId: string, locale: string, deadlineAtMs?: number): Promise<SetupFetchResult> {
  // Native Keychain replay cannot resolve bookshelf-relative paths.
  const urls = buildKdpGetSetupPageUrlCandidates(kdpBookId, { locale }).filter((url) =>
    /^https?:\/\//i.test(url),
  );
  const attempts: SetupFetchResult["attempts"] = [];
  let best: SetupFetchResult | null = null;
  const preferredMarketplace = marketplaceKeyFromLocale(locale);

  for (const url of urls) {
    const timeoutMs = pricingRequestTimeout(deadlineAtMs);
    const result = await kdpPageFetch({
      url,
      method: "GET",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: null,
      authScope: "pricing",
      timeoutMs,
    });
    const text = String(result.text || "");
    const json = tryParseJson(text);
    attempts.push({
      status: Number(result.status || 0),
      url,
      text: text.slice(0, 400),
      snippet: text.slice(0, 240),
      json: json ?? undefined,
    });
    const marketplaceKey = json
      ? resolvePricingMarketplaceKey(json, preferredMarketplace)
      : preferredMarketplace;
    const pricing = json ? parseKdpGetSetupPage(json, marketplaceKey) : null;
    const candidate: SetupFetchResult = {
      ok: Boolean(result.ok) && Boolean(json) && hasKdpSetupPagePricing(pricing),
      status: Number(result.status || 0),
      text,
      json,
      url: String(result.finalUrl || url),
      attempts,
      pricing,
      marketplaceKey: pricing?.marketplace || marketplaceKey,
    };
    // Match the Chrome worker: an individual route may legitimately return
    // the KDP SPA HTML shell (HTTP 200), a legacy 403, or a stale 404 while a
    // later /v2/ or locale fallback returns the pricing JSON.  Do not turn the
    // first miss into an auth gate.  Only classify the result after every
    // compatible setup-page route has been attempted.
    if (candidate.ok) return candidate;
    if (!best || candidate.status > best.status) best = candidate;
  }

  return (
    best || {
      ok: false,
      status: 0,
      text: "",
      json: null,
      url: "",
      attempts,
      pricing: null,
      marketplaceKey: "US",
    }
  );
}

function resolveTitleExpandedDistribution(
  allMarketplaceRows: Array<{ expandedDistribution?: boolean | null; marketplace?: string }>,
  preferredMarketplace = "US",
): boolean | null {
  const preferred = String(preferredMarketplace || "US")
    .trim()
    .toUpperCase();
  const preferredRow = allMarketplaceRows.find(
    (row) =>
      String(row?.marketplace || "")
        .trim()
        .toUpperCase() === preferred,
  );
  if (preferredRow?.expandedDistribution != null) return preferredRow.expandedDistribution;
  if (allMarketplaceRows.some((row) => row?.expandedDistribution === true)) return true;
  if (allMarketplaceRows.some((row) => row?.expandedDistribution === false)) return false;
  return null;
}

function buildMarketplacePricingRows(opts: {
  accountId: string;
  asin: string;
  setupPageJson: unknown;
  preferredMarketplace: string;
  capturedAt: string;
}): AnyRow[] {
  const rows = parseAllMarketplacePricingFromSetupPage(
    opts.setupPageJson,
    opts.preferredMarketplace,
  );
  return rows
    .map((row) => ({
      account_id: opts.accountId,
      asin: opts.asin,
      marketplace: String(row.marketplace || "")
        .trim()
        .toUpperCase(),
      kdp_list_price: row.listPrice,
      printing_cost: row.printingCost,
      net_royalty_per_sale: row.netRoyalty,
      royalty_rate: row.royaltyRate,
      target_break_even_acos: row.targetBreakEvenAcos,
      pricing_currency: row.currency,
      expanded_distribution: row.expandedDistribution,
      royalty_programs:
        Array.isArray(row.royaltyPrograms) && row.royaltyPrograms.length
          ? row.royaltyPrograms
          : null,
      territories:
        Array.isArray(row.territories) && row.territories.length ? row.territories : null,
      pricing_captured_at: opts.capturedAt,
      updated_at: opts.capturedAt,
    }))
    .filter(
      (row) =>
        row.marketplace && (row.kdp_list_price != null || row.net_royalty_per_sale != null),
    );
}

/**
 * Clear the pricing auth banner when the WebView lands on print-setup after login.
 * Prefer runtime NAV handling; this helper remains for explicit callers.
 */
export function maybeClearPricingAuthFromNav(url: string): void {
  if (shouldClearPricingGateForTabUrl(url)) {
    setKdpHelperPricingAuth({ required: false, bookId: null });
  }
}

export async function syncKdpPaperbackPricing(opts: {
  accountId: string;
  titlesJson?: unknown;
  booksObj?: Record<string, unknown> | null;
  formatRows?: AnyRow[];
  forceRefresh?: boolean;
  maxBooks?: number;
  /** Soft deadline for a short background wake, with time reserved for writes. */
  deadlineAtMs?: number;
  /** First-time / incomplete shelf — price more per wake, keep pending for metronome. */
  onboarding?: boolean;
  /**
   * Only when helper UI is focused: may open print-setup for one-time Amazon step-up.
   * Background / hidden host never navigates to auth.
   */
  allowAuthNavigate?: boolean;
}): Promise<PricingSyncResult> {
  const accountId = String(opts.accountId || "").trim();
  const empty = {
    ok: false as const,
    synced: 0,
    skipped: 0,
    candidates: 0,
    pending: 0,
  };
  if (!accountId) {
    return { ...empty, message: "missing account" };
  }

  const priorCheckpoint = await pricingCheckpoints.load(accountId);
  // Persist the intent even when the report phase has consumed this wake.
  await pricingCheckpoints.save(accountId, { ...priorCheckpoint, needsDiscovery: true });
  try {
    return await syncPricingSlice(opts, priorCheckpoint);
  } catch (error) {
    if (!(error instanceof PricingSliceExpiredError)) throw error;
    const checkpoint = await pricingCheckpoints.load(accountId);
    const pending = Math.max(1, checkpoint.pending.length);
    const message = `KDP pricing: slice deferred · ${pending} pending`;
    void appendKdpActivity(message, "info");
    return { ...empty, ok: true, pending, message };
  }
}

async function syncPricingSlice(
  opts: Parameters<typeof syncKdpPaperbackPricing>[0],
  priorCheckpoint: Awaited<ReturnType<typeof pricingCheckpoints.load>>,
): Promise<PricingSyncResult> {
  const accountId = opts.accountId.trim();
  pricingRequestTimeout(opts.deadlineAtMs);
  // Recent report rows may omit an ebook that has no sales today. Persisted
  // format identity must still exclude its historical print-setup alias.
  const persistedFormats: AnyRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('kdp_book_formats')
      .select('asin,format').eq('account_id', accountId).order('id')
      .range(offset, offset + 999);
    if (error) throw new Error('KDP pricing format identity unavailable; existing prices preserved');
    persistedFormats.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const formatRows = [...persistedFormats, ...(opts.formatRows || [])];
  const knownFormats = new Map<string, Set<string>>();
  for (const row of formatRows) {
    const asin = String(row.asin || '').trim().toUpperCase();
    const format = String(row.format || '').trim().toLowerCase();
    if (!asin || !format) continue;
    const formats = knownFormats.get(asin) || new Set<string>();
    formats.add(format); knownFormats.set(asin, formats);
  }
  const observedDigitalAsins = new Set<string>();
  const isKnownNonPrint = (asin: string) => {
    const formats = knownFormats.get(asin);
    return observedDigitalAsins.has(asin) || Boolean(formats?.size && !formats.has('paperback'));
  };
  const paperbackAsins = formatRows
    .filter((fr) => String(fr?.format || "").toLowerCase() === "paperback")
    .map((fr) => String(fr?.asin || "").trim().toUpperCase())
    .filter(Boolean);

  const locale = extractKdpBookshelfLocale(getKdpHelperStatus().currentUrl || "") || "en_US";
  const allowAuthNavigate =
    Boolean(opts.allowAuthNavigate) && isKdpHelperScreenFocused();

  // Local Keychain + optional hidden-host bookshelf seed — cookies never leave the phone.
  const bookshelfHtml = await ensureKdpBookshelfContext(accountId, locale, {
    allowAuthNavigate,
    deadlineAtMs: opts.deadlineAtMs,
  });
  for (const row of extractBookshelfPrintRowsFromHtml(bookshelfHtml || '')) {
    const digitalAsin = String(row.digitalAsin || '').trim().toUpperCase();
    if (digitalAsin) observedDigitalAsins.add(digitalAsin);
  }

  const storedRows = await loadStoredPricingRows(accountId);
  await applyBookshelfPrimaryPriceChanges({
    accountId, bookshelfHtml, storedRows,
    markDirty: markPricingSetupDirty,
    writePricing: writeKdpPricing,
    log: (message) => appendKdpActivity(message, "info"),
  });
  const storedSetupByAsin = setupMapFromStoredPricing(storedRows);
  for (const asin of storedSetupByAsin.keys()) {
    if (isKnownNonPrint(asin)) storedSetupByAsin.delete(asin);
  }
  const dirtyEntries = await loadDirtyPricingSetupIds(accountId).catch(() => []);
  const dirtySet = new Set(dirtyEntries.map((e) => e.setupId));

  const { candidates: discovered, pairMaps } = collectPricingCandidatesForIos({
    booksObj: opts.booksObj || null,
    formatRows,
    titlesJson: opts.titlesJson ?? null,
    bookshelfHtml,
    storedSetupByAsin,
  });
  let candidates = [...discovered];
  const inactiveSetupIds = new Set(extractBookshelfPrintRowsFromHtml(bookshelfHtml || '')
    .filter(row => ['draft', 'in_review', 'unpublished', 'action_required'].includes(String(row.printStatus || '').toLowerCase()))
    .map(row => normalizeSetupId(row.kdpBookId)));

  for (const entry of dirtyEntries) {
    if (inactiveSetupIds.has(entry.setupId)) continue;
    if (candidates.some((c) => normalizeSetupId(c.kdpBookId) === entry.setupId)) continue;
    let asin: string | null = null;
    for (const [a, sid] of storedSetupByAsin.entries()) {
      if (normalizeSetupId(sid) === entry.setupId) {
        asin = a;
        break;
      }
    }
    if (asin && (isKnownNonPrint(asin) || discovered.some(row => row.asin === asin && normalizeSetupId(row.kdpBookId) !== entry.setupId))) continue;
    candidates.push({ asin, kdpBookId: entry.setupId, title: null });
  }

  const pendingBefore = await countPendingPricing(accountId, paperbackAsins).catch(
    () => candidates.length,
  );

  if (!candidates.length) {
    await pricingCheckpoints.save(accountId, { needsDiscovery: true, pending: [] });
    const msg = "KDP pricing: no setup IDs yet — background will retry";
    void appendKdpActivity(msg, "info");
    return {
      ok: true,
      synced: 0,
      skipped: 0,
      candidates: 0,
      pending: Math.max(pendingBefore, paperbackAsins.length),
      message: msg,
    };
  }

  const freshAsins = opts.forceRefresh
    ? new Set<string>()
    : await loadFreshPricingAsins(accountId).catch(() => new Set<string>());

  let todo = candidates.filter((c) => {
    const setupId = normalizeSetupId(c.kdpBookId);
    if (dirtySet.has(setupId)) return true;
    const asin = String(c.asin || "")
      .trim()
      .toUpperCase();
    if (!opts.forceRefresh && asin && freshAsins.has(asin)) return false;
    return true;
  });

  if (dirtySet.size > 0 && !opts.forceRefresh && !opts.onboarding) {
    const dirtyTodo = todo.filter((c) => dirtySet.has(normalizeSetupId(c.kdpBookId)));
    if (dirtyTodo.length) todo = dirtyTodo;
  }

  const maxBooks =
    Number.isFinite(Number(opts.maxBooks)) && Number(opts.maxBooks) > 0
      ? Math.max(1, Math.trunc(Number(opts.maxBooks)))
      : opts.onboarding
        ? ONBOARDING_MAX_BOOKS
        : dirtySet.size > 0 && !opts.forceRefresh
          ? Math.max(dirtySet.size, DEFAULT_MAX_BOOKS)
          : DEFAULT_MAX_BOOKS;
  const completed = new Set(priorCheckpoint.pending.length ? priorCheckpoint.completed || [] : []);
  todo = todo.filter(c => !completed.has(pricingCandidateKey(c)) || dirtySet.has(normalizeSetupId(c.kdpBookId)) || opts.forceRefresh);
  todo = resumePricingCandidates(priorCheckpoint.pending, candidates, todo);
  const checkpoint = { needsDiscovery: false, pending: [...todo], completed: [...completed] };
  await pricingCheckpoints.save(accountId, checkpoint);
  const skippedFresh = Math.max(0, candidates.length - todo.length);
  const selectedCount = Math.min(todo.length, maxBooks);
  todo = todo.slice(0, selectedCount);

  if (!todo.length) {
    const pending = await countPendingPricing(accountId, paperbackAsins).catch(
      () => pendingBefore,
    );
    // Shelf already priced (Chrome or prior helper) — drop sticky print-setup banner.
    if (pending === 0) {
      setKdpHelperPricingAuth({ required: false, bookId: null });
      await patchPricingBootstrap(accountId, { authBlockedAt: null });
    }
    const msg =
      skippedFresh > 0
        ? `KDP pricing: skipped ${skippedFresh}/${candidates.length} (fresh <15m)`
        : "KDP pricing: nothing to fetch";
    void appendKdpActivity(msg, "info");
    return {
      ok: true,
      synced: 0,
      skipped: skippedFresh,
      candidates: candidates.length,
      pending,
      message: msg,
    };
  }

  const dirtyNote = dirtySet.size
    ? ` · ${Math.min(todo.length, dirtySet.size)} price change${dirtySet.size === 1 ? "" : "s"}`
    : "";
  setKdpHelperRunning(
    true,
    `KDP pricing: ${todo.length} book${todo.length === 1 ? "" : "s"}${dirtyNote}…`,
  );
  void appendKdpActivity(
    `KDP pricing: ${todo.length}/${candidates.length} candidate${candidates.length === 1 ? "" : "s"}${dirtyNote}`,
    "info",
  );

  const probeId = todo[0]!.kdpBookId;
  const probe = await fetchSetupPage(probeId, locale, opts.deadlineAtMs);
  const probeIsPermanentMiss = isExhaustedSetupPageMiss(probe);
  if (!probeIsPermanentMiss && setupPageLooksUnauthenticated(probe)) {
    // HTML / non-JSON / 403 — same as Chrome sign-in gate. A stored old price
    // is not proof that the pending refresh succeeded: do not clear auth merely
    // because every paperback has a non-null pricing_captured_at.
    const pendingAfterAuth = await countPendingPricing(accountId, paperbackAsins).catch(
      () => pendingBefore,
    );
    const refreshPending = Math.max(pendingAfterAuth, todo.length);
    const why = diagnoseKdpSetupPageFailure({
      fetchResult: probe,
      json: probe.json,
      url: probe.url,
      preferredMarketplace: probe.marketplaceKey || "US",
    });
    setKdpHelperPricingAuth({ required: true, bookId: probeId });
    await patchPricingBootstrap(accountId, { authBlockedAt: nowIso() });
    if (allowAuthNavigate) {
      const authUrl = buildPricingAuthActionTabUrl(probeId, { locale });
      if (authUrl) navigateKdpWebView(authUrl);
      setKdpHelperError(KDP_PRICING_AUTH_REQUIRED_MSG);
    }
    void appendKdpActivity(`${KDP_PRICING_AUTH_REQUIRED_MSG} · ${why}`, "info");
    return {
      ok: true,
      synced: 0,
      skipped: skippedFresh,
      candidates: candidates.length,
      pending: refreshPending,
      skippedAuth: true,
      authRequired: true,
      authBookId: probeId,
      message: KDP_PRICING_AUTH_REQUIRED_MSG,
    };
  }

  let synced = 0;
  let hardFail = 0;
  let consecutiveHard = 0;
  let loggedFirstFail = false;
  let authBookId: string | null = null;

  for (let i = 0; i < todo.length; i += 1) {
    const c = todo[i]!;
    let fetched: SetupFetchResult;
    try {
      fetched = i === 0 ? probe : await fetchSetupPage(c.kdpBookId, locale, opts.deadlineAtMs);
    } catch (error) {
      if (error instanceof PricingSliceExpiredError) break;
      throw error;
    }
    // Move an attempted failure behind untouched books; a permanently stale
    // setup must not monopolize every subsequent three-book slice.
    checkpoint.pending = [...checkpoint.pending.filter(row => pricingCandidateKey(row) !== pricingCandidateKey(c)), c];
    await pricingCheckpoints.save(accountId, checkpoint);

    if (
      !isExhaustedSetupPageMiss(fetched) &&
      setupPageLooksUnauthenticated(fetched)
    ) {
      authBookId = c.kdpBookId;
      setKdpHelperPricingAuth({ required: true, bookId: c.kdpBookId });
      await patchPricingBootstrap(accountId, { authBlockedAt: nowIso() });
      if (allowAuthNavigate) {
        const authUrl = buildPricingAuthActionTabUrl(c.kdpBookId, { locale });
        if (authUrl) navigateKdpWebView(authUrl);
        setKdpHelperError(KDP_PRICING_AUTH_REQUIRED_MSG);
      }
      void appendKdpActivity(KDP_PRICING_AUTH_REQUIRED_MSG, "info");
      break;
    }

    const json = fetched.json;
    const allMarketplace = json
      ? parseAllMarketplacePricingFromSetupPage(json, fetched.marketplaceKey || "US")
      : [];
    const pricing = json
      ? pickPrimaryMarketplacePricing(allMarketplace, fetched.marketplaceKey || "US") ||
        fetched.pricing ||
        parseKdpGetSetupPage(json, fetched.marketplaceKey || "US")
      : fetched.pricing;
    if (!fetched.ok || !hasKdpSetupPagePricing(pricing)) {
      const permanentMiss = isExhaustedSetupPageMiss(fetched);
      if (!loggedFirstFail) {
        loggedFirstFail = true;
        void appendKdpActivity(
          `KDP pricing: ${diagnoseKdpSetupPageFailure({
            fetchResult: fetched,
            json: fetched.json,
            url: fetched.url,
            preferredMarketplace: fetched.marketplaceKey || "US",
          })}`,
          "info",
        );
      }
      hardFail += 1;
      // A removed/unpublished edition is isolated to its old KDP setup ID.
      // It must never consume the consecutive-failure budget and prevent the
      // remaining live ASINs from being priced in this same sweep.
      if (permanentMiss) consecutiveHard = 0;
      else consecutiveHard += 1;
      if (consecutiveHard >= 3) {
        void appendKdpActivity("KDP pricing: stopping after repeated setup-page misses", "info");
        break;
      }
      if (i + 1 < todo.length) await sleep(FETCH_GAP_MS);
      continue;
    }
    consecutiveHard = 0;

    const responseAsin = String(
      pricing?.asin || extractAsinFromSetupPageJson(json) || "",
    )
      .trim()
      .toUpperCase();
    const candidateAsin = String(c.asin || "")
      .trim()
      .toUpperCase();
    if (
      looksLikeAmazonAsin(responseAsin) &&
      looksLikeAmazonAsin(candidateAsin) &&
      responseAsin !== candidateAsin
    ) {
      hardFail += 1;
      if (i + 1 < todo.length) await sleep(FETCH_GAP_MS);
      continue;
    }

    let asin =
      (looksLikeAmazonAsin(candidateAsin) && candidateAsin) ||
      (looksLikeAmazonAsin(responseAsin) && responseAsin) ||
      resolveAsinFromSetupPairMaps(c.kdpBookId, pricing?.bookTitle || c.title, pairMaps) ||
      "";
    asin = String(asin || "")
      .trim()
      .toUpperCase();
    if (!looksLikeAmazonAsin(asin)) {
      hardFail += 1;
      if (i + 1 < todo.length) await sleep(FETCH_GAP_MS);
      continue;
    }

    const capturedAt = nowIso();
    const titleRow: AnyRow = {
      account_id: accountId,
      asin,
      kdp_setup_book_id: c.kdpBookId,
      kdp_list_price: pricing!.listPrice,
      printing_cost: pricing!.printingCost,
      net_royalty_per_sale: pricing!.netRoyalty,
      royalty_rate: pricing!.royaltyRate,
      target_break_even_acos: pricing!.targetBreakEvenAcos,
      pricing_marketplace: pricing!.marketplace,
      pricing_currency: pricing!.currency,
      expanded_distribution: resolveTitleExpandedDistribution(
        allMarketplace,
        pricing!.marketplace || fetched.marketplaceKey || "US",
      ),
      pricing_captured_at: capturedAt,
      updated_at: capturedAt,
    };
    const marketplaceRows = buildMarketplacePricingRows({
      accountId,
      asin,
      setupPageJson: json,
      preferredMarketplace: pricing!.marketplace || fetched.marketplaceKey || "US",
      capturedAt,
    });
    // Commit each exact ASIN with all of its captured marketplaces. A later
    // expiry cannot discard books already acknowledged by both writes.
    await writeKdpPricing({ accountId, titleRows: [titleRow], marketplaceRows });
    checkpoint.pending = checkpoint.pending.filter(row => pricingCandidateKey(row) !== pricingCandidateKey(c));
    completed.add(pricingCandidateKey(c));
    checkpoint.completed = [...completed];
    await pricingCheckpoints.save(accountId, checkpoint);
    await clearDirtyPricingSetupIds(accountId, [normalizeSetupId(c.kdpBookId)]);
    if (synced === 0) {
      setKdpHelperPricingAuth({ required: false, bookId: null });
      await patchPricingBootstrap(accountId, { authBlockedAt: null });
    }
    synced += 1;
    void appendKdpActivity(`KDP pricing checkpoint · ${asin} · ${marketplaceRows.length} markets · ${checkpoint.pending.length} pending`, "info");
    if (i + 1 < todo.length) await sleep(FETCH_GAP_MS);
  }

  const pending = Math.max(checkpoint.pending.length,
    await countPendingPricing(accountId, paperbackAsins).catch(() => Math.max(0, pendingBefore - synced)),
  );

  if (pending === 0) {
    setKdpHelperPricingAuth({ required: false, bookId: null });
    await patchPricingBootstrap(accountId, { authBlockedAt: null });
  }

  const msg = synced
    ? `KDP pricing: updated ${synced} book${synced === 1 ? "" : "s"}${pending ? ` · ${pending} left` : ""}`
    : hardFail
      ? `KDP pricing: 0 updated · ${hardFail} failed`
      : pending ? `KDP pricing: ${pending} pending · slice deferred` : "KDP pricing: nothing new";
  void appendKdpActivity(msg, synced && !pending ? "steady" : "info");
  return {
    ok: true,
    synced,
    skipped: skippedFresh + hardFail,
    authRequired: Boolean(authBookId),
    authBookId,
    candidates: candidates.length,
    pending,
    message: msg,
  };
}
