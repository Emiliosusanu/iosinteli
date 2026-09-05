import type { AmazonProfile } from "./types";

/** Nest missing `is_enabled` is treated as on — same contract as the safety audit. */
export function profileEnabled(profile: Pick<AmazonProfile, "is_enabled">): boolean {
  return profile.is_enabled !== false;
}

export function profileInView(
  profile: Pick<AmazonProfile, "id" | "profile_id">,
  selectedProfileIds: string[],
): boolean {
  return selectedProfileIds.includes(profile.id) || selectedProfileIds.includes(profile.profile_id);
}

export function profileDisplayName(profile: Pick<AmazonProfile, "nickname" | "account_name">): string {
  return profile.nickname || profile.account_name || "Amazon profile";
}

export function enabledStatusLabel(enabled: boolean): "Enabled" | "Disabled" {
  return enabled ? "Enabled" : "Disabled";
}

export function viewStatusLabel(inView: boolean): "In view" | "—" {
  return inView ? "In view" : "—";
}

export function disableConfirmTitle(name: string): string {
  return `Turn off ${name}?`;
}

/** Regional-indicator flag emoji from ISO country code (US → 🇺🇸). */
export function countryFlagEmoji(countryCode: string | null | undefined): string {
  const cc = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

/** Unique flag emojis for enabled (or selected) profiles — multi-country header cue. */
export function multiCountryFlagIcons(
  profiles: Array<Pick<AmazonProfile, "country_code" | "is_enabled">>,
  opts?: { onlyEnabled?: boolean },
): string[] {
  const onlyEnabled = opts?.onlyEnabled !== false;
  const seen = new Set<string>();
  const flags: string[] = [];
  for (const profile of profiles) {
    if (onlyEnabled && profile.is_enabled === false) continue;
    const code = String(profile.country_code || "")
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    flags.push(countryFlagEmoji(code));
  }
  return flags;
}

/** Short Amazon Ads account entity id (…kww8v5) for group headers. */
export function shortAdsAccountId(accountId: string | null | undefined): string {
  if (!accountId) return "";
  const s = String(accountId).trim();
  if (!s) return "";
  if (s.length <= 8) return s;
  return `…${s.slice(-6)}`;
}

const MARKETPLACE_SUFFIX =
  /\s*[-–—]\s*(US|CA|UK|GB|DE|FR|IT|ES|JP|AU|MX|IN|AE|NL|SE|PL|BE|TR|SG|BR)\s*$/i;

/** Strip trailing marketplace so "… - US" and "… - CA" share a family. */
export function adsAccountFamilyName(accountName: string | null | undefined): string {
  const name = String(accountName || "").trim();
  if (!name) return "";
  return name.replace(MARKETPLACE_SUFFIX, "").trim();
}

/** Group key = Ads account entity id; name family if id missing (US+CA). */
export function adsAccountGroupKey(
  profile: Pick<AmazonProfile, "account_id" | "id" | "profile_id" | "account_name">,
): string {
  const accountId = String(profile.account_id || "").trim();
  if (accountId) return `acct:${accountId}`;
  const family = adsAccountFamilyName(profile.account_name);
  if (family) return `name:${family.toLowerCase()}`;
  return `solo:${profile.id || profile.profile_id}`;
}

export function adsAccountGroupTitle(
  profile: Pick<AmazonProfile, "account_name" | "account_id" | "nickname">,
): string {
  const family = adsAccountFamilyName(profile.account_name);
  const name = family || String(profile.account_name || "").trim() || "Amazon Ads account";
  const short = shortAdsAccountId(profile.account_id);
  return short ? `${name} (${short})` : name;
}

/** Header: family name + marketplace flags so CA is visibly under US. */
export function adsAccountGroupHeading(group: Pick<AdsAccountGroup, "title" | "items">): string {
  const flags = multiCountryFlagIcons(group.items, { onlyEnabled: false });
  return flags.length ? `${group.title} · ${flags.join(" ")}` : group.title;
}

/**
 * Ready to enable = has at least one enabled/active sponsored campaign.
 * Do NOT use total campaign_count alone (includes paused).
 */
export function isReadyToEnable(
  profile: Pick<AmazonProfile, "campaigns_enabled_count">,
): boolean {
  return (profile.campaigns_enabled_count ?? 0) > 0;
}

/** Default Ready filter: ready campaigns OR already Nest-enabled. */
export function matchesReadyDefaultFilter(
  profile: Pick<AmazonProfile, "campaigns_enabled_count" | "is_enabled">,
): boolean {
  return isReadyToEnable(profile) || profileEnabled(profile);
}

export type AdsAccountGroup = {
  key: string;
  title: string;
  accountId: string | null;
  items: AmazonProfile[];
};

/** Group marketplace profiles under the same Ads parent account (US+CA same entity). */
export function groupProfilesByAdsAccount(profiles: AmazonProfile[]): AdsAccountGroup[] {
  const map = new Map<string, AdsAccountGroup>();
  for (const profile of profiles) {
    const key = adsAccountGroupKey(profile);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        title: adsAccountGroupTitle(profile),
        accountId: profile.account_id ? String(profile.account_id) : null,
        items: [],
      };
      map.set(key, group);
    } else if (!group.accountId && profile.account_id) {
      group.accountId = String(profile.account_id);
      group.title = adsAccountGroupTitle(profile);
    }
    group.items.push(profile);
  }
  return Array.from(map.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        const readyDelta = Number(isReadyToEnable(b)) - Number(isReadyToEnable(a));
        if (readyDelta !== 0) return readyDelta;
        const enabledDelta = Number(profileEnabled(b)) - Number(profileEnabled(a));
        if (enabledDelta !== 0) return enabledDelta;
        return profileDisplayName(a).localeCompare(profileDisplayName(b));
      }),
    }))
    .sort((a, b) => {
      const aReady = a.items.some((p) => matchesReadyDefaultFilter(p));
      const bReady = b.items.some((p) => matchesReadyDefaultFilter(p));
      if (aReady !== bReady) return aReady ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}

export function filterProfilesBySheetMode(
  profiles: AmazonProfile[],
  mode: "ready" | "all",
): AmazonProfile[] {
  if (mode === "all") return profiles;
  const ready = profiles.filter(matchesReadyDefaultFilter);
  const keepKeys = new Set(ready.map((profile) => adsAccountGroupKey(profile)));
  // Keep CA/UK siblings of a ready US (or any ready marketplace) so grouping is visible.
  return profiles.filter(
    (profile) =>
      matchesReadyDefaultFilter(profile) || keepKeys.has(adsAccountGroupKey(profile)),
  );
}

/** Same Ads parent + why this marketplace may stay off. */
export function profileAssociationHint(
  profile: Pick<AmazonProfile, "id" | "country_code" | "campaigns_enabled_count" | "is_enabled">,
  groupItems: Array<Pick<AmazonProfile, "id" | "country_code" | "nickname" | "account_name" | "is_enabled">>,
): string | null {
  const parts: string[] = [];
  const others = groupItems.filter((item) => item.id !== profile.id);
  const us = others.find((item) => String(item.country_code || "").toUpperCase() === "US");
  if (us) {
    parts.push(`Same Ads account as ${profileDisplayName(us)} (US)`);
  } else if (others.length) {
    const codes = [
      ...new Set(
        others
          .map((item) => String(item.country_code || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (codes.length) parts.push(`Same Ads account as ${codes.join(", ")}`);
  }
  if (!isReadyToEnable(profile) && !profileEnabled(profile)) {
    parts.push("No active campaigns");
  } else if (!profileEnabled(profile)) {
    const enabledCountries = [
      ...new Set(
        groupItems
          .filter((item) => profileEnabled(item))
          .map((item) => String(item.country_code || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const cc = String(profile.country_code || "").trim().toUpperCase();
    if (cc && enabledCountries.length && !enabledCountries.includes(cc)) {
      parts.push(`Enabling adds ${cc} next to ${enabledCountries.join(", ")}. Plan may block extra countries.`);
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

export function enableErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Nest toggle loads/copies rules when enabling. A cold rules payload is retryable, not a plan block. */
export function isTransientEnableProfileError(error: unknown): boolean {
  return /rule data is temporarily unavailable/i.test(enableErrorText(error));
}

export function enableProfileFailedTitle(message: string): string {
  if (/allows up to \d+ countries/i.test(message)) return "Plan country limit";
  if (/allows up to \d+ enabled Amazon account/i.test(message)) return "Plan account limit";
  return ENABLE_PROFILE_FAILED_TITLE;
}

export function enableProfileFailedBody(message: string): string {
  if (isTransientEnableProfileError(message)) {
    return "Rule data was still unavailable after retrying. The profile was not left enabled. Try again in a moment.";
  }
  return message;
}

export function currencyCodeOf(profile: Pick<AmazonProfile, "currency_code"> | null | undefined): string {
  return String(profile?.currency_code || "USD").trim().toUpperCase() || "USD";
}

export function viewCurrencyOfSelection(
  profiles: AmazonProfile[],
  selectedProfileIds: string[],
): string | null {
  for (const id of selectedProfileIds) {
    const match = profiles.find((p) => p.id === id || p.profile_id === id);
    if (match) return currencyCodeOf(match);
  }
  return null;
}

/** USD stays the reporting chip when the view mixes marketplaces. */
export function displayCurrencyOfSelection(
  profiles: AmazonProfile[],
  selectedProfileIds: string[],
): string {
  const codes: string[] = [];
  for (const id of selectedProfileIds) {
    const match = profiles.find((p) => p.id === id || p.profile_id === id);
    if (match) codes.push(currencyCodeOf(match));
  }
  if (codes.includes("USD")) return "USD";
  return codes[0] || "USD";
}

export type ViewTogglePlan =
  | { kind: "remove"; nextIds: string[] }
  | { kind: "add"; nextIds: string[] }
  | { kind: "nest_disabled" };

/**
 * TopBar / view-chip selection planner.
 * Mixed marketplaces stay in one view. Nest-disabled profiles cannot join.
 */
export function planViewToggle(params: {
  profileId: string;
  profiles: AmazonProfile[];
  selectedProfileIds: string[];
}): ViewTogglePlan {
  const { profileId, profiles, selectedProfileIds } = params;
  const nextProfile = profiles.find((p) => p.id === profileId || p.profile_id === profileId);
  const rowId = nextProfile?.id ?? profileId;
  const adsId = nextProfile?.profile_id;

  if (
    selectedProfileIds.includes(rowId) ||
    (adsId ? selectedProfileIds.includes(adsId) : false)
  ) {
    return {
      kind: "remove",
      nextIds: selectedProfileIds.filter((id) => id !== rowId && id !== adsId),
    };
  }

  if (nextProfile && !profileEnabled(nextProfile)) {
    return { kind: "nest_disabled" };
  }

  return { kind: "add", nextIds: [...selectedProfileIds, rowId] };
}

/** Select-all for TopBar: every Nest-enabled marketplace in the current view. */
export function planSelectAllEnabled(params: {
  profiles: AmazonProfile[];
  selectedProfileIds?: string[];
}): string[] {
  void params.selectedProfileIds;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const profile of params.profiles) {
    if (!profileEnabled(profile)) continue;
    const id = profile.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** @deprecated Use planSelectAllEnabled — mixed marketplaces stay selected. */
export function planSelectAllSameCurrency(params: {
  profiles: AmazonProfile[];
  selectedProfileIds: string[];
}): string[] {
  return planSelectAllEnabled(params);
}

export const NEST_DISABLED_VIEW_TITLE = "Profile is off in InteliAds";
export const NEST_DISABLED_VIEW_MESSAGE = "Enable in Amazon Accounts first";

export const ENABLE_PROFILE_FAILED_TITLE = "Couldn't enable profile";

export const PROFILE_LIST_READY_LABEL = "Ready";
export const PROFILE_LIST_ALL_LABEL = "All profiles";

export const DISABLE_CONFIRM_MESSAGE =
  "Stops InteliAds for this profile. Does not disconnect Amazon.";

export function profileRowAccessibilityLabel(params: {
  name: string;
  marketplace?: string;
  currency?: string;
  enabled: boolean;
  inView: boolean;
}): string {
  return [
    params.name,
    params.marketplace,
    params.currency,
    enabledStatusLabel(params.enabled),
    viewStatusLabel(params.inView),
  ]
    .filter(Boolean)
    .join(". ");
}

export function profileSwitchAccessibilityLabel(name: string, enabled: boolean): string {
  return `${name}. ${enabledStatusLabel(enabled)}`;
}

export function viewSwitchAccessibilityLabel(name: string, inView: boolean): string {
  return `${name}. ${viewStatusLabel(inView)}`;
}

export const PROFILE_SWITCH_ON_HINT =
  "Turns off InteliAds for this profile. Does not disconnect Amazon.";
export const PROFILE_SWITCH_OFF_HINT = "Enables this profile for InteliAds.";

export const VIEW_ADD_HINT = "Adds to current view.";
export const VIEW_REMOVE_HINT = "Removes from current view. InteliAds stays enabled.";
export const VIEW_SWITCH_HINT_ON = "Removes from current view.";
export const VIEW_SWITCH_HINT_OFF = "Adds to current view. USD stays if the mix includes it.";

/** Linking UI is self-explanatory — no permanent tutorial footer. */
export const KDP_SECTION_FOOTER = "";
