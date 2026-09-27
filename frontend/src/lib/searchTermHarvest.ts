/** Search-term harvest helpers used by global list + campaign detail. */
import { Alert } from "react-native";
import { alertMutationError, blockIfCannotWriteAmazon } from "@/src/components/Mutations";
import { addSearchTermAsTarget, harvestAmazonWriteAlert } from "@/src/lib/mutations";

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function searchTermLooksTargeted(item: any): boolean {
  if (truthyFlag(item?.targeted) || truthyFlag(item?.is_targeted) || truthyFlag(item?.isTargeted) || truthyFlag(item?.has_target)) {
    return true;
  }
  const status = String(item?.status ?? item?.state ?? "").toLowerCase();
  return status === "targeted" || status.includes("targeted");
}

/** Mark rows already Exact/ASIN-harvested on a sibling Manual campaign for the same book. */
export async function enrichSearchTermsCrossCampaignTargeted(
  rows: any[],
  opts: { campaignId?: string | null } = {},
): Promise<any[]> {
  if (!rows.length) return rows;
  const { supabase } = await import("./supabase.ts");
  const campaignIds = [
    ...new Set(
      rows
        .map((row) => String(row.campaign_id ?? opts.campaignId ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (!campaignIds.length) return rows;

  const [{ data: ads }, { data: campaigns }] = await Promise.all([
    supabase
      .from("product_ads")
      .select("campaign_id, asin")
      .in("campaign_id", campaignIds)
      .not("asin", "is", null),
    supabase.from("campaigns").select("id, amazon_profile_id").in("id", campaignIds),
  ]);

  const profileByCampaign = new Map<string, string>();
  for (const row of campaigns ?? []) {
    const id = String((row as any).id ?? "").trim();
    const profileId = String((row as any).amazon_profile_id ?? "").trim();
    if (id && profileId) profileByCampaign.set(id, profileId);
  }
  const asinsByCampaign = new Map<string, Set<string>>();
  const allAsins = new Set<string>();
  for (const row of ads ?? []) {
    const campaignId = String((row as any).campaign_id ?? "").trim();
    const asin = String((row as any).asin ?? "").trim().toUpperCase();
    if (!campaignId || !asin) continue;
    let set = asinsByCampaign.get(campaignId);
    if (!set) {
      set = new Set();
      asinsByCampaign.set(campaignId, set);
    }
    set.add(asin);
    allAsins.add(asin);
  }
  if (!allAsins.size) {
    return rows.map((row) =>
      searchTermLooksTargeted(row) ? { ...row, has_target: true, status: row.status || "targeted" } : row,
    );
  }

  const profileIds = [...new Set([...profileByCampaign.values()])];
  const { data: siblingAds } = await supabase
    .from("product_ads")
    .select("campaign_id, asin, campaigns!inner(amazon_profile_id)")
    .in("asin", [...allAsins])
    .in("campaigns.amazon_profile_id", profileIds);

  const sourceSet = new Set(campaignIds);
  const siblingIds: string[] = [];
  const siblingAsinsByCampaign = new Map<string, Set<string>>();
  const siblingProfileByCampaign = new Map<string, string>();
  for (const row of siblingAds ?? []) {
    const campaignId = String((row as any).campaign_id ?? "").trim();
    if (!campaignId || sourceSet.has(campaignId)) continue;
    const asin = String((row as any).asin ?? "").trim().toUpperCase();
    if (!asin) continue;
    const profileId = String(
      (row as any).campaigns?.amazon_profile_id ??
        (Array.isArray((row as any).campaigns) ? (row as any).campaigns[0]?.amazon_profile_id : "") ??
        "",
    ).trim();
    if (profileId) siblingProfileByCampaign.set(campaignId, profileId);
    siblingIds.push(campaignId);
    let set = siblingAsinsByCampaign.get(campaignId);
    if (!set) {
      set = new Set();
      siblingAsinsByCampaign.set(campaignId, set);
    }
    set.add(asin);
  }
  if (!siblingIds.length) {
    return rows.map((row) =>
      searchTermLooksTargeted(row) ? { ...row, has_target: true, status: row.status || "targeted" } : row,
    );
  }

  const uniqueSiblingIds = [...new Set(siblingIds)];
  const [{ data: sibKeywords }, { data: sibTargets }] = await Promise.all([
    supabase
      .from("keywords")
      .select("campaign_id, keyword_text")
      .in("campaign_id", uniqueSiblingIds)
      .not("status", "eq", "archived"),
    supabase
      .from("product_targets")
      .select("campaign_id, expression")
      .in("campaign_id", uniqueSiblingIds)
      .not("state", "eq", "archived"),
  ]);

  const normalize = (value: string) => String(value ?? "").trim().toLowerCase();
  const profileAsinKey = (profileId: string, asin: string) => `${profileId}:${asin}`;
  const keywordTermsByProfileAsin = new Map<string, Set<string>>();
  const asinTargetsByProfileAsin = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, campaignId: string, term: string) => {
    const asins = siblingAsinsByCampaign.get(campaignId);
    const profileId = siblingProfileByCampaign.get(campaignId);
    if (!asins || !profileId) return;
    const key = normalize(term);
    if (!key) return;
    for (const asin of asins) {
      const mapKey = profileAsinKey(profileId, asin);
      let set = map.get(mapKey);
      if (!set) {
        set = new Set();
        map.set(mapKey, set);
      }
      set.add(key);
    }
  };
  for (const row of sibKeywords ?? []) {
    add(keywordTermsByProfileAsin, String((row as any).campaign_id ?? ""), String((row as any).keyword_text ?? ""));
  }
  for (const row of sibTargets ?? []) {
    const expr = Array.isArray((row as any).expression) ? (row as any).expression : [];
    for (const part of expr) {
      const type = part?.type;
      if ((type === "ASIN_SAME_AS" || type === "asinSameAs") && part?.value) {
        add(asinTargetsByProfileAsin, String((row as any).campaign_id ?? ""), String(part.value));
      }
    }
  }

  return rows.map((row) => {
    if (searchTermLooksTargeted(row)) {
      return { ...row, has_target: true, status: row.status || "targeted" };
    }
    const campaignId = String(row.campaign_id ?? opts.campaignId ?? "").trim();
    const term = normalize(String(row.search_term ?? ""));
    const termType = String(row.term_type ?? "keyword").toLowerCase();
    const sourceAsins = asinsByCampaign.get(campaignId);
    const sourceProfile = profileByCampaign.get(campaignId);
    if (!campaignId || !term || !sourceAsins?.size || !sourceProfile) return row;
    for (const asin of sourceAsins) {
      const key = profileAsinKey(sourceProfile, asin);
      const hit =
        termType === "asin"
          ? asinTargetsByProfileAsin.get(key)?.has(term)
          : keywordTermsByProfileAsin.get(key)?.has(term);
      if (hit) {
        return { ...row, has_target: true, status: "targeted", is_targeted: true };
      }
    }
    return row;
  });
}

export function searchTermLooksNegated(item: any): boolean {
  if (truthyFlag(item?.negated) || truthyFlag(item?.has_negative) || truthyFlag(item?.hasNegative)) return true;
  const status = String(item?.status ?? item?.state ?? "").toLowerCase();
  return status === "negated" || status.includes("negat");
}

/** One-tap Exact harvest using the settings default bid (Nest picks Exact-majority ad group). */
export async function fastAddSearchTermExact(args: {
  guestMode: boolean;
  viewAsOtherUser?: boolean;
  id: string;
  term: string;
  bid: number;
  onSuccess: () => Promise<void> | void;
}): Promise<boolean> {
  if (blockIfCannotWriteAmazon({ guestMode: args.guestMode, viewAsOtherUser: Boolean(args.viewAsOtherUser) })) {
    return false;
  }
  try {
    const result = await addSearchTermAsTarget(args.id, {
      matchType: "exact",
      bid: args.bid,
    });
    const copy = harvestAmazonWriteAlert("add", result);
    Alert.alert(copy.title, copy.body);
    await args.onSuccess();
    return true;
  } catch (error) {
    alertMutationError(error, "Couldn't add that search term.");
    return false;
  }
}
