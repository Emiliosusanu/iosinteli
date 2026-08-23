import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { SFSymbol } from "@/src/components/ios/Native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
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
import { useTheme, acosTone, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  formatDateShort,
  safeDivide,
} from "@/src/lib/format";
import { EmptyState, ToneDot, SectionCard, MetricStrip, RetryState, ScreenSpinner } from "@/src/components/Primitives";
import { BidBudgetEditor, EntityStateSwitch } from "@/src/components/Mutations";
import { CampaignDailyChart, Funnel } from "@/src/components/Charts";
import { SubScreen } from "@/src/components/SubScreen";
import { biddingStrategyLabel, shouldShowActiveOrPausedWithData, statusLabel } from "@/src/lib/campaigns";
import { fetchCampaignApi, updateCampaign, updateCampaignState, type PlacementAdjustments } from "@/src/lib/mutations";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { describeProductTarget, fallbackAsinCoverUrl } from "@/src/lib/targeting";

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
  const invalidateAds = useInvalidateAds();
  const chartWidth = Math.max(240, viewportWidth - 64);
  const autoRange = last65Days();
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [placementEdit, setPlacementEdit] = useState<(typeof PLACEMENT_EDITORS)[number] | null>(null);
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
    queryFn: () => fetchKeywords([c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean), { campaignId: id!, limit: 8, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!c && !isAuto,
  });

  const productTargetsQ = useQuery({
    queryKey: ["campaign-product-targets", adminFilterUserId ?? "self", id, c?.amazon_profile_id, dateRange.start, dateRange.end],
    queryFn: () => fetchProductTargets([c!.amazon_profile_id || selectedProfileIds[0]].filter(Boolean), { campaignId: id!, start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: !!c,
  });

  const searchTermsQ = useQuery({
    queryKey: ["campaign-search-terms-auto", id, c?.amazon_profile_id],
    queryFn: () => fetchSearchTerms([c!.amazon_profile_id], { campaignId: id!, limit: 10, start: autoRange.start, end: autoRange.end }),
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
    () => (adGroupsQ.data ?? []).filter((ag) => shouldShowActiveOrPausedWithData(ag as any, ag.state)),
    [adGroupsQ.data],
  );
  const visibleProductTargets = useMemo(
    () => (productTargetsQ.data ?? []).filter((pt) => shouldShowActiveOrPausedWithData(pt as any, (pt as any).state)),
    [productTargetsQ.data],
  );
  const visibleProductAds = useMemo(
    () => (productAdsQ.data ?? []).filter((pa) => shouldShowActiveOrPausedWithData(pa as any, pa.status)),
    [productAdsQ.data],
  );
  const autoTargetSummaries = useMemo(() => {
    const byLabel = new Map<string, { label: string; tone: any; impressions: number; clicks: number; orders: number; spend: number; sales: number }>();
    for (const targetRow of visibleProductTargets) {
      const target = describeProductTarget((targetRow as any).expression, (targetRow as any).expression_type);
      const key = target.label;
      const current =
        byLabel.get(key) ??
        { label: target.label, tone: target.tone, impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 };
      current.impressions += Number((targetRow as any).total_impressions ?? 0);
      current.clicks += Number((targetRow as any).total_clicks ?? 0);
      current.orders += Number((targetRow as any).total_orders ?? 0);
      current.spend += Number((targetRow as any).total_spend ?? 0);
      current.sales += Number((targetRow as any).total_sales ?? 0);
      byLabel.set(key, current);
    }
    return Array.from(byLabel.values()).sort((a, b) => b.spend - a.spend || b.orders - a.orders || a.label.localeCompare(b.label));
  }, [visibleProductTargets]);

  // Decide which targeting sections to show by what data actually exists
  const hasKeywords = (keywordsQ.data ?? []).length > 0;
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
          title="Campaign failed to load"
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
  const displayBudget = readBudget(campaignApiQ.data, c);
  const placementAdjustments = readPlacementAdjustments(campaignApiQ.data, c as unknown as Record<string, unknown>);
  const budgetPeriod = (c.budget_type ?? "daily").toLowerCase() === "lifetime" ? "total" : "day";
  const budgetNoun = budgetPeriod === "total" ? "Lifetime budget" : "Daily budget";
  const placementRows = placementsQ.data ?? [];

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
            <View
              style={{ flex: 1, minWidth: 0 }}
              accessible
              accessibilityRole="header"
              accessibilityLabel={[c.name, heroLoading ? null : verdict.label, contextLine, c.state === "enabled" ? "Enabled" : "Paused"].filter(Boolean).join(". ")}
            >
              <Text
                style={[t.typography.headline, { color: t.colors.text_primary }]}
                numberOfLines={2}
              >
                {c.name}
              </Text>
              <View style={styles.metaRow}>
                <View style={[styles.statusDot, { backgroundColor: toneColor(heroLoading ? "inactive" : verdict.tone, t.colors) }]} />
                <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                  {heroLoading ? "…" : verdict.label}
                </Text>
                {contextLine ? (
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{contextLine}</Text>
                ) : null}
              </View>
            </View>
            <EntityStateSwitch
              enabled={c.state === "enabled"}
              noun="campaign"
              testID={`campaign-state-${c.id}`}
              onChange={async (next) => {
                await updateCampaignState(c.id, next ? "enabled" : "paused");
                await persistCampaign();
              }}
            />
          </View>
          <TouchableOpacity
            testID={`campaign-budget-${c.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${budgetNoun} ${budgetLabel}. Edit budget.`}
            accessibilityHint="Opens the budget editor. Saving writes Amazon Ads."
            onPress={() => setBudgetOpen(true)}
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
        </SectionCard>

        <View style={[styles.metricsCard, { backgroundColor: t.colors.background_secondary }]}>
          {heroFailed ? (
            <RetryState
              title="Performance failed to load"
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
                  { label: "Sales", value: dash(formatCurrency(heroSales, primaryCurrency)) },
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
                  onEdit={() => setPlacementEdit(editor)}
                />
              ))}
              <RetryState
                title="Placement performance failed to load"
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
                  onEdit={() => setPlacementEdit(editor)}
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
                    onEdit={() => setPlacementEdit(editor)}
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
              title="Trend failed to load"
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
              title="Ad groups failed to load"
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
              return (
                <TouchableOpacity
                  key={ag.id}
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
                  style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === visibleAdGroups.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <ToneDot value={agAcos} />
                      <Text style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={2}>
                        {ag.name || "Ad Group"}
                      </Text>
                    </View>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 3 }]}>
                      {statusLabel(ag.state)} · {formatCurrency(Number(ag.total_spend), primaryCurrency)} spend · {formatInt(Number(ag.total_orders))} orders
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
          <SectionCard title="Top Keywords">
            {keywordsQ.data!.map((kw, idx) => (
              <TouchableOpacity
                key={kw.id}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${kw.keyword_text || "Keyword"}${kw.match_type ? `, ${kw.match_type}` : ""}`}
                onPress={() => router.push(`/keyword/${kw.id}` as any)}
                style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: idx === keywordsQ.data!.length - 1 ? 0 : StyleSheet.hairlineWidth }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>{kw.keyword_text}</Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    {[kw.match_type, `Bid ${kw.bid_amount ? formatCurrency(Number(kw.bid_amount), primaryCurrency) : "—"}`, `${formatInt(kw.total_clicks)} clicks`, `${formatInt(kw.total_orders)} orders`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Text style={[t.typography.caption1, { color: toneColor(acosTone(Number(kw.total_acos)), t.colors), marginLeft: spacing.sm }]}>
                  {kw.total_sales > 0 ? formatPercent(Number(kw.total_acos)) : "—"} ACoS
                </Text>
                <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
              </TouchableOpacity>
            ))}
          </SectionCard>
        ) : null}

        {!isAuto && hasProductTargets ? (
          <SectionCard title="Top Products Targeted">
            {visibleProductTargets.map((pt: any, idx) => (
              <ProductTargetRow
                key={pt.id}
                pt={pt}
                isLast={idx === visibleProductTargets.length - 1}
                primaryCurrency={primaryCurrency}
                t={t}
                onOpenTarget={(targetId) => router.push(`/target/${targetId}` as any)}
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
              title="Targets failed to load"
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
              title="No targets in this range"
              subtitle="No keywords or product targets with data for the selected dates."
            />
          </SectionCard>
        ) : null}

        {isAuto && autoTargetSummaries.length > 0 ? (
          <SectionCard title="Auto Targeting">
            {autoTargetSummaries.map((row, idx) => (
              <AutoTargetSummaryRow
                key={row.label}
                row={row}
                isLast={idx === autoTargetSummaries.length - 1}
                primaryCurrency={primaryCurrency}
                t={t}
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
                title="Search terms failed to load"
                subtitle="This list uses the last 65 days, not the screen date range."
                onRetry={() => void searchTermsQ.refetch()}
                retrying={searchTermsQ.isRefetching}
              />
            ) : searchTermsQ.isLoading && (searchTermsQ.data ?? []).length === 0 ? (
              <ScreenSpinner />
            ) : (searchTermsQ.data ?? []).length > 0 ? (
              searchTermsQ.data!.slice(0, 10).map((st: any, idx) => {
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
              title="Advertised products failed to load"
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
          await updateCampaign(c.id, { placementAdjustments: { [placementEdit.key]: next } });
          await persistCampaign();
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
    row ? `Sales ${formatCurrency(row.sales, primaryCurrency)}` : null,
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
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Sales</Text>
            <Text style={[t.typography.callout, { color: t.colors.text_primary, fontVariant: ["tabular-nums"] }]}>
              {formatCurrency(row.sales, primaryCurrency)}
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

function AutoTargetSummaryRow({
  row,
  isLast,
  primaryCurrency,
  t,
}: {
  row: { label: string; tone: any; impressions: number; clicks: number; orders: number; spend: number; sales: number };
  isLast: boolean;
  primaryCurrency: string;
  t: any;
}) {
  const acos = safeDivide(row.spend, row.sales) * 100;
  const ctr = safeDivide(row.clicks, row.impressions) * 100;

  return (
    <View style={[styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.tight, flexWrap: "wrap" }}>
          <ToneDot value={acos} />
          <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
            {row.label}
          </Text>
        </View>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 3 }]}>
          Auto · {formatCurrency(row.spend, primaryCurrency)} spend · {formatInt(row.orders)} orders · {formatPercent(ctr, 2)} CTR
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", marginLeft: 10 }}>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>ACoS</Text>
        <Text style={[t.typography.callout, { color: toneColor(acosTone(acos), t.colors), fontVariant: ["tabular-nums"] }]}>
          {row.sales > 0 ? formatPercent(acos) : "—"}
        </Text>
      </View>
    </View>
  );
}

function ProductTargetRow({
  pt,
  isLast,
  primaryCurrency,
  t,
  onOpenTarget,
}: {
  pt: any;
  isLast: boolean;
  primaryCurrency: string;
  t: any;
  onOpenTarget: (targetId: string) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const target = describeProductTarget(pt.expression, pt.expression_type);
  const fallbackCover = fallbackAsinCoverUrl(target.asin);
  const coverUrl = !coverFailed ? pt.image_url || fallbackCover : null;
  const title = pt.title || target.asin || target.label;
  const acos = safeDivide(Number(pt.total_spend ?? 0), Number(pt.total_sales ?? 0)) * 100;
  const content = (
    <>
      <View style={[styles.productThumb, { backgroundColor: t.colors.background_tertiary }]}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.productThumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            recyclingKey={target.asin || pt.id}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <SFSymbol name="cube" size={22} color={t.colors.text_tertiary} />
        )}
      </View>
      <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
        <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 3 }]} numberOfLines={2}>
          {[target.label, statusLabel(pt.state), target.asin, `${formatCurrency(Number(pt.total_spend ?? 0), primaryCurrency)} spend`, `${formatInt(Number(pt.total_orders ?? 0))} orders`, Number(pt.total_sales ?? 0) > 0 ? `${formatPercent(acos)} ACoS` : null].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </>
  );

  const rowStyle = [styles.row, { borderBottomColor: t.colors.separator, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth }];

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${target.label}, ${statusLabel(pt.state)}`}
      style={rowStyle}
      onPress={() => onOpenTarget(pt.id)}
    >
      {content}
      <SFSymbol name="chevron.right" size={15} color={t.colors.text_tertiary} />
    </TouchableOpacity>
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
  const [coverFailed, setCoverFailed] = useState(false);
  const fallbackCover = fallbackAsinCoverUrl(pa.asin);
  const coverUrl = !coverFailed ? pa.image_url || fallbackCover : null;
  const title = pa.title || pa.asin || pa.sku || "Advertised product";
  const acos = safeDivide(Number(pa.total_spend ?? 0), Number(pa.total_sales ?? 0)) * 100;
  const canOpen = Boolean(pa.asin);

  const content = (
    <>
      <View style={[styles.productThumb, { backgroundColor: t.colors.background_tertiary }]}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.productThumb}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={pa.asin || pa.id}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <SFSymbol name="book" size={22} color={t.colors.text_tertiary} />
        )}
      </View>
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
      onPress={() => onOpenBook(pa.asin, pa.title, coverUrl || fallbackCover)}
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
