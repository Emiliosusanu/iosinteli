import type { AmazonProfileBookPreview } from "./mutations.ts";
import type { LinkPreviewBook } from "./kdp/linkPreviewCompare.ts";

export type ManagedKdpBook = AmazonProfileBookPreview & {
  inKdp: boolean;
  adsProfileIds: string[];
};

export function mergeKdpAndAdsBooks(
  kdpRows: readonly LinkPreviewBook[],
  adsRowsByProfile: readonly { profileId: string; books: readonly AmazonProfileBookPreview[] }[],
): ManagedKdpBook[] {
  const byAsin = new Map<string, ManagedKdpBook>();
  for (const row of kdpRows) {
    const asin = String(row.asin || "").trim().toUpperCase();
    if (!asin) continue;
    byAsin.set(asin, {
      asin,
      title: row.title,
      coverUrl: row.imageUrl,
      inKdp: true,
      adsProfileIds: [],
    });
  }
  for (const group of adsRowsByProfile) {
    const profileId = String(group.profileId || "").trim();
    if (!profileId) continue;
    for (const row of group.books) {
      const asin = String(row.asin || "").trim().toUpperCase();
      if (!asin) continue;
      const previous = byAsin.get(asin);
      byAsin.set(asin, {
        asin,
        title: row.title || previous?.title || null,
        coverUrl: row.coverUrl || previous?.coverUrl || null,
        inKdp: previous?.inKdp ?? false,
        adsProfileIds: [...new Set([...(previous?.adsProfileIds ?? []), profileId])],
      });
    }
  }
  return [...byAsin.values()].sort((a, b) =>
    Number(b.inKdp) - Number(a.inKdp) || (a.title || a.asin).localeCompare(b.title || b.asin),
  );
}
