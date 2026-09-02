import type { AmazonProfile } from "./types";

/** Nest missing `is_enabled` is treated as on — same contract as the safety audit. */
export function profileEnabled(profile: Pick<AmazonProfile, "is_enabled">): boolean {
  return profile.is_enabled !== false;
}

export function profileInView(
  profile: Pick<AmazonProfile, "id">,
  selectedProfileIds: string[],
): boolean {
  return selectedProfileIds.includes(profile.id);
}

export function profileDisplayName(profile: Pick<AmazonProfile, "nickname" | "account_name">): string {
  return profile.nickname || profile.account_name || "Amazon profile";
}

export function enabledStatusLabel(enabled: boolean): "Enabled" | "Disabled" {
  return enabled ? "Enabled" : "Disabled";
}

export function viewStatusLabel(inView: boolean): "In current view" | "Not in current view" {
  return inView ? "In current view" : "Not in current view";
}

export function disableConfirmTitle(name: string): string {
  return `Turn off ${name}?`;
}

export const DISABLE_CONFIRM_MESSAGE =
  "This stops InteliAds from using this Amazon profile. It does not disconnect Amazon.";

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

export const PROFILE_SWITCH_ON_HINT =
  "Turns off InteliAds for this Amazon profile. Does not disconnect Amazon.";
export const PROFILE_SWITCH_OFF_HINT = "Enables this Amazon profile for InteliAds.";

export const KDP_SECTION_FOOTER =
  "Royalties come from the Chrome helper and/or the iPhone KDP helper (Settings → Royalty source). Linking here only attaches KDP data to Amazon Ads profiles. This iPhone also refreshes linked KDP and ad spend in the background.";
