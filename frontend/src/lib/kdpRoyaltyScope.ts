/**
 * Which KDP / Royaltix marketplace totals the UI may show.
 *
 * "Active" means Nest-enabled / InteliAds-enabled profiles (Amazon Profiles
 * toggles) — not the header "in view" currency chips. View is single-currency
 * and must not decide the royalty marketplace.
 *
 * US KDP royalties already include every marketplace. Adding CA (or any other
 * country) on top of US double-counts. Mixed non-US countries have no honest
 * combined total and must not invent a US number.
 *
 * Missing royalties stay unavailable (null / "—"). This helper never fabricates zeros.
 */

export type RoyaltyCountryProfile = {
  id: string;
  profile_id?: string | null;
  country_code?: string | null;
  is_enabled?: boolean | null;
};

export type KdpRoyaltyScope =
  | {
      kind: "country";
      country: string;
      reason: "single_enabled_country" | "us_covers_all_marketplaces";
      profileIds: string[];
    }
  | {
      kind: "unavailable";
      reason: "none_enabled" | "mixed_non_us";
      country: null;
      profileIds: [];
    };

/** Amazon Ads often stores United Kingdom as UK; treat GB as the same country. */
export function normalizeRoyaltyCountry(code: string | null | undefined): string | null {
  const cc = String(code || "")
    .trim()
    .toUpperCase();
  if (!cc) return null;
  if (cc === "GB") return "UK";
  return cc;
}

export function profileIsNestEnabled(profile: Pick<RoyaltyCountryProfile, "is_enabled">): boolean {
  return profile.is_enabled !== false;
}

function collectProfileIds(profiles: readonly RoyaltyCountryProfile[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const profile of profiles) {
    for (const raw of [profile.id, profile.profile_id]) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

export function enabledRoyaltyCountries(profiles: readonly RoyaltyCountryProfile[]): string[] {
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (!profileIsNestEnabled(profile)) continue;
    const country = normalizeRoyaltyCountry(profile.country_code);
    if (!country) continue;
    seen.add(country);
  }
  return [...seen].sort();
}

/**
 * Pick the single marketplace whose KDP totals may be shown.
 * Returns empty profileIds when no honest total exists.
 */
export function selectKdpRoyaltyScope(profiles: readonly RoyaltyCountryProfile[]): KdpRoyaltyScope {
  const enabled = profiles.filter(profileIsNestEnabled);
  if (!enabled.length) {
    return { kind: "unavailable", reason: "none_enabled", country: null, profileIds: [] };
  }

  const countries = enabledRoyaltyCountries(enabled);
  if (countries.length === 0) {
    return { kind: "unavailable", reason: "none_enabled", country: null, profileIds: [] };
  }

  if (countries.length === 1) {
    const country = countries[0]!;
    return {
      kind: "country",
      country,
      reason: "single_enabled_country",
      profileIds: collectProfileIds(
        enabled.filter((profile) => normalizeRoyaltyCountry(profile.country_code) === country),
      ),
    };
  }

  if (countries.includes("US")) {
    return {
      kind: "country",
      country: "US",
      reason: "us_covers_all_marketplaces",
      profileIds: collectProfileIds(
        enabled.filter((profile) => normalizeRoyaltyCountry(profile.country_code) === "US"),
      ),
    };
  }

  return { kind: "unavailable", reason: "mixed_non_us", country: null, profileIds: [] };
}

export function profilesMatchingSelection(
  profiles: readonly RoyaltyCountryProfile[],
  selectedIds: readonly string[],
): RoyaltyCountryProfile[] {
  const wanted = new Set(
    selectedIds.map((id) => String(id || "").trim()).filter(Boolean),
  );
  if (!wanted.size) return [...profiles];
  return profiles.filter((profile) => {
    const id = String(profile.id || "").trim();
    const adsId = String(profile.profile_id || "").trim();
    return (id && wanted.has(id)) || (adsId && wanted.has(adsId));
  });
}

/** Country rules on the selected (in-view) profiles only. */
export function selectKdpRoyaltyScopeForSelection(
  profiles: readonly RoyaltyCountryProfile[],
  selectedIds: readonly string[],
): KdpRoyaltyScope {
  return selectKdpRoyaltyScope(profilesMatchingSelection(profiles, selectedIds));
}

export function kdpRoyaltyProfileIdsForQuery(profiles: readonly RoyaltyCountryProfile[]): string[] {
  return selectKdpRoyaltyScope(profiles).profileIds;
}

/** Known KDP totals only. hasKdpData false must not become 0. */
export function knownKdpRoyaltyTotal(range: { hasKdpData?: boolean; totalRoyalties?: number } | null | undefined): number | null {
  if (!range?.hasKdpData) return null;
  const value = range.totalRoyalties;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
