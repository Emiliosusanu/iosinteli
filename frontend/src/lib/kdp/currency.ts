/**
 * Royaltix parity: rewrite preferredCurrency on replayed KDP requests so a
 * US-captured template still returns EUR (or USD) for the seller's view.
 */

/** Default for onboarding / first tick when Ads profiles and templates are silent. */
export const DEFAULT_KDP_REPLAY_CURRENCY = "USD" as const;

const CURRENCY_KEYS = new Set([
  "preferredcurrency",
  "preferred_currency",
  "currency",
  "currencycode",
  "currency_code",
  "defaultcurrency",
  "default_currency",
]);

export function normalizeKdpReplayCurrency(raw: string | null | undefined): "EUR" | "USD" | null {
  const c = String(raw || "")
    .trim()
    .toUpperCase();
  if (c === "EUR" || c === "USD") return c;
  return null;
}

export function preferredCurrencyFromTemplates(
  templates: Record<string, { url?: string; requestBody?: string | null } | undefined>,
): "EUR" | "USD" | null {
  for (const row of Object.values(templates)) {
    if (!row) continue;
    const blob = `${row.url || ""}\n${row.requestBody || ""}`;
    const eur = /preferredCurrency["\\\s:=]+EUR/i.test(blob) || /"currency(?:Code)?"\s*:\s*"EUR"/i.test(blob);
    const usd = /preferredCurrency["\\\s:=]+USD/i.test(blob) || /"currency(?:Code)?"\s*:\s*"USD"/i.test(blob);
    if (eur) return "EUR";
    if (usd) return "USD";
  }
  return null;
}

/** Prefer EUR when any selected Ads profile is EUR; else first known currency. */
export function preferredCurrencyFromProfiles(
  profiles: Array<{ currency_code?: string | null }>,
): "EUR" | "USD" | null {
  const codes = profiles
    .map((p) => normalizeKdpReplayCurrency(p.currency_code))
    .filter((c): c is "EUR" | "USD" => c != null);
  if (!codes.length) return null;
  if (codes.includes("EUR")) return "EUR";
  return codes[0] ?? null;
}

/**
 * Ads view currency wins over a previously saved value. Templates next.
 * Onboarding / unknown → USD (never leave preferredCurrency unset).
 */
export function resolvePreferredReplayCurrency(opts: {
  profiles: Array<{ currency_code?: string | null }>;
  templates: Record<string, { url?: string; requestBody?: string | null } | undefined>;
  saved: "EUR" | "USD" | null;
}): "EUR" | "USD" {
  return (
    preferredCurrencyFromProfiles(opts.profiles) ||
    preferredCurrencyFromTemplates(opts.templates) ||
    normalizeKdpReplayCurrency(opts.saved) ||
    DEFAULT_KDP_REPLAY_CURRENCY
  );
}

function patchJsonCurrency(value: unknown, currency: string): unknown {
  if (Array.isArray(value)) return value.map((v) => patchJsonCurrency(v, currency));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase();
    if (CURRENCY_KEYS.has(normalized)) out[key] = currency;
    else out[key] = patchJsonCurrency(nested, currency);
  }
  return out;
}

export function patchKdpUrlCurrency(urlString: string, currency: string | null | undefined): string {
  const code = normalizeKdpReplayCurrency(currency);
  if (!code) return urlString;
  try {
    const u = new URL(urlString);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      const normalized = key.trim().toLowerCase();
      if (CURRENCY_KEYS.has(normalized)) {
        u.searchParams.set(key, code);
        changed = true;
      }
    }
    // Royaltix: inject when the captured template has no currency param yet.
    if (!changed) u.searchParams.set("preferredCurrency", code);
    return u.toString();
  } catch {
    return urlString;
  }
}

function jsonHadCurrencyKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(jsonHadCurrencyKey);
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (CURRENCY_KEYS.has(key.trim().toLowerCase())) return true;
    if (jsonHadCurrencyKey(nested)) return true;
  }
  return false;
}

export function patchKdpBodyCurrency(
  body: string | null,
  currency: string | null | undefined,
): string | null {
  const code = normalizeKdpReplayCurrency(currency);
  if (!code || body == null || body === "") return body;
  try {
    const parsed = JSON.parse(body);
    let patched = patchJsonCurrency(parsed, code);
    if (
      !jsonHadCurrencyKey(parsed) &&
      patched &&
      typeof patched === "object" &&
      !Array.isArray(patched)
    ) {
      patched = { ...(patched as Record<string, unknown>), preferredCurrency: code };
    }
    return JSON.stringify(patched);
  } catch {
    return body;
  }
}
