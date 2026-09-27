/**
 * Pure helpers for Settings KDP↔Ads book compare (no network).
 */
export type LinkPreviewBook = {
  asin: string;
  title: string | null;
  imageUrl: string | null;
};

export type LinkPreviewProfile = {
  profileId: string;
  label: string;
  books: LinkPreviewBook[];
};

export type KdpAdsLinkPreview = {
  helperAccountId: string | null;
  helperAccountName: string | null;
  kdpBooks: LinkPreviewBook[];
  adsProfiles: LinkPreviewProfile[];
  sharedAsins: string[];
  sharedBooks: LinkPreviewBook[];
  kdpOnlyAsins: string[];
  adsOnlyAsins: string[];
};

export function summarizeLinkPreview(preview: KdpAdsLinkPreview): {
  status: "matched" | "no_overlap" | "no_helper" | "no_ads";
  detail: string;
} {
  if (!preview.helperAccountId) {
    return {
      status: "no_helper",
      detail: "iPhone helper has no KDP account bound yet. Run the helper once while signed into KDP.",
    };
  }
  if (!preview.adsProfiles.length) {
    return {
      status: "no_ads",
      detail: "Select Amazon Ads profiles on Overview, then reopen this page.",
    };
  }
  if (!preview.sharedAsins.length) {
    return {
      status: "no_overlap",
      detail:
        "No shared sponsored ASINs — helper KDP and Ads in view do not match. Linking uses ASINs, not book titles.",
    };
  }
  return {
    status: "matched",
    detail: `${preview.sharedAsins.length} book${preview.sharedAsins.length === 1 ? "" : "s"} in common (sponsored ASIN overlap).`,
  };
}
