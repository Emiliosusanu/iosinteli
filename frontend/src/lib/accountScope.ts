import type { AmazonProfile } from "./types";

/** Nest toggle / nickname / KDP link keys are Amazon Ads `profile_id`. */
export function amazonAdsProfileId(profile: Pick<AmazonProfile, "id" | "profile_id">): string {
  return profile.profile_id || profile.id;
}

export function amazonAdsProfileIdsForSelection(
  profiles: Array<Pick<AmazonProfile, "id" | "profile_id">>,
  selectedIds: string[],
): string[] {
  return selectedIds.map((id) => {
    const match = profiles.find((p) => p.id === id || p.profile_id === id);
    return match ? amazonAdsProfileId(match) : id;
  });
}

export const VIEWING_CUSTOMER_MESSAGE =
  "Account changes aren't available while viewing another user's accounts.";
