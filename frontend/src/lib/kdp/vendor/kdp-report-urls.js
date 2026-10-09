/**
 * KDP report URL helpers — KENP must use captured network templates from the
 * SPA shell at /reports/kenpc. Do not invent navigable SPA deep-links like
 * /table/titles or /marketplaceOverview (Amazon serves HTML "URL does not
 * exist" for both).
 */

export const KDP_KENP_SPA_PATHS = Object.freeze([
  'https://kdpreports.amazon.com/reports/kenpc',
  'https://kdpreports.amazon.com/reports/kenp',
]);

/**
 * Dead / invented kenp data paths. Navigating or replaying them returns HTTP
 * 200 HTML: "Sorry, the URL you requested does not exist" — not a login page
 * and not JSON report data.
 */
const OBSOLETE_KENP_DATA_PATH_RE =
  /\/reports\/kenpc?\/(?:table\/titles|marketplaceOverview(?:V2)?)(?:\/|$|\?|#)/i;

/**
 * True when the URL is a known-dead kenp data path (table/titles or the
 * royalties-style marketplaceOverview invents from 1.2.85–1.2.88).
 */
export function isObsoleteKenpDataUrl(url) {
  try {
    return OBSOLETE_KENP_DATA_PATH_RE.test(String(url || ''));
  } catch {
    return false;
  }
}

/**
 * Remap a captured kenp chart-tooltip titles URL onto a possible report data
 * endpoint. Only strips the tooltip segment under /api/reports/kenp(c) —
 * never invents SPA paths (marketplaceOverview / table/titles).
 */
export function remapKenpTitlesUrlToReportCandidates(url) {
  const src = String(url || '');
  if (!src || !/\/chart\/tooltip\/titles\b/i.test(src)) return [];
  const out = [];
  if (/\/api\/reports\/kenpc?\b/i.test(src)) {
    const next = src.replace(/\/chart\/tooltip\/titles\b/i, '');
    if (next && next !== src && !isObsoleteKenpDataUrl(next) && !out.includes(next)) {
      out.push(next);
    }
  }
  return out;
}

/**
 * Derive a kenp/kenpc URL from a sibling royalties or orders report URL by
 * swapping the report token. Prefers kenpc (current SPA token). Obsolete
 * invented paths are filtered out.
 */
export function deriveKenpUrlFromSiblingReport(url, fromToken = 'royalties') {
  const src = String(url || '');
  const from = String(fromToken || '').trim().toLowerCase();
  if (!src || !from) return [];
  const out = [];
  const replaceToken = (input, tokenFrom, tokenTo) => {
    try {
      const u = new URL(input);
      const segs = u.pathname.split('/');
      let changed = false;
      for (let i = 0; i < segs.length; i++) {
        if (String(segs[i] || '').toLowerCase() === tokenFrom) {
          segs[i] = tokenTo;
          changed = true;
        }
      }
      if (changed) {
        u.pathname = segs.join('/');
        return u.toString();
      }
    } catch {
    }
    try {
      const rx = new RegExp(`(/)${tokenFrom.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=/|$)`, 'ig');
      if (rx.test(input)) return input.replace(rx, `$1${tokenTo}`);
    } catch {
    }
    return input;
  };
  for (const toTok of ['kenpc', 'kenp']) {
    const next = replaceToken(src, from, toTok);
    if (next && next !== src && !isObsoleteKenpDataUrl(next) && !out.includes(next)) {
      out.push(next);
    }
  }
  return out;
}

/**
 * Build ordered kenp template URL candidates from stored sibling templates.
 * Only non-obsolete candidates (typically /api/reports/kenpc after a sibling
 * /api/reports/royalties swap). Never invents SPA deep-links.
 */
export function buildKenpUrlCandidatesFromTemplates(templates) {
  const t = templates && typeof templates === 'object' ? templates : {};
  const out = [];
  const pushAll = (list) => {
    for (const u of list || []) {
      const s = String(u || '');
      if (!s || isObsoleteKenpDataUrl(s) || out.includes(s)) continue;
      out.push(s);
    }
  };
  const royaltiesUrl = String(t?.royalties?.url || '');
  if (royaltiesUrl) pushAll(deriveKenpUrlFromSiblingReport(royaltiesUrl, 'royalties'));
  const ordersUrl = String(t?.orders?.url || '');
  if (ordersUrl) pushAll(deriveKenpUrlFromSiblingReport(ordersUrl, 'orders'));
  const kenpTitlesUrl = String(t?.kenp_titles?.url || '');
  if (kenpTitlesUrl) pushAll(remapKenpTitlesUrlToReportCandidates(kenpTitlesUrl));
  return out;
}

function htmlPreview(text, max = 4000) {
  try {
    return String(text || '').slice(0, max).toLowerCase();
  } catch {
    return '';
  }
}

export function looksLikeHtmlDocument(text) {
  try {
    const t = String(text || '').trim();
    if (!t) return false;
    const low = htmlPreview(t, 2000);
    if (low.includes('<html') || low.includes('<!doctype html')) return true;
    if (low.includes('<head') && low.includes('<body')) return true;
    if (low.includes('cloudflare') && low.includes('error')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Classify an HTML response body from kdpreports (or similar).
 * @returns {'login'|'not_found'|'html'|null}
 */
export function classifyKdpHtmlResponse(text) {
  try {
    if (!looksLikeHtmlDocument(text)) return null;
    const low = htmlPreview(text, 6000);
    // Amazon report SPA 404-style shell (still HTTP 200).
    if (
      low.includes('url you requested does not exist')
      || low.includes('the url you requested does not exist')
      || (low.includes('does not exist') && low.includes('navigation menu') && low.includes('reports'))
      || low.includes('please use the navigation menu to see your reports')
    ) {
      return 'not_found';
    }
    // Login / session walls — keep signals specific; generic SPA shells often
    // contain the words "sign in" in chrome/footer even when authenticated.
    if (
      low.includes('/ap/signin')
      || low.includes('id="ap_login_form"')
      || low.includes('name="signIn"')
      || low.includes('name="signin"')
      || low.includes('auth-ui') && low.includes('password')
      || (low.includes('enter your email') && low.includes('password'))
      || (low.includes('amazon sign-in') || low.includes('amazon sign in'))
    ) {
      return 'login';
    }
    return 'html';
  } catch {
    return 'html';
  }
}

/**
 * Human-readable fetch error fragment for an HTML body.
 * login → "likely logged out"; not_found → obsolete path (not logout).
 */
export function describeKdpHtmlFetchFailure(text, { label = 'report', status = 0, contentType = '', finalUrl = '' } = {}) {
  const kind = classifyKdpHtmlResponse(text) || 'html';
  const ct = contentType ? String(contentType).trim() : '';
  const fu = finalUrl ? String(finalUrl).trim() : '';
  const extra = `${status ? ` (${status})` : ''}${ct ? ` ${ct}` : ''}${fu ? ` ${fu}` : ''}`.trim();
  const suffix = extra ? `: ${extra}` : '';
  if (kind === 'login') {
    return `${label} fetch returned HTML (likely logged out)${suffix}`;
  }
  if (kind === 'not_found') {
    return `${label} fetch hit an obsolete Amazon report URL (page says URL does not exist)${suffix}`;
  }
  return `${label} fetch returned unexpected HTML${suffix}`;
}

export function isKdpLoggedOutErrorMessage(message) {
  try {
    const m = String(message || '').toLowerCase();
    if (!m) return false;
    if (m.includes('likely logged out')) return true;
    if (m.includes('appears logged out')) return true;
    if (m.includes('kdp_sign_in_required')) return true;
    if (m.includes('sign_in required') || m.includes('signin required')) return true;
    if (m.includes('amazon sign-in required') || m.includes('amazon sign in required')) return true;
    // Any Amazon auth wall URL embedded in the error (including cross-host
    // pageFetch messages that append location.href / tab.url).
    if (m.includes('/ap/signin') || m.includes('authportal')) return true;
    if (/\/ap\/(?:mfa|challenge|cvf)\b/.test(m)) return true;
    if (m.includes('amazon.') && m.includes('openid.return_to=')) return true;
    // Legacy wording before we split not_found vs login — only treat as logout
    // when there is no obsolete-URL signal.
    if (m.includes('returned html') && !m.includes('does not exist') && !m.includes('obsolete')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isObsoleteKenpUrlErrorMessage(message) {
  try {
    const m = String(message || '').toLowerCase();
    if (!m) return false;
    return m.includes('obsolete amazon report url')
      || (m.includes('does not exist') && (m.includes('kenp') || m.includes('report url')));
  } catch {
    return false;
  }
}
