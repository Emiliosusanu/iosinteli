/**
 * Books list / detail Ads + KDP scope.
 * Disabled Ads profiles (`is_enabled !== true`) must not contribute books.
 */

import { moneyProfileIdsForSelection, nativeCurrencyMoneyProfileIdsForSelection, profileEnabled } from "./accountsUi.ts";
import {
  isKdpOnlySessionScope,
  selectKdpRoyaltyScope,
  selectOverviewPortfolioRoyaltyScope,
  type KdpRoyaltyScope,
} from "./kdpRoyaltyScope.ts";
import type { AmazonProfile } from "./types.ts";

/** Selected profile ids that are Nest-enabled (In view ∩ Enabled). */
export function enabledSelectedProfileIds(
  profiles: readonly AmazonProfile[],
  selectedProfileIds: readonly string[],
): string[] {
  const enabled = new Set<string>();
  for (const profile of profiles) {
    if (!profileEnabled(profile)) continue;
    if (profile.id) enabled.add(profile.id);
    if (profile.profile_id) enabled.add(profile.profile_id);
  }
  return selectedProfileIds.filter((id) => enabled.has(String(id || "").trim()));
}

/** Ads money profiles for Books — currency chip ∩ enabled selection (USD includes FX markets). */
export function booksMoneyProfileIds(
  profiles: AmazonProfile[],
  selectedProfileIds: readonly string[],
): string[] {
  return moneyProfileIdsForSelection(
    profiles,
    enabledSelectedProfileIds(profiles, selectedProfileIds),
  );
}

/**
 * True when the session still has Ads profile rows (enabled or disabled).
 * Empty enabled∩selection must not be treated as a KDP-only session.
 */
function sessionHasAdsProfiles(profiles: readonly { id?: string | null; profile_id?: string | null }[]): boolean {
  return profiles.some((profile) => {
    const id = String(profile.id || "").trim();
    const adsId = String(profile.profile_id || "").trim();
    return Boolean(id || adsId);
  });
}

/**
 * When Ads exist but the money/enabled pool is empty, keep linked_profiles
 * semantics (unavailable) — never widen Gross to every owned KDP shelf.
 */
function scopeForEmptyAdsPool(
  profiles: readonly { id?: string | null; profile_id?: string | null }[],
): KdpRoyaltyScope {
  if (sessionHasAdsProfiles(profiles)) {
    return {
      kind: "unavailable",
      reason: "no_enabled_ads_profiles",
      country: null,
      profileIds: [],
    };
  }
  return selectKdpRoyaltyScope([]);
}

/**
 * Royalty country scope from native-currency Ads ids (no FX mix into KDP).
 * USD chip + CA Ads still scopes KDP to USD marketplaces only.
 */
export function booksRoyaltyScopeForSelection(
  profiles: readonly AmazonProfile[],
  selectedProfileIds: readonly string[],
): KdpRoyaltyScope {
  const enabledSelected = enabledSelectedProfileIds(profiles, selectedProfileIds);
  const nativeIds = nativeCurrencyMoneyProfileIdsForSelection(
    profiles as AmazonProfile[],
    enabledSelected,
  );
  const ids = nativeIds.length > 0 ? nativeIds : enabledSelected;
  const pool = profiles.filter((profile) => {
    if (!profileEnabled(profile)) return false;
    const id = String(profile.id || "").trim();
    const adsId = String(profile.profile_id || "").trim();
    return ids.includes(id) || (adsId !== "" && ids.includes(adsId));
  });
  if (pool.length === 0) return scopeForEmptyAdsPool(profiles);
  return selectKdpRoyaltyScope(pool);
}

/**
 * All Ads profile ids in the session (Nest-enabled + Nest-disabled / paused).
 * Overview portfolio dashboard ignores view chips and money-chip currency.
 */
export function overviewPortfolioProfileIds(
  profiles: readonly AmazonProfile[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (value: string | null | undefined) => {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const profile of profiles) {
    add(profile.id);
    add(profile.profile_id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/**
 * Overview Gross/Net royalty scope across the full Ads portfolio.
 * Includes Nest-disabled markets; never money-chip / enabled-only.
 * While any Ads rows exist, stays linked_profiles (no user_accounts widen).
 */
export function overviewRoyaltyScopeForPortfolio(
  profiles: readonly AmazonProfile[],
): KdpRoyaltyScope {
  if (!sessionHasAdsProfiles(profiles)) {
    return selectKdpRoyaltyScope([]);
  }
  return selectOverviewPortfolioRoyaltyScope(profiles);
}

/** Royalty country scope from enabled Ads profiles only. */
export function booksRoyaltyScope(profiles: readonly AmazonProfile[]): KdpRoyaltyScope {
  const enabled = profiles.filter(profileEnabled);
  if (enabled.length === 0) return scopeForEmptyAdsPool(profiles);
  return selectKdpRoyaltyScope(enabled);
}

/**
 * Overview + Books must not use `user_accounts` while any Ads profiles exist
 * (enabled or disabled) — that pulled every KDP account and leaked royalties
 * from Disabled/paused markets and unlinked shelves ($4.1K-style overcount).
 * Only true KDP-only sessions (no Ads profiles at all) use `user_accounts`.
 */
export function booksKdpQueryScope(
  scope: KdpRoyaltyScope,
): "linked_profiles" | "user_accounts" {
  if (isKdpOnlySessionScope(scope)) return "user_accounts";
  return "linked_profiles";
}

/** Drop KDP accounts that are not owned by the signed-in user. */
export function ownedKdpAccountIds(
  accounts: readonly { id?: string | null; user_id?: string | null }[],
  ownerUserId: string | null | undefined,
): string[] {
  const owner = String(ownerUserId || "").trim();
  if (!owner) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of accounts) {
    if (String(row.user_id || "").trim() !== owner) continue;
    const id = String(row.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** True while the Books list query has not settled with real data. */
export function booksListAwaitingRows(query: {
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
  /** Raw react-query `data` — do not default to []. */
  data: unknown;
}): boolean {
  if (query.isError) return false;
  if (query.data != null) return false;
  return query.isPending || query.isFetching === true;
}
