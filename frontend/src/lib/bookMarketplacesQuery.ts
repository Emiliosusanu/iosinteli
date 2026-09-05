import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/src/contexts/AppContext";
import { STABLE_SCOPED_CACHE, sortedProfileIds } from "./periodQuery";
import { supabase } from "./supabase";
import {
  emptySponsoredMarketplaceIndex,
  buildSponsoredMarketplaceIndex,
  type MarketplaceCampaignRef,
  type MarketplaceProductAdRef,
  type MarketplaceProfileRef,
  type SponsoredMarketplaceIndex,
} from "./bookMarketplaces";

const PAGE_SIZE = 1000;
const MAX_PAGES = 40;
const PROFILE_CHUNK = 200;

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

function profileQueryIds(profiles: readonly MarketplaceProfileRef[]): string[] {
  const ids = new Set<string>();
  for (const profile of profiles) {
    const id = String(profile.id ?? "").trim();
    const adsId = String(profile.profile_id ?? "").trim();
    if (id) ids.add(id);
    if (adsId) ids.add(adsId);
  }
  return [...ids];
}

async function fetchPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0, from = 0; page < MAX_PAGES; page += 1, from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchSponsoredMarketplaceIndex(
  profiles: readonly MarketplaceProfileRef[],
): Promise<SponsoredMarketplaceIndex> {
  const profileIds = profileQueryIds(profiles);
  if (!profileIds.length) return emptySponsoredMarketplaceIndex();

  const campaigns: MarketplaceCampaignRef[] = [];
  const productAds: MarketplaceProductAdRef[] = [];

  try {
    for (const chunk of chunkIds(profileIds, PROFILE_CHUNK)) {
      const [campaignRows, adRows] = await Promise.all([
        fetchPages<MarketplaceCampaignRef>((from, to) =>
          supabase
            .from("campaigns")
            .select("name, amazon_profile_id")
            .in("amazon_profile_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        fetchPages<MarketplaceProductAdRef>((from, to) =>
          supabase
            .from("product_ads")
            .select("asin, sku, title, amazon_profile_id")
            .in("amazon_profile_id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      campaigns.push(...campaignRows);
      productAds.push(...adRows);
    }
  } catch {
    return emptySponsoredMarketplaceIndex();
  }

  return buildSponsoredMarketplaceIndex({ profiles, campaigns, productAds });
}

export function sponsoredMarketplaceIndexQueryKey(
  userScope: string,
  profileIds: readonly string[],
) {
  return ["sponsored-marketplace-index", userScope, sortedProfileIds(profileIds)] as const;
}

/** Seller-scope index of which books are sponsored in more than one marketplace. */
export function useSponsoredMarketplaceIndex(): SponsoredMarketplaceIndex {
  const { profiles, adminFilterUserId } = useApp();
  const profileIds = useMemo(
    () => sortedProfileIds(profiles.map((profile) => String(profile.id || "").trim())),
    [profiles],
  );

  const query = useQuery({
    queryKey: sponsoredMarketplaceIndexQueryKey(adminFilterUserId ?? "self", profileIds),
    queryFn: () => fetchSponsoredMarketplaceIndex(profiles),
    enabled: profileIds.length > 0 && !adminFilterUserId,
    ...STABLE_SCOPED_CACHE,
  });

  return query.data ?? emptySponsoredMarketplaceIndex();
}
