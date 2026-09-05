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
  fetchKeywords,
  fetchProductAds,
  fetchProductTargets,
  fetchSearchTerms,
  fetchCampaignPlacements,
  aggregateDailyMetrics,
  fetchCampaignMetricsForCampaign,
  type CampaignPlacementRow,
} from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  formatDateShort,
  safeDivide,
} from "@/src/lib/format";
import { EmptyState, ToneDot, SectionCard, MetricStrip, RetryState, ScreenSpinner } from "@/src/components/Primitives";
import { alertMutationError, assertCanWriteAmazon, assertNotViewingAsOtherUser, BidBudgetEditor, blockIfCannotWriteAmazon, EntityStateSwitch, MutationTap } from "@/src/components/Mutations";
import { CampaignDailyChart, Funnel } from "@/src/components/Charts";
import { SubScreen } from "@/src/components/SubScreen";
import {
  BIDDING_STRATEGY_OPTIONS,
  biddingStrategyLabel,
  normalizeBiddingStrategyCode,
  shouldShowActiveOrPausedWithData,
  statusLabel,
} from "@/src/lib/campaigns";
import { getCampaignSettingsCooldown } from "@/src/lib/bidCooldown";
import {
  fetchCampaignApi,
  updateAdGroupManual,
  updateCampaign,
  updateCampaignState,
  type PlacementAdjustments,
} from "@/src/lib/mutations";
import { applyOptimisticEntityBid, applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityBid, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { enqueueEntityBidWrite } from "@/src/lib/bulkOutbox";
import { describeProductTarget, fallbackAsinCoverUrl, productTargetHeading, readTargetBid } from "@/src/lib/targeting";
import { compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { countriesForSponsoredCampaign, marketplaceFlagsA11y } from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { CampaignMarketplaceFlags } from "@/src/components/MarketplaceFlags";

const PLACEMENT_EDITORS: {
  key: keyof PlacementAdjustments;
  label: string;
  testID: "campaign-placement-top" | "campaign-placement-product" | "campaign-placement-rest";
}[] = [
  { key: "top_of_search", label: "Top of search", testID: "campaign-placement-top" },
  { key: "product_pages", label: "Product pages", testID: "campaign-placement-product" },
  { key: "rest_of_search", label: "Rest of search", testID: "campaign-placement-rest" },
];

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
): Required<PlacementAdjustments> {
  const apiAdj = api?.placementAdjustments;
  const sbAdj = (campaign?.placementAdjustments ?? campaign?.placement_adjustments) as PlacementAdjustments | undefined;
  const pick = (key: keyof PlacementAdjustments, snake: string) => {
    const raw = apiAdj?.[key] ?? sbAdj?.[key] ?? campaign?.[snake] ?? campaign?.[key];
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { primaryCurrency, dateRange, selectedProfileIds, profilesLoading, adminFilterUserId } = useApp();
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
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const c = campaignQ.data;
  // Auto vs manual is determined ONLY by targeting_type. `type` is the ad-product
  // (e.g. "sponsoredProducts") and must NOT be used to infer product-targeting.
  const isAuto = (c?.targeting_type ?? "").toLowerCase() === "auto";

  const adGroupsQ = useQuery({
    queryKey: ["campaign-adgroups", id, c?.amazon_profile_id, dateRange.start, dateRange.end],
    queryFn: () => fetchAdGroups([c!.amazon_profile_id], id!, { start: dateRange.start, end: dateRange.end }),
    enabled: !!c,
  });

  // For manual campaigns, fetch BOTH keywords and product targets — show whichever
  // has data (handles keyword, product-targeting, and mixed campaigns correctly).
  const keywordsQ = useQuery({
    queryKey: ["campaign-keywords", adminFilterUserId ?? "self", id, c?.amazon_profile_id, dateRange.start, dateRange.end],
    queryFn: () => fetchKeywords([c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean), { campaignId: id!, limit: 500, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!c && !isAuto,
  });

  const productTargetsQ = useQuery({
    queryKey: ["campaign-product-targets", adminFilterUserId ?? "self", id, c?.amazon_profile_id, dateRange.start, dateRange.end],
    queryFn: () => fetchProductTargets([c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean), { campaignId: id!, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!c,
  });

  const searchTermsQ = useQuery({
    queryKey: ["campaign-search-terms-auto", id, c?.amazon_profile_id],
    queryFn: () => fetchSearchTerms([c!.amazon_profile_id], { campaignId: id!, limit: 100, start: autoRange.start, end: autoRange.end }),
    enabled: !!c && isAuto,
  });

  const productAdsQ = useQuery({
    queryKey: ["campaign-products", id, c?.amazon_profile_id, dateRange.start, dateRange.end],
    queryFn: () => fetchProductAds([c!.amazon_profile_id], { campaignId: id!, start: dateRange.start, end: dateRange.end }),
    enabled: !!c,
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
    spend:       daily.map((m) => ({ value: m.spend, label: formatDateShort(m.date) })),
    orders:      daily.map((m) => ({ value: m.orders, label: formatDateShort(m.date) })),
    acos:        daily.map((m) => ({ value: m.sales > 0 ? (m.spend / m.sales) * 100 : 0, label: formatDateShort(m.date) })),
  }), [daily]);

  const visibleAdGroups = useMemo(
    () =>
      [...(adGroupsQ.data ?? []).filter((ag) => shouldShowActiveOrPausedWithData(ag as any, ag.state))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [adGroupsQ.data],
  );
  const defaultBidByAdGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const ag of adGroupsQ.data ?? []) {
      const bid = readTargetBid(ag as any);
      if (bid == null) continue;
      map.set(ag.id, bid);
      map.set(String(ag.id), bid);
    }
    return map;
  }, [adGroupsQ.data]);
  const campaignFallbackDefaultBid = useMemo(() => {
    for (const ag of adGroupsQ.data ?? []) {
      const bid = readTargetBid(ag as any);
      if (bid != null) return bid;
    }
    return undefined;
  }, [adGroupsQ.data]);
  const resolveInheritedBid = (adGroupId: string | null | undefined) => {
    if (adGroupId != null && adGroupId !== "") {
      return defaultBidByAdGroupId.get(adGroupId) ?? defaultBidByAdGroupId.get(String(adGroupId)) ?? campaignFallbackDefaultBid;
    }
    return campaignFallbackDefaultBid;
  };
  const visibleProductTargets = useMemo(
    () =>
      [...(productTargetsQ.data ?? []).filter((pt) => shouldShowActiveOrPausedWithData(pt as any, (pt as any).state))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [productTargetsQ.data],
  );
  const visibleKeywords = useMemo(
    () =>
      [...(keywordsQ.data ?? []).filter((kw) => shouldShowActiveOrPausedWithData(kw as any, kw.status))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [keywordsQ.data],
  );
  const visibleProductAds = useMemo(
    () =>
      [...(productAdsQ.data ?? []).filter((pa) => shouldShowActiveOrPausedWithData(pa as any, pa.status))].sort(
        compareByAcosSpendImpressionsSync,
      ),
    [productAdsQ.data],
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
  const settingsCooldown = getCampaignSettingsCooldown(c as any);
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

  const openEntityBidEdit = (edit: {
    kind: "keyword" | "target" | "adGroup";
    id: string;
    title: string;
    value: number;
    fallbackTargetIds?: string[];
  }) => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    setEntityBidEdit(edit);
  };

  const persistCampaign = async () => {
    await invalidateAds(["campaign-api", "campaign"]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        campaignQ.refetch(),
        campaignApiQ.refetch(),
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
  const budgetLabel =
    displayBudget != null
      ? `${formatCurrency(Number(displayBudget), primaryCurrency)}/${budgetPeriod}`
      : "—";
  const dash = (value: string) => (heroLoading || heroFailed ? "—" : value);
  const extraPlacements = placementRows.filter((row) => !placementEditorFor(row.placement));
  const targetingPending = !isAuto && (keywordsQ.isLoading || productTargetsQ.isLoading) && !hasKeywords && !hasProductTargets;
  const targetingFailed = !isAuto && !hasKeywords && !hasProductTargets && (keywordsQ.isError || productTargetsQ.isError);

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
              accessibilityLabel={[c.name, marketplaceFlagsA11y(countriesForSponsoredCampaign(marketplaceIndex, c)), heroLoading ? null : verdict.label, contextLine, c.state === "enabled" ? "Enabled" : "Paused"].filter(Boolean).join(". ")}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Text
                  style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, minWidth: 0 }]}
                  numberOfLines={2}
                >
                  {c.name}
                </Text>
                <CampaignMarketplaceFlags
                  index={marketplaceIndex}
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
                  value={formatPercent(placementAdjustments[editor.key], 0)}
                  cooldown={settingsCooldown}
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
                  { label: "Spend", value: dash(formatCurrency(heroSpend, primaryCurrency)) },
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
                  { label: "CPC", value: dash(dailyAgg.clicks > 0 ? formatCurrency(heroCpc, primaryCurrency) : "—") },
                ]}
              />
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
                  adj={placementAdjustments[editor.key]}
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
                  adj={placementAdjustments[editor.key]}
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
                    adj={placementAdjustments[editor.key]}
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

        <SectionCard title={`Ad Groups (${visibleAdGroups.length})`}>
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
              return (
                <View
                  key={ag.id}
                  style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === visibleAdGroups.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                >
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
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 3 }]}>
                        {statusLabel(ag.state)} · {formatCurrency(Number(ag.total_spend), primaryCurrency)} spend · {formatInt(Number(ag.total_impressions))} impr · {formatInt(Number(ag.total_clicks))} clicks · {formatInt(Number(ag.total_orders))} orders
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
                      cooldownRow={ag as any}
                      onPress={() =>
                        openEntityBidEdit({
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
                        })
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
          <SectionCard title="Keywords">
            {visibleKeywords.map((kw, idx) => (
              <View
                key={kw.id}
                style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === visibleKeywords.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
              >
                <TouchableOpacity
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${kw.keyword_text || "Keyword"}${kw.match_type ? `, ${kw.match_type}` : ""}`}
                  onPress={() => router.push(`/keyword/${kw.id}` as any)}
                  style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>{kw.keyword_text}</Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                      {[kw.match_type, `${formatInt(kw.total_clicks)} clicks`, `${formatInt(kw.total_orders)} orders`].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Text style={[t.typography.caption1, { color: toneColor(acosTone(Number(kw.total_acos)), t.colors), marginLeft: spacing.sm }]}>
                    {kw.total_sales > 0 ? formatPercent(Number(kw.total_acos)) : "—"} ACoS
                  </Text>
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
                    cooldownRow={kw as any}
                    onPress={() =>
                      openEntityBidEdit({
                        kind: "keyword",
                        id: kw.id,
                        title: kw.keyword_text || "Keyword bid",
                        value: readTargetBid(kw as any, resolveInheritedBid(kw.ad_group_id)) ?? 0.02,
                      })
                    }
                  />
                </View>
              </View>
            ))}
          </SectionCard>
        ) : null}

        {!isAuto && hasProductTargets ? (
          <SectionCard title="Product targets">
            {visibleProductTargets.map((pt: any, idx) => (
              <ProductTargetRow
                key={pt.id}
                pt={pt}
                isLast={idx === visibleProductTargets.length - 1}
                primaryCurrency={primaryCurrency}
                inheritedDefaultBid={resolveInheritedBid(pt.ad_group_id)}
                t={t}
                onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
                onEditBid={() => {
                  const bid = readTargetBid(pt, resolveInheritedBid(pt.ad_group_id));
                  setEntityBidEdit({
                    kind: "target",
                    id: pt.id,
                    title: productTargetHeading(pt),
                    value: bid ?? 0.02,
                  });
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
          <SectionCard title="Auto Targeting">
            {visibleProductTargets.map((pt: any, idx) => (
              <ProductTargetRow
                key={pt.id}
                pt={pt}
                isLast={idx === visibleProductTargets.length - 1}
                primaryCurrency={primaryCurrency}
                inheritedDefaultBid={resolveInheritedBid(pt.ad_group_id)}
                t={t}
                onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
                onEditBid={() => {
                  const bid = readTargetBid(pt, resolveInheritedBid(pt.ad_group_id));
                  setEntityBidEdit({
                    kind: "target",
                    id: pt.id,
                    title: productTargetHeading(pt),
                    value: bid ?? 0.02,
                  });
                }}
              />
            ))}
          </SectionCard>
        ) : null}

        {isAuto ? (
          <SectionCard title="Search terms">
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginBottom: spacing.md }]}>
              Last 65 days.
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
            ) : (searchTermsQ.data ?? []).length > 0 ? (
              searchTermsQ.data!.map((st: any, idx) => {
                const isWinner = st.total_orders > 0;
                return (
                  <TouchableOpacity
                    key={st.id}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`${st.search_term}, ${isWinner ? "converting" : "no orders"}`}
                    onPress={() =>
                      router.push({
                        pathname: "/search-term/[id]",
                        params: { id: st.id, term: st.search_term ?? "", campaign: c.name ?? "" },
                      } as any)
                    }
                    style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === Math.min(9, searchTermsQ.data!.length - 1) ? 0 : StyleSheet.hairlineWidth }]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>{st.search_term}</Text>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                        {isWinner ? "Converting" : "No orders"} · {formatCurrency(st.total_spend, primaryCurrency)} spend · {formatInt(st.total_orders)} orders
                      </Text>
                    </View>
                    <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
                  </TouchableOpacity>
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
          {productAdsQ.isError && visibleProductAds.length === 0 ? (
            <RetryState
              title="Couldn't load advertised products"
              subtitle="The rest of this campaign is still available."
              onRetry={() => void productAdsQ.refetch()}
              retrying={productAdsQ.isRefetching}
            />
          ) : productAdsQ.isLoading && visibleProductAds.length === 0 ? (
            <ScreenSpinner />
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
              subtitle="No product ads in this campaign."
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
        value={placementEdit ? placementAdjustments[placementEdit.key] : 0}
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
              ? updateAdGroupManual(edit.id, { defaultBid: next, forceCooldown: true }, edit.fallbackTargetIds ?? [])
              : enqueueEntityBidWrite({
                  entityKind: edit.kind === "keyword" ? "keyword" : "product_target",
                  entityId: edit.id,
                  bid: next,
                  previousBid,
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

function ProductTargetRow({
  pt,
  isLast,
  primaryCurrency,
  inheritedDefaultBid,
  t,
  onOpenTarget,
  onEditBid,
}: {
  pt: any;
  isLast: boolean;
  primaryCurrency: string;
  inheritedDefaultBid?: number;
  t: any;
  onOpenTarget: (targetId: string) => void;
  onEditBid: () => void;
}) {
  const target = describeProductTarget(pt.expression, pt.expression_type, pt.resolved_expression);
  const fallbackCover = fallbackAsinCoverUrl(target.asin);
  const title = productTargetHeading(pt);
  const acos = safeDivide(Number(pt.total_spend ?? 0), Number(pt.total_sales ?? 0)) * 100;
  const bid = readTargetBid(pt, inheritedDefaultBid);

  return (
    <View style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <TouchableOpacity
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${target.label}, ${statusLabel(pt.state)}`}
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
          <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={2}>
            {[target.label, statusLabel(pt.state), target.asin, `${formatCurrency(Number(pt.total_spend ?? 0), primaryCurrency)} spend`, `${formatInt(Number(pt.total_orders ?? 0))} orders`, Number(pt.total_sales ?? 0) > 0 ? `${formatPercent(acos)} ACoS` : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
      </TouchableOpacity>
      <View onStartShouldSetResponder={() => true} onTouchEnd={(e) => e.stopPropagation()} style={{ marginLeft: 8 }}>
        <MutationTap
          testID={`campaign-target-bid-${pt.id}`}
          label="Bid"
          compact
          value={bid != null ? formatCurrency(bid, primaryCurrency) : "Set"}
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
