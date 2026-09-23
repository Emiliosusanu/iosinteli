/**
 * Resolve KDP shelves from Ads profile ↔ KDP account bridge rows.
 * One kdp_account_id must count once even when linked to US + CA (or more).
 */

export type KdpAccountAmazonProfileLink = {
  kdp_account_id?: string | null;
  amazon_profile_id?: string | null;
  is_paused?: boolean | null;
};

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** KDP account ids linked to any of the given Ads profile ids. */
export function linkedKdpAccountIdsFromRows(
  links: readonly KdpAccountAmazonProfileLink[],
  profileIds: readonly string[],
  opts?: { includePaused?: boolean },
): string[] {
  const includePaused = opts?.includePaused === true;
  const wanted = new Set(
    profileIds.map((id) => String(id || "").trim()).filter(Boolean),
  );
  if (!wanted.size) return [];
  return uniqueStrings(
    links
      .filter((row) => {
        if (!includePaused && row.is_paused === true) return false;
        const profileId = String(row.amazon_profile_id || "").trim();
        return Boolean(profileId && wanted.has(profileId));
      })
      .map((row) => row.kdp_account_id),
  );
}

/** Active (non-paused) KDP account ids linked to any of the given Ads profile ids. */
export function activeLinkedKdpAccountIdsFromRows(
  links: readonly KdpAccountAmazonProfileLink[],
  profileIds: readonly string[],
): string[] {
  return linkedKdpAccountIdsFromRows(links, profileIds, { includePaused: false });
}
