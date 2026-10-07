/** KDP Reports storefront filters and native currencies. */

export type KdpMarketplaceTarget = {
  key: string;
  filterToken: string;
  currency: string;
};

const KDP_MARKETPLACES: readonly (KdpMarketplaceTarget & { aliases: readonly string[] })[] = [
  { key: "US", filterToken: "Amazon.com", currency: "USD", aliases: ["US", "AMAZON.COM"] },
  { key: "CA", filterToken: "Amazon.ca", currency: "CAD", aliases: ["CA", "AMAZON.CA"] },
  { key: "MX", filterToken: "Amazon.com.mx", currency: "MXN", aliases: ["MX", "AMAZON.COM.MX"] },
  { key: "GB", filterToken: "Amazon.co.uk", currency: "GBP", aliases: ["GB", "UK", "AMAZON.CO.UK"] },
  { key: "DE", filterToken: "Amazon.de", currency: "EUR", aliases: ["DE", "AMAZON.DE"] },
  { key: "FR", filterToken: "Amazon.fr", currency: "EUR", aliases: ["FR", "AMAZON.FR"] },
  { key: "IT", filterToken: "Amazon.it", currency: "EUR", aliases: ["IT", "AMAZON.IT"] },
  { key: "ES", filterToken: "Amazon.es", currency: "EUR", aliases: ["ES", "AMAZON.ES"] },
  { key: "NL", filterToken: "Amazon.nl", currency: "EUR", aliases: ["NL", "AMAZON.NL"] },
  { key: "PL", filterToken: "Amazon.pl", currency: "PLN", aliases: ["PL", "AMAZON.PL"] },
  { key: "SE", filterToken: "Amazon.se", currency: "SEK", aliases: ["SE", "AMAZON.SE"] },
  { key: "BE", filterToken: "Amazon.com.be", currency: "EUR", aliases: ["BE", "AMAZON.COM.BE"] },
  { key: "IE", filterToken: "Amazon.ie", currency: "EUR", aliases: ["IE", "AMAZON.IE"] },
  { key: "AU", filterToken: "Amazon.com.au", currency: "AUD", aliases: ["AU", "AMAZON.COM.AU"] },
  { key: "JP", filterToken: "Amazon.co.jp", currency: "JPY", aliases: ["JP", "AMAZON.CO.JP"] },
  { key: "IN", filterToken: "Amazon.in", currency: "INR", aliases: ["IN", "AMAZON.IN"] },
  { key: "BR", filterToken: "Amazon.com.br", currency: "BRL", aliases: ["BR", "AMAZON.COM.BR"] },
] as const;

function normalizeMarketplaceToken(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\//, "")
    .replace(/^WWW\./, "");
}

export function resolveKdpMarketplaceTarget(raw: unknown): KdpMarketplaceTarget | null {
  const token = normalizeMarketplaceToken(raw);
  if (!token || token === "ALL" || token.includes("CREATESPACE")) return null;
  const match = KDP_MARKETPLACES.find((row) =>
    row.key === token ||
    normalizeMarketplaceToken(row.filterToken) === token ||
    row.aliases.some((alias) => normalizeMarketplaceToken(alias) === token),
  );
  return match
    ? { key: match.key, filterToken: match.filterToken, currency: match.currency }
    : null;
}

function withoutMarketplaceFilter(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMarketplaceFilter);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase();
    if (normalized === "marketplace") continue;
    out[key] = withoutMarketplaceFilter(nested);
  }
  return out;
}

function patchFilterBy(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(withoutMarketplaceFilter(parsed));
    } catch {
      return value;
    }
  }
  return withoutMarketplaceFilter(value);
}

function patchBodyObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(patchBodyObject);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key.trim().toLowerCase() === "filterby" ? patchFilterBy(nested) : patchBodyObject(nested);
  }
  return out;
}

function withMarketplaceFilter(value: unknown, target: KdpMarketplaceTarget): unknown {
  if (typeof value === "string") {
    try {
      return JSON.stringify(withMarketplaceFilter(JSON.parse(value), target));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((row) => withMarketplaceFilter(row, target));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase();
    if (normalized === "filterby") {
      let filter: Record<string, unknown> = {};
      if (typeof nested === "string") {
        try {
          const parsed = JSON.parse(nested);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filter = { ...parsed };
        } catch {
          filter = {};
        }
      } else if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        filter = { ...(nested as Record<string, unknown>) };
      }
      delete filter.marketplace;
      filter.MARKETPLACE = [target.filterToken];
      out[key] = typeof nested === "string" ? JSON.stringify(filter) : filter;
    } else if (normalized === "preferredmarketplaces") {
      out[key] = [target.filterToken];
    } else {
      out[key] = withMarketplaceFilter(nested, target);
    }
  }
  return out;
}

export function patchKdpBodyAllMarketplaces(body: string | null | undefined): string | null {
  if (body == null) return null;
  try {
    return JSON.stringify(patchBodyObject(JSON.parse(body)));
  } catch {
    return body;
  }
}

export function patchKdpUrlAllMarketplaces(urlString: string): string {
  try {
    const url = new URL(urlString);
    for (const key of [...url.searchParams.keys()]) {
      if (key.trim().toLowerCase() !== "filterby") continue;
      const current = url.searchParams.get(key);
      if (current == null) continue;
      url.searchParams.set(key, String(patchFilterBy(current)));
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

export function patchKdpBodyMarketplace(
  body: string | null | undefined,
  target: KdpMarketplaceTarget,
): string | null {
  if (body == null) return null;
  try {
    const parsed = JSON.parse(body);
    const patched = withMarketplaceFilter(parsed, target) as Record<string, unknown>;
    if (!("filterBy" in patched)) patched.filterBy = { MARKETPLACE: [target.filterToken] };
    return JSON.stringify(patched);
  } catch {
    return body;
  }
}

export function patchKdpUrlMarketplace(urlString: string, target: KdpMarketplaceTarget): string {
  try {
    const url = new URL(urlString);
    let found = false;
    for (const key of [...url.searchParams.keys()]) {
      if (key.trim().toLowerCase() !== "filterby") continue;
      found = true;
      const current = url.searchParams.get(key);
      let filter: Record<string, unknown> = {};
      try {
        const parsed = current ? JSON.parse(current) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filter = { ...parsed };
      } catch {
        filter = {};
      }
      delete filter.marketplace;
      filter.MARKETPLACE = [target.filterToken];
      url.searchParams.set(key, JSON.stringify(filter));
    }
    return url.toString();
  } catch {
    return urlString;
  }
}
