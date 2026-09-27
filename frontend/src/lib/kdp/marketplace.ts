/** Remove only KDP Reports' marketplace filter so replay always covers all stores. */

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
