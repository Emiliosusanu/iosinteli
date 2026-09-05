/**
 * Typed allowlist for InteliAds URL schemes.
 * Maps OS / notification paths onto real Expo Router hrefs. Unknown paths
 * fall back to Overview — never to an arbitrary server URL.
 */

export const DEEP_LINK_HREFS = {
  overview: "/(tabs)",
  campaigns: "/(tabs)/campaigns",
  targeting: "/(tabs)/targeting",
  books: "/(tabs)/products",
  more: "/(tabs)/more",
  sync: "/more/sync",
  bidBot: "/more/bid-bot",
  settings: "/more/settings",
  notifications: "/more/notifications",
  accounts: "/more/accounts",
  kdpHelper: "/more/kdp-helper",
  kdpSource: "/more/kdp-source",
  automation: "/more/automation",
  ruleHistory: "/more/rule-history",
} as const;

export type DeepLinkHref = (typeof DEEP_LINK_HREFS)[keyof typeof DEEP_LINK_HREFS] | `/product/${string}`;

const ASIN_RE = /^[A-Z0-9]{8,16}$/i;

const ALIAS_TO_HREF: Record<string, string> = {
  "": DEEP_LINK_HREFS.overview,
  "/": DEEP_LINK_HREFS.overview,
  index: DEEP_LINK_HREFS.overview,
  "/index": DEEP_LINK_HREFS.overview,
  "(tabs)": DEEP_LINK_HREFS.overview,
  "/(tabs)": DEEP_LINK_HREFS.overview,
  "(tabs)/index": DEEP_LINK_HREFS.overview,
  "/(tabs)/index": DEEP_LINK_HREFS.overview,
  "tabs/index": DEEP_LINK_HREFS.overview,
  "/tabs/index": DEEP_LINK_HREFS.overview,
  overview: DEEP_LINK_HREFS.overview,
  "/overview": DEEP_LINK_HREFS.overview,
  home: DEEP_LINK_HREFS.overview,
  "/home": DEEP_LINK_HREFS.overview,
  "daily-report": DEEP_LINK_HREFS.overview,
  "/daily-report": DEEP_LINK_HREFS.overview,
  campaigns: DEEP_LINK_HREFS.campaigns,
  "/campaigns": DEEP_LINK_HREFS.campaigns,
  "(tabs)/campaigns": DEEP_LINK_HREFS.campaigns,
  "/(tabs)/campaigns": DEEP_LINK_HREFS.campaigns,
  "new-orders": DEEP_LINK_HREFS.campaigns,
  "/new-orders": DEEP_LINK_HREFS.campaigns,
  targeting: DEEP_LINK_HREFS.targeting,
  "/targeting": DEEP_LINK_HREFS.targeting,
  "(tabs)/targeting": DEEP_LINK_HREFS.targeting,
  "/(tabs)/targeting": DEEP_LINK_HREFS.targeting,
  products: DEEP_LINK_HREFS.books,
  "/products": DEEP_LINK_HREFS.books,
  books: DEEP_LINK_HREFS.books,
  "/books": DEEP_LINK_HREFS.books,
  "(tabs)/products": DEEP_LINK_HREFS.books,
  "/(tabs)/products": DEEP_LINK_HREFS.books,
  more: DEEP_LINK_HREFS.more,
  "/more": DEEP_LINK_HREFS.more,
  "(tabs)/more": DEEP_LINK_HREFS.more,
  "/(tabs)/more": DEEP_LINK_HREFS.more,
  sync: DEEP_LINK_HREFS.sync,
  "/sync": DEEP_LINK_HREFS.sync,
  "more/sync": DEEP_LINK_HREFS.sync,
  "/more/sync": DEEP_LINK_HREFS.sync,
  "bid-bot": DEEP_LINK_HREFS.bidBot,
  "/bid-bot": DEEP_LINK_HREFS.bidBot,
  bidbot: DEEP_LINK_HREFS.bidBot,
  "/bidbot": DEEP_LINK_HREFS.bidBot,
  "more/bid-bot": DEEP_LINK_HREFS.bidBot,
  "/more/bid-bot": DEEP_LINK_HREFS.bidBot,
  settings: DEEP_LINK_HREFS.settings,
  "/settings": DEEP_LINK_HREFS.settings,
  "more/settings": DEEP_LINK_HREFS.settings,
  "/more/settings": DEEP_LINK_HREFS.settings,
  notifications: DEEP_LINK_HREFS.notifications,
  "/notifications": DEEP_LINK_HREFS.notifications,
  "more/notifications": DEEP_LINK_HREFS.notifications,
  "/more/notifications": DEEP_LINK_HREFS.notifications,
  "kdp-data-stale": DEEP_LINK_HREFS.kdpSource,
  "/kdp-data-stale": DEEP_LINK_HREFS.kdpSource,
  accounts: DEEP_LINK_HREFS.accounts,
  "/accounts": DEEP_LINK_HREFS.accounts,
  "more/accounts": DEEP_LINK_HREFS.accounts,
  "/more/accounts": DEEP_LINK_HREFS.accounts,
  "kdp-helper": DEEP_LINK_HREFS.kdpHelper,
  "/kdp-helper": DEEP_LINK_HREFS.kdpHelper,
  "more/kdp-helper": DEEP_LINK_HREFS.kdpHelper,
  "/more/kdp-helper": DEEP_LINK_HREFS.kdpHelper,
  "kdp-source": DEEP_LINK_HREFS.kdpSource,
  "/kdp-source": DEEP_LINK_HREFS.kdpSource,
  "more/kdp-source": DEEP_LINK_HREFS.kdpSource,
  "/more/kdp-source": DEEP_LINK_HREFS.kdpSource,
  rules: DEEP_LINK_HREFS.ruleHistory,
  "/rules": DEEP_LINK_HREFS.ruleHistory,
  "rule-activity": DEEP_LINK_HREFS.ruleHistory,
  "/rule-activity": DEEP_LINK_HREFS.ruleHistory,
  "rule-history": DEEP_LINK_HREFS.ruleHistory,
  "/rule-history": DEEP_LINK_HREFS.ruleHistory,
  "more/rule-history": DEEP_LINK_HREFS.ruleHistory,
  "/more/rule-history": DEEP_LINK_HREFS.ruleHistory,
  automation: DEEP_LINK_HREFS.automation,
  "/automation": DEEP_LINK_HREFS.automation,
  "more/automation": DEEP_LINK_HREFS.automation,
  "/more/automation": DEEP_LINK_HREFS.automation,
};

const ALLOWED_EXACT = new Set<string>(Object.values(DEEP_LINK_HREFS));

function stripScheme(raw: string): string {
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/+/i, "");
}

export function normalizeDeepLinkPath(raw: string): string {
  let path = String(raw ?? "").trim();
  if (!path) return "";
  path = stripScheme(path);
  const q = path.indexOf("?");
  if (q >= 0) path = path.slice(0, q);
  const hash = path.indexOf("#");
  if (hash >= 0) path = path.slice(0, hash);
  path = path.replace(/^\/+/, "");
  path = path.replace(/\/+$/, "");
  return path ? `/${path}` : "";
}

function productHref(path: string): string | null {
  const match = path.match(/^\/?product\/([A-Za-z0-9]{8,16})$/);
  if (!match) return null;
  const asin = match[1].toUpperCase();
  return ASIN_RE.test(asin) ? `/product/${asin}` : null;
}

export function isAllowedAppHref(href: string): boolean {
  if (ALLOWED_EXACT.has(href)) return true;
  return productHref(href) != null;
}

/** Map an incoming OS URL or Expo path onto a real in-app href. */
export function resolveDeepLinkHref(raw: string): DeepLinkHref {
  const path = normalizeDeepLinkPath(raw);
  const aliased = ALIAS_TO_HREF[path] ?? ALIAS_TO_HREF[path.replace(/^\//, "")] ?? null;
  if (aliased && isAllowedAppHref(aliased)) return aliased as DeepLinkHref;
  const product = productHref(path);
  if (product) return product as DeepLinkHref;
  if (isAllowedAppHref(path)) return path as DeepLinkHref;
  return DEEP_LINK_HREFS.overview;
}

/** Expo Router +native-intent receives a path, not always a full URL. */
export function redirectSystemPath(path: string): string {
  return resolveDeepLinkHref(path);
}
