import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { SFSymbol } from "@/src/components/ios/Native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCampaignById,
  fetchAdGroups,
  fetchExactCampaignTargetingCatalog,
  fetchProductAds,
  fetchSearchTerms,
  fetchCampaignPlacements,
  aggregateDailyMetrics,
  fetchCampaignMetricsForCampaign,
  type CampaignPlacementRow,
} from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { rowCurrencyOfProfile } from "@/src/lib/accountsUi";
import { useTheme, acosTone, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatOptionalPercent,
  formatInt,
  formatDateShort,
  formatDateRangeLabel,
  safeDivide,
} from "@/src/lib/format";
import { DenseMetricLine, EmptyState, ToneDot, SectionCard, MetricStrip, RetryState, ScreenSpinner } from "@/src/components/Primitives";
import { alertMutationError, assertCanWriteAmazon, assertNotViewingAsOtherUser, BidBudgetEditor, blockIfCannotWriteAmazon, EntityStateSwitch, MutationTap } from "@/src/components/Mutations";
import { CampaignDailyChart, Funnel } from "@/src/components/Charts";
import { SubScreen } from "@/src/components/SubScreen";
import {
  BIDDING_STRATEGY_OPTIONS,
  biddingStrategyLabel,
  normalizeBiddingStrategyCode,
  matchesEntityStateFilter,
  shouldShowActiveOrPausedWithData,
  statusLabel,
} from "@/src/lib/campaigns";
import { getCampaignStrategyCooldown, getPlacementAdjCooldown } from "@/src/lib/bidCooldown";
import {
  fetchCampaignApi,
  updateAdGroupState,
  updateAdGroupManual,
  updateCampaign,
  updateCampaignState,
  updateKeywordManual,
  updateProductTargetManual,
  type PlacementAdjustments,
} from "@/src/lib/mutations";
import { applyOptimisticEntityBid, applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityBid, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { enqueueEntityBidWrite } from "@/src/lib/bulkOutbox";
import { describeProductTarget, fallbackAsinCoverUrl, formatMatchTypeLabel, isExactMatchType, productTargetHeading, readTargetBid } from "@/src/lib/targeting";
import { compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { sortSearchTermsAcosThenSpend } from "@/src/lib/searchTermSort";
import { fastAddSearchTermExact, searchTermLooksTargeted } from "@/src/lib/searchTermHarvest";
import { countriesForCampaignIdentity, countriesForSponsoredCampaign, identityFlagsA11y } from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { CampaignMarketplaceFlags } from "@/src/components/MarketplaceFlags";
import { fetchNestBookProfitabilityDetail } from "@/src/lib/dashboardApi";
import { useVisibleProductTargetTitles } from "@/src/lib/useVisibleProductTargetTitles";

const PLACEMENT_EDITORS: {
  key: keyof PlacementAdjustments;
  label: string;
  testID: "campaign-placement-top" | "campaign-placement-product" | "campaign-placement-rest";
}[] = [
  { key: "top_of_search", label: "Top of search", testID: "campaign-placement-top" },
  { key: "product_pages", label: "Product pages", testID: "campaign-placement-product" },
  { key: "rest_of_search", label: "Rest of search", testID: "campaign-placement-rest" },
];

/** Keep detail ScrollViews responsive after the server has ranked the full scope. */
const CAMPAIGN_TARGET_DISPLAY_LIMIT = 200;

function placementEditorFor(placement: string) {
  const key = placement === "other" ? "rest_of_search" : placement;
  return PLACEMENT_EDITORS.find((row) => row.key === key);
}

function readBudget(api?: { budget?: number } | null, campaign?: { budget?: number | null } | null) {
  if (api?.budget != null && Number.isFinite(Number(api.budget))) return Number(api.budget);
  if (campaign?.budget != null && Number.isFinite(Number(campaign.budget))) return Number(campaign.budget);
  return null;
}

function readPlacementAdjustments(
  api?: { placementAdjustments?: PlacementAdjustments } | null,
  campaign?: Record<string, unknown> | null,
): PlacementAdjustments {
  const apiAdj = api?.placementAdjustments;
  const sbAdj = (campaign?.placementAdjustments ?? campaign?.placement_adjustments) as PlacementAdjustments | undefined;
  const pick = (key: keyof PlacementAdjustments, snake: string) => {
    const raw = apiAdj?.[key] ?? sbAdj?.[key] ?? campaign?.[snake] ?? campaign?.[key];
    if (raw == null || raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    top_of_search: pick("top_of_search", "placement_top_of_search"),
    product_pages: pick("product_pages", "placement_product_pages"),
    rest_of_search: pick("rest_of_search", "placement_rest_of_search"),
  };
}

function campaignVerdict(item: { spend?: number; orders?: number; sales?: number; acos?: number }) {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  const sales = Number(item.sales) || 0;
  const acos = Number(item.acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Wasting spend", tone: "danger" as const };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" as const };
  if (sales > 0) return { label: "Profitable", tone: "good" as const };
  return { label: "No spend yet", tone: "inactive" as const };
}

function campaignProductLabel(type?: string | null) {
  const n = String(type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (n.includes("sponsoredproducts") || n === "sp") return "Sponsored Products";
  if (n.includes("sponsoredbrands") || n === "sb") return "Sponsored Brands";
  if (n.includes("sponsoreddisplay") || n === "sd") return "Sponsored Display";
  return null;
}

// 65-day window for auto campaign search terms
function last65Days(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 64);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default function CampaignDetail() {
  const t = useTheme();
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const { id, childState } = useLocalSearchParams<{ id: string; childState?: string }>();
  // Campaign detail is also the recovery surface for paused children. Showing
  // enabled rows only made a paused keyword/target disappear before the user
  // could turn it back on. Explicit `childState=enabled` keeps the narrow view.
  const activeChildrenOnly = childState === "enabled";
  const { primaryCurrency, dateRange, selectedProfileIds, profilesLoading, adminFilterUserId, entityCooldownHours, profiles, defaultExactBid } = useApp();
  const marketplaceIndex = useSponsoredMarketplaceIndex();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const chartWidth = Math.max(240, viewportWidth - 64);
  const autoRange = last65Days();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [placementEdit, setPlacementEdit] = useState<(typeof PLACEMENT_EDITORS)[number] | null>(null);
  const [entityBidEdit, setEntityBidEdit] = useState<{
    kind: "keyword" | "target" | "adGroup";
    id: string;
    title: string;
    value: number;
    fallbackTargetIds?: string[];
    forceCooldown?: boolean;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [addingExactId, setAddingExactId] = useState<string | null>(null);

  const campaignQ = useQuery({
    queryKey: ["campaign", id, selectedProfileIds, adminFilterUserId ?? "self"],
    queryFn: () => fetchCampaignById(id!, selectedProfileIds, adminFilterUserId),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const campaignApiQ = useQuery({
    queryKey: ["campaign-api", id],
    queryFn: () => fetchCampaignApi(id!),
    enabled: !!id,
  });

  const campaignBookAsin = campaignApiQ.data?.primaryAsin ?? null;
  const bookPricingQ = useQuery({
    queryKey: ["campaign-book-pricing", campaignBookAsin, dateRange.start, dateRange.end, selectedProfileIds, adminFilterUserId ?? "self"],
    queryFn: () => fetchNestBookProfitabilityDetail({
      asin: campaignBookAsin!,
      startDate: dateRange.start,
      endDate: dateRange.end,
      profileIds: selectedProfileIds,
      filterUserId: adminFilterUserId,
    }),
    enabled: Boolean(campaignBookAsin && selectedProfileIds.length),
    retry: false,
  });

  const c = campaignQ.data;
  // Auto vs manual is determined ONLY by targeting_type. `type` is the ad-product
  // (e.g. "sponsoredProducts") and must NOT be used to infer product-targeting.
  const isAuto = (c?.targeting_type ?? "").toLowerCase() === "auto";

  const adGroupsQ = useQuery({
    queryKey: ["campaign-adgroups", id, c?.amazon_profile_id, dateRange.start, dateRange.end, activeChildrenOnly ? "enabled" : "all"],
    queryFn: () => fetchAdGroups([c!.amazon_profile_id], id!, {
      start: dateRange.start,
      end: dateRange.end,
      state: activeChildrenOnly ? "enabled" : undefined,
    }),
    enabled: !!c,
  });

  const activeAdGroupIds = useMemo(
    () => (adGroupsQ.data ?? [])
      .filter((group) => !activeChildrenOnly || matchesEntityStateFilter(group.state, "enabled"))
      .map((group) => String(group.id))
      .sort(),
    [activeChildrenOnly, adGroupsQ.data],
  );
  const activeAdGroupKey = activeAdGroupIds.join("|");
  // Wait for ad-group list before deciding empty — a disabled child query looks
  // "not loading" and used to flash permanent "No advertised products" / "No targets".
  const awaitingChildScope = !!c && !adGroupsQ.isError && !adGroupsQ.isSuccess;
  // Enabled-only with zero enabled AGs → honest empty (do not fetch).
  // Otherwise load children: scope to AG ids when present, else campaign-wide.
  const canLoadActiveChildren =
    !!c &&
    adGroupsQ.isSuccess &&
    (activeAdGroupIds.length > 0 || !activeChildrenOnly);
  const childAdGroupFilter =
    activeAdGroupIds.length > 0 ? { adGroupIds: activeAdGroupIds } : {};

  // For manual campaigns, fetch BOTH keywords and product targets — show whichever
  // has data (handles keyword, product-targeting, and mixed campaigns correctly).
  const keywordsQ = useQuery({
    queryKey: ["campaign-keywords-exact-period", adminFilterUserId ?? "self", user?.id ?? "anon", id, c?.amazon_profile_id, activeAdGroupKey, dateRange.start, dateRange.end],
    queryFn: () => fetchExactCampaignTargetingCatalog({
      campaignId: id!,
      profiles: [c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean),
      start: dateRange.start,
      end: dateRange.end,
      ownerId: viewAsOtherUser ? adminFilterUserId : user?.id ?? null,
      state: activeChildrenOnly ? "active" : "all",
      includeKeywords: true,
      includeProductTargets: false,
    }),
    select: (catalog) => catalog.keywords,
    enabled: canLoadActiveChildren && !isAuto,
  });

  const productTargetsQ = useQuery({
    queryKey: ["campaign-product-targets-exact-period", adminFilterUserId ?? "self", user?.id ?? "anon", id, c?.amazon_profile_id, activeAdGroupKey, dateRange.start, dateRange.end],
    queryFn: () => fetchExactCampaignTargetingCatalog({
      campaignId: id!,
      profiles: [c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean),
      start: dateRange.start,
      end: dateRange.end,
      ownerId: viewAsOtherUser ? adminFilterUserId : user?.id ?? null,
      state: activeChildrenOnly ? "active" : "all",
      includeKeywords: false,
      includeProductTargets: true,
    }),
    select: (catalog) => catalog.productTargets,
    enabled: canLoadActiveChildren,
  });

  const searchTermsQ = useQuery({
    queryKey: ["campaign-search-terms-auto", id, c?.amazon_profile_id, activeAdGroupKey],
    queryFn: () => fetchSearchTerms([c!.amazon_profile_id], {
      campaignId: id!,
      ...childAdGroupFilter,
      limit: 100,
      start: autoRange.start,
      end: autoRange.end,
    }),
    enabled: canLoadActiveChildren && isAuto,
  });

  const productAdsQ = useQuery({
    queryKey: ["campaign-products", id, c?.amazon_profile_id, activeAdGroupKey, dateRange.start, dateRange.end],
    queryFn: () => fetchProductAds([c!.amazon_profile_id], {
      campaignId: id!,
      ...childAdGroupFilter,
      status: activeChildrenOnly ? "enabled" : undefined,
      start: dateRange.start,
      end: dateRange.end,
    }),
    enabled: canLoadActiveChildren,
  });

  const dailyMetricsQ = useQuery({
    queryKey: ["campaign-daily", id, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchCampaignMetricsForCampaign(selectedProfileIds, id!, dateRange.start, dateRange.end),
    enabled: !!id && !!c,
  });

  const placementsQ = useQuery({
    queryKey: ["campaign-placements", id, dateRange.start, dateRange.end],
    queryFn: () => fetchCampaignPlacements(id!, dateRange.start, dateRange.end),
    enabled: !!id && !!c,
  });

  const daily = aggregateDailyMetrics((dailyMetricsQ.data as any) ?? []);

  const dailyAgg = useMemo(
    () => daily.reduce(
      (acc, m) => ({
        spend: acc.spend + m.spend,
        sales: acc.sales + m.sales,
        orders: acc.orders + m.orders,
        clicks: acc.clicks + m.clicks,
        impressions: acc.impressions + m.impressions,
      }),
      { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
    ),
    [daily],
  );

  const perf = useMemo(() => ({
    impressions: daily.map((m) => ({ value: m.impressions, label: formatDateShort(m.date) })),
    clicks:      daily.map((m) => ({ value: m.clicks, label: formatDateShort(m.date) })),
    spend:       daily.map((m) => ({ value: m.spend, label: formatDateShort(m.date) })),
    orders:      daily.map((m) => ({ value: m.orders, label: formatDateShort(m.date) })),
    acos:        daily.map((m) => ({ value: m.sales > 0 ? (m.spend / m.sales) * 100 : 0, label: formatDateShort(m.date) })),
  }), [daily]);

  const visibleAdGroups = useMemo(
    () =>
      [...(adGroupsQ.data ?? []).filter((ag) => activeChildrenOnly
        ? matchesEntityStateFilter(ag.state, "enabled")
        : shouldShowActiveOrPausedWithData(ag as any, ag.state))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [activeChildrenOnly, adGroupsQ.data],
  );
  const defaultBidByAdGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const ag of visibleAdGroups) {
      const bid = readTargetBid(ag as any);
      if (bid == null) continue;
      map.set(ag.id, bid);
      map.set(String(ag.id), bid);
    }
    return map;
  }, [visibleAdGroups]);
  const campaignFallbackDefaultBid = useMemo(() => {
    for (const ag of visibleAdGroups) {
      const bid = readTargetBid(ag as any);
      if (bid != null) return bid;
    }
    return undefined;
  }, [visibleAdGroups]);
  const resolveInheritedBid = (adGroupId: string | null | undefined) => {
    if (adGroupId != null && adGroupId !== "") {
      return defaultBidByAdGroupId.get(adGroupId) ?? defaultBidByAdGroupId.get(String(adGroupId)) ?? campaignFallbackDefaultBid;
    }
    return campaignFallbackDefaultBid;
  };
  const visibleProductTargets = useMemo(
    () =>
      [...(productTargetsQ.data ?? []).filter((pt) => activeChildrenOnly
        ? matchesEntityStateFilter((pt as any).state, "enabled")
        : shouldShowActiveOrPausedWithData(pt as any, (pt as any).state))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [activeChildrenOnly, productTargetsQ.data],
  );
  const visibleKeywords = useMemo(
    () =>
      (keywordsQ.data ?? []).filter((kw) => activeChildrenOnly
        ? matchesEntityStateFilter(kw.status, "enabled")
        : shouldShowActiveOrPausedWithData(kw as any, kw.status)),
    [activeChildrenOnly, keywordsQ.data],
  );
  const displayedKeywords = useMemo(
    () => visibleKeywords.slice(0, CAMPAIGN_TARGET_DISPLAY_LIMIT),
    [visibleKeywords],
  );
  const baseDisplayedProductTargets = useMemo(
    () => visibleProductTargets.slice(0, CAMPAIGN_TARGET_DISPLAY_LIMIT),
    [visibleProductTargets],
  );
  const displayedProductTargets = useVisibleProductTargetTitles(
    baseDisplayedProductTargets,
    `${id}:${dateRange.start}:${dateRange.end}:${productTargetsQ.dataUpdatedAt}`,
  );
  const campaignChildPreviewByAdGroup = useMemo(() => {
    const previews = new Map<string, { keywordCount: number; targetCount: number; labels: string[] }>();
    const ensure = (id: string) => {
      const current = previews.get(id) ?? { keywordCount: 0, targetCount: 0, labels: [] };
      previews.set(id, current);
      return current;
    };
    for (const keyword of visibleKeywords) {
      if (!keyword.ad_group_id) continue;
      const preview = ensure(String(keyword.ad_group_id));
      preview.keywordCount += 1;
      const label = String(keyword.keyword_text ?? "").trim();
      if (label && preview.labels.length < 3 && !preview.labels.includes(label)) preview.labels.push(label);
    }
    for (const target of visibleProductTargets) {
      if (!target.ad_group_id) continue;
      const preview = ensure(String(target.ad_group_id));
      preview.targetCount += 1;
      const label = productTargetHeading(target).trim();
      if (label && preview.labels.length < 3 && !preview.labels.includes(label)) preview.labels.push(label);
    }
    return previews;
  }, [visibleKeywords, visibleProductTargets]);
  const visibleProductAds = useMemo(
    () =>
      [...(productAdsQ.data ?? []).filter((pa) => activeChildrenOnly
        ? matchesEntityStateFilter(pa.status, "enabled")
        : shouldShowActiveOrPausedWithData(pa as any, pa.status))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [activeChildrenOnly, productAdsQ.data],
  );
  const sortedSearchTerms = useMemo(
    () => sortSearchTermsAcosThenSpend((searchTermsQ.data ?? []).filter((term) =>
      !activeChildrenOnly || activeAdGroupIds.includes(String(term.ad_group_id ?? "")),
    )),
    [activeAdGroupIds, activeChildrenOnly, searchTermsQ.data],
  );

  // Decide which targeting sections to show by what data actually exists
  const hasKeywords = visibleKeywords.length > 0;
  const hasProductTargets = visibleProductTargets.length > 0;

  if (selectedProfileIds.length === 0 && !profilesLoading) {
    return (
      <SubScreen title="Campaign" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see this campaign." />
      </SubScreen>
    );
  }

  if (profilesLoading || campaignQ.isLoading) {
    return (
      <SubScreen title="Campaign" showDateRange>
        <ScreenSpinner />
      </SubScreen>
    );
  }

  if (campaignQ.isError) {
    return (
      <SubScreen title="Campaign" showDateRange>
        <RetryState
          title="Couldn't load campaign"
          subtitle="Check your connection and try again."
          onRetry={() => void campaignQ.refetch()}
          retrying={campaignQ.isRefetching}
        />
      </SubScreen>
    );
  }

  if (!c) {
    return (
      <SubScreen title="Campaign" showDateRange>
        <EmptyState icon="alert-circle-outline" title="Campaign not found" />
      </SubScreen>
    );
  }

  const heroLoading = dailyMetricsQ.isLoading && daily.length === 0;
  const heroFailed = dailyMetricsQ.isError && daily.length === 0;
  const heroSpend  = dailyAgg.spend;
  const heroSales  = dailyAgg.sales;
  const heroOrders = dailyAgg.orders;
  const heroAcos   = heroSales > 0 ? (heroSpend / heroSales) * 100 : 0;
  const heroRoas   = heroSpend > 0 ? heroSales / heroSpend : 0;
  const heroCtr    = dailyAgg.impressions > 0 ? (dailyAgg.clicks / dailyAgg.impressions) * 100 : 0;
  const biddingLabel = biddingStrategyLabel(c.bidding_strategy);
  const settingsCooldown = getCampaignStrategyCooldown(c as any, entityCooldownHours);
  const displayBudget = readBudget(campaignApiQ.data, c);
  const placementAdjustments = readPlacementAdjustments(campaignApiQ.data, c as unknown as Record<string, unknown>);
  const budgetPeriod = (c.budget_type ?? "daily").toLowerCase() === "lifetime" ? "total" : "day";
  const budgetNoun = budgetPeriod === "total" ? "Lifetime budget" : "Daily budget";
  const placementRows = placementsQ.data ?? [];

  const changeBiddingStrategy = () => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    const current = normalizeBiddingStrategyCode(c.bidding_strategy);
    Alert.alert(
      "Bidding strategy",
      settingsCooldown.isInCooldown
        ? `On cooldown. Changing now resets the window.\nCurrent: ${biddingLabel}`
        : `Current: ${biddingLabel}`,
      [
        ...BIDDING_STRATEGY_OPTIONS.map((opt) => ({
          text: current === opt.code ? `${opt.label} ✓` : opt.label,
          onPress: () => {
            if (current === opt.code) return;
            void (async () => {
              try {
                assertCanWriteAmazon({ viewAsOtherUser });
                await updateCampaign(c.id, { biddingStrategy: opt.code });
                await persistCampaign();
                await campaignQ.refetch();
              } catch (error) {
                alertMutationError(error, "Couldn't update bidding strategy.");
              }
            })();
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  };

  const openEntityBidEdit = (
    edit: {
      kind: "keyword" | "target" | "adGroup";
      id: string;
      title: string;
      value: number;
      fallbackTargetIds?: string[];
    },
    opts?: { forceCooldown?: boolean },
  ) => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    setEntityBidEdit({ ...edit, forceCooldown: opts?.forceCooldown === true });
  };

  const addExactFromSearchTerm = async (st: { id: string; search_term?: string | null }) => {
    if (addingExactId) return;
    setAddingExactId(st.id);
    try {
      const ok = await fastAddSearchTermExact({
        guestMode,
        viewAsOtherUser,
        id: st.id,
        term: st.search_term ?? "",
        bid: defaultExactBid,
        onSuccess: async () => {
          queryClient.setQueriesData(
            { queryKey: ["campaign-search-terms-auto"] },
            (prev: any) => {
              if (!Array.isArray(prev)) return prev;
              return prev.map((row: any) =>
                String(row.id) === String(st.id)
                  ? { ...row, status: "targeted", has_target: true, is_targeted: true }
                  : row,
              );
            },
          );
          await Promise.all([searchTermsQ.refetch(), invalidateAds()]);
        },
      });
      if (!ok) return;
    } finally {
      setAddingExactId(null);
    }
  };

  const persistCampaign = async () => {
    await invalidateAds(["campaign-api", "campaign"]);
  };

  const renameCampaign = () => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    Alert.prompt(
      "Rename campaign",
      "The new name is written to Amazon Ads.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            const name = String(value ?? "").trim();
            if (!name || name === c?.name) return;
            void updateCampaign(c!.id, { name })
              .then(async () => {
                await persistCampaign();
                await campaignQ.refetch();
              })
              .catch((error) => alertMutationError(error, "Couldn't rename campaign."));
          },
        },
      ],
      "plain-text",
      c?.name ?? "",
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        campaignQ.refetch(),
        campaignApiQ.refetch(),
        ...(campaignBookAsin ? [bookPricingQ.refetch()] : []),
        dailyMetricsQ.refetch(),
        placementsQ.refetch(),
        adGroupsQ.refetch(),
        keywordsQ.refetch(),
        productTargetsQ.refetch(),
        productAdsQ.refetch(),
        searchTermsQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const verdict = heroFailed
    ? { label: "Performance unavailable", tone: "inactive" as const }
    : campaignVerdict({ spend: heroSpend, orders: heroOrders, sales: heroSales, acos: heroAcos });
  const targetingCaption = isAuto
    ? "Automatic"
    : hasKeywords && hasProductTargets
      ? "Keyword & product targeting"
      : hasProductTargets
        ? "Product targeting"
        : hasKeywords
          ? "Keyword targeting"
          : null;
  const productLabel = campaignProductLabel(c.type);
  const contextLine = [productLabel, targetingCaption, biddingLabel].filter(Boolean).join(" · ");
  const heroCvr = dailyAgg.clicks > 0 ? (dailyAgg.orders / dailyAgg.clicks) * 100 : 0;
  const heroCpc = dailyAgg.clicks > 0 ? heroSpend / dailyAgg.clicks : 0;
  const campaignCurrency = rowCurrencyOfProfile(profiles, c?.amazon_profile_id, primaryCurrency);
  const breakEvenAcos =
    bookPricingQ.data?.summary.pricingSynced && Number(bookPricingQ.data.summary.breakEvenAcos) > 0
      ? Number(bookPricingQ.data.summary.breakEvenAcos)
      : null;
  const budgetLabel =
    displayBudget != null
      ? `${formatCurrency(Number(displayBudget), campaignCurrency)}/${budgetPeriod}`
      : "—";
  const dash = (value: string) => (heroLoading || heroFailed ? "—" : value);
  const extraPlacements = placementRows.filter((row) => !placementEditorFor(row.placement));
  const targetingPending =
    !isAuto &&
    (awaitingChildScope ||
      ((keywordsQ.isLoading || productTargetsQ.isLoading) && !hasKeywords && !hasProductTargets));
  const targetingFailed =
    !isAuto &&
    !awaitingChildScope &&
    !hasKeywords &&
    !hasProductTargets &&
    (keywordsQ.isError || productTargetsQ.isError);
  const childPreviewLoading = awaitingChildScope || keywordsQ.isLoading || productTargetsQ.isLoading;
  const childPreviewFailed = keywordsQ.isError || productTargetsQ.isError;

  return (
    <SubScreen title={c.name} showDateRange>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />}
      >
        <SectionCard>
          <View style={styles.headerRow}>
            <EntityStateSwitch
              enabled={c.state === "enabled"}
              noun="campaign"
              testID={`campaign-state-${c.id}`}
              onChange={async (next) => {
                assertNotViewingAsOtherUser(viewAsOtherUser);
                const previous = applyOptimisticEntityState(queryClient, "campaign", c.id, next);
                try {
                  await updateCampaignState(c.id, next ? "enabled" : "paused");
                  await persistCampaign();
                  void invalidateEntityStateQueries(queryClient, "campaign");
                } catch (error) {
                  revertOptimisticEntityState(queryClient, "campaign", c.id, previous);
                  throw error;
                }
              }}
            />
            <View
              style={{ flex: 1, minWidth: 0 }}
              accessible
              accessibilityRole="header"
              accessibilityLabel={[
                c.name,
                countriesForSponsoredCampaign(marketplaceIndex, c).length >= 2
                  ? identityFlagsA11y(countriesForCampaignIdentity(profiles, c))
                  : null,
                heroLoading ? null : verdict.label,
                contextLine,
                c.state === "enabled" ? "Enabled" : "Paused",
              ].filter(Boolean).join(". ")}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Text
                  style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, minWidth: 0 }]}
                  numberOfLines={2}
                >
                  {c.name}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Rename campaign"
                  onPress={renameCampaign}
                  hitSlop={8}
                  style={{ padding: 2 }}
                >
                  <SFSymbol name="pencil" size={14} color={t.colors.tone_primary} />
                </TouchableOpacity>
                <CampaignMarketplaceFlags
                  index={marketplaceIndex}
                  profiles={profiles}
                  campaign={c}
                  style={t.typography.headline}
                />
              </View>
              <View style={styles.metaRow}>
                <View style={[styles.statusDot, { backgroundColor: toneColor(heroLoading ? "inactive" : verdict.tone, t.colors) }]} />
                <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                  {heroLoading ? "…" : verdict.label}
                </Text>
                {contextLine ? (
                  <TouchableOpacity onPress={changeBiddingStrategy} hitSlop={6}>
                    <Text
                      style={[
                        t.typography.caption1,
                        {
                          color: settingsCooldown.isInCooldown ? t.colors.tone_warning : t.colors.text_secondary,
                        },
                      ]}
                    >
                      {contextLine}
                      {settingsCooldown.isInCooldown ? " · Cooldown" : ""}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
          <TouchableOpacity
            testID={`campaign-budget-${c.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${budgetNoun} ${budgetLabel}. Edit budget.`}
            accessibilityHint="Opens the budget editor. Saving writes Amazon Ads."
            onPress={() => {
              if (blockIfCannotWriteAmazon(writeGuard)) return;
              setBudgetOpen(true);
            }}
            style={[styles.budgetRow, { borderTopColor: t.colors.separator }]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>{budgetNoun}</Text>
              <Text style={[t.typography.title2, { color: t.colors.text_primary, fontVariant: ["tabular-nums"], marginTop: 2 }]}>
                {budgetLabel}
              </Text>
            </View>
            <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Edit</Text>
          </TouchableOpacity>
          <View style={[styles.quickPlacements, { borderTopColor: t.colors.separator }]}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: 6 }]}>Placements</Text>
            <View style={styles.quickPlacementRow}>
              {PLACEMENT_EDITORS.map((editor) => (
                <MutationTap
                  key={editor.key}
                  testID={editor.testID}
                  label={editor.label}
                  compact
                  value={formatOptionalPercent(placementAdjustments[editor.key], 0)}
                  cooldown={getPlacementAdjCooldown(c as any, entityCooldownHours, Date.now(), editor.key)}
                  onPress={() => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    setPlacementEdit(editor);
                  }}
                />
              ))}
            </View>
          </View>
        </SectionCard>

        <View style={[styles.metricsCard, { backgroundColor: t.colors.background_secondary }]}>
          {heroFailed ? (
            <RetryState
              title="Couldn't load performance"
              subtitle="Identity, status, and budget are still available."
              onRetry={() => void dailyMetricsQ.refetch()}
              retrying={dailyMetricsQ.isRefetching}
            />
          ) : (
            <>
              <Text
                style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}
                accessibilityRole="header"
              >
                Outcome
              </Text>
              <MetricStrip
                items={[
                  {
                    label: "ACoS",
                    value: dash(heroSales > 0 ? formatPercent(heroAcos) : "—"),
                    color: toneColor(acosTone(heroAcos), t.colors),
                  },
                  { label: "Spend", value: dash(formatCurrency(heroSpend, campaignCurrency)) },
                  { label: "Orders", value: dash(formatInt(heroOrders)) },
                ]}
              />
              <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
              <Text
                style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}
                accessibilityRole="header"
              >
                Traffic
              </Text>
              <MetricStrip
                items={[
                  { label: "Clicks", value: dash(formatInt(dailyAgg.clicks)) },
                  { label: "Impr.", value: dash(formatInt(dailyAgg.impressions)) },
                  { label: "CTR", value: dash(dailyAgg.impressions > 0 ? formatPercent(heroCtr, 2) : "—") },
                  { label: "CVR", value: dash(dailyAgg.clicks > 0 ? formatPercent(heroCvr, 1) : "—") },
                ]}
              />
              <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
              <Text
                style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}
                accessibilityRole="header"
              >
                Efficiency
              </Text>
              <MetricStrip
                items={[
                  { label: "ROAS", value: dash(heroSpend > 0 ? `${heroRoas.toFixed(2)}x` : "—") },
                  { label: "CPC", value: dash(dailyAgg.clicks > 0 ? formatCurrency(heroCpc, campaignCurrency) : "—") },
                  {
                    label: "BE ACoS",
                    value: breakEvenAcos != null ? formatPercent(breakEvenAcos, 1) : "—",
                    color: breakEvenAcos != null ? t.colors.text_primary : t.colors.text_tertiary,
                  },
                ]}
              />
              {campaignBookAsin && bookPricingQ.isSuccess && !bookPricingQ.data.summary.pricingSynced ? (
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 8 }]}>KDP pricing sync required for BE ACoS.</Text>
              ) : null}
            </>
          )}
        </View>

        <SectionCard title="Placements">
          {placementsQ.isError && placementRows.length === 0 ? (
            <>
              {PLACEMENT_EDITORS.map((editor, idx) => (
                <PlacementBlock
                  key={editor.key}
                  name={editor.label}
                  testID={editor.testID}
                  adj={placementAdjustments[editor.key] ?? null}
                  row={undefined}
                  performanceState="error"
                  primaryCurrency={primaryCurrency}
                  isLast={idx === PLACEMENT_EDITORS.length - 1}
                  onEdit={() => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    setPlacementEdit(editor);
                  }}
                />
              ))}
              <RetryState
                title="Couldn't load placement performance"
                subtitle="Bid adjustments above are still the confirmed values."
                onRetry={() => void placementsQ.refetch()}
                retrying={placementsQ.isRefetching}
              />
            </>
          ) : placementsQ.isLoading && placementRows.length === 0 ? (
            <>
              {PLACEMENT_EDITORS.map((editor, idx) => (
                <PlacementBlock
                  key={editor.key}
                  name={editor.label}
                  testID={editor.testID}
                  adj={placementAdjustments[editor.key] ?? null}
                  row={undefined}
                  performanceState="loading"
                  primaryCurrency={primaryCurrency}
                  isLast={idx === PLACEMENT_EDITORS.length - 1}
                  onEdit={() => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    setPlacementEdit(editor);
                  }}
                />
              ))}
              <ScreenSpinner />
            </>
          ) : (
            <>
              {PLACEMENT_EDITORS.map((editor, idx) => {
                const row = placementRows.find((item) => placementEditorFor(item.placement)?.key === editor.key);
                return (
                  <PlacementBlock
                    key={editor.key}
                    name={editor.label}
                    testID={editor.testID}
                    adj={placementAdjustments[editor.key] ?? null}
                    row={row}
                    performanceState={row ? "ready" : "empty"}
                    primaryCurrency={primaryCurrency}
                    isLast={idx === PLACEMENT_EDITORS.length - 1 && extraPlacements.length === 0}
                    onEdit={() => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    setPlacementEdit(editor);
                  }}
                  />
                );
              })}
              {extraPlacements.map((row, idx) => (
                <PlacementBlock
                  key={row.placement}
                  name={row.label}
                  adj={null}
                  row={row}
                  performanceState="ready"
                  primaryCurrency={primaryCurrency}
                  isLast={idx === extraPlacements.length - 1}
                />
              ))}
            </>
          )}
        </SectionCard>

        {dailyMetricsQ.isError && daily.length === 0 ? (
          <SectionCard title="Daily performance">
            <RetryState
              title="Couldn't load trend"
              subtitle="Totals above, if shown, are still for this date range."
              onRetry={() => void dailyMetricsQ.refetch()}
              retrying={dailyMetricsQ.isRefetching}
            />
          </SectionCard>
        ) : heroLoading ? (
          <SectionCard title="Daily performance">
            <ScreenSpinner />
          </SectionCard>
        ) : daily.length > 0 ? (
          <SectionCard title="Daily performance">
            <CampaignDailyChart
              impressionsData={perf.impressions}
              clicksData={perf.clicks}
              spendData={perf.spend}
              ordersData={perf.orders}
              acosData={perf.acos}
              width={chartWidth}
              currency={primaryCurrency}
            />
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.chart_grid }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Impressions</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_placement }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Clicks</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_warning }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Spend</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_primary }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Orders</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_good }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>ACoS</Text>
              </View>
            </View>
          </SectionCard>
        ) : (
          <SectionCard title="Daily performance">
            <EmptyState
              icon="stats-chart-outline"
              title="No daily performance"
              subtitle="No trend points in this date range."
            />
          </SectionCard>
        )}

        {!heroLoading && !heroFailed ? (
          <SectionCard title="Conversion funnel">
            {dailyAgg.impressions > 0 || dailyAgg.clicks > 0 || dailyAgg.orders > 0 ? (
              <Funnel impressions={dailyAgg.impressions} clicks={dailyAgg.clicks} orders={dailyAgg.orders} />
            ) : (
              <EmptyState
                icon="funnel-outline"
                title="No conversion traffic"
                subtitle="No impressions, clicks, or orders in this date range."
              />
            )}
          </SectionCard>
        ) : null}

        <SectionCard
          title={`Ad Groups (${visibleAdGroups.length})`}
          action={{
            label: "New ad group",
            onPress: () => {
              if (blockIfCannotWriteAmazon(writeGuard)) return;
              router.push({
                pathname: "/campaign/ad-group-create",
                params: { campaignId: c.id, asin: campaignBookAsin ?? "" },
              } as any);
            },
          }}
        >
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginBottom: spacing.sm }]}>
            Performance metrics · {formatDateRangeLabel(dateRange)}
          </Text>
          {adGroupsQ.isError && visibleAdGroups.length === 0 ? (
            <RetryState
              title="Couldn't load ad groups"
              subtitle="The rest of this campaign is still available."
              onRetry={() => void adGroupsQ.refetch()}
              retrying={adGroupsQ.isRefetching}
            />
          ) : adGroupsQ.isLoading && visibleAdGroups.length === 0 ? (
            <ScreenSpinner />
          ) : visibleAdGroups.length > 0 ? (
            visibleAdGroups.map((ag, idx) => {
              const agAcos = Number(ag.total_acos);
              const agSales = Number(ag.total_sales);
              const defaultBid = readTargetBid(ag as any);
              const bidChipValue = defaultBid ?? campaignFallbackDefaultBid ?? null;
              const childPreview = campaignChildPreviewByAdGroup.get(String(ag.id));
              const childCountLabel = childPreview
                ? `${childPreview.keywordCount} keywords · ${childPreview.targetCount} product targets`
                : childPreviewLoading
                  ? "Loading targets"
                  : childPreviewFailed
                    ? "Targets unavailable"
                    : "No targets";
              return (
                <View
                  key={ag.id}
                  style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === visibleAdGroups.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                >
                  <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()} style={{ marginRight: 8 }}>
                    <EntityStateSwitch
                      testID={`campaign-adgroup-state-${ag.id}`}
                      enabled={matchesEntityStateFilter(ag.state, "enabled")}
                      noun="ad group"
                      confirmPause
                      onChange={async (next) => {
                        assertNotViewingAsOtherUser(viewAsOtherUser);
                        const previous = applyOptimisticEntityState(queryClient, "ad_group", ag.id, next);
                        try {
                          await updateAdGroupState(ag.id, next ? "enabled" : "paused");
                          void invalidateEntityStateQueries(queryClient, "ad_group");
                          void adGroupsQ.refetch();
                        } catch (error) {
                          revertOptimisticEntityState(queryClient, "ad_group", ag.id, previous);
                          throw error;
                        }
                      }}
                    />
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.72}
                    accessibilityRole="button"
                    accessibilityLabel={`${ag.name || "Ad Group"}, ${statusLabel(ag.state)}, ACoS ${agSales > 0 ? formatPercent(agAcos) : "none"}, spend ${formatCurrency(Number(ag.total_spend), primaryCurrency)}, ${formatInt(Number(ag.total_orders))} orders`}
                    onPress={() =>
                      router.push({
                        pathname: "/more/ad-group/[id]",
                        params: {
                          id: ag.id,
                          name: ag.name || "Ad Group",
                          isAuto: String(!!(ag as any).is_auto),
                          spend: String(ag.total_spend ?? 0),
                          orders: String(ag.total_orders ?? 0),
                          acos: String(ag.total_acos ?? 0),
                          ctr: String(ag.total_ctr || safeDivide(ag.total_clicks, ag.total_impressions) * 100),
                          clicks: String(ag.total_clicks ?? 0),
                          impressions: String(ag.total_impressions ?? 0),
                        },
                      })
                    }
                    style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <ToneDot value={agAcos} />
                        <Text style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={2}>
                          {ag.name || "Ad Group"}
                        </Text>
                      </View>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 3 }]} numberOfLines={1}>
                        {statusLabel(ag.state)} · {formatCurrency(Number(ag.total_spend), primaryCurrency)} spend · {formatInt(Number(ag.total_impressions))} impr · {formatInt(Number(ag.total_clicks))} clicks · {formatInt(Number(ag.total_orders))} orders
                      </Text>
                      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginLeft: 16, marginTop: 2 }]} numberOfLines={1}>
                        {childCountLabel}{childPreview?.labels.length ? ` · ${childPreview.labels.join(" · ")}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", marginLeft: spacing.sm }}>
                      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>ACoS</Text>
                      <Text style={[t.typography.callout, { color: toneColor(acosTone(agAcos), t.colors), fontVariant: ["tabular-nums"] }]}>
                        {agSales > 0 ? formatPercent(agAcos) : "—"}
                      </Text>
                    </View>
                    <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
                  </TouchableOpacity>
                  <View onStartShouldSetResponder={() => true} onTouchEnd={(e) => e.stopPropagation()} style={{ marginLeft: 8 }}>
                    <MutationTap
                      testID={`campaign-adgroup-bid-${ag.id}`}
                      label="Bid"
                      compact
                      value={bidChipValue != null ? formatCurrency(bidChipValue, primaryCurrency) : "Set"}
                      currency={primaryCurrency}
                      cooldownRow={ag as any}
                      onPress={(opts) =>
                        openEntityBidEdit(
                          {
                            kind: "adGroup",
                            id: ag.id,
                            title: `${ag.name || "Ad Group"} default bid`,
                            value: bidChipValue ?? 0.02,
                            fallbackTargetIds: (productTargetsQ.data ?? [])
                              .filter((pt) => {
                                if (pt.ad_group_id !== ag.id) return false;
                                return describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression).isAuto;
                              })
                              .map((pt) => pt.id),
                          },
                          opts,
                        )
                      }
                    />
                  </View>
                </View>
              );
            })
          ) : (
            <EmptyState
              icon="layers-outline"
              title="No ad groups"
              subtitle="This campaign has no ad groups to inspect."
            />
          )}
        </SectionCard>

        {!isAuto && hasKeywords ? (
          <SectionCard title={`Keywords · Top ${displayedKeywords.length} of ${visibleKeywords.length}`}>
            {displayedKeywords.map((kw, idx) => (
              <View
                key={kw.id}
                style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === displayedKeywords.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
              >
                <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()} style={{ marginRight: 8 }}>
                  <EntityStateSwitch
                    testID={`campaign-keyword-state-${kw.id}`}
                    enabled={matchesEntityStateFilter(kw.status, "enabled")}
                    noun="keyword"
                    onChange={async (next) => {
                      assertNotViewingAsOtherUser(viewAsOtherUser);
                      const previous = applyOptimisticEntityState(queryClient, "keyword", kw.id, next);
                      try {
                        await updateKeywordManual(kw.id, { status: next ? "enabled" : "paused" });
                        void invalidateEntityStateQueries(queryClient, "keyword");
                      } catch (error) {
                        revertOptimisticEntityState(queryClient, "keyword", kw.id, previous);
                        throw error;
                      }
                    }}
                  />
                </View>
                <TouchableOpacity
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${kw.keyword_text || "Keyword"}${kw.match_type ? `, ${formatMatchTypeLabel(kw.match_type)}` : ""}, ${formatInt(kw.total_clicks)} clicks, ${formatInt(kw.total_orders)} orders`}
                  onPress={() => router.push(`/keyword/${kw.id}` as any)}
                  style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={1}>{kw.keyword_text}</Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]} numberOfLines={1}>
                      <Text
                        style={{
                          color: t.colors.text_secondary,
                          fontWeight: isExactMatchType(kw.match_type) ? "700" : "500",
                        }}
                      >
                        {formatMatchTypeLabel(kw.match_type)}
                      </Text>
                      {kw.match_type ? " · " : ""}
                      {statusLabel(kw.status)}
                    </Text>
                    <DenseMetricLine items={campaignTargetMetricItems(kw, primaryCurrency, t)} />
                  </View>
                  <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
                </TouchableOpacity>
                <View onStartShouldSetResponder={() => true} onTouchEnd={(e) => e.stopPropagation()} style={{ marginLeft: 8 }}>
                  <MutationTap
                    testID={`campaign-keyword-bid-${kw.id}`}
                    label="Bid"
                    compact
                    value={(() => {
                      const bid = readTargetBid(kw as any, resolveInheritedBid(kw.ad_group_id));
                      return bid != null ? formatCurrency(bid, primaryCurrency) : "Set";
                    })()}
                    currency={primaryCurrency}
                    cooldownRow={kw as any}
                    onPress={(opts) =>
                      openEntityBidEdit(
                        {
                          kind: "keyword",
                          id: kw.id,
                          title: kw.keyword_text || "Keyword bid",
                          value: readTargetBid(kw as any, resolveInheritedBid(kw.ad_group_id)) ?? 0.02,
                        },
                        opts,
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {!isAuto && hasProductTargets ? (
          <SectionCard title={`Product targets · Top ${displayedProductTargets.length} of ${visibleProductTargets.length}`}>
            {displayedProductTargets.map((pt: any, idx) => (
              <ProductTargetRow
                key={pt.id}
                pt={pt}
                isLast={idx === displayedProductTargets.length - 1}
                primaryCurrency={primaryCurrency}
                inheritedDefaultBid={resolveInheritedBid(pt.ad_group_id)}
                t={t}
                viewAsOtherUser={viewAsOtherUser}
                onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
                onEditBid={(opts) => {
                  const bid = readTargetBid(pt, resolveInheritedBid(pt.ad_group_id));
                  openEntityBidEdit(
                    {
                      kind: "target",
                      id: pt.id,
                      title: describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression).label,
                      value: bid ?? 0.02,
                    },
                    opts,
                  );
                }}
              />
            ))}
          </SectionCard>
        ) : null}

        {targetingPending ? (
          <SectionCard title="Targeting">
            <ScreenSpinner />
          </SectionCard>
        ) : targetingFailed ? (
          <SectionCard title="Targeting">
            <RetryState
              title="Couldn't load targets"
              subtitle="Campaign performance above is still available."
              onRetry={() => {
                void keywordsQ.refetch();
                void productTargetsQ.refetch();
              }}
              retrying={keywordsQ.isRefetching || productTargetsQ.isRefetching}
            />
          </SectionCard>
        ) : !isAuto && !hasKeywords && !hasProductTargets ? (
          <SectionCard title="Targeting">
            <EmptyState
              icon="search-outline"
              title="No targets synced"
              subtitle="No enabled or paused keywords/product targets for this campaign yet."
            />
          </SectionCard>
        ) : null}

        {isAuto && hasProductTargets ? (
          <SectionCard title={`Auto Targeting (${visibleProductTargets.length})`}>
            {displayedProductTargets.map((pt: any, idx) => (
              <ProductTargetRow
                key={pt.id}
                pt={pt}
                variant="auto"
                isLast={idx === displayedProductTargets.length - 1}
                primaryCurrency={primaryCurrency}
                inheritedDefaultBid={resolveInheritedBid(pt.ad_group_id)}
                t={t}
                viewAsOtherUser={viewAsOtherUser}
                onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
                onEditBid={(opts) => {
                  const bid = readTargetBid(pt, resolveInheritedBid(pt.ad_group_id));
                  openEntityBidEdit(
                    {
                      kind: "target",
                      id: pt.id,
                      title: productTargetHeading(pt),
                      value: bid ?? 0.02,
                    },
                    opts,
                  );
                }}
              />
            ))}
          </SectionCard>
        ) : null}

        {isAuto ? (
          <SectionCard title="Search terms">
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginBottom: spacing.md }]}>
              Last 65 days · sorted by ACoS, then spend.
            </Text>
            {searchTermsQ.isError && (searchTermsQ.data ?? []).length === 0 ? (
              <RetryState
                title="Couldn't load search terms"
                subtitle="This list uses the last 65 days, not the screen date range."
                onRetry={() => void searchTermsQ.refetch()}
                retrying={searchTermsQ.isRefetching}
              />
            ) : searchTermsQ.isLoading && (searchTermsQ.data ?? []).length === 0 ? (
              <ScreenSpinner />
            ) : sortedSearchTerms.length > 0 ? (
              sortedSearchTerms.map((st: any, idx) => {
                const isWinner = Number(st.total_orders) > 0;
                const already = searchTermLooksTargeted(st);
                return (
                  <View
                    key={st.id}
                    style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === sortedSearchTerms.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`${st.search_term}, ${isWinner ? "converting" : "no orders"}`}
                      onPress={() => router.push({
                        pathname: "/search-term/[id]",
                        params: { id: st.id, term: st.search_term ?? "", campaign: c.name ?? "" },
                      } as any)}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>{st.search_term}</Text>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                        {isWinner ? "Converting" : "No orders"} · {formatCurrency(st.total_spend, primaryCurrency)} · {formatInt(st.total_orders)}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID={`campaign-search-term-add-exact-${st.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={already ? `Already a keyword for ${st.search_term}` : `Add ${st.search_term} as Exact`}
                      disabled={already || addingExactId === st.id}
                      onPress={() => void addExactFromSearchTerm(st)}
                      style={{
                        marginLeft: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: radii.sm,
                        backgroundColor: already ? t.colors.background_tertiary : `${t.colors.tone_primary}18`,
                        opacity: addingExactId === st.id ? 0.6 : 1,
                      }}
                    >
                      <Text style={[t.typography.caption1, { color: already ? t.colors.text_tertiary : t.colors.tone_primary, fontWeight: "700" }]}>
                        {already ? "Added" : addingExactId === st.id ? "…" : "Exact"}
                      </Text>
                    </TouchableOpacity>
                    <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon="search-outline"
                title="No search terms yet"
                subtitle="Nothing in the last 65 days."
              />
            )}
          </SectionCard>
        ) : null}

        <SectionCard title={`Advertised Products (${visibleProductAds.length})`}>
          {awaitingChildScope || (productAdsQ.isLoading && visibleProductAds.length === 0) ? (
            <ScreenSpinner />
          ) : productAdsQ.isError && visibleProductAds.length === 0 ? (
            <RetryState
              title="Couldn't load advertised products"
              subtitle="The rest of this campaign is still available."
              onRetry={() => void productAdsQ.refetch()}
              retrying={productAdsQ.isRefetching}
            />
          ) : visibleProductAds.length > 0 ? (
            visibleProductAds.map((pa, idx) => (
              <AdvertisedProductRow
                key={pa.id}
                pa={pa}
                isLast={idx === visibleProductAds.length - 1}
                primaryCurrency={primaryCurrency}
                t={t}
                onOpenBook={(asin, title, imageUrl) =>
                  router.push({
                    pathname: "/product/[asin]",
                    params: { asin, title: title ?? "", imageUrl: imageUrl ?? "" },
                  })
                }
              />
            ))
          ) : (
            <EmptyState
              icon="cube-outline"
              title="No advertised products"
              subtitle={
                activeChildrenOnly && activeAdGroupIds.length === 0
                  ? "No enabled ad groups with product ads in this campaign."
                  : "No product ads in this campaign."
              }
            />
          )}
        </SectionCard>
      </ScrollView>

      <BidBudgetEditor
        visible={budgetOpen}
        title={budgetNoun}
        value={displayBudget ?? 0}
        currency={primaryCurrency}
        kind="money"
        onClose={() => setBudgetOpen(false)}
        onSave={async (next) => {
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          await updateCampaign(c.id, { budget: next });
          await persistCampaign();
        }}
      />
      <BidBudgetEditor
        visible={placementEdit != null}
        title={`${placementEdit?.label ?? "Placement"} %`}
        value={placementEdit ? placementAdjustments[placementEdit.key] ?? 0 : 0}
        kind="percent"
        min={0}
        max={900}
        onClose={() => setPlacementEdit(null)}
        onSave={async (next) => {
          if (!placementEdit) return;
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          await updateCampaign(c.id, { placementAdjustments: { [placementEdit.key]: next } });
          await persistCampaign();
        }}
      />
      <BidBudgetEditor
        visible={entityBidEdit != null}
        title={entityBidEdit?.title ?? "Bid"}
        value={entityBidEdit?.value ?? 0.02}
        currency={primaryCurrency}
        kind="money"
        onClose={() => setEntityBidEdit(null)}
        onSave={async (next) => {
          if (!entityBidEdit) return;
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          const edit = entityBidEdit;
          let previousBid: number | null = null;
          if (edit.kind === "keyword" || edit.kind === "target") {
            previousBid = applyOptimisticEntityBid(
              queryClient,
              edit.kind === "keyword" ? "keyword" : "product_target",
              edit.id,
              next,
            );
          } else if (edit.kind === "adGroup") {
            queryClient.setQueriesData(
              {
                predicate: (query) => {
                  const key = query.queryKey[0];
                  return typeof key === "string" && (key.startsWith("campaign") || key.startsWith("ad-group") || key === "ad-groups");
                },
              },
              (old: unknown) => {
              if (Array.isArray(old)) {
                return old.map((row: any) =>
                  row?.id === edit.id ? { ...row, default_bid: next, bid_last_modified_at: new Date().toISOString() } : row,
                );
              }
              return old;
            });
          }
          const write =
            edit.kind === "adGroup"
              ? updateAdGroupManual(
                  edit.id,
                  { defaultBid: next, forceCooldown: edit.forceCooldown === true },
                  edit.fallbackTargetIds ?? [],
                )
              : enqueueEntityBidWrite({
                  entityKind: edit.kind === "keyword" ? "keyword" : "product_target",
                  entityId: edit.id,
                  bid: next,
                  previousBid,
                  forceCooldown: edit.forceCooldown === true,
                });
          void write
            .then(() => {
              if (edit.kind === "adGroup") {
                void invalidateAds([
                  "campaign",
                  "campaign-keywords",
                  "campaign-product-targets",
                  "campaign-adgroups",
                  "keywords",
                  "product-targets",
                  "ad-groups",
                ]);
                void Promise.all([keywordsQ.refetch(), productTargetsQ.refetch(), adGroupsQ.refetch()]);
              }
            })
            .catch((error) => {
              if (edit.kind === "keyword" || edit.kind === "target") {
                revertOptimisticEntityBid(
                  queryClient,
                  edit.kind === "keyword" ? "keyword" : "product_target",
                  edit.id,
                  previousBid,
                );
              }
              alertMutationError(error);
            });
        }}
      />
    </SubScreen>
  );
}

function PlacementBlock({
  name,
  testID,
  adj,
  row,
  performanceState,
  primaryCurrency,
  isLast,
  onEdit,
}: {
  name: string;
  testID?: string;
  adj: number | null;
  row?: CampaignPlacementRow;
  performanceState: "ready" | "loading" | "empty" | "error";
  primaryCurrency: string;
  isLast: boolean;
  onEdit?: () => void;
}) {
  const t = useTheme();
  const adjLabel = adj == null ? null : formatPercent(adj, 0);
  const a11y = [
    name,
    adjLabel ? `Bid adjustment ${adjLabel}` : null,
    row ? `Spend ${formatCurrency(row.spend, primaryCurrency)}` : null,
    row ? `${formatInt(row.impressions)} impressions` : null,
    row ? `${formatInt(row.clicks)} clicks` : null,
    row ? `${formatInt(row.orders)} orders` : null,
    row ? `ACoS ${row.sales > 0 ? formatPercent(row.acos) : "none"}` : null,
    onEdit ? "Edit placement" : null,
  ].filter(Boolean).join(". ");

  const body = (
    <View style={styles.placementBlock}>
      <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{name}</Text>
      {adjLabel != null ? (
        <View style={styles.placementFact}>
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Bid adjustment</Text>
          <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>{adjLabel}</Text>
        </View>
      ) : null}
      {performanceState === "ready" && row ? (
        <>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Spend</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
              {formatCurrency(row.spend, primaryCurrency)}
            </Text>
          </View>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Impr</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
              {formatInt(row.impressions)}
            </Text>
          </View>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Clicks</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
              {formatInt(row.clicks)}
            </Text>
          </View>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Orders</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
              {formatInt(row.orders)}
            </Text>
          </View>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>ACoS</Text>
            <Text style={[t.typography.callout, { color: toneColor(acosTone(row.acos), t.colors), fontVariant: ["tabular-nums"] }]}>
              {row.sales > 0 ? formatPercent(row.acos) : "—"}
            </Text>
          </View>
          <View style={styles.placementFact}>
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Share of spend</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_secondary, fontVariant: ["tabular-nums"] }]}>
              {formatPercent(row.share, 0)}
            </Text>
          </View>
        </>
      ) : performanceState === "loading" ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Loading performance…</Text>
      ) : performanceState === "error" ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Performance unavailable</Text>
      ) : (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>No placement performance in this range</Text>
      )}
    </View>
  );

  const wrapStyle = [styles.placementWrap, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }];

  if (onEdit) {
    return (
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        activeOpacity={0.75}
        onPress={onEdit}
        style={wrapStyle}
      >
        {body}
      </TouchableOpacity>
    );
  }

  return <View style={wrapStyle}>{body}</View>;
}

function campaignTargetMetricItems(item: any, currency: string, t: any) {
  const spend = Number(item.total_spend) || 0;
  const sales = Number(item.total_sales) || 0;
  const acos = Number(item.total_acos) || safeDivide(spend, sales) * 100;
  return [
    { label: "Spend", value: formatCurrency(spend, currency) },
    { label: "Impr", value: formatInt(Number(item.total_impressions) || 0) },
    { label: "Clicks", value: formatInt(Number(item.total_clicks) || 0) },
    { label: "Orders", value: formatInt(Number(item.total_orders) || 0) },
    {
      label: "ACoS",
      value: sales > 0 ? formatPercent(acos) : "—",
      color: sales > 0 ? toneColor(acosTone(acos), t.colors) : t.colors.text_secondary,
    },
  ];
}

function ProductTargetRow({
  pt,
  isLast,
  primaryCurrency,
  inheritedDefaultBid,
  t,
  viewAsOtherUser,
  onOpenTarget,
  onEditBid,
  variant = "product",
}: {
  pt: any;
  isLast: boolean;
  primaryCurrency: string;
  inheritedDefaultBid?: number;
  t: any;
  viewAsOtherUser: boolean;
  onOpenTarget: (targetId: string) => void;
  onEditBid: (opts?: { forceCooldown?: boolean }) => void;
  variant?: "auto" | "product";
}) {
  const queryClient = useQueryClient();
  const target = describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression);
  const fallbackCover = fallbackAsinCoverUrl(target.asin);
  const title = variant === "auto" ? target.label : productTargetHeading(pt);
  const bid = readTargetBid(pt, inheritedDefaultBid);
  const stateText = statusLabel(pt.state);

  return (
    <View style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()} style={{ marginRight: 8 }}>
        <EntityStateSwitch
          testID={`campaign-target-state-${pt.id}`}
          enabled={matchesEntityStateFilter(pt.state, "enabled")}
          noun="target"
          onChange={async (next) => {
            assertNotViewingAsOtherUser(viewAsOtherUser);
            const previous = applyOptimisticEntityState(queryClient, "product_target", pt.id, next);
            try {
              await updateProductTargetManual(pt.id, { state: next ? "enabled" : "paused" });
              void invalidateEntityStateQueries(queryClient, "product_target");
            } catch (error) {
              revertOptimisticEntityState(queryClient, "product_target", pt.id, previous);
              throw error;
            }
          }}
        />
      </View>
      <TouchableOpacity
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${target.label}, ${stateText}`}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}
        onPress={() => onOpenTarget(pt.id)}
      >
        <BookCover
          uri={pt.image_url}
          fallbackUri={fallbackCover}
          asin={target.asin}
          size="xs"
          placeholder={target.isAuto ? "auto" : target.asin ? "book" : "cube"}
          recyclingKey={target.asin || pt.id}
        />
        <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
          <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={2}>
            {variant === "auto" ? null : (
              <Text
                style={{
                  color: t.colors.text_secondary,
                  fontWeight: isExactMatchType(target.label) ? "700" : "500",
                }}
              >
                {formatMatchTypeLabel(target.label) || target.label}
              </Text>
            )}
            {variant === "auto" ? null : " · "}
            {[stateText, target.asin]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <DenseMetricLine items={campaignTargetMetricItems(pt, primaryCurrency, t)} />
        </View>
        <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
      </TouchableOpacity>
      <View onStartShouldSetResponder={() => true} onTouchEnd={(e) => e.stopPropagation()} style={{ marginLeft: 8 }}>
        <MutationTap
          testID={`campaign-target-bid-${pt.id}`}
          label="Bid"
          compact
          value={bid != null ? formatCurrency(bid, primaryCurrency) : "Set"}
          currency={primaryCurrency}
          cooldownRow={pt}
          onPress={onEditBid}
        />
      </View>
    </View>
  );
}

function AdvertisedProductRow({
  pa,
  isLast,
  primaryCurrency,
  t,
  onOpenBook,
}: {
  pa: any;
  isLast: boolean;
  primaryCurrency: string;
  t: any;
  onOpenBook: (asin: string, title?: string | null, imageUrl?: string | null) => void;
}) {
  const fallbackCover = fallbackAsinCoverUrl(pa.asin);
  const title = pa.title || pa.asin || pa.sku || "Advertised product";
  const acos = safeDivide(Number(pa.total_spend ?? 0), Number(pa.total_sales ?? 0)) * 100;
  const canOpen = Boolean(pa.asin);

  const content = (
    <>
      <BookCover
        uri={pa.image_url}
        fallbackUri={fallbackCover}
        asin={pa.asin}
        size="xs"
        recyclingKey={pa.asin || pa.id}
      />
      <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
        <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={2}>
          {[statusLabel(pa.status), pa.asin, `${formatCurrency(Number(pa.total_spend ?? 0), primaryCurrency)} spend`, `${formatInt(Number(pa.total_orders ?? 0))} orders`, Number(pa.total_sales ?? 0) > 0 ? `${formatPercent(acos)} ACoS` : null].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </>
  );

  const rowStyle = [styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }];
  if (!canOpen) return <View style={rowStyle}>{content}</View>;

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${statusLabel(pa.status)}`}
      style={rowStyle}
      onPress={() => onOpenBook(pa.asin, pa.title, pa.image_url || fallbackCover)}
    >
      {content}
      <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: { padding: layout.pagePad, paddingBottom: 80 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.xs,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  budgetRow: {
    minHeight: layout.minTap,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  quickPlacements: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quickPlacementRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricsCard: {
    borderRadius: radii.md,
    padding: spacing.card,
    marginBottom: spacing.lg,
  },
  metricsSplit: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, justifyContent: "center", marginTop: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  productThumb: {
    width: 44,
    height: 56,
    borderRadius: radii.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  placementWrap: { paddingVertical: spacing.md },
  placementBlock: { gap: spacing.sm },
  placementFact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.md,
  },
});
