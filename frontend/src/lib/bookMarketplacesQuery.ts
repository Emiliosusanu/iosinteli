import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/src/contexts/AppContext";
import { STABLE_SCOPED_CACHE, sortedProfileIds } from "./periodQuery";
import { supabase } from "./supabase";
import { fetchAggregatedCampaigns } from "./dashboardApi";
import { fetchTargetingBookOptions } from "./queries";
import {
  emptySponsoredMarketplaceIndex,
  buildSponsoredMarketplaceIndex,
  buildSponsoredMarketplaceIndexFromCampaignBooks,
  mergeSponsoredMarketplaceIndexes,
  productAdsForVisibleCampaigns,
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

async function fetchDirectSponsoredMarketplaceIndex(
  profiles: readonly MarketplaceProfileRef[],
): Promise<SponsoredMarketplaceIndex> {
  const profileIds = profileQueryIds(profiles);
  if (!profileIds.length) return emptySponsoredMarketplaceIndex();

  const campaigns: MarketplaceCampaignRef[] = [];
  const productAds: MarketplaceProductAdRef[] = [];

  for (const chunk of chunkIds(profileIds, PROFILE_CHUNK)) {
    const [campaignRows, adRows] = await Promise.all([
      fetchPages<MarketplaceCampaignRef>((from, to) =>
        supabase
          .from("campaigns")
          .select("id, name, state, amazon_profile_id")
          .in("amazon_profile_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchPages<MarketplaceProductAdRef>((from, to) =>
        supabase
          .from("product_ads")
          .select("campaign_id, asin, sku, title, amazon_profile_id")
          .in("amazon_profile_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    campaigns.push(...campaignRows);
    productAds.push(...adRows);
  }

  // A stale product_ad row must never manufacture a marketplace badge after
  // its campaign has disappeared/archived. Active and paused are both valid
  // customer-visible campaigns; every other state is excluded.
  const verifiedProductAds = productAdsForVisibleCampaigns(campaigns, productAds);

  return buildSponsoredMarketplaceIndex({ profiles, campaigns, productAds: verifiedProductAds });
}

async function fetchServerSponsoredMarketplaceIndex(
  profiles: readonly MarketplaceProfileRef[],
  opts: { start: string; end: string; filterUserId?: string | null },
): Promise<SponsoredMarketplaceIndex> {
  const profileIds = profileQueryIds(profiles);
  if (!profileIds.length) return emptySponsoredMarketplaceIndex();

  const booksPromise = fetchTargetingBookOptions(profileIds, {
    filterUserId: opts.filterUserId,
  });
  const campaigns: MarketplaceCampaignRef[] = [];

  // The aggregate response does not echo profileId. Each request is scoped to
  // one exact profile, so attach it at this boundary without any name matching.
  for (let i = 0; i < profileIds.length; i += 2) {
    const batch = profileIds.slice(i, i + 2);
    const rowsByProfile = await Promise.all(
      batch.map(async (profileId) => {
        const rows = await fetchAggregatedCampaigns({
          startDate: opts.start,
          endDate: opts.end,
          profileIds: [profileId],
          filterUserId: opts.filterUserId,
        });
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          state: row.state,
          amazon_profile_id: row.amazon_profile_id || profileId,
        }));
      }),
    );
    for (const rows of rowsByProfile) campaigns.push(...rows);
  }

  const books = await booksPromise;
  return buildSponsoredMarketplaceIndexFromCampaignBooks({ profiles, campaigns, books });
}

export async function fetchSponsoredMarketplaceIndex(
  profiles: readonly MarketplaceProfileRef[],
  opts?: { start?: string; end?: string; filterUserId?: string | null },
): Promise<SponsoredMarketplaceIndex> {
  const profileIds = profileQueryIds(profiles);
  if (!profileIds.length) return emptySponsoredMarketplaceIndex();

  const today = new Date().toISOString().slice(0, 10);
  const attempts: Array<Promise<SponsoredMarketplaceIndex>> = [];
  // Direct Supabase reads preserve enabled + paused coverage for the signed-in
  // seller. Admin customer-view is intentionally served by Nest because RLS
  // belongs to the customer, not the viewing admin.
  if (!opts?.filterUserId) attempts.push(fetchDirectSponsoredMarketplaceIndex(profiles));
  attempts.push(
    fetchServerSponsoredMarketplaceIndex(profiles, {
      start: opts?.start || today,
      end: opts?.end || today,
      filterUserId: opts?.filterUserId,
    }),
  );

  const settled = await Promise.allSettled(attempts);
  const indexes = settled
    .filter((result): result is PromiseFulfilledResult<SponsoredMarketplaceIndex> => result.status === "fulfilled")
    .map((result) => result.value);
  if (!indexes.length) {
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw failure?.reason ?? new Error("Couldn't load sponsored marketplaces.");
  }
  return mergeSponsoredMarketplaceIndexes(...indexes);
}

export function sponsoredMarketplaceIndexQueryKey(
  userScope: string,
  profileIds: readonly string[],
) {
  // v3 adds the ownership-checked Nest path used by admin/customer view and
  // invalidates old persisted empty indexes.
  return ["sponsored-marketplace-index-v3", userScope, sortedProfileIds(profileIds)] as const;
}

/** Seller-scope index of which books are sponsored in more than one marketplace. */
export function useSponsoredMarketplaceIndex(): SponsoredMarketplaceIndex {
  const { profiles, adminFilterUserId, dateRange } = useApp();
  const profileIds = useMemo(
    () => sortedProfileIds(profiles.map((profile) => String(profile.id || "").trim())),
    [profiles],
  );

  const query = useQuery({
    queryKey: sponsoredMarketplaceIndexQueryKey(adminFilterUserId ?? "self", profileIds),
    queryFn: () => fetchSponsoredMarketplaceIndex(profiles, {
      start: dateRange.start,
      end: dateRange.end,
      filterUserId: adminFilterUserId,
    }),
    enabled: profileIds.length > 0,
    ...STABLE_SCOPED_CACHE,
    refetchOnMount: "always",
  });

  return query.data ?? emptySponsoredMarketplaceIndex();
}
