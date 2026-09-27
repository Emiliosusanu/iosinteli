/**
 * Notification / digest authority is activated profiles — not the Overview filter.
 * Header selection still owns on-screen totals.
 */

import { profileEnabled } from "./accountsUi.ts";
import { uniqueProfileIds } from "./notificationScope.ts";

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
