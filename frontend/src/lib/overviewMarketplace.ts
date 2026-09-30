import type { AmazonProfile } from "./types";

export type OverviewMarketplaceSelection = string | null;

function normalizedCountry(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
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
