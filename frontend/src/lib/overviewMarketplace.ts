import type { AmazonProfile } from "./types";
import { normalizeFlagCountryCode } from "./accountsUi.ts";

export type OverviewMarketplaceSelection = string | null;

/** Choose only enabled profiles already returned for the current customer. */
export function sharedMarketProfileIds(
  profiles: readonly Pick<AmazonProfile, "id" | "country_code" | "is_enabled">[],
  country: OverviewMarketplaceSelection,
): string[] {
  const market = normalizedCountry(country);
  return profiles.filter((p) => p.is_enabled === true &&
    (!market || normalizedCountry(p.country_code) === market)).map((p) => p.id);
}

function normalizedCountry(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  return normalizeFlagCountryCode(raw) ?? raw;
}

function profileAliases(profile: Pick<AmazonProfile, "id" | "profile_id">): string[] {
  return [profile.id, profile.profile_id]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

/**
 * Narrows an existing, already-authorized Ads scope to one marketplace.
 * The returned IDs preserve the caller's ID namespace so query cache keys and
 * server authorization continue to use the same profile identifiers.
 */
export function overviewAdsProfileIdsForMarket(
  scopedProfileIds: readonly string[],
  profiles: readonly Pick<AmazonProfile, "id" | "profile_id" | "country_code">[],
  country: OverviewMarketplaceSelection,
): string[] {
  const selected = normalizedCountry(country);
  if (!selected) return [...scopedProfileIds];

  const allowedAliases = new Set<string>();
  for (const profile of profiles) {
    if (normalizedCountry(profile.country_code) !== selected) continue;
    for (const alias of profileAliases(profile)) allowedAliases.add(alias);
  }

  return scopedProfileIds.filter((id) => allowedAliases.has(String(id).trim()));
}

export function overviewMarketplaceLabel(country: OverviewMarketplaceSelection): string {
  return normalizedCountry(country) || "All markets";
}
