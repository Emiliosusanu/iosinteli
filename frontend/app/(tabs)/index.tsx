import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  Image,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  fetchCampaignMetricsRange,
  aggregateDailyMetrics,
  fetchProfileSyncLogs,
  fetchTopCampaignsRange,
  fetchTopKeywordsRange,
  fetchTopBooksRange,
} from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  formatCompact,
  previousRange,
  safeDivide,
  formatDateShort,
} from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { KpiTile, SectionCard, EmptyState, Pill, Skeleton, ToneDot } from "@/src/components/Primitives";
import {
  NetProfitChart,
  Funnel,
  BudgetRing,
  Heatmap,
  KdpIncomeChart,
  MiniChart,
} from "@/src/components/Charts";

const screenWidth = Dimensions.get("window").width;

export default function OverviewScreen() {
  const t = useTheme();
  const router = useRouter();
  const { guestMode } = useAuth();
  const { selectedProfileIds, primaryCurrency, dateRange, royaltyRate } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  // Date-filtered raw daily metrics (powering main charts + KPI tiles)
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

  // Date-filtered top performers (replace the old lifetime totals)
  const topCampaignsQ = useQuery({
    queryKey: ["top-campaigns-range", selectedProfileIds, dateRange.start, dateRange.end, royaltyRate],
    queryFn: () =>
      fetchTopCampaignsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate,
        limit: 5,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const topKeywordsQ = useQuery({
    queryKey: ["top-keywords-range", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopKeywordsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        limit: 5,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const topBooksQ = useQuery({
    queryKey: ["top-books-range", selectedProfileIds, dateRange.start, dateRange.end, royaltyRate],
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate,
        limit: 5,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const syncLogsQ = useQuery({
    queryKey: ["sync-logs", selectedProfileIds],
    queryFn: () => fetchProfileSyncLogs(selectedProfileIds),
    enabled: selectedProfileIds.length > 0,
  });

  const loading = metricsQ.isLoading;
  const dailyMetrics = aggregateDailyMetrics(metricsQ.data ?? []);
  const prevDailyMetrics = aggregateDailyMetrics(prevMetricsQ.data ?? []);

  // Aggregate KPIs from date-range metrics
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
    return {
      ...t,
      acos,
      roas,
      ctr,
      kdpIncome: t.sales * (royaltyRate / 100),
      net: t.sales * (royaltyRate / 100) - t.spend,
    };
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

  // KDP Income vs Ad Spend chart data
  const kdpData = useMemo(() => {
    const sliced = dailyMetrics.slice(-Math.min(dailyMetrics.length, 30));
    return {
      spend: sliced.map((m) => ({ value: m.spend, label: formatDateShort(m.date) })),
      income: sliced.map((m) => ({ value: m.sales * (royaltyRate / 100) })),
    };
  }, [dailyMetrics, royaltyRate]);

  // Multi-metric mini charts data
  const miniSeries = useMemo(() => {
    const sliced = dailyMetrics.slice(-Math.min(dailyMetrics.length, 14));
    return {
      impressions: sliced.map((m) => ({ value: m.impressions })),
      spend: sliced.map((m) => ({ value: m.spend })),
      orders: sliced.map((m) => ({ value: m.orders })),
      acos: sliced.map((m) => ({ value: safeDivide(m.spend, m.sales) * 100 })),
    };
  }, [dailyMetrics]);

  // Budget pace (uses lifetime totals from campaigns; OK because it's a "today" snapshot)
  const totalDailyBudget = useMemo(() => {
    return (topCampaignsQ.data ?? []).reduce(
      (sum, c) => sum + (c.budget && c.state === "enabled" ? Number(c.budget) : 0),
      0,
    );
  }, [topCampaignsQ.data]);
  const todaySpend = useMemo(() => {
    const last = dailyMetrics[dailyMetrics.length - 1];
    return last ? last.spend : 0;
  }, [dailyMetrics]);

  // Best hours heatmap (derived from daily orders distributed by typical hour curve)
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxValue = 0;
    for (const m of dailyMetrics) {
      const d = new Date(m.date);
      const day = d.getDay();
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
      metricsQ.refetch(),
      prevMetricsQ.refetch(),
      topCampaignsQ.refetch(),
      topKeywordsQ.refetch(),
      topBooksQ.refetch(),
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
          title={guestMode ? "No demo data" : "No Amazon profiles linked"}
          subtitle={
            guestMode
              ? "Sign in with your Supabase account to load your own profiles."
              : "Link an Amazon account in your inteliads web dashboard. Profiles must be enabled in 'user_amazon_profiles'."
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Overview" />

      {guestMode && (
        <View
          style={[
            styles.demoBanner,
            { backgroundColor: t.colors.tone_warning + "22", borderBottomColor: t.colors.tone_warning + "33" },
          ]}
        >
          <Ionicons name="information-circle" size={14} color={t.colors.tone_warning} />
          <Text style={[t.typography.caption1, { color: t.colors.text_primary, marginLeft: 6 }]}>
            Demo mode · Sign in to view your account data only
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
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
                {loading ? (
                  <Skeleton width={180} height={36} />
                ) : (
                  formatCurrency(totalsFromMetrics.net, primaryCurrency, { compact: true })
                )}
              </Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                KDP Income {formatCurrency(totalsFromMetrics.kdpIncome, primaryCurrency, { compact: true })} ·
                Ad Spend {formatCurrency(totalsFromMetrics.spend, primaryCurrency, { compact: true })}
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
              value={
                loading ? "—" : formatCurrency(totalsFromMetrics.spend, primaryCurrency, { compact: true })
              }
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
              value={
                loading ? "—" : formatCurrency(totalsFromMetrics.sales, primaryCurrency, { compact: true })
              }
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
              deltaTone={acosTone(totalsFromMetrics.acos, royaltyRate)}
              icon="speedometer-outline"
              iconColor={toneColor(acosTone(totalsFromMetrics.acos, royaltyRate), t.colors)}
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

        {/* KDP Income vs Ad Spend chart */}
        {dailyMetrics.length > 0 && (
          <SectionCard title="KDP Income vs Ad Spend" testID="kdp-income-card">
            <KdpIncomeChart
              spendData={kdpData.spend}
              incomeData={kdpData.income}
              width={screenWidth - 32}
            />
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_danger }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Ad Spend</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_good }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                  KDP Income ({royaltyRate}%)
                </Text>
              </View>
            </View>
          </SectionCard>
        )}

        {/* Multi-metric mini grid: Impressions / Spend / Orders / ACOS */}
        {dailyMetrics.length > 0 && (
          <SectionCard title="Performance · 14 days" testID="multi-metric-card">
            <View style={styles.metricGrid}>
              <MetricMiniCard
                label="Impressions"
                value={formatCompact(totalsFromMetrics.impressions)}
                color={t.colors.tone_primary}
                data={miniSeries.impressions}
                variant="bar"
                t={t}
              />
              <MetricMiniCard
                label="Ad Spend"
                value={formatCurrency(totalsFromMetrics.spend, primaryCurrency, { compact: true })}
                color={t.colors.tone_danger}
                data={miniSeries.spend}
                variant="line"
                t={t}
              />
              <MetricMiniCard
                label="Orders"
                value={formatInt(totalsFromMetrics.orders)}
                color={t.colors.tone_product}
                data={miniSeries.orders}
                variant="line"
                t={t}
              />
              <MetricMiniCard
                label="ACOS"
                value={formatPercent(totalsFromMetrics.acos)}
                color={toneColor(acosTone(totalsFromMetrics.acos, royaltyRate), t.colors)}
                data={miniSeries.acos}
                variant="line"
                t={t}
              />
            </View>
          </SectionCard>
        )}

        {/* Top Performer Books */}
        <SectionCard
          testID="top-books-card"
          title="Top books"
          action={{ label: "See all", onPress: () => router.push("/(tabs)/products") }}
        >
          {(topBooksQ.data ?? []).length === 0 ? (
            <EmptyState icon="book-outline" title="No book performance in range" />
          ) : (
            (topBooksQ.data ?? []).map((b, idx) => {
              const tone = acosTone(b.acos, b.breakeven_acos);
              const isLast = idx === (topBooksQ.data?.length ?? 0) - 1;
              return (
                <View
                  key={b.asin || b.sku || idx}
                  testID={`top-book-${b.asin || b.sku || idx}`}
                  style={[
                    styles.bookRow,
                    {
                      borderBottomColor: t.colors.separator,
                      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.bookImage,
                      { backgroundColor: t.colors.background_tertiary },
                    ]}
                  >
                    {b.image_url ? (
                      <Image source={{ uri: b.image_url }} style={{ width: 44, height: 56 }} resizeMode="cover" />
                    ) : (
                      <Ionicons name="book-outline" size={20} color={t.colors.text_tertiary} />
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]}
                      numberOfLines={1}
                    >
                      {b.title || b.asin || b.sku}
                    </Text>
                    <Text
                      style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}
                      numberOfLines={1}
                    >
                      No. {b.asin || b.sku || "—"}
                    </Text>
                    <View style={styles.bookKpiRow}>
                      <BookKpi label="NET" value={formatCurrency(b.net, primaryCurrency, { compact: true })} color={b.net >= 0 ? t.colors.tone_good : t.colors.tone_danger} t={t} />
                      <BookKpi label="SPEND" value={formatCurrency(b.spend, primaryCurrency, { compact: true })} t={t} />
                      <BookKpi label="ORD" value={formatInt(b.orders)} t={t} />
                      <BookKpi
                        label="ACOS"
                        value={b.sales > 0 ? formatPercent(b.acos) : "—"}
                        color={toneColor(tone, t.colors)}
                        t={t}
                      />
                      <BookKpi
                        label="BE"
                        value={`${b.breakeven_acos.toFixed(0)}%`}
                        color={t.colors.text_secondary}
                        t={t}
                      />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </SectionCard>

        {/* Top Campaigns by Net (date-filtered) */}
        <SectionCard
          testID="top-campaigns-card"
          title="Top campaigns"
          action={{ label: "See all", onPress: () => router.push("/(tabs)/campaigns") }}
        >
          {(topCampaignsQ.data ?? []).length === 0 ? (
            <EmptyState icon="megaphone-outline" title="No campaign data in range" />
          ) : (
            (topCampaignsQ.data ?? []).map((c, idx) => {
              const isLast = idx === (topCampaignsQ.data?.length ?? 0) - 1;
              return (
                <TouchableOpacity
                  key={c.id}
                  testID={`top-campaign-${c.id}`}
                  onPress={() => router.push(`/campaign/${c.id}`)}
                  style={[
                    styles.row,
                    {
                      borderBottomColor: t.colors.separator,
                      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                  activeOpacity={0.6}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <ToneDot value={c.acos} target={royaltyRate} />
                      <Text
                        style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: 8, flex: 1 }]}
                        numberOfLines={1}
                      >
                        {c.name}
                      </Text>
                    </View>
                    <Text
                      style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 2 }]}
                    >
                      Spend {formatCurrency(c.spend, primaryCurrency, { compact: true })} · Sales{" "}
                      {formatCurrency(c.sales, primaryCurrency, { compact: true })} · ACOS{" "}
                      {c.sales > 0 ? formatPercent(c.acos) : "—"} · BE {royaltyRate}%
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
              );
            })
          )}
        </SectionCard>

        {/* Top Keywords by ROAS (date-filtered) */}
        <SectionCard
          testID="top-keywords-card"
          title="Top keywords by ROAS"
          action={{ label: "See all", onPress: () => router.push("/(tabs)/targeting") }}
        >
          {(topKeywordsQ.data ?? []).length === 0 ? (
            <EmptyState icon="search-outline" title="No keyword data in range" />
          ) : (
            (topKeywordsQ.data ?? []).map((kw, idx) => {
              const isLast = idx === (topKeywordsQ.data?.length ?? 0) - 1;
              return (
                <View
                  key={kw.id}
                  style={[
                    styles.row,
                    {
                      borderBottomColor: t.colors.separator,
                      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text
                        style={[t.typography.callout, { color: t.colors.text_primary, flex: 1 }]}
                        numberOfLines={1}
                      >
                        {kw.text}
                      </Text>
                      {kw.match_type && <Pill label={kw.match_type} tone="primary" />}
                    </View>
                    <Text
                      style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}
                    >
                      Spend {formatCurrency(kw.spend, primaryCurrency, { compact: true })} · ACOS{" "}
                      {kw.sales > 0 ? formatPercent(kw.acos) : "—"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[t.typography.headline, { color: t.colors.tone_good }]}>
                      {kw.roas.toFixed(1)}x
                    </Text>
                    <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>ROAS</Text>
                  </View>
                </View>
              );
            })
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
                {lastSync.campaigns_synced} campaigns · {lastSync.keywords_synced} keywords ·{" "}
                {lastSync.product_ads_synced} products
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

function MetricMiniCard({
  label,
  value,
  color,
  data,
  variant,
  t,
}: {
  label: string;
  value: string;
  color: string;
  data: { value: number }[];
  variant: "bar" | "line";
  t: any;
}) {
  const cardWidth = (screenWidth - 32 - 24 - 12) / 2; // card padding + outer gutter
  return (
    <View
      style={[
        styles.miniCard,
        { backgroundColor: t.colors.background_tertiary, width: cardWidth, padding: t.spacing.sm },
      ]}
    >
      <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{label.toUpperCase()}</Text>
      <Text style={[t.typography.title3, { color: color, marginTop: 4 }]} numberOfLines={1}>
        {value}
      </Text>
      <View style={{ marginTop: 4, marginHorizontal: -t.spacing.sm }}>
        <MiniChart data={data} variant={variant} color={color} width={cardWidth - 4} height={48} />
      </View>
    </View>
  );
}

function BookKpi({ label, value, color, t }: { label: string; value: string; color?: string; t: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, fontSize: 9 }]}>{label}</Text>
      <Text
        style={[
          { fontSize: 12, fontWeight: "600", marginTop: 1, color: color || t.colors.text_primary },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 100 },
  demoBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  netCard: {},
  netHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kpiGrid: { flexDirection: "row", gap: 12 },
  kpiCol: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniCard: { borderRadius: 10, minHeight: 96 },
  bookRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
  },
  bookImage: {
    width: 44,
    height: 56,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bookKpiRow: {
    flexDirection: "row",
    marginTop: 8,
    gap: 6,
  },
});
