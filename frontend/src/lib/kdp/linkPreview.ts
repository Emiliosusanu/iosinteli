/**
 * Settings preview: helper-bound KDP shelf vs selected Ads product_ads,
 * so the user can see shared ASINs (link truth) at a glance.
 */
import { amazonAdsProfileIdsForSelection } from "../accountScope.ts";
import { fetchAmazonProfiles } from "../queries.ts";
import { pickUsableCoverUrl } from "../kdpTitlePresentation.ts";
import { supabase } from "../supabase.ts";
import { uniqueNormalizedAsins, normalizeAsin } from "./asinAttribution.ts";
import {
  type KdpAdsLinkPreview,
  type LinkPreviewBook,
  type LinkPreviewProfile,
  summarizeLinkPreview,
} from "./linkPreviewCompare.ts";
import { loadHelperAccountId } from "./persist.ts";

export type { KdpAdsLinkPreview, LinkPreviewBook, LinkPreviewProfile };
export { summarizeLinkPreview };

const BOOK_CAP = 24;

export async function fetchKdpAccountBooks(accountId: string): Promise<LinkPreviewBook[]> {
  const byAsin = new Map<string, LinkPreviewBook>();
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("kdp_titles")
      .select("asin, title, cover_url, amazon_image_url")
      .eq("account_id", accountId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`kdp_titles: ${error.message}`);
    if (!data?.length) break;
    for (const row of data as Array<{
      asin?: string;
      title?: string | null;
      cover_url?: string | null;
      amazon_image_url?: string | null;
    }>) {
      const asin = normalizeAsin(row.asin);
      if (!asin) continue;
      const imageUrl = pickUsableCoverUrl(row.cover_url, row.amazon_image_url);
      const prev = byAsin.get(asin);
      byAsin.set(asin, {
        asin,
        title: String(row.title || prev?.title || "").trim() || null,
        imageUrl: pickUsableCoverUrl(prev?.imageUrl, imageUrl),
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // kdp_titles is enrichment, not the catalog authority. Keep formats that
  // have not received title/cover enrichment yet so the manager never hides
  // a real imported book.
  const formatRows: Array<{ asin: string; book_id: string }> = [];
  from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("kdp_book_formats")
      .select("asin, book_id")
      .eq("account_id", accountId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`kdp_book_formats: ${error.message}`);
    if (!data?.length) break;
    for (const row of data as Array<{ asin?: string; book_id?: string }>) {
      const asin = normalizeAsin(row.asin);
      const bookId = String(row.book_id || "").trim();
      if (asin && bookId) formatRows.push({ asin, book_id: bookId });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const bookById = new Map<string, { title: string | null; imageUrl: string | null }>();
  const bookIds = [...new Set(formatRows.map((row) => row.book_id))];
  for (let i = 0; i < bookIds.length; i += 100) {
    const { data, error } = await supabase
      .from("kdp_books")
      .select("id, display_title, cover_url")
      .eq("account_id", accountId)
      .in("id", bookIds.slice(i, i + 100));
    if (error) throw new Error(`kdp_books: ${error.message}`);
    for (const row of (data ?? []) as Array<{
      id?: string;
      display_title?: string | null;
      cover_url?: string | null;
    }>) {
      const id = String(row.id || "").trim();
      if (!id) continue;
      bookById.set(id, {
        title: String(row.display_title || "").trim() || null,
        imageUrl: pickUsableCoverUrl(row.cover_url),
      });
    }
  }
  for (const format of formatRows) {
    const previous = byAsin.get(format.asin);
    const book = bookById.get(format.book_id);
    byAsin.set(format.asin, {
      asin: format.asin,
      title: previous?.title || book?.title || null,
      imageUrl: pickUsableCoverUrl(previous?.imageUrl, book?.imageUrl),
    });
  }
  return [...byAsin.values()].sort((a, b) =>
    (a.title || a.asin).localeCompare(b.title || b.asin),
  );
}

async function loadAdsBooks(profileIds: string[]): Promise<Map<string, LinkPreviewBook[]>> {
  const out = new Map<string, LinkPreviewBook[]>();
  for (const pid of profileIds) out.set(pid, []);
  if (!profileIds.length) return out;

  const byProfile = new Map<string, Map<string, LinkPreviewBook>>();
  for (const pid of profileIds) byProfile.set(pid, new Map());

  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("product_ads")
      .select("amazon_profile_id, asin, title, image_url")
      .in("amazon_profile_id", profileIds)
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    for (const row of data as Array<{
      amazon_profile_id?: string;
      asin?: string;
      title?: string | null;
      image_url?: string | null;
    }>) {
      const pid = String(row.amazon_profile_id || "").trim();
      const asin = normalizeAsin(row.asin);
      if (!pid || !asin || !byProfile.has(pid)) continue;
      const bucket = byProfile.get(pid)!;
      const prev = bucket.get(asin);
      bucket.set(asin, {
        asin,
        title: String(row.title || prev?.title || "").trim() || null,
        imageUrl: pickUsableCoverUrl(prev?.imageUrl, row.image_url),
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  for (const [pid, map] of byProfile) {
    out.set(
      pid,
      [...map.values()].sort((a, b) => (a.title || a.asin).localeCompare(b.title || b.asin)),
    );
  }
  return out;
}

async function localAccountName(accountId: string): Promise<string | null> {
  const { data } = await supabase.from("kdp_accounts").select("name").eq("id", accountId).maybeSingle();
  const name = String((data as { name?: string } | null)?.name || "").trim();
  return name || null;
}

/** Build the Settings compare snapshot for the sticky helper account vs Ads in view. */
export async function fetchKdpAdsLinkPreview(opts: {
  userId: string;
  selectedProfileIds: string[];
}): Promise<KdpAdsLinkPreview> {
  const helperAccountId = await loadHelperAccountId();
  const allProfiles = await fetchAmazonProfiles(opts.userId).catch(() => []);
  const adsIds = amazonAdsProfileIdsForSelection(allProfiles, opts.selectedProfileIds);

  const kdpBooks = helperAccountId ? await fetchKdpAccountBooks(helperAccountId) : [];
  const adsByProfile = await loadAdsBooks(adsIds);

  const adsProfiles: LinkPreviewProfile[] = adsIds.map((profileId) => {
    const match = allProfiles.find(
      (p) => p.profile_id === profileId || p.id === profileId,
    );
    const label =
      match?.nickname?.trim() ||
      match?.account_name?.trim() ||
      profileId;
    return {
      profileId,
      label,
      books: adsByProfile.get(profileId) ?? [],
    };
  });

  const kdpAsins = uniqueNormalizedAsins(kdpBooks.map((b) => b.asin));
  const adsAsinSet = new Set<string>();
  const adsBookByAsin = new Map<string, LinkPreviewBook>();
  for (const profile of adsProfiles) {
    for (const book of profile.books) {
      adsAsinSet.add(book.asin);
      const prev = adsBookByAsin.get(book.asin);
      adsBookByAsin.set(book.asin, {
        asin: book.asin,
        title: book.title || prev?.title || null,
        imageUrl: pickUsableCoverUrl(prev?.imageUrl, book.imageUrl),
      });
    }
  }

  const sharedAsins = kdpAsins.filter((asin) => adsAsinSet.has(asin));
  const sharedSet = new Set(sharedAsins);
  const kdpByAsin = new Map(kdpBooks.map((b) => [b.asin, b]));
  const sharedBooks = sharedAsins.map((asin) => {
    const kdp = kdpByAsin.get(asin);
    const ads = adsBookByAsin.get(asin);
    return {
      asin,
      title: kdp?.title || ads?.title || null,
      imageUrl: pickUsableCoverUrl(kdp?.imageUrl, ads?.imageUrl),
    };
  });

  const prioritizeShared = (books: LinkPreviewBook[]) =>
    [...books]
      .sort((a, b) => Number(sharedSet.has(b.asin)) - Number(sharedSet.has(a.asin)))
      .slice(0, BOOK_CAP);

  return {
    helperAccountId,
    helperAccountName: helperAccountId ? await localAccountName(helperAccountId) : null,
    kdpBooks: prioritizeShared(kdpBooks),
    adsProfiles: adsProfiles.map((profile) => ({
      ...profile,
      books: prioritizeShared(profile.books),
    })),
    sharedAsins,
    sharedBooks: sharedBooks.slice(0, BOOK_CAP),
    kdpOnlyAsins: kdpAsins.filter((asin) => !adsAsinSet.has(asin)),
    adsOnlyAsins: [...adsAsinSet].filter((asin) => !kdpAsins.includes(asin)).sort(),
  };
}
