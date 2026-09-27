/**
 * Simple ASIN-proof gates for KDP ↔ Amazon Ads linking.
 *
 * Truth = ASIN (10-char), not book title. Same title on two publishers is fine;
 * same sponsored ASIN on a KDP shelf is the strong link signal.
 * Never delete historical kdp_* rows here — only refuse/pause bad joins.
 */
import {
  intersectAsins,
  profilesEligibleForCatalog,
  uniqueNormalizedAsins,
} from "./asinAttribution.ts";

export type ProfileLinkRejectReason =
  | "no_kdp_catalog"
  | "no_sponsored_asin_overlap"
  | "empty_selection";

export type ProfileLinkDecision = {
  allowedProfileIds: string[];
  rejected: { profileId: string; reason: ProfileLinkRejectReason }[];
  matchedAsinsByProfileId: Record<string, string[]>;
  catalogAsins: string[];
};

/**
 * Decide which Ads profiles may join a KDP account.
 * Strict: catalog must be non-empty; each profile needs ≥1 sponsored ASIN ∩ catalog.
 */
export function decideAsinProvenProfileLinks(opts: {
  catalogAsins: readonly string[];
  sponsoredAsinsByProfileId: Record<string, readonly string[]>;
  profileIds: readonly string[];
}): ProfileLinkDecision {
  const catalogAsins = uniqueNormalizedAsins(opts.catalogAsins);
  const profileIds = [
    ...new Set(opts.profileIds.map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  const matchedAsinsByProfileId: Record<string, string[]> = {};
  const rejected: ProfileLinkDecision["rejected"] = [];

  if (!profileIds.length) {
    return {
      allowedProfileIds: [],
      rejected: [],
      matchedAsinsByProfileId,
      catalogAsins,
    };
  }

  if (!catalogAsins.length) {
    return {
      allowedProfileIds: [],
      rejected: profileIds.map((profileId) => ({
        profileId,
        reason: "no_kdp_catalog" as const,
      })),
      matchedAsinsByProfileId,
      catalogAsins,
    };
  }

  const eligible = new Set(
    profilesEligibleForCatalog({
      catalogAsins,
      sponsoredAsinsByProfileId: opts.sponsoredAsinsByProfileId,
    }),
  );

  const allowedProfileIds: string[] = [];
  for (const profileId of profileIds) {
    const sponsored = opts.sponsoredAsinsByProfileId[profileId] ?? [];
    const matched = intersectAsins(catalogAsins, sponsored);
    if (matched.length && eligible.has(profileId)) {
      allowedProfileIds.push(profileId);
      matchedAsinsByProfileId[profileId] = matched;
    } else {
      rejected.push({ profileId, reason: "no_sponsored_asin_overlap" });
    }
  }

  return {
    allowedProfileIds,
    rejected,
    matchedAsinsByProfileId,
    catalogAsins,
  };
}

/** Human copy for Accounts UI / alerts — no Nest dependency. */
export function describeLinkRejects(
  rejected: ProfileLinkDecision["rejected"],
  profileLabel: (profileId: string) => string = (id) => id,
): string {
  if (!rejected.length) return "";
  const byReason = new Map<ProfileLinkRejectReason, string[]>();
  for (const row of rejected) {
    const list = byReason.get(row.reason) ?? [];
    list.push(profileLabel(row.profileId));
    byReason.set(row.reason, list);
  }
  const parts: string[] = [];
  const noCatalog = byReason.get("no_kdp_catalog");
  if (noCatalog?.length) {
    parts.push(
      "This KDP account has no book ASINs yet — import titles before linking Ads profiles.",
    );
  }
  const noOverlap = byReason.get("no_sponsored_asin_overlap");
  if (noOverlap?.length) {
    parts.push(
      `No sponsored ASIN overlap (skipped): ${noOverlap.slice(0, 6).join(", ")}${
        noOverlap.length > 6 ? "…" : ""
      }.`,
    );
  }
  return parts.join("\n");
}

/**
 * Live session catalog vs sticky shelf: contamination if sticky has titles and
 * zero ASIN overlap with the live WebView catalog.
 */
export function stickyContaminatesLiveCatalog(opts: {
  liveCatalogAsins: readonly string[];
  stickyShelfAsins: readonly string[];
}): boolean {
  const live = uniqueNormalizedAsins(opts.liveCatalogAsins);
  const sticky = uniqueNormalizedAsins(opts.stickyShelfAsins);
  if (!live.length || !sticky.length) return false;
  return intersectAsins(live, sticky).length === 0;
}
