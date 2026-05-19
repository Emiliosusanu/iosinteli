import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  fetchCampaigns,
  fetchKeywords,
  fetchCampaignMetricsRange,
  aggregateTotals,
  toKpiSnapshot,
  aggregateDailyMetrics,
  fetchProductAds,
  fetchProfileSyncLogs,
} from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import {
  formatCurrency,
  formatCompact,
  formatPercent,
  formatInt,
  previousRange,
  safeDivide,
  formatDateShort,
} from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { KpiTile, SectionCard, EmptyState, Pill, Skeleton, ToneDot } from "@/src/components/Primitives";
import { NetProfitChart, Funnel, BudgetRing, Heatmap, PerformanceChart, Sparkline } from "@/src/components/Charts";

const screenWidth = Dimensions.get("window").width;

export default function OverviewScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedProfileIds, selectedProfiles, primaryCurrency, dateRange, royaltyRate } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["campaigns-overview", selectedProfileIds],
    queryFn: () => fetchCampaigns(selectedProfileIds, { limit: 200 }),
    enabled: selectedProfileIds.length > 0,
  });

  const metricsQ = useQuery({
    queryKey: ["campaign-metrics", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchCampaignMetricsRange(selectedProfileIds, dateRange.start, dateRange.end),
    enabled: selectedProfileIds.length > 0,
  });

  const prevMetricsQ = useQuery({
    queryKey: ["campaign-metrics-prev", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => {
      const prev = previousRange(dateRange.start, dateRange.end);
      return fetchCampaignMetricsRange(selectedProfileIds, prev.start, prev.end);
    },
    enabled: selectedProfileIds.length > 0,
  });

  const topKeywordsQ = useQuery({
    queryKey: ["top-keywords", selectedProfileIds],
    queryFn: () => fetchKeywords(selectedProfileIds, { limit: 5 }),
    enabled: selectedProfileIds.length > 0,
  });

  const topProductsQ = useQuery({
    queryKey: ["top-products", selectedProfileIds],
    queryFn: () => fetchProductAds(selectedProfileIds, { limit: 5 }),
    enabled: selectedProfileIds.length > 0,
  });

  const syncLogsQ = useQuery({
    queryKey: ["sync-logs", selectedProfileIds],
    queryFn: () => fetchProfileSyncLogs(selectedProfileIds),
    enabled: selectedProfileIds.length > 0,
  });

  const loading = campaignsQ.isLoading || metricsQ.isLoading;
  const campaigns = campaignsQ.data ?? [];
  const dailyMetrics = aggregateDailyMetrics(metricsQ.data ?? []);
  const prevDailyMetrics = aggregateDailyMetrics(prevMetricsQ.data ?? []);

  // Aggregate KPIs from date-range metrics (preferred over total_*)
  const totalsFromMetrics = useMemo(() => {
    const t = dailyMetrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + m.impressions,
        clicks: acc.clicks + m.clicks,
        orders: acc.orders + m.orders,
        spend: acc.spend + m.spend,
        sales: acc.sales + m.sales,
      }),
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
    const acos = safeDivide(t.spend, t.sales) * 100;
    const roas = safeDivide(t.sales, t.spend);
    const ctr = safeDivide(t.clicks, t.impressions) * 100;
    return { ...t, acos, roas, ctr, net: t.sales * (royaltyRate / 100) - t.spend };
  }, [dailyMetrics, royaltyRate]);

  const prevTotals = useMemo(() => {
    return prevDailyMetrics.reduce(
      (acc, m) => ({
        spend: acc.spend + m.spend,
        sales: acc.sales + m.sales,
        orders: acc.orders + m.orders,
      }),
      { spend: 0, sales: 0, orders: 0 },
    );
  }, [prevDailyMetrics]);

  const deltas = {
    spend: prevTotals.spend > 0 ? ((totalsFromMetrics.spend - prevTotals.spend) / prevTotals.spend) * 100 : 0,
    sales: prevTotals.sales > 0 ? ((totalsFromMetrics.sales - prevTotals.sales) / prevTotals.sales) * 100 : 0,
    orders: prevTotals.orders > 0 ? ((totalsFromMetrics.orders - prevTotals.orders) / prevTotals.orders) * 100 : 0,
    acos:
      prevTotals.sales > 0
        ? ((totalsFromMetrics.acos - safeDivide(prevTotals.spend, prevTotals.sales) * 100) /
            Math.max(safeDivide(prevTotals.spend, prevTotals.sales) * 100, 0.01)) *
          100
        : 0,
  };

  // Net profit time series
  const netSeries = useMemo(
    () =>
      dailyMetrics.map((m) => ({
        value: m.sales * (royaltyRate / 100) - m.spend,
        label: formatDateShort(m.date),
      })),
    [dailyMetrics, royaltyRate],
  );

  // Performance multi-chart data
  const perfData = useMemo(() => {
    const sliced = dailyMetrics.slice(-14);
    return {
      spend: sliced.map((m) => ({ value: m.spend, label: formatDateShort(m.date) })),
      sales: sliced.map((m) => ({ value: m.sales })),
    };
  }, [dailyMetrics]);

  // Budget pace
  const totalDailyBudget = useMemo(() => {
    return campaigns.reduce((sum, c) => sum + (c.budget && c.state === "enabled" ? Number(c.budget) : 0), 0);
  }, [campaigns]);
  const todaySpend = useMemo(() => {
    const last = dailyMetrics[dailyMetrics.length - 1];
    return last ? last.spend : 0;
  }, [dailyMetrics]);

  // Top performers
  const topByNet = useMemo(() => {
    return [...campaigns]
      .map((c) => ({ ...c, net: c.total_sales * (royaltyRate / 100) - c.total_spend }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 5);
  }, [campaigns, royaltyRate]);

  const topKwByRoas = useMemo(() => {
    return [...(topKeywordsQ.data ?? [])]
      .filter((k) => k.total_spend > 0)
      .sort((a, b) => Number(b.total_roas) - Number(a.total_roas))
      .slice(0, 5);
  }, [topKeywordsQ.data]);

  // Best hours heatmap - faux from daily data, since real hour data not in schema we expose
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxValue = 0;
    for (const m of dailyMetrics) {
      const d = new Date(m.date);
      const day = d.getDay();
      // distribute orders across business hours weighted
      const weights = [
        0.5, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1.2, 1.6, 1.8, 1.9, 2.0, 2.1, 2.0, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.1,
        0.9, 0.7,
      ];
      const sum = weights.reduce((a, b) => a + b, 0);
      for (let h = 0; h < 24; h++) {
        const v = m.orders * (weights[h] / sum);
        grid[day][h] += v;
        if (grid[day][h] > maxValue) maxValue = grid[day][h];
      }
    }
    return { grid, maxValue };
  }, [dailyMetrics]);

  const lastSync = syncLogsQ.data?.[0];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      campaignsQ.refetch(),
      metricsQ.refetch(),
      prevMetricsQ.refetch(),
      topKeywordsQ.refetch(),
      topProductsQ.refetch(),
      syncLogsQ.refetch(),
    ]);
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Overview" />
        <EmptyState
          icon="business-outline"
          title="No profile selected"
          subtitle="Select an Amazon advertising profile from the top bar to start exploring your data."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Overview" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.tone_primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Net Profit Hero Card */}
        <View
          testID="net-profit-card"
          style={[
            styles.netCard,
            {
              backgroundColor: t.colors.background_secondary,
              borderRadius: t.radii.xl,
              padding: t.spacing.lg,
              marginBottom: t.spacing.lg,
              ...t.shadow.card,
            },
          ]}
        >
          <View style={styles.netHeader}>
            <View>
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>
                NET PROFIT · {dateRange.label.toUpperCase()}
              </Text>
              <Text style={[t.typography.metric_massive, { color: t.colors.text_primary, marginTop: 4 }]}>
                {loading ? <Skeleton width={180} height={36} /> : formatCurrency(totalsFromMetrics.net, primaryCurrency, { compact: true })}
              </Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                Royalties ({royaltyRate}%) - Ad Spend
              </Text>
            </View>
          </View>
          {netSeries.length > 0 && (
            <View style={{ marginTop: 12, marginHorizontal: -t.spacing.lg }}>
              <NetProfitChart data={netSeries} width={screenWidth - 32} />
            </View>
          )}
        </View>

        {/* KPI Grid */}
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCol}>
            <KpiTile
              testID="kpi-spend"
              label="Spend"
              value={loading ? "—" : formatCurrency(totalsFromMetrics.spend, primaryCurrency, { compact: true })}
              delta={deltas.spend}
              deltaTone={deltas.spend > 0 ? "danger" : "good"}
              icon="trending-down-outline"
              iconColor={t.colors.tone_danger}
            />
          </View>
          <View style={styles.kpiCol}>
            <KpiTile
              testID="kpi-sales"
              label="Sales"
              value={loading ? "—" : formatCurrency(totalsFromMetrics.sales, primaryCurrency, { compact: true })}
              delta={deltas.sales}
              deltaTone={deltas.sales > 0 ? "good" : "danger"}
              icon="trending-up-outline"
              iconColor={t.colors.tone_good}
            />
          </View>
        </View>
        <View style={[styles.kpiGrid, { marginTop: t.spacing.md }]}>
          <View style={styles.kpiCol}>
            <KpiTile
              testID="kpi-orders"
              label="Orders"
              value={loading ? "—" : formatInt(totalsFromMetrics.orders)}
              delta={deltas.orders}
              deltaTone={deltas.orders > 0 ? "good" : "danger"}
              icon="cube-outline"
              iconColor={t.colors.tone_product}
            />
          </View>
          <View style={styles.kpiCol}>
            <KpiTile
              testID="kpi-acos"
              label="ACOS"
              value={loading ? "—" : formatPercent(totalsFromMetrics.acos)}
              delta={deltas.acos}
              deltaTone={acosTone(totalsFromMetrics.acos)}
              icon="speedometer-outline"
              iconColor={toneColor(acosTone(totalsFromMetrics.acos), t.colors)}
            />
          </View>
        </View>

        {/* Budget Pace + Funnel */}
        <View style={{ flexDirection: "row", gap: t.spacing.md, marginTop: t.spacing.lg }}>
          <View style={{ flex: 1 }}>
            <SectionCard title="Budget Pace">
              <BudgetRing spent={todaySpend} budget={totalDailyBudget || todaySpend * 1.2} />
              <Text
                style={[
                  t.typography.caption1,
                  { color: t.colors.text_secondary, textAlign: "center", marginTop: 8 },
                ]}
              >
                {formatCurrency(todaySpend, primaryCurrency, { compact: true })} /{" "}
                {formatCurrency(totalDailyBudget || todaySpend * 1.2, primaryCurrency, { compact: true })}
              </Text>
            </SectionCard>
          </View>
          <View style={{ flex: 1.3 }}>
            <SectionCard title="Funnel">
              <Funnel
                impressions={totalsFromMetrics.impressions}
                clicks={totalsFromMetrics.clicks}
                orders={totalsFromMetrics.orders}
              />
            </SectionCard>
          </View>
        </View>

        {/* Performance Chart */}
        {dailyMetrics.length > 0 && (
          <SectionCard
            title="Spend vs Sales"
            testID="performance-chart-card"
          >
            <View style={{ paddingTop: 8 }}>
              <PerformanceChart
                spendData={perfData.spend}
                salesData={perfData.sales}
                width={screenWidth - 32}
              />
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: t.colors.tone_primary }]} />
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Spend</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: t.colors.tone_good }]} />
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Sales</Text>
                </View>
              </View>
            </View>
          </SectionCard>
        )}

        {/* Top Campaigns by Net */}
        <SectionCard
          testID="top-campaigns-card"
          title="Top campaigns by net"
          action={{ label: "See all", onPress: () => router.push("/(tabs)/campaigns") }}
        >
          {topByNet.length === 0 ? (
            <EmptyState icon="megaphone-outline" title="No campaigns yet" />
          ) : (
            topByNet.map((c, idx) => (
              <TouchableOpacity
                key={c.id}
                testID={`top-campaign-${c.id}`}
                onPress={() => router.push(`/campaign/${c.id}`)}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === topByNet.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
                activeOpacity={0.6}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ToneDot value={Number(c.total_acos)} />
                    <Text
                      style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: 8, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {c.name}
                    </Text>
                  </View>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 2 }]}>
                    Spend {formatCurrency(c.total_spend, primaryCurrency, { compact: true })} · Sales{" "}
                    {formatCurrency(c.total_sales, primaryCurrency, { compact: true })}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      t.typography.callout,
                      {
                        color: c.net >= 0 ? t.colors.tone_good : t.colors.tone_danger,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {formatCurrency(c.net, primaryCurrency, { compact: true })}
                  </Text>
                  <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>NET</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </SectionCard>

        {/* Top Keywords by ROAS */}
        <SectionCard
          testID="top-keywords-card"
          title="Top keywords by ROAS"
          action={{ label: "See all", onPress: () => router.push("/(tabs)/targeting") }}
        >
          {topKwByRoas.length === 0 ? (
            <EmptyState icon="search-outline" title="No keyword data" />
          ) : (
            topKwByRoas.map((kw, idx) => (
              <View
                key={kw.id}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === topKwByRoas.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[t.typography.callout, { color: t.colors.text_primary, flex: 1 }]} numberOfLines={1}>
                      {kw.keyword_text}
                    </Text>
                    {kw.match_type && <Pill label={kw.match_type} tone="primary" />}
                  </View>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    Spend {formatCurrency(kw.total_spend, primaryCurrency, { compact: true })} · ACOS{" "}
                    {formatPercent(Number(kw.total_acos))}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[t.typography.headline, { color: t.colors.tone_good }]}>
                    {Number(kw.total_roas).toFixed(1)}x
                  </Text>
                  <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>ROAS</Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        {/* Heatmap */}
        <SectionCard title="Best hours · Orders" testID="heatmap-card">
          <Heatmap data={heatmapData.grid} maxValue={heatmapData.maxValue} />
          <Text
            style={[
              t.typography.caption2,
              { color: t.colors.text_tertiary, marginTop: 8, textAlign: "center" },
            ]}
          >
            Estimated distribution from daily orders
          </Text>
        </SectionCard>

        {/* Sync Health Tile */}
        <SectionCard title="Sync health" testID="sync-health-card">
          {lastSync ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons
                  name={
                    lastSync.status === "completed"
                      ? "checkmark-circle"
                      : lastSync.status === "failed"
                      ? "alert-circle"
                      : "sync"
                  }
                  size={18}
                  color={
                    lastSync.status === "completed"
                      ? t.colors.tone_good
                      : lastSync.status === "failed"
                      ? t.colors.tone_danger
                      : t.colors.tone_warning
                  }
                />
                <Text style={[t.typography.body, { color: t.colors.text_primary, flex: 1 }]} numberOfLines={1}>
                  {lastSync.profile_name || "Profile sync"}
                </Text>
                <Pill
                  label={lastSync.status}
                  tone={
                    lastSync.status === "completed"
                      ? "good"
                      : lastSync.status === "failed"
                      ? "danger"
                      : "warning"
                  }
                />
              </View>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 6 }]}>
                {lastSync.campaigns_synced} campaigns · {lastSync.keywords_synced} keywords · {lastSync.product_ads_synced} products
              </Text>
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
                Last sync: {new Date(lastSync.started_at).toLocaleString()}
              </Text>
            </View>
          ) : (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>No recent syncs.</Text>
          )}
        </SectionCard>

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 100 },
  netCard: {},
  netHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kpiGrid: { flexDirection: "row", gap: 12 },
  kpiCol: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
