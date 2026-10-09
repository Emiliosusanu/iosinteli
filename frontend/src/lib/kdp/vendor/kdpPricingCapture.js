/**
 * KDP print-setup pricing capture helpers.
 * Parses get-setup-page JSON and computes calculator net royalty.
 */

export function pickRoyaltyRate(listPrice, royaltyRates) {
  if (listPrice == null || listPrice === '') return null;
  const price = Number(listPrice);
  const rates = Array.isArray(royaltyRates) ? royaltyRates : [];
  if (!Number.isFinite(price) || rates.length === 0) return null;

  const sorted = [...rates].sort(
    (a, b) => Number(b?.threshold ?? 0) - Number(a?.threshold ?? 0),
  );
  for (const row of sorted) {
    if (price >= Number(row?.threshold ?? 0)) {
      return Number(row?.royaltyRate ?? 0);
    }
  }
  return Number(sorted[sorted.length - 1]?.royaltyRate ?? 0);
}

/** US paperback: net ≈ list × rate − printing (no VAT). */
export function computeKdpNetRoyalty(listPrice, printingCost, royaltyRates) {
  if (listPrice == null || listPrice === '' || printingCost == null || printingCost === '') return null;
  const list = Number(listPrice);
  const printing = Number(printingCost);
  const rate = pickRoyaltyRate(list, royaltyRates);
  if (!Number.isFinite(list) || list <= 0 || !Number.isFinite(printing) || printing < 0 || rate == null) return null;
  return list * rate - printing;
}

export function computeTargetBreakEvenAcos(netRoyalty, listPrice) {
  if (netRoyalty == null || netRoyalty === '' || listPrice == null || listPrice === '') return null;
  const net = Number(netRoyalty);
  const list = Number(listPrice);
  if (!Number.isFinite(net) || !Number.isFinite(list) || list <= 0) return null;
  return (net / list) * 100;
}

function numericPricingInput(value) {
  return value == null || String(value).trim() === '' ? null : Number(value);
}

/**
 * Live KDP browser contract (forensic 1.2.108):
 * GET /print-setup/print-book/{setupId}/{format}/{locale}/v2/get-setup-page
 * Authorization absent; anti-csrftoken-a2z present; cookies browser-managed.
 */
export function buildKdpGetSetupPageUrl(
  kdpBookId,
  format = 'paperback',
  marketplace = 'en-US',
) {
  const id = String(kdpBookId || '').trim();
  if (!id) return null;
  const fmt = String(format || 'paperback').trim() || 'paperback';
  const mkt = String(marketplace || 'en-US').trim() || 'en-US';
  return `https://kdp.amazon.com/print-setup/print-book/${encodeURIComponent(id)}/${encodeURIComponent(fmt)}/${encodeURIComponent(mkt)}/v2/get-setup-page`;
}

/** Header names only — never log or persist CSRF/Authorization values. */
export const KDP_SETUP_PAGE_CSRF_HEADER = 'anti-csrftoken-a2z';
export const KDP_SETUP_PAGE_CSRF_COOKIE = 'anti-csrftoken-a2z';

/**
 * Build authoritative get-setup-page request headers matching the live browser.
 * Does NOT set Authorization (malformed Auth caused false 403 sign_in).
 * CSRF value must come from the live page session; callers must not persist it.
 */
export function buildKdpSetupPageRequestHeaders({
  referer = 'https://kdp.amazon.com/en_US/bookshelf',
  csrfToken = null,
  contentType = 'application/json',
} = {}) {
  const headers = {
    accept: 'application/json, text/plain, */*',
    referer: String(referer || 'https://kdp.amazon.com/en_US/bookshelf'),
  };
  if (contentType) headers['content-type'] = String(contentType);
  const csrf = String(csrfToken || '').trim();
  if (csrf) headers[KDP_SETUP_PAGE_CSRF_HEADER] = csrf;
  // Explicitly omit Authorization — Amazon API Gateway rejects non-SigV4 values.
  return headers;
}

/** True when a header map includes a non-empty Authorization (case-insensitive). */
export function setupPageHeadersIncludeAuthorization(headers = {}) {
  if (!headers || typeof headers !== 'object') return false;
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === 'authorization' && String(v || '').trim()) return true;
  }
  return false;
}

/** Strip Authorization from a header map (mutate-safe copy). */
export function stripSetupPageAuthorizationHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (String(k).toLowerCase() === 'authorization') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Sanitize log/debug objects so CSRF / Authorization secrets are never persisted.
 * Replaces values with PRESENT/ABSENT presence markers.
 */
export function sanitizeKdpSetupPageLogHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const kl = String(k).toLowerCase();
    if (
      kl === 'authorization'
      || kl === KDP_SETUP_PAGE_CSRF_HEADER
      || kl === 'cookie'
      || kl.includes('csrf')
      || kl.includes('token')
    ) {
      out[k] = String(v || '').trim() ? 'PRESENT' : 'ABSENT';
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Resolve a bookshelf-relative KDP API path to an absolute URL. */
export function resolveKdpAbsoluteUrl(url, baseOrigin = 'https://kdp.amazon.com') {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(baseOrigin || 'https://kdp.amazon.com').replace(/\/$/, '');
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}

/** Read KDP site locale from an open bookshelf tab URL (e.g. en_US, en_GB). */
export function extractKdpBookshelfLocale(tabUrl) {
  const m = String(tabUrl || '').match(/kdp\.amazon\.com\/([a-z]{2}_[A-Z]{2})/i);
  return m ? m[1] : 'en_US';
}

const LOCALE_SETUP_MARKETPLACE = {
  en_US: 'en-US',
  en_GB: 'en-GB',
  de_DE: 'de-DE',
  fr_FR: 'fr-FR',
  es_ES: 'es-ES',
  it_IT: 'it-IT',
  nl_NL: 'nl-NL',
  pl_PL: 'pl-PL',
  ja_JP: 'ja-JP',
};

/**
 * get-setup-page URL candidates. Live browser prefers the /v2/ print-book path
 * without a bookshelf locale prefix; keep legacy non-v2 paths as fallbacks only.
 */
export function buildKdpGetSetupPageUrlCandidates(kdpBookId, options = {}) {
  const id = String(kdpBookId || '').trim();
  if (!id) return [];
  const opts = (options && typeof options === 'object') ? options : {};
  const format = String(opts.format || 'paperback').trim() || 'paperback';
  const locale = String(opts.locale || 'en_US').trim() || 'en_US';
  const marketplace = String(
    opts.marketplace || LOCALE_SETUP_MARKETPLACE[locale] || 'en-US',
  ).trim();
  const encId = encodeURIComponent(id);
  const fmt = encodeURIComponent(format);
  const mkt = encodeURIComponent(marketplace);
  // Proven live browser shape first (forensic closeout 1.2.108).
  const primary = [
    `/print-setup/print-book/${encId}/${fmt}/${mkt}/v2/get-setup-page`,
    `https://kdp.amazon.com/print-setup/print-book/${encId}/${fmt}/${mkt}/v2/get-setup-page`,
    `/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}/v2/get-setup-page`,
    `https://kdp.amazon.com/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}/v2/get-setup-page`,
    // Legacy non-v2 fallbacks (may 403/404 on modern KDP).
    `/${locale}/title-setup/${fmt}/${encId}/get-setup-page`,
    `/${locale}/print-setup/${fmt}/${encId}/get-setup-page`,
    `/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}/get-setup-page`,
    `/${locale}/print-setup/print-book/${encId}/${fmt}/US/get-setup-page`,
    `https://kdp.amazon.com/${locale}/title-setup/${fmt}/${encId}/get-setup-page`,
    `https://kdp.amazon.com/${locale}/print-setup/${fmt}/${encId}/get-setup-page`,
    `https://kdp.amazon.com/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}/get-setup-page`,
    `https://kdp.amazon.com/${locale}/print-setup/print-book/${encId}/${fmt}/US/get-setup-page`,
    `https://kdp.amazon.com/title-setup/${fmt}/${encId}/get-setup-page`,
    `https://kdp.amazon.com/print-setup/print-book/${encId}/${fmt}/${mkt}/get-setup-page`,
    `https://kdp.amazon.com/print-setup/print-book/${encId}/${fmt}/US/get-setup-page`,
  ];
  const out = [...new Set(primary.filter(Boolean))];
  if (locale !== 'en_US') {
    out.push(...buildKdpGetSetupPageUrlCandidates(kdpBookId, { format, locale: 'en_US' }));
  }
  return [...new Set(out)];
}

/** True when URL is the proven live /v2/ get-setup-page contract. */
export function isKdpSetupPageV2Url(url) {
  return /\/print-setup\/print-book\/[^/]+\/(?:paperback|hardcover)\/[^/]+\/v2\/get-setup-page(?:\?|$)/i
    .test(String(url || ''));
}

/**
 * Print/title-setup editor URLs (not get-setup-page API). Visiting once per
 * Chrome profile completes Amazon's setup step-up so later API fetches reuse cookies.
 * Includes bookshelf-relative paths (for in-page fetch) and absolute kdp.amazon.com
 * URLs. Callers that open a new tab MUST use buildPricingAuthActionTabUrl / resolveKdpAbsoluteUrl
 * — chrome.tabs.create resolves relative paths against the extension origin.
 */
export function buildKdpPrintSetupEditorUrlCandidates(kdpBookId, options = {}) {
  const id = String(kdpBookId || '').trim();
  if (!id) return [];
  const opts = (options && typeof options === 'object') ? options : {};
  const format = String(opts.format || 'paperback');
  const locale = String(opts.locale || 'en_US').trim() || 'en_US';
  const marketplace = String(
    opts.marketplace || LOCALE_SETUP_MARKETPLACE[locale] || 'en-US',
  ).trim();
  const encId = encodeURIComponent(id);
  const fmt = encodeURIComponent(format);
  const mkt = encodeURIComponent(marketplace);
  const primary = [
    `/${locale}/title-setup/${fmt}/${encId}/pricing`,
    `/${locale}/title-setup/${fmt}/${encId}`,
    `/${locale}/print-setup/${fmt}/${encId}/pricing`,
    `/${locale}/print-setup/${fmt}/${encId}`,
    `/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}`,
    `https://kdp.amazon.com/${locale}/title-setup/${fmt}/${encId}/pricing`,
    `https://kdp.amazon.com/${locale}/title-setup/${fmt}/${encId}`,
    `https://kdp.amazon.com/${locale}/print-setup/${fmt}/${encId}/pricing`,
    `https://kdp.amazon.com/${locale}/print-setup/${fmt}/${encId}`,
    `https://kdp.amazon.com/${locale}/print-setup/print-book/${encId}/${fmt}/${mkt}`,
    `https://kdp.amazon.com/title-setup/${fmt}/${encId}/pricing`,
    `https://kdp.amazon.com/title-setup/${fmt}/${encId}`,
    `https://kdp.amazon.com/print-setup/print-book/${encId}/${fmt}/${mkt}`,
  ];
  const out = [...new Set(primary.filter(Boolean))];
  if (locale !== 'en_US') {
    out.push(...buildKdpPrintSetupEditorUrlCandidates(kdpBookId, { format, locale: 'en_US' }));
  }
  return [...new Set(out)];
}

/**
 * Absolute https://kdp.amazon.com URL for the pricing sign-in tab.
 * Never return a relative path — tabs.create from the service worker would
 * resolve it against chrome-extension://…/worker.html (ERR_FILE_NOT_FOUND).
 * Prefer the live print-setup pricing route (confirmed on KDP), not invented paths.
 */
export function buildPricingAuthActionTabUrl(kdpBookId, options = {}) {
  const id = String(kdpBookId || '').trim();
  if (!id) return '';
  const opts = (options && typeof options === 'object') ? options : {};
  const locale = String(opts.locale || 'en_US').trim() || 'en_US';
  const preferred = `https://kdp.amazon.com/${locale}/print-setup/paperback/${encodeURIComponent(id)}/pricing`;
  if (/^https:\/\/kdp\.amazon\.com\//i.test(preferred)) return preferred;
  return `https://kdp.amazon.com/en_US/print-setup/paperback/${encodeURIComponent(id)}/pricing`;
}

/**
 * True when a tab URL is the paperback Rights & Pricing editor
 * (`…/print-setup|title-setup/paperback/<id>/pricing`).
 *
 * Visiting this page may *arm verification* of get-setup-page access.
 * It does **not** by itself prove pricing auth — do not clear the gate
 * until an authoritative setup-page probe succeeds.
 */
export function shouldClearPricingGateForTabUrl(url) {
  return shouldVerifyPricingAuthForTabUrl(url);
}

/** Alias: pricing-route tab completion → verify, never treat as auth proof. */
export function shouldVerifyPricingAuthForTabUrl(url) {
  const ctx = extractKdpPricingEditorContext(url);
  return Boolean(ctx?.setupId && ctx.pricingRoute);
}

/** Identify the paperback pricing editor and its internal KDP setup-book id. */
export function extractKdpPricingEditorContext(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw, 'https://kdp.amazon.com');
  } catch {
    return null;
  }
  if (parsed.hostname && parsed.hostname.toLowerCase() !== 'kdp.amazon.com') return null;
  const path = decodeURIComponent(parsed.pathname || '');
  let match = path.match(/\/(?:print|title)-setup\/(paperback|hardcover)\/([A-Z0-9]+)(?:\/|$)/i);
  let format = match?.[1] || null;
  let setupId = match?.[2] || null;
  if (!setupId) {
    match = path.match(/\/(?:print|title)-setup\/print-book\/([A-Z0-9]+)\/(paperback|hardcover)(?:\/|$)/i);
    setupId = match?.[1] || null;
    format = match?.[2] || null;
  }
  if (!setupId || String(format || '').toLowerCase() !== 'paperback') return null;
  return {
    setupId: String(setupId).trim().toUpperCase(),
    format: 'paperback',
    pricingRoute: /\/pricing(?:\/|$)/i.test(path),
  };
}

/** Pure predicate shared by validation/tests for KDP price-save detection. */
export function isLikelyKdpPricingMutation({ pageUrl, requestUrl, method, body } = {}) {
  const context = extractKdpPricingEditorContext(pageUrl);
  if (!context) return false;
  const verb = String(method || 'GET').trim().toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(verb)) return false;
  const requestText = `${String(requestUrl || '')} ${String(body || '')}`.toLowerCase();
  if (/dataplane\.rum|unagi-|\/telemetry|\/metrics|\/logging/.test(requestText)) return false;
  const hasPricingSignal = /pric|royalt|list.?price|printing.?cost|distribution/.test(requestText);
  const hasSetupSignal = /(?:print|title)-setup|setup-page|save-setup/.test(requestText);
  return Boolean(hasPricingSignal || (context.pricingRoute && hasSetupSignal));
}

/** Unwrap nested API envelopes so pricing/book fields are at the top level. */
export function unwrapKdpSetupPageJson(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.pricing || json.pricingSpec || json.book) return json;
  for (const key of ['data', 'payload', 'result', 'response', 'body', 'setupPage']) {
    const inner = json[key];
    if (inner && typeof inner === 'object' && (inner.pricing || inner.pricingSpec || inner.book)) {
      return inner;
    }
  }
  return json;
}

function pricingBlockHasValues(root, marketplaceKey) {
  const mk = String(marketplaceKey || '').trim();
  if (!mk) return false;
  const listBlock = root?.pricing?.[mk];
  const specBlock = root?.pricingSpec?.current?.[mk];
  return Number.isFinite(numericPricingInput(listBlock?.priceVatExclusive))
    || Number.isFinite(numericPricingInput(specBlock?.printingCost));
}

function pricingBlockHasCompleteValues(root, marketplaceKey) {
  const mk = String(marketplaceKey || '').trim();
  const price = numericPricingInput(root?.pricing?.[mk]?.priceVatExclusive);
  const cost = numericPricingInput(root?.pricingSpec?.current?.[mk]?.printingCost);
  return Number.isFinite(price) && price > 0
    && Number.isFinite(cost) && cost >= 0;
}

/** Pick the marketplace key that actually carries list/printing values. */
export function resolvePricingMarketplaceKey(json, preferredKey = 'US') {
  const root = unwrapKdpSetupPageJson(json);
  if (!root) return String(preferredKey || 'US').trim();

  const preferred = String(preferredKey || 'US').trim();
  const candidates = [
    preferred,
    'US',
    'GB',
    'CA',
    'AU',
    'DE',
    'FR',
    'IT',
    'ES',
    'JP',
    'en-US',
    'en_US',
  ];
  const allKeys = [...new Set([
    ...candidates,
    ...Object.keys(root?.pricing || {}),
    ...Object.keys(root?.pricingSpec?.current || {}),
  ])];
  for (const key of allKeys) {
    if (pricingBlockHasCompleteValues(root, key)) return key;
  }
  for (const key of candidates) {
    if (pricingBlockHasValues(root, key)) return key;
  }
  for (const key of Object.keys(root?.pricing || {})) {
    if (pricingBlockHasValues(root, key)) return key;
  }
  for (const key of Object.keys(root?.pricingSpec?.current || {})) {
    if (pricingBlockHasValues(root, key)) return key;
  }
  return preferred;
}

export function hasKdpSetupPagePricing(pricing) {
  return pricing != null
    && pricing.listPrice != null
    && pricing.netRoyalty != null;
}

export function summarizeKdpSetupPageJson(json) {
  const root = unwrapKdpSetupPageJson(json) || {};
  const envelope = json && typeof json === 'object' ? json : {};
  return {
    topLevelKeys: Object.keys(envelope),
    pricingKeys: Object.keys(root.pricing || {}),
    pricingSpecKeys: Object.keys(root.pricingSpec?.current || {}),
    bookTitle: root?.book?.title || root?.book?.name || null,
    error: root?.error || root?.errors || envelope?.error || envelope?.errors || null,
  };
}

export function snippetKdpFetchText(text, maxLen = 240) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** Detect Amazon print-setup auth gate, e.g. HTTP 403 {"reason":"sign_in"}. */
export function extractKdpSignInReason(json) {
  if (!json || typeof json !== 'object') return null;
  const candidates = [json];
  const root = unwrapKdpSetupPageJson(json);
  if (root && root !== json) candidates.push(root);
  for (const key of ['data', 'payload', 'result', 'response', 'body', 'setupPage']) {
    const inner = json[key];
    if (inner && typeof inner === 'object') candidates.push(inner);
  }
  for (const obj of candidates) {
    const reason = String(obj?.reason || obj?.Reason || '').trim().toLowerCase();
    if (reason === 'sign_in' || reason === 'sign-in' || reason === 'signin') return reason;
  }
  return null;
}

/**
 * Amazon API Gateway rejects a non-SigV4 Authorization header with:
 * "Invalid key=value pair (missing equal-sign) in Authorization header..."
 * That is a request-shape / programming error — NOT a user sign-in gate.
 */
export function isKdpSetupPageMalformedAuthorizationResponse(json, text, status) {
  const st = Number(status || 0);
  if (st !== 403 && st !== 401) return false;
  const body = json && typeof json === 'object'
    ? JSON.stringify(json)
    : String(text || '');
  return /invalid key\s*=\s*value pair/i.test(body)
    && /authorization header/i.test(body);
}

/** True when the failure is a request-shape/programming error, not user auth. */
export function isKdpSetupPageRequestShapeError({ fetchResult, json, hint } = {}) {
  if (isKdpSetupPageMalformedAuthorizationResponse(
    json ?? fetchResult?.json,
    String(fetchResult?.text || ''),
    Number(fetchResult?.status || 0),
  )) {
    return true;
  }
  const h = String(hint || '');
  if (/request_error|malformed authorization|request[_ ]?shape/i.test(h)) return true;
  // Prefer attempt snippets when the "best" attempt was an SPA shell.
  const attempts = Array.isArray(fetchResult?.attempts) ? fetchResult.attempts : [];
  for (const a of attempts) {
    if (isKdpSetupPageMalformedAuthorizationResponse(
      a?.json,
      String(a?.snippet || a?.text || ''),
      Number(a?.status || 0),
    )) {
      return true;
    }
  }
  return false;
}

/** True when get-setup-page response is an Amazon sign-in gate (403, reason sign_in, login HTML). */
export function isKdpSetupPageSignInResponse(json, text, status) {
  // Malformed Authorization is NOT sign_in — do not ask the user to log in.
  if (isKdpSetupPageMalformedAuthorizationResponse(json, text, status)) return false;
  const st = Number(status || 0);
  if (extractKdpSignInReason(json)) return true;
  const body = json && typeof json === 'object'
    ? JSON.stringify(json)
    : String(text || '');
  if (st === 403 && /sign[\s_-]?in|"reason"\s*:\s*"sign[_-]?in"/i.test(body)) return true;
  if (/sign[\s-]?in|ap_login|authportal/i.test(body)
    && (st === 403 || st === 401 || /<html/i.test(body))) {
    return true;
  }
  return false;
}

export function isKdpSetupPageAuthFailure({ fetchResult, json } = {}) {
  if (isKdpSetupPageRequestShapeError({ fetchResult, json })) return false;
  if (fetchResult?.pricingAuthRequired === true) return true;
  const status = Number(fetchResult?.status || 0);
  const text = String(fetchResult?.text || '');
  return isKdpSetupPageSignInResponse(json, text, status);
}


/**
 * WebKit/network transport miss for get-setup-page. Kept as an iOS-only
 * compatibility export while the shared Chrome parser remains the source of
 * truth for URL, pricing and Bookshelf parsing.
 */
export function isKdpSetupPageTransportFailure(fetchResult) {
  const status = Number(fetchResult?.status || 0);
  if (status !== 0) return false;
  const text = String(fetchResult?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return /load failed|failed to fetch|network\s*error|networkerror|aborted|internet connection|the network connection was lost/i.test(text);
}

/**
 * True when the get-setup-page response is a PERMANENT miss — KDP answers
 * `404 "ItemSetId <id> is not found"` for a print-setup ID that has been
 * deleted, unpublished, or gone stale. Unlike an auth/step-up failure this
 * never resolves: no sign-in and no retry will ever price the book. The
 * caller must skip it instead of opening a step-up tab every cycle (which
 * is what spammed dozens of 404 tabs). Checks every fallback attempt, since
 * the "best" attempt kept is often the 200 SPA shell, not the 404 itself.
 */
export function isKdpSetupPagePermanentMiss(fetched) {
  const attempts = Array.isArray(fetched?.attempts) && fetched.attempts.length
    ? fetched.attempts
    : [fetched];
  return attempts.some((a) => {
    if (!a) return false;
    const status = Number(a.status || 0);
    if (status !== 404) return false;
    const body = a.snippet != null
      ? String(a.snippet)
      : (a.json && typeof a.json === 'object' ? JSON.stringify(a.json) : String(a.text || ''));
    return /is not found|itemsetid/i.test(body);
  });
}

export function diagnoseKdpSetupPageFailure({
  fetchResult,
  json,
  url,
  preferredMarketplace = 'US',
} = {}) {
  const parts = [];
  const status = Number(fetchResult?.status || 0);
  const ok = Boolean(fetchResult?.ok);
  const contentType = String(fetchResult?.contentType || '');
  const finalUrl = String(fetchResult?.finalUrl || url || '');
  const text = String(fetchResult?.text || '');

  if (!ok) parts.push(`HTTP ${status || 'failed'}`);
  if (fetchResult?.redirected) parts.push('redirected');
  if (finalUrl && url && finalUrl !== url) parts.push(`finalUrl=${finalUrl}`);

  // Request-shape / programming errors must not be reported as sign_in.
  if (isKdpSetupPageRequestShapeError({ fetchResult, json })) {
    parts.push('request_error: malformed Authorization');
    return parts.join('; ');
  }

  if (!json) {
    parts.push('non-JSON response');
    const snippet = snippetKdpFetchText(text);
    if (snippet) parts.push(`snippet=${snippet}`);
    if (isKdpSetupPageTransportFailure(fetchResult)) {
      parts.push('transport failure (need kdp.amazon.com session / print-setup)');
    }
    if (/sign[\s-]?in|ap_login|authportal/i.test(text)) parts.push('looks like login page');
    if (status === 403 && /sign[\s_-]?in|"reason"\s*:\s*"sign[_-]?in"/i.test(text)) {
      parts.push('sign_in required');
    }
    return parts.join('; ');
  }

  if (isKdpSetupPageAuthFailure({ fetchResult, json })) {
    parts.push('sign_in required');
    const signInReason = extractKdpSignInReason(json);
    if (signInReason) parts.push(`reason=${signInReason}`);
    return parts.join('; ');
  }

  const summary = summarizeKdpSetupPageJson(json);
  const mk = resolvePricingMarketplaceKey(json, preferredMarketplace);
  const pricing = parseKdpGetSetupPage(json, mk);

  if (pricing.listPrice == null) {
    parts.push('missing listPrice');
    if (summary.pricingKeys.length) parts.push(`pricing keys: ${summary.pricingKeys.join(',')}`);
    else parts.push('no pricing block');
  }
  if (pricing.printingCost == null) parts.push('missing printingCost');
  if (pricing.netRoyalty == null) parts.push('missing netRoyalty');
  if (summary.bookTitle) parts.push(`book=${summary.bookTitle.slice(0, 60)}`);
  if (summary.error) parts.push(`apiError=${JSON.stringify(summary.error).slice(0, 120)}`);
  if (contentType && !contentType.includes('json')) parts.push(`content-type=${contentType}`);

  return parts.length ? parts.join('; ') : 'unknown parse failure';
}

/**
 * @param {object} json - get-setup-page response body
 * @param {string} marketplaceKey - e.g. 'US', 'GB'
 */
export function parseKdpGetSetupPage(json, marketplaceKey = 'US') {
  const root = unwrapKdpSetupPageJson(json);
  if (!root) {
    return {
      marketplace: String(marketplaceKey || 'US').trim(),
      currency: 'USD',
      listPrice: null,
      printingCost: null,
      royaltyRate: null,
      netRoyalty: null,
      targetBreakEvenAcos: null,
      bookTitle: null,
      asin: null,
    };
  }

  const mk = resolvePricingMarketplaceKey(root, marketplaceKey);
  const listBlock = root?.pricing?.[mk];
  const specBlock = root?.pricingSpec?.current?.[mk];
  const listPrice = numericPricingInput(listBlock?.priceVatExclusive);
  const printingCost = numericPricingInput(specBlock?.printingCost);
  const royaltyRates = specBlock?.programs?.RETAIL?.royaltyRates ?? [];
  const currency = String(listBlock?.currencyCode || specBlock?.currencyCode || 'USD');
  const netRoyalty = computeKdpNetRoyalty(listPrice, printingCost, royaltyRates);
  const royaltyRate = pickRoyaltyRate(listPrice, royaltyRates);
  const bookTitle = root?.book?.title || root?.book?.name || null;
  const asin = extractAsinFromSetupPageJson(root);

  return {
    marketplace: mk,
    currency,
    listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : null,
    printingCost: Number.isFinite(printingCost) && printingCost >= 0 ? printingCost : null,
    royaltyRate: royaltyRate != null ? royaltyRate : null,
    netRoyalty: netRoyalty != null ? Number(netRoyalty.toFixed(4)) : null,
    targetBreakEvenAcos: computeTargetBreakEvenAcos(netRoyalty, listPrice),
    bookTitle,
    asin,
  };
}

/** Amazon Ads profile country_code → KDP setup-page marketplace key. */
export const ADS_COUNTRY_TO_KDP_MARKETPLACE = {
  US: 'US',
  CA: 'CA',
  MX: 'MX',
  GB: 'GB',
  UK: 'GB',
  DE: 'DE',
  FR: 'FR',
  IT: 'IT',
  ES: 'ES',
  NL: 'NL',
  PL: 'PL',
  SE: 'SE',
  BE: 'BE',
  AU: 'AU',
  JP: 'JP',
  IN: 'IN',
  BR: 'BR',
  IE: 'IE',
};

const LOCALE_TAG_TO_MARKETPLACE = {
  'en-US': 'US',
  'en_US': 'US',
  'en-GB': 'GB',
  'en_GB': 'GB',
  'de-DE': 'DE',
  'de_DE': 'DE',
  'fr-FR': 'FR',
  'fr_FR': 'FR',
  'it-IT': 'IT',
  'it_IT': 'IT',
  'es-ES': 'ES',
  'es_ES': 'ES',
  'nl-NL': 'NL',
  'nl_NL': 'NL',
  'pl-PL': 'PL',
  'pl_PL': 'PL',
  'ja-JP': 'JP',
  'ja_JP': 'JP',
};

const EXPANDED_DISTRIBUTION_PROGRAM_RE = /expanded|ingram|wholesale|books.?in.?print|\bbip\b/i;

/** Normalize KDP pricing block keys (US, en-US, en_US → US). */
export function normalizeMarketplaceKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return 'US';
  const upper = key.toUpperCase();
  if (upper === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const fromLocale = LOCALE_TAG_TO_MARKETPLACE[key] || LOCALE_TAG_TO_MARKETPLACE[key.replace('_', '-')];
  if (fromLocale) return fromLocale;
  const m = key.match(/^([a-z]{2})[-_]([A-Z]{2})$/i);
  if (m) return m[2].toUpperCase();
  return upper.slice(0, 2);
}

export function countryCodeToKdpMarketplaceKey(countryCode) {
  const cc = String(countryCode || 'US').trim().toUpperCase();
  return ADS_COUNTRY_TO_KDP_MARKETPLACE[cc] || normalizeMarketplaceKey(cc);
}

function marketplaceKeyLookupAliases(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return ['US'];
  const normalized = normalizeMarketplaceKey(key);
  const aliases = new Set([key, normalized]);
  if (normalized === 'GB') aliases.add('UK');
  if (normalized === 'US') {
    aliases.add('en-US');
    aliases.add('en_US');
  }
  if (normalized === 'GB') {
    aliases.add('en-GB');
    aliases.add('en_GB');
  }
  return [...aliases];
}

function readPricingBlocksForKey(root, rawKey) {
  if (!root) return { resolvedKey: normalizeMarketplaceKey(rawKey), listBlock: null, specBlock: null };
  for (const alias of marketplaceKeyLookupAliases(rawKey)) {
    const listBlock = root?.pricing?.[alias];
    const specBlock = root?.pricingSpec?.current?.[alias];
    if (Number.isFinite(Number(listBlock?.priceVatExclusive))
      || Number.isFinite(Number(specBlock?.printingCost))) {
      return { resolvedKey: normalizeMarketplaceKey(alias), listBlock, specBlock };
    }
  }
  const normalized = normalizeMarketplaceKey(rawKey);
  return {
    resolvedKey: normalized,
    listBlock: root?.pricing?.[rawKey] || root?.pricing?.[normalized] || null,
    specBlock: root?.pricingSpec?.current?.[rawKey] || root?.pricingSpec?.current?.[normalized] || null,
  };
}

function parsePricingFromBlocks(root, rawKey) {
  const { resolvedKey, listBlock, specBlock } = readPricingBlocksForKey(root, rawKey);
  const listPrice = numericPricingInput(listBlock?.priceVatExclusive);
  const printingCost = numericPricingInput(specBlock?.printingCost);
  const royaltyRates = specBlock?.programs?.RETAIL?.royaltyRates ?? [];
  const currency = String(listBlock?.currencyCode || specBlock?.currencyCode || 'USD');
  const netRoyalty = computeKdpNetRoyalty(listPrice, printingCost, royaltyRates);
  const royaltyRate = pickRoyaltyRate(listPrice, royaltyRates);
  const bookTitle = root?.book?.title || root?.book?.name || null;
  const asin = extractAsinFromSetupPageJson(root);

  return {
    marketplace: resolvedKey,
    currency,
    listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : null,
    printingCost: Number.isFinite(printingCost) && printingCost >= 0 ? printingCost : null,
    royaltyRate: royaltyRate != null ? royaltyRate : null,
    netRoyalty: netRoyalty != null ? Number(netRoyalty.toFixed(4)) : null,
    targetBreakEvenAcos: computeTargetBreakEvenAcos(netRoyalty, listPrice),
    bookTitle,
    asin,
  };
}

/** Union of marketplace keys present in a get-setup-page payload. */
export function listSetupPageMarketplaceKeys(json) {
  const root = unwrapKdpSetupPageJson(json);
  if (!root) return [];
  const keys = new Set([
    ...Object.keys(root.pricing || {}),
    ...Object.keys(root.pricingSpec?.current || {}),
  ]);
  return [...keys].filter((key) => String(key || '').trim());
}

function collectTerritoryCodes(node, depth = 0, out = new Set()) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectTerritoryCodes(item, depth + 1, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (/territor|country|region|marketplace/i.test(key)) {
      if (typeof value === 'string' && /^[A-Z]{2}$/.test(value.trim())) {
        out.add(value.trim().toUpperCase());
      } else if (Array.isArray(value)) {
        for (const item of value) {
          const code = String(item?.code || item?.countryCode || item?.country || item || '').trim().toUpperCase();
          if (/^[A-Z]{2}$/.test(code)) out.add(code);
        }
      }
    }
    if (value && typeof value === 'object') collectTerritoryCodes(value, depth + 1, out);
  }
  return out;
}

function readProgramEnrollmentBlock(root, rawKey) {
  const enrollments = root?.programEnrollments;
  if (!enrollments || typeof enrollments !== 'object') return null;
  for (const alias of marketplaceKeyLookupAliases(rawKey)) {
    const block = enrollments[alias];
    if (block && typeof block === 'object') return block;
  }
  return null;
}

function readExpandedDistributionEnrollment(root, rawKey) {
  const enrollmentBlock = readProgramEnrollmentBlock(root, rawKey);
  if (enrollmentBlock) {
    for (const [programKey, programValue] of Object.entries(enrollmentBlock)) {
      if (!EXPANDED_DISTRIBUTION_PROGRAM_RE.test(programKey)) continue;
      const enrolled = readBooleanHint(programValue?.enrolled);
      if (enrolled != null) {
        return { expandedDistribution: enrolled, expandedPrograms: enrolled ? [programKey] : [] };
      }
    }
  }
  return null;
}

function readMarketplaceTerritories(root, rawKey) {
  const deps = root?.rightsSpec?.marketplaceDependencies;
  if (deps && typeof deps === 'object') {
    for (const alias of marketplaceKeyLookupAliases(rawKey)) {
      const list = deps[alias];
      if (Array.isArray(list) && list.length > 0) {
        return list
          .map((code) => String(code || '').trim().toUpperCase())
          .filter((code) => /^[A-Z]{2}$/.test(code))
          .sort();
      }
    }
  }

  const rights = root?.rights && typeof root.rights === 'object' ? root.rights : {};
  if (readBooleanHint(rights.worldwideRights) === true) {
    const available = root?.rightsSpec?.availableTerritoryRights;
    if (Array.isArray(available) && available.length > 0) {
      return available
        .map((code) => String(code || '').trim().toUpperCase())
        .filter((code) => /^[A-Z]{2}$/.test(code))
        .sort();
    }
  }

  return [...collectTerritoryCodes(root.book)]
    .concat([...collectTerritoryCodes(root.distribution)])
    .concat([...collectTerritoryCodes(root.rights)])
    .filter((code, idx, arr) => arr.indexOf(code) === idx)
    .sort();
}

function readBooleanHint(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const low = value.trim().toLowerCase();
    if (low === 'true' || low === 'yes' || low === 'enabled' || low === 'on') return true;
    if (low === 'false' || low === 'no' || low === 'disabled' || low === 'off') return false;
  }
  return null;
}

/**
 * Expanded distribution + royalty programs for one marketplace block.
 * Returns null expandedDistribution when KDP does not expose a clear signal.
 */
export function parseDistributionFromSetupPage(json, marketplaceKey = 'US') {
  const root = unwrapKdpSetupPageJson(json);
  if (!root) {
    return {
      marketplace: normalizeMarketplaceKey(marketplaceKey),
      expandedDistribution: null,
      royaltyPrograms: [],
      expandedPrograms: [],
      territories: [],
    };
  }

  const { resolvedKey, specBlock } = readPricingBlocksForKey(root, marketplaceKey);
  const programs = specBlock?.programs && typeof specBlock.programs === 'object'
    ? specBlock.programs
    : {};
  const royaltyPrograms = Object.keys(programs);
  let expandedPrograms = royaltyPrograms.filter((key) => {
    const upper = String(key || '').toUpperCase();
    if (upper === 'RETAIL') return false;
    return EXPANDED_DISTRIBUTION_PROGRAM_RE.test(key);
  });

  const enrollmentSignal = readExpandedDistributionEnrollment(root, marketplaceKey);
  let expandedDistribution = enrollmentSignal?.expandedDistribution ?? null;
  if (enrollmentSignal?.expandedPrograms?.length) {
    expandedPrograms = [...new Set([...expandedPrograms, ...enrollmentSignal.expandedPrograms])];
  }

  const book = root.book && typeof root.book === 'object' ? root.book : {};
  if (expandedDistribution == null) {
    const boolHints = [
      book.expandedDistribution,
      book.expandedDistributionEnabled,
      book.distribution?.expandedDistribution,
      book.distribution?.expandedDistributionEnabled,
      root.distribution?.expandedDistribution,
      root.distribution?.expandedDistributionEnabled,
      root.rights?.expandedDistribution,
      specBlock?.expandedDistribution,
      specBlock?.expandedDistributionEnabled,
    ].map(readBooleanHint);
    for (const hint of boolHints) {
      if (hint != null) {
        expandedDistribution = hint;
        break;
      }
    }
  }
  if (expandedDistribution == null && expandedPrograms.length > 0) {
    const enrollmentBlock = readProgramEnrollmentBlock(root, marketplaceKey);
    if (!enrollmentBlock) {
      expandedDistribution = true;
    }
  }

  const territories = readMarketplaceTerritories(root, marketplaceKey);

  return {
    marketplace: resolvedKey,
    expandedDistribution,
    royaltyPrograms,
    expandedPrograms,
    territories,
  };
}

/** Parse calculator pricing for every marketplace block in one get-setup-page payload. */
export function parseAllMarketplacePricingFromSetupPage(json, preferredKey = 'US') {
  const root = unwrapKdpSetupPageJson(json);
  if (!root) return [];

  const rawKeys = listSetupPageMarketplaceKeys(json);
  const seen = new Set();
  const rows = [];

  for (const rawKey of rawKeys) {
    const pricing = parsePricingFromBlocks(root, rawKey);
    if (!hasKdpSetupPagePricing(pricing)) continue;
    const mk = normalizeMarketplaceKey(pricing.marketplace || rawKey);
    if (seen.has(mk)) continue;
    seen.add(mk);
    const distribution = parseDistributionFromSetupPage(json, rawKey);
    rows.push({
      ...pricing,
      marketplace: mk,
      expandedDistribution: distribution.expandedDistribution,
      royaltyPrograms: distribution.royaltyPrograms,
      expandedPrograms: distribution.expandedPrograms,
      territories: distribution.territories,
    });
  }

  const preferred = normalizeMarketplaceKey(preferredKey);
  rows.sort((a, b) => {
    if (a.marketplace === preferred) return -1;
    if (b.marketplace === preferred) return 1;
    return a.marketplace.localeCompare(b.marketplace);
  });
  return rows;
}

export function pickPrimaryMarketplacePricing(allRows, preferredKey = 'US') {
  const rows = Array.isArray(allRows) ? allRows : [];
  if (rows.length === 0) return null;
  const preferred = normalizeMarketplaceKey(preferredKey);
  return rows.find((row) => row.marketplace === preferred)
    || rows.find((row) => row.marketplace === 'US')
    || rows[0]
    || null;
}

/** Setup ids that only appear as dual-print-price-asin widgets, not href pairing. */
export function collectWidgetOnlySetupIds(html, setupByAsin = new Map()) {
  const hrefIds = new Set(
    [...(setupByAsin instanceof Map ? setupByAsin.values() : [])]
      .map((id) => String(id || '').trim().toUpperCase())
      .filter(looksLikeKdpSetupBookId),
  );
  const text = String(html || '');
  for (const link of extractPrintSetupLinksFromHtml(text)) {
    if (link.format !== 'paperback') continue;
    const id = String(link.kdpBookId || '').trim().toUpperCase();
    if (looksLikeKdpSetupBookId(id)) hrefIds.add(id);
  }
  if (hrefIds.size === 0) return new Set();

  const widgetIds = new Set();
  const re = /dual-print-price-asin-([A-Z0-9]+)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const id = String(match[1] || '').trim().toUpperCase();
    if (looksLikeKdpSetupBookId(id)) widgetIds.add(id);
  }
  const widgetOnly = new Set();
  for (const id of widgetIds) {
    if (!hrefIds.has(id)) widgetOnly.add(id);
  }
  return widgetOnly;
}

/**
 * Drop duplicate/wrong setup IDs per ASIN and orphan widget IDs that bookshelf
 * pairing already resolved to a different print-setup href id.
 */
export function dedupePricingCandidates(candidates, options = {}) {
  const pairMaps = options?.pairMaps || {};
  const setupByAsin = pairMaps?.setupByAsin instanceof Map ? pairMaps.setupByAsin : new Map();
  const storedSetupByAsin = options?.storedSetupByAsin instanceof Map
    ? options.storedSetupByAsin
    : new Map();
  const widgetOnlyIds = collectWidgetOnlySetupIds(options?.bookshelfHtml, setupByAsin);

  const trustedSetupIds = new Set();
  for (const setupId of setupByAsin.values()) {
    const id = String(setupId || '').trim().toUpperCase();
    if (looksLikeKdpSetupBookId(id)) trustedSetupIds.add(id);
  }
  for (const [asin, setupId] of storedSetupByAsin.entries()) {
    const id = String(setupId || '').trim().toUpperCase();
    if (!looksLikeKdpSetupBookId(id)) continue;
    const paired = String(setupByAsin.get(asin) || '').trim().toUpperCase();
    if (paired && paired !== id) continue;
    trustedSetupIds.add(id);
  }

  const bestByAsin = new Map();
  const orphans = [];

  for (const candidate of candidates || []) {
    const asin = String(candidate?.asin || '').trim().toUpperCase();
    const setupId = String(candidate?.kdpBookId || '').trim().toUpperCase();
    if (!looksLikeKdpSetupBookId(setupId)) continue;
    if (widgetOnlyIds.has(setupId)) continue;

    if (!asin) {
      orphans.push(candidate);
      continue;
    }

    const preferred = String(
      setupByAsin.get(asin) || storedSetupByAsin.get(asin) || '',
    ).trim().toUpperCase();
    if (preferred && preferred !== setupId) continue;

    const existing = bestByAsin.get(asin);
    if (!existing) {
      bestByAsin.set(asin, candidate);
      continue;
    }
    const existingId = String(existing?.kdpBookId || '').trim().toUpperCase();
    if (preferred && existingId !== preferred && setupId === preferred) {
      bestByAsin.set(asin, candidate);
    }
  }

  const out = [...bestByAsin.values()];
  const pairedSetupIds = new Set(
    out.map((candidate) => String(candidate?.kdpBookId || '').trim().toUpperCase()).filter(Boolean),
  );
  for (const candidate of orphans) {
    const setupId = String(candidate?.kdpBookId || '').trim().toUpperCase();
    if (!looksLikeKdpSetupBookId(setupId)) continue;
    if (widgetOnlyIds.has(setupId)) continue;
    if (pairedSetupIds.has(setupId)) continue;
    if (trustedSetupIds.size > 0 && !trustedSetupIds.has(setupId)) continue;
    out.push(candidate);
    pairedSetupIds.add(setupId);
  }

  return out;
}

/** Prefer paired ASIN candidates before orphan setup IDs for probe/fetch order. */
export function sortPricingCandidatesForFetch(candidates) {
  return [...(candidates || [])].sort((a, b) => {
    const aAsin = looksLikeAmazonAsin(a?.asin);
    const bAsin = looksLikeAmazonAsin(b?.asin);
    if (aAsin !== bAsin) return aAsin ? -1 : 1;
    return String(a?.kdpBookId || '').localeCompare(String(b?.kdpBookId || ''));
  });
}

/** Dev dump: parsed summary + optional raw JSON envelope. */
export function buildSetupPageDump(json, meta = {}) {
  const summary = summarizeKdpSetupPageJson(json);
  const allMarketplaces = parseAllMarketplacePricingFromSetupPage(json, meta?.marketplaceKey || 'US');
  const primary = pickPrimaryMarketplacePricing(allMarketplaces, meta?.marketplaceKey || 'US');
  return {
    ...meta,
    jsonSummary: summary,
    primaryMarketplace: primary?.marketplace || null,
    marketplaceCount: allMarketplaces.length,
    allMarketplaces,
    distributionByMarketplace: allMarketplaces.map((row) => ({
      marketplace: row.marketplace,
      expandedDistribution: row.expandedDistribution,
      royaltyPrograms: row.royaltyPrograms,
      expandedPrograms: row.expandedPrograms,
      territories: row.territories,
    })),
    raw: json ?? null,
  };
}

export function normalizePricingTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prefer the edition whose title best matches the get-setup-page book title. */
export function scorePricingTitleMatch(needle, candidate) {
  const a = normalizePricingTitle(needle);
  const b = normalizePricingTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 10_000;

  const aFirst = a.split(' ').filter(Boolean)[0] || '';
  const bFirst = b.split(' ').filter(Boolean)[0] || '';
  if (!aFirst || aFirst !== bFirst) return 0;

  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (longer.startsWith(shorter) && shorter.length >= 12) {
    return shorter.length * 10;
  }
  return 0;
}

export function extractYearToken(title) {
  const match = normalizePricingTitle(title).match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

/** Title stem with edition year removed — for shared print-setup siblings (e.g. 2025 vs 2026). */
export function stripEditionYearFromTitle(title) {
  return normalizePricingTitle(title).replace(/\b20\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export function looksLikeAmazonAsin(value) {
  const asin = String(value || '').trim().toUpperCase();
  if (/^B0[A-Z0-9]{8}$/.test(asin)) return true;
  // Printed books can use their ISBN-10 as the Amazon ASIN, including an X
  // check digit. Validate it rather than accepting arbitrary numeric setup ids.
  if (!/^[0-9]{9}[0-9X]$/.test(asin) || /^0{9}/.test(asin)) return false;
  const checksum = [...asin].reduce((sum, digit, index) =>
    sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
  return checksum % 11 === 0;
}

/** Read paperback ASIN from get-setup-page JSON when KDP exposes it. */
export function extractAsinFromSetupPageJson(json) {
  if (!json || typeof json !== 'object') return null;
  const direct = [
    json?.book?.asin,
    json?.book?.printAsin,
    json?.book?.paperbackAsin,
    json?.asin,
    json?.bookDetails?.asin,
    json?.titleDetails?.asin,
    json?.book?.marketplaceMetadata?.asin,
  ];
  for (const raw of direct) {
    const asin = String(raw || '').trim().toUpperCase();
    if (looksLikeAmazonAsin(asin)) return asin;
  }

  const visit = (node, depth = 0) => {
    if (!node || depth > 6) return null;
    if (typeof node === 'string') {
      const asin = String(node || '').trim().toUpperCase();
      return looksLikeAmazonAsin(asin) ? asin : null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = visit(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (/asin/i.test(key)) {
          const asin = String(value || '').trim().toUpperCase();
          if (looksLikeAmazonAsin(asin)) return asin;
        }
      }
      for (const value of Object.values(node)) {
        const hit = visit(value, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };

  return visit(json.book) || visit(json);
}

/**
 * Pick the ASIN row whose catalog title matches the calculator book title.
 * Avoids attaching 2025 pricing to a 2026 edition when both share a country name.
 */
export function pickBestAsinRowForBookTitle(rows, bookTitle) {
  const needle = String(bookTitle || '').trim();
  if (!needle || !Array.isArray(rows) || rows.length === 0) return null;

  const needleYear = extractYearToken(needle);
  let best = null;
  let bestScore = 0;

  for (const row of rows) {
    const asin = String(row?.asin || '').trim().toUpperCase();
    const title = String(row?.title || row?.titleName || '').trim();
    if (!looksLikeAmazonAsin(asin) || !title) continue;

    let score = scorePricingTitleMatch(needle, title);
    if (score <= 0) continue;

    const rowYear = extractYearToken(title);
    if (needleYear && rowYear) {
      score += needleYear === rowYear ? 500 : -1000;
    }

    if (score > bestScore) {
      bestScore = score;
      best = asin;
    }
  }

  return bestScore > 0 ? best : null;
}

export function pickBestPrintAsinForBookTitle(candidates, bookTitle) {
  const rows = (candidates || []).map((item) => ({
    asin: item?.asin || item?.printAsin || null,
    title: item?.title || item?.titleName || null,
  }));
  return pickBestAsinRowForBookTitle(rows, bookTitle);
}

/** Build bidirectional maps from bookshelf DOM rows (setup ID ↔ paperback ASIN). */
export function buildPrintSetupPairMaps(pairs, options = {}) {
  const widgetOnlyIds = options?.widgetOnlyIds instanceof Set ? options.widgetOnlyIds : new Set();
  const asinBySetupId = new Map();
  const setupByAsin = new Map();

  const preferSetupId = (currentId, nextId) => {
    const current = String(currentId || '').trim().toUpperCase();
    const next = String(nextId || '').trim().toUpperCase();
    if (!looksLikeKdpSetupBookId(next)) return false;
    if (!looksLikeKdpSetupBookId(current)) return true;
    if (current === next) return false;
    const currentWidget = widgetOnlyIds.has(current);
    const nextWidget = widgetOnlyIds.has(next);
    if (currentWidget && !nextWidget) return true;
    return false;
  };

  for (const row of pairs || []) {
    const setupId = String(row?.kdpBookId || row?.setupId || '').trim().toUpperCase();
    const asin = String(row?.printAsin || row?.asin || '').trim().toUpperCase();
    const title = String(row?.title || row?.titleName || '').trim() || null;
    if (!looksLikeKdpSetupBookId(setupId)) continue;

    if (looksLikeAmazonAsin(asin)) {
      const existing = setupByAsin.get(asin);
      if (!existing || preferSetupId(existing, setupId)) {
        setupByAsin.set(asin, setupId);
      }
      const prev = asinBySetupId.get(setupId);
      if (!prev?.asin) {
        asinBySetupId.set(setupId, { asin, title });
      } else if (title && scorePricingTitleMatch(title, prev.title || '') > 0) {
        asinBySetupId.set(setupId, { asin, title });
      }
    } else if (!asinBySetupId.has(setupId)) {
      asinBySetupId.set(setupId, { asin: null, title });
    }
  }

  return { asinBySetupId, setupByAsin };
}

/** Prefer explicit bookshelf DOM mapping over fuzzy DB title matching. */
export function resolveAsinFromSetupPairMaps(setupId, bookTitle, maps) {
  const id = String(setupId || '').trim().toUpperCase();
  if (!looksLikeKdpSetupBookId(id)) return null;
  const hit = maps?.asinBySetupId?.get(id);
  if (!hit?.asin || !looksLikeAmazonAsin(hit.asin)) return null;

  const needleYear = extractYearToken(bookTitle);
  const mappedYear = extractYearToken(hit.title);
  if (needleYear && mappedYear && needleYear !== mappedYear) return null;
  if (bookTitle && hit.title && scorePricingTitleMatch(bookTitle, hit.title) <= 0) {
    if (needleYear && mappedYear && needleYear === mappedYear) return hit.asin;
    return null;
  }
  return hit.asin;
}

/** Extract KDP internal print/title-setup IDs from bookshelf HTML (offline / HAR tests). */
export function extractPrintSetupLinksFromHtml(html) {
  const text = String(html || '');
  const out = [];
  const seen = new Set();
  const patterns = [
    /\/(?:print|title)-setup\/(paperback|hardcover)\/([A-Z0-9]+)/gi,
    /\/(?:print|title)-setup\/print-book\/([A-Z0-9]+)\/(paperback|hardcover)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      let format;
      let kdpBookId;
      if (m[2] === 'paperback' || m[2] === 'hardcover') {
        kdpBookId = String(m[1] || '').toUpperCase();
        format = String(m[2]).toLowerCase();
      } else {
        format = String(m[1] || '').toLowerCase();
        kdpBookId = String(m[2] || '').toUpperCase();
      }
      const key = `${format}:${kdpBookId}`;
      if (!kdpBookId || seen.has(key)) continue;
      seen.add(key);
      out.push({ format, kdpBookId, url: buildKdpGetSetupPageUrl(kdpBookId, format) });
    }
  }
  return out;
}

/** KDP internal print-setup / bookshelf title ids (e.g. P3BWZSWT3DH, 2RZKVQBNHD8). */
export function looksLikeKdpSetupBookId(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!id || id.length < 8 || id.length > 16) return false;
  if (!/^[A-Z0-9][A-Z0-9]+$/.test(id)) return false;
  if (looksLikeAmazonAsin(id)) return false;
  return true;
}

const BOOKSHELF_AMOUNT_RE = /[0-9]{1,3}(?:[.,][0-9]{3})+[.,][0-9]{2}|[0-9]{1,6}[.,][0-9]{2}/g;
const BOOKSHELF_WHOLE_CURRENCY_RE = /(?:US\$|CA\$|C\$|AU\$|A\$|[$€£¥])\s*([0-9]{1,6})(?![0-9.,])|([0-9]{1,6})\s*(?:USD|EUR|GBP|JPY|CAD|AUD|INR|MXN|BRL|PLN|SEK)\b/i;
/** Visible status words only — not hyphenated HTML ids like status-live-status. */
const BOOKSHELF_STATUS_LABEL_RE = /(?:^|[>\s"'=])(LIVE|ONLINE|DRAFT|BOZZA|UNPUBLISHED|PUBLISHED|IN\s*REVIEW|PUBLISHING|ACTION\s*REQUIRED)(?=$|[\s<"'/])/i;

export function parseBookshelfLocaleNumber(raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) return Number(s.replace(/\./g, '').replace(',', '.'));
    return Number(s.replace(/,/g, ''));
  }
  if (lastComma >= 0) {
    const frac = s.slice(lastComma + 1);
    if (frac.length === 3 && lastComma > 0) return Number(s.replace(/,/g, ''));
    return Number(s.replace(',', '.'));
  }
  if (lastDot >= 0) {
    const frac = s.slice(lastDot + 1);
    if (frac.length === 3 && /^\d{1,3}(?:\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
    return Number(s);
  }
  return Number(s);
}

export function parseBookshelfDisplayedMoney(text) {
  const s = String(text || '');
  if (!s.trim()) return { displayedPrice: null, currency: null };
  let currency = null;
  // Prefer the ISO code rendered by KDP. A bare "$" is deliberately not
  // treated as USD: US, Canada and Australia all use a dollar symbol, and a
  // wrong marketplace would corrupt the cached royalty inputs used for BE ACoS.
  const iso = s.match(/\b(USD|CAD|AUD|EUR|GBP|JPY|INR|MXN|BRL|PLN|SEK)\b/i);
  if (iso) currency = String(iso[1]).toUpperCase();
  else if (/US\s*\$/i.test(s)) currency = 'USD';
  else if (/(?:CA|C)\s*\$/i.test(s)) currency = 'CAD';
  else if (/(?:AU|A)\s*\$/i.test(s)) currency = 'AUD';
  else if (/€/.test(s)) currency = 'EUR';
  else if (/£/.test(s)) currency = 'GBP';
  else if (/¥/.test(s)) currency = 'JPY';
  const tokens = Array.from(s.matchAll(BOOKSHELF_AMOUNT_RE));
  let rawAmount = null;
  if (tokens.length === 1) {
    rawAmount = tokens[0][0];
  } else if (tokens.length > 1) {
    const scored = tokens.map((m) => {
      const around = s.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6);
      return {
        raw: m[0],
        score: /[$€£¥]|(?:US|CA|C|AU|A)\$|USD|EUR|GBP|JPY|CAD|AUD|INR|MXN|BRL|PLN|SEK/i.test(around) ? 2 : 1,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    rawAmount = scored[0].raw;
  } else {
    const whole = s.match(BOOKSHELF_WHOLE_CURRENCY_RE);
    rawAmount = whole?.[1] || whole?.[2] || null;
  }
  if (!rawAmount) return { displayedPrice: null, currency };
  const num = parseBookshelfLocaleNumber(rawAmount);
  if (!Number.isFinite(num) || num < 0 || num > 999999) {
    return { displayedPrice: null, currency: null };
  }
  return {
    displayedPrice: num.toFixed(2),
    currency,
  };
}

export function parseBookshelfPrintStatus(text) {
  const s = String(text || '');
  const m = s.match(BOOKSHELF_STATUS_LABEL_RE);
  if (!m) return null;
  const raw = String(m[1] || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw.includes('unpublish')) return 'unpublished';
  if (raw.includes('draft') || raw === 'bozza') return 'draft';
  if (raw.includes('review') || raw.includes('publishing')) return 'in_review';
  if (raw.includes('action')) return 'action_required';
  if (raw === 'online' || raw === 'live' || raw === 'published') return 'live';
  return null;
}

export function extractSetupIdFromBookshelfWidgetId(id, kind) {
  const raw = String(id || '');
  const needle = String(kind || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = raw.match(new RegExp(`${needle}-([A-Z0-9]+)$`, 'i'));
  const setupId = m?.[1] ? String(m[1]).toUpperCase() : '';
  return looksLikeKdpSetupBookId(setupId) ? setupId : null;
}

export function extractAsinFromBookshelfWidgetText(text) {
  const m = String(text || '').match(/ASIN:\s*([A-Z0-9]{10})/i);
  const asin = m?.[1] ? String(m[1]).toUpperCase() : '';
  return looksLikeAmazonAsin(asin) ? asin : null;
}

function bookshelfWidgetInnerText(html, idNeedle) {
  const text = String(html || '');
  const needle = String(idNeedle || '');
  if (!needle) return '';
  const idx = text.indexOf(needle);
  if (idx < 0) return '';
  const gt = text.indexOf('>', idx);
  const start = gt >= 0 && gt - idx < 160 ? gt + 1 : idx + needle.length;
  let end = Math.min(text.length, start + 240);
  const nextDouble = text.indexOf('id="', start);
  const nextSingle = text.indexOf("id='", start);
  const nextId = [nextDouble, nextSingle].filter((n) => n >= 0).sort((a, b) => a - b)[0];
  if (nextId != null) end = Math.min(end, nextId);
  const close = text.indexOf('</', start);
  if (close >= 0) end = Math.min(end, close);
  return text.slice(start, end);
}

function collectSetupIdsFromWidgetKind(html, kind) {
  const ids = new Set();
  const re = new RegExp(`${kind}-([A-Z0-9]+)`, 'gi');
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const id = String(m[1] || '').toUpperCase();
    if (looksLikeKdpSetupBookId(id)) ids.add(id);
  }
  return ids;
}

export function inferBookshelfPrintStatusFromHtml(html, setupId) {
  const text = String(html || '');
  const id = String(setupId || '').trim().toUpperCase();
  if (!id) return null;
  if (new RegExp(`dual-print-status-live-status[^"'\\s>]*${id}`, 'i').test(text)) return 'live';
  if (new RegExp(`dual-print-status-draft[^"'\\s>]*${id}`, 'i').test(text)) return 'draft';
  const label = bookshelfWidgetInnerText(text, `dual-print-status-live-status-popover-${id}-label`)
    || bookshelfWidgetInnerText(text, `dual-print-status-format-${id}`);
  return parseBookshelfPrintStatus(label);
}

/**
 * Parse modern KDP bookshelf HTML by stable setupId widgets.
 * Print ASIN and print price are joined independently of DOM order.
 * Digital widgets never become print rows. Hardcover CTAs are ignored.
 */
export function extractBookshelfPrintRowsFromHtml(html) {
  const text = String(html || '');
  const out = [];
  const seen = new Set();
  const add = (kdpBookId, printAsin, extras = {}) => {
    const id = String(kdpBookId || '').trim().toUpperCase();
    const asin = printAsin ? String(printAsin).trim().toUpperCase() : null;
    if (!looksLikeKdpSetupBookId(id)) return;
    if (asin && extras.digitalAsin && asin === extras.digitalAsin) return;
    const key = asin ? `${id}:${asin}` : id;
    if (seen.has(key)) return;
    seen.add(key);
    const money = extras.displayedPrice
      ? { displayedPrice: extras.displayedPrice, currency: extras.currency || null }
      : parseBookshelfDisplayedMoney(extras.text || extras.priceText || '');
    out.push({
      kdpBookId: id,
      printAsin: asin,
      digitalAsin: extras.digitalAsin || null,
      displayedPrice: money.displayedPrice || null,
      currency: money.currency || extras.currency || null,
      printStatus: extras.printStatus || parseBookshelfPrintStatus(extras.statusText || extras.text || ''),
    });
  };

  const setupIds = new Set([
    ...collectSetupIdsFromWidgetKind(text, 'dual-print-price-asin'),
    ...collectSetupIdsFromWidgetKind(text, 'dual-print-price-list-price'),
  ]);

  for (const setupId of setupIds) {
    const printSnippet = bookshelfWidgetInnerText(text, `dual-print-price-asin-${setupId}`);
    const priceSnippet = bookshelfWidgetInnerText(text, `dual-print-price-list-price-${setupId}`);
    const digitalSnippet = bookshelfWidgetInnerText(text, `dual-digital-price-asin-${setupId}`);
    const printAsin = extractAsinFromBookshelfWidgetText(printSnippet);
    const digitalAsin = extractAsinFromBookshelfWidgetText(digitalSnippet);
    if (!printAsin || (digitalAsin && printAsin === digitalAsin)) continue;
    const fromPrice = parseBookshelfDisplayedMoney(priceSnippet);
    const fromAsinWidget = parseBookshelfDisplayedMoney(printSnippet);
    const resolvedId = resolvePrintSetupBookIdForAsinBlock(text, printAsin, setupId);
    add(resolvedId || setupId, printAsin, {
      digitalAsin,
      displayedPrice: fromPrice.displayedPrice || fromAsinWidget.displayedPrice || null,
      currency: fromPrice.currency || fromAsinWidget.currency || null,
      printStatus: inferBookshelfPrintStatusFromHtml(text, setupId)
        || parseBookshelfPrintStatus(printSnippet)
        || parseBookshelfPrintStatus(priceSnippet),
    });
  }

  for (const link of extractPrintSetupLinksFromHtml(text)) {
    if (link.format === 'paperback') add(link.kdpBookId, null);
  }

  return out;
}

function addPrintSetupLink(links, seen, format, kdpBookId) {
  const id = String(kdpBookId || '').trim().toUpperCase();
  const fmt = String(format || 'paperback').toLowerCase();
  if (!looksLikeKdpSetupBookId(id)) return;
  const key = `${fmt}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  links.push({ format: fmt, kdpBookId: id, url: buildKdpGetSetupPageUrl(id, fmt) });
}

/** Walk arbitrary KDP JSON and collect setup-book ids from URLs and known fields. */
export function extractPrintSetupIdsFromJsonDeep(json) {
  const links = [];
  const seen = new Set();
  const visit = (node) => {
    if (node == null) return;
    if (typeof node === 'string') {
      for (const link of extractPrintSetupLinksFromHtml(node)) {
        addPrintSetupLink(links, seen, link.format, link.kdpBookId);
      }
      const blockRe = /dual-print-price-asin-([A-Z0-9]+)/gi;
      let m;
      while ((m = blockRe.exec(node)) !== null) {
        addPrintSetupLink(links, seen, 'paperback', m[1]);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      const id = node.id ?? node.bookId ?? node.titleId ?? node.setupBookId
        ?? node.printBookId ?? node.paperbackBookId ?? node.kdpBookId;
      if (looksLikeKdpSetupBookId(id)) {
        const fmt = String(node.format || node.bookFormat || 'paperback').toLowerCase();
        addPrintSetupLink(links, seen, fmt.includes('hard') ? 'hardcover' : 'paperback', id);
      }
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(json);
  return links;
}

/** Print/title-setup href id from a bookshelf row fragment (Rights & Pricing link). */
export function extractPrintSetupHrefIdFromFragment(fragment) {
  const near = extractPrintSetupLinksFromHtml(String(fragment || ''))
    .find((l) => l.format === 'paperback');
  return near?.kdpBookId ? String(near.kdpBookId).toUpperCase() : null;
}

/** Match a print/title-setup paperback href only on the same bookshelf row as the ASIN. */
export function extractPrintSetupHrefIdCoLocatedWithAsin(fragment, asin, maxGap = 900) {
  const a = String(asin || '').trim().toUpperCase();
  const text = String(fragment || '');
  if (!a || !text || !looksLikeAmazonAsin(a)) return null;
  const gap = Math.max(120, Math.min(Number(maxGap) || 900, 2000));
  const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hrefPath = String.raw`\/(?:print|title)-setup\/(?:paperback\/([A-Z0-9]+)|print-book\/([A-Z0-9]+)\/paperback)`;
  const idFromHit = (hit) => hit?.[1] || hit?.[2] || null;

  const forward = new RegExp(
    `ASIN:\\s*${esc}(?![A-Z0-9])[\\s\\S]{0,${gap}}?${hrefPath}`,
    'i',
  );
  const fHit = forward.exec(text);
  const forwardId = idFromHit(fHit);
  if (forwardId && looksLikeKdpSetupBookId(forwardId)) {
    return String(forwardId).toUpperCase();
  }

  const backward = new RegExp(
    `${hrefPath}[\\s\\S]{0,${gap}}?ASIN:\\s*${esc}(?![A-Z0-9])`,
    'i',
  );
  const bHit = backward.exec(text);
  const backwardId = idFromHit(bHit);
  if (backwardId && looksLikeKdpSetupBookId(backwardId)) {
    return String(backwardId).toUpperCase();
  }

  return null;
}

/**
 * Prefer print-setup href ids over dual-print-price-asin widget ids.
 * KDP can expose different internal ids in the price widget vs print-setup URLs.
 */
export function resolvePrintSetupBookIdForAsinBlock(html, asin, widgetId = null) {
  const a = String(asin || '').trim().toUpperCase();
  const text = String(html || '');
  const widget = String(widgetId || '').trim().toUpperCase();
  if (!a || !text) return widget || null;

  const coLocated = extractPrintSetupHrefIdCoLocatedWithAsin(text, a);
  if (coLocated) return coLocated;

  if (widget && looksLikeKdpSetupBookId(widget)) return widget;
  return null;
}

/** Find print-setup book id in HTML near a paperback ASIN occurrence. */
export function extractSetupIdNearAsin(html, asin) {
  const a = String(asin || '').trim().toUpperCase();
  const text = String(html || '');
  if (!a || !text) return null;

  let idx = text.indexOf(a);
  while (idx >= 0) {
    const window = text.slice(Math.max(0, idx - 400), idx + 1000);
    const hrefId = extractPrintSetupHrefIdCoLocatedWithAsin(window, a);
    if (hrefId) return hrefId;
    idx = text.indexOf(a, idx + 1);
  }

  const directRe = new RegExp(
    `dual-print-price-asin-([A-Z0-9]+)[\\s\\S]{0,360}?ASIN:\\s*${a}`,
    'gi',
  );
  const direct = directRe.exec(text);
  if (direct?.[1] && looksLikeKdpSetupBookId(direct[1])) {
    return resolvePrintSetupBookIdForAsinBlock(text, a, direct[1]);
  }

  idx = text.indexOf(a);
  while (idx >= 0) {
    const window = text.slice(Math.max(0, idx - 1200), idx + 2400);
    const modern = extractBookshelfPrintRowsFromHtml(window).find(
      (row) => row.printAsin === a || !row.printAsin,
    );
    if (modern?.kdpBookId) return String(modern.kdpBookId).toUpperCase();
    idx = text.indexOf(a, idx + 1);
  }
  return null;
}

/**
 * Authoritative marketplace pricing / royalty / BE may propagate to a peer ASIN
 * only when both sides have a real non-null matching kdp_setup_book_id.
 * Title-stem / edition-year collisions are not economic provenance.
 */
export function canPropagateAuthoritativePricingToPeer({
  sourceSetupId,
  peerSetupId,
} = {}) {
  const source = String(sourceSetupId || '').trim().toUpperCase();
  const peer = String(peerSetupId || '').trim().toUpperCase();
  if (!looksLikeKdpSetupBookId(source)) return false;
  if (!looksLikeKdpSetupBookId(peer)) return false;
  return source === peer;
}

/** Keep only peer ASINs with proven shared KDP setup identity. */
export function selectProvenSetupPeerAsins({
  sourceSetupId,
  candidateAsins,
  setupByAsin,
} = {}) {
  const source = String(sourceSetupId || '').trim().toUpperCase();
  if (!looksLikeKdpSetupBookId(source)) return [];
  const map = setupByAsin instanceof Map ? setupByAsin : new Map();
  const out = [];
  const seen = new Set();
  for (const raw of candidateAsins || []) {
    const asin = String(raw || '').trim().toUpperCase();
    if (!looksLikeAmazonAsin(asin) || seen.has(asin)) continue;
    const peerSetup = String(map.get(asin) || '').trim().toUpperCase();
    if (!canPropagateAuthoritativePricingToPeer({
      sourceSetupId: source,
      peerSetupId: peerSetup,
    })) {
      continue;
    }
    seen.add(asin);
    out.push(asin);
  }
  return out;
}

/**
 * Expand marketplace pricing rows only to ASINs sharing an explicit setup id.
 * Marketplace and currency always remain those of the authoritative source row.
 */
export function expandMarketplacePricingRowsByPeerAsins({
  marketplaceRows,
  expandedTitleRows,
  setupByAsin: setupByAsinInput,
} = {}) {
  const list = Array.isArray(marketplaceRows) ? marketplaceRows.filter(Boolean) : [];
  if (list.length === 0) return [];

  const setupByAsin = setupByAsinInput instanceof Map ? new Map(setupByAsinInput) : new Map();
  for (const row of Array.isArray(expandedTitleRows) ? expandedTitleRows : []) {
    const asin = String(row?.asin || '').trim().toUpperCase();
    const setupId = String(row?.kdp_setup_book_id || '').trim().toUpperCase();
    if (!looksLikeAmazonAsin(asin) || !looksLikeKdpSetupBookId(setupId)) continue;
    setupByAsin.set(asin, setupId);
  }

  const peersBySetup = new Map();
  for (const [asin, setupId] of setupByAsin.entries()) {
    if (!looksLikeAmazonAsin(asin) || !looksLikeKdpSetupBookId(setupId)) continue;
    if (!peersBySetup.has(setupId)) peersBySetup.set(setupId, new Set());
    peersBySetup.get(setupId).add(asin);
  }

  const out = [];
  const seen = new Set();
  for (const row of list) {
    const primaryAsin = String(row?.asin || '').trim().toUpperCase();
    if (!looksLikeAmazonAsin(primaryAsin)) continue;
    const sourceSetupId = String(setupByAsin.get(primaryAsin) || '').trim().toUpperCase();
    const peerAsins = looksLikeKdpSetupBookId(sourceSetupId)
      ? [...(peersBySetup.get(sourceSetupId) || [primaryAsin])].filter((asin) =>
          canPropagateAuthoritativePricingToPeer({
            sourceSetupId,
            peerSetupId: setupByAsin.get(asin),
          }),
        )
      : [primaryAsin];

    if (looksLikeKdpSetupBookId(sourceSetupId) && !peerAsins.includes(primaryAsin)) {
      peerAsins.unshift(primaryAsin);
    }

    for (const asin of peerAsins) {
      if (
        asin !== primaryAsin
        && !canPropagateAuthoritativePricingToPeer({
          sourceSetupId,
          peerSetupId: setupByAsin.get(asin),
        })
      ) {
        continue;
      }
      const marketplace = String(row?.marketplace || '').trim().toUpperCase();
      const key = `${String(row?.account_id || '')}:${asin}:${marketplace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...row, asin, marketplace: marketplace || row?.marketplace });
    }
  }
  return out;
}
