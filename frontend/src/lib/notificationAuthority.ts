/**
 * Digest money scope: Overview selection ∩ activated profiles (match Home).
 * Fall back to all activated only when the header selection is empty.
 */

import { profileEnabled } from "./accountsUi.ts";
import {
  adsProfileIdsForSelection,
  uniqueProfileIds,
} from "./notificationScope.ts";

export type AuthorityProfile = {
  id: string;
  profile_id?: string | null;
  is_enabled?: boolean | null;
  currency_code?: string | null;
};

export function activatedProfileIds(profiles: readonly AuthorityProfile[]): string[] {
  return uniqueProfileIds(
    profiles
      .filter((profile) => profileEnabled(profile))
      .flatMap((profile) => [profile.id, profile.profile_id]),
  );
}

export function activatedAdsProfileIds(profiles: readonly AuthorityProfile[]): string[] {
  return uniqueProfileIds(
    profiles
      .filter((profile) => profileEnabled(profile))
      .map((profile) => profile.profile_id || profile.id),
  );
}

export function currencyCodeOfProfile(profile: Pick<AuthorityProfile, "currency_code">): string {
  const code = String(profile.currency_code || "").trim().toUpperCase();
  return code || "USD";
}

/** Activated profiles grouped by native currency. Order is first-seen. */
export function groupActivatedProfilesByCurrency<T extends AuthorityProfile>(
  profiles: readonly T[],
): { currency: string; profiles: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const profile of profiles) {
    if (!profileEnabled(profile)) continue;
    const currency = currencyCodeOfProfile(profile);
    if (!groups.has(currency)) {
      groups.set(currency, []);
      order.push(currency);
    }
    groups.get(currency)!.push(profile);
  }
  return order.map((currency) => ({ currency, profiles: groups.get(currency)! }));
}

/**
 * Ads profile ids for digest spend/orders/ACoS — same money set as Home when
 * the header has a selection; otherwise all activated.
 */
export function digestMoneyAdsProfileIds(
  selectedIds: readonly string[],
  profiles: readonly AuthorityProfile[],
): string[] {
  const activated = new Set(activatedAdsProfileIds(profiles));
  const selectedAds = adsProfileIdsForSelection(selectedIds, profiles as any);
  const scoped = selectedAds.filter((id) => activated.has(id));
  return scoped.length ? scoped : [...activated];
}

/**
 * Nest fetch groups for digests.
 * Multi-market USD chip → one Nest call (server FX rollup, same as Home).
 * Otherwise native per-currency groups among moneyAdsIds only.
 */
export function digestFetchGroupsForMoney(
  profiles: readonly AuthorityProfile[],
  moneyAdsIds: readonly string[],
  displayCurrency: string,
): { currency: string; adsIds: string[]; selectionIds: string[] }[] {
  const money = new Set(uniqueProfileIds(moneyAdsIds));
  if (!money.size) return [];
  const inMoney = profiles.filter((p) => {
    if (!profileEnabled(p)) return false;
    const ads = String(p.profile_id || p.id || "").trim();
    return ads && money.has(ads);
  });
  if (!inMoney.length) {
    return [
      {
        currency: String(displayCurrency || "USD").trim().toUpperCase() || "USD",
        adsIds: [...money],
        selectionIds: [...money],
      },
    ];
  }
  const currencies = new Set(inMoney.map((p) => currencyCodeOfProfile(p)));
  const display = String(displayCurrency || "USD").trim().toUpperCase() || "USD";
  // Home USD chip converts CAD/EUR… via Nest Frankfurter — digests must too.
  if (display === "USD" && currencies.size > 1) {
    const selectionIds = uniqueProfileIds(
      inMoney.flatMap((p) => [p.id, p.profile_id].filter(Boolean) as string[]),
    );
    return [{ currency: "USD", adsIds: [...money], selectionIds }];
  }
  return groupActivatedProfilesByCurrency(inMoney).map((group) => ({
    currency: group.currency,
    adsIds: uniqueProfileIds(group.profiles.map((p) => p.profile_id || p.id)),
    selectionIds: uniqueProfileIds(
      group.profiles.flatMap((p) => [p.id, p.profile_id].filter(Boolean) as string[]),
    ),
  }));
}

/** Native per-currency Nest groups (no USD FX rollup) for moneyAdsIds. */
export function digestNativeCurrencyFetchGroups(
  profiles: readonly AuthorityProfile[],
  moneyAdsIds: readonly string[],
): { currency: string; adsIds: string[]; selectionIds: string[] }[] {
  return digestFetchGroupsForMoney(profiles, moneyAdsIds, "___NATIVE___");
}

/** Nest hid money (FX fail-closed): mixed markets + null currency. */
export function nestMoneyHiddenForDigest(snapshot: {
  scope?: { currency?: string | null; mixedCurrency?: boolean | null } | null;
}): boolean {
  const currency = String(snapshot.scope?.currency || "").trim();
  return !!snapshot.scope?.mixedCurrency && !currency;
}

export const DIGEST_PROFILE_FRESH_MS = 36 * 60 * 60 * 1000;

export function countFreshCompletedProfiles(
  logs: ReadonlyArray<{ amazon_profile_id?: string | null; status?: string | null; completed_at?: string | null }>,
  activatedAdsIds: readonly string[],
  nowMs: number,
  freshMs = DIGEST_PROFILE_FRESH_MS,
): number {
  const latest = new Map<string, number>();
  for (const log of logs) {
    if (String(log.status || "").toLowerCase() !== "completed") continue;
    const id = String(log.amazon_profile_id || "").trim();
    const at = log.completed_at ? Date.parse(String(log.completed_at)) : Number.NaN;
    if (!id || !Number.isFinite(at)) continue;
    const prev = latest.get(id) ?? 0;
    if (at > prev) latest.set(id, at);
  }
  let count = 0;
  for (const id of uniqueProfileIds(activatedAdsIds)) {
    const at = latest.get(id);
    if (at != null && nowMs - at <= freshMs) count += 1;
  }
  return count;
}

export function digestCoverageLine(input: {
  activatedCount: number;
  updatedCount: number | null;
  currencies: readonly string[];
  displayCurrency: string;
}): string | null {
  const parts: string[] = [];
  if (
    input.updatedCount != null &&
    input.activatedCount > 0 &&
    input.updatedCount < input.activatedCount
  ) {
    parts.push(`${input.updatedCount} of ${input.activatedCount} profiles updated`);
  }
  return parts.length ? parts.join(" · ") : null;
}
