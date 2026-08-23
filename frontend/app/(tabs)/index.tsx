import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  Image,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { IOSSegmentedControl, SFSymbol, sfFromIonicon } from "@/src/components/ios/Native";
import {
  fetchCampaignMetricsRange,
  aggregateDailyMetrics,
  fetchProfileSyncLogs,
  fetchTopCampaignsRange,
  fetchTopBooksRange,
  fetchKdpRoyaltiesRange,
  fetchAllCampaignBudgets,
  fetchRuleExecutions,
  fetchOptimizationRules,
  fetchTodayExecutionStats,
  fetchHourlyMetrics,
  fetchPlacementMixRange,
  fetchSearchTerms,
  fetchKeywords,
  type TopBookRow,
} from "@/src/lib/queries";
import { fetchBidEngineStatus } from "@/src/lib/mutations";
import type { PlacementMixRow } from "@/src/lib/queries";
import {
  bootstrapToBleeders,
  bootstrapToCampaignMetrics,
  bootstrapToRoyalties,
  bootstrapToTopBooks,
  fetchAggregatedCampaigns,
  fetchDashboardBootstrap,
  nestDashboardProfileIds,
  previousMetricsToCampaignRows,
  previousMetricsToRoyalties,
} from "@/src/lib/dashboardApi";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, toneColor, useReduceMotion } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  formatCompact,
  previousRange,
  safeDivide,
  formatDateShort,
  toDateString,
  parseDateOnly,
  formatDateRangeLabel,
} from "@/src/lib/format";
import { buildBookColorMap, bookColorKeyFor, fallbackBookColor, normalizeBookColorKey } from "@/src/lib/bookColors";
import { EmptyState, RetryState, StatBadge, MetricStrip } from "@/src/components/Primitives";
import { NetProfitChart, Sparkline } from "@/src/components/Charts";
import * as Haptics from "expo-haptics";

const CARD_RADIUS = 10;
const PAGE_PAD = 16;
const OVERVIEW_QUERY_CACHE = {
  staleTime: 5 * 60_000,
  gcTime: 12 * 60 * 60_000,
};
const OVERVIEW_LIVE_QUERY_CACHE = {
  staleTime: 60_000,
  gcTime: 6 * 60 * 60_000,
};

type DashboardActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone: "danger" | "warning";
  route: string;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function DeltaBadge({ delta, inverse = false, neutral = false, t }: { delta: number; inverse?: boolean; neutral?: boolean; t: any }) {
  if (delta === 0) return null;
  const good = inverse ? delta < 0 : delta > 0;
  const color = neutral ? t.colors.text_tertiary : good ? t.colors.tone_good : t.colors.tone_danger;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
      <SFSymbol name={delta > 0 ? "arrow.up" : "arrow.down"} size={11} color={color} />
      <Text style={{ fontSize: 12, color, fontWeight: "600", marginLeft: 1 }}>
        {Math.abs(delta).toFixed(1)}%
      </Text>
    </View>
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDate(a: Date, b: Date) {
  return toDateString(a) === toDateString(b);
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function makeDashboardMonthRange(anchor: Date, now = new Date()) {
  const today = parseDateOnly(toDateString(now));
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  let start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (start > currentMonthStart) start = currentMonthStart;

  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const end = monthEnd > today ? today : monthEnd;
  const range = { start: toDateString(start), end: toDateString(end), label: "Custom" };
  return { ...range, label: sameMonth(start, today) ? "This month" : formatDateRangeLabel(range) };
}

function makeDashboardWeekRange(anchorEnd: Date, now = new Date()) {
  const today = parseDateOnly(toDateString(now));
  const end = anchorEnd > today ? today : parseDateOnly(toDateString(anchorEnd));
  const start = addDays(end, -6);
  const range = { start: toDateString(start), end: toDateString(end), label: "Custom" };
  return { ...range, label: sameDate(end, today) ? "Last 7 days" : formatDateRangeLabel(range) };
}

function isDashboardMonthRange(start: Date, end: Date, now = new Date()) {
  const today = parseDateOnly(toDateString(now));
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const endsAtMonthEnd = sameDate(end, monthEnd);
  const endsTodayInCurrentMonth = sameMonth(start, today) && sameDate(end, today);
  return start.getDate() === 1 && sameMonth(start, end) && (endsAtMonthEnd || endsTodayInCurrentMonth);
}

function inferDashboardPeriodMode(range: { start: string; end: string }) {
  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);
  if (isDashboardMonthRange(start, end)) return "month";
  return "week";
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function OverviewScreen() {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const { user, guestMode } = useAuth();
  const {
    profilesLoading,
    profilesFetching,
    profilesError,
    refetchProfiles,
    adminUsers,
    adminUsersError,
    isAdminViewer,
    adminFilterUserId,
    selectedProfileIds,
    selectedProfiles,
    primaryCurrency,
    dateRange,
    setDateRange,
  } = useApp();
  const viewingUser = adminUsers.find((candidate) => candidate.id === adminFilterUserId);
  const viewingAsAdmin = !!adminFilterUserId;
  const nestProfileIds = nestDashboardProfileIds(selectedProfileIds, selectedProfiles);
  const [refreshing, setRefreshing] = useState(false);
  const contentWidth = Math.max(280, viewportWidth - PAGE_PAD * 2);
  const chartWidth = Math.max(240, contentWidth - 32);
  const heroChartWidth = Math.max(240, contentWidth - 36);

  // ── date range helpers ──
  const todayDate = parseDateOnly(toDateString(new Date()));
  const todayStr = toDateString(todayDate);
  const yesterdayStr = toDateString(addDays(todayDate, -1));
  const dayBeforeStr = toDateString(addDays(todayDate, -2));

  // period selector: Month / Week
  const [periodMode, setPeriodMode] = useState<"month" | "week">(() => inferDashboardPeriodMode(dateRange));

  useEffect(() => {
    setPeriodMode(inferDashboardPeriodMode(dateRange));
  }, [dateRange.start, dateRange.end]);

  // ── queries ──
  const sellerReady = !viewingAsAdmin && selectedProfileIds.length > 0;

  const bootstrapQ = useQuery({
    queryKey: ["dashboard-bootstrap", adminFilterUserId, nestProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchDashboardBootstrap({
        startDate: dateRange.start,
        endDate: dateRange.end,
        profileIds: nestProfileIds,
        filterUserId: adminFilterUserId,
      }),
    enabled: viewingAsAdmin && nestProfileIds.length > 0,
    ...OVERVIEW_QUERY_CACHE,
  });

  const adminCampaignsQ = useQuery({
    queryKey: ["dashboard-campaigns", adminFilterUserId, nestProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchAggregatedCampaigns({
        startDate: dateRange.start,
        endDate: dateRange.end,
        profileIds: nestProfileIds,
        filterUserId: adminFilterUserId,
      }),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const metricsQ = useQuery({
    queryKey: ["campaign-metrics", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchCampaignMetricsRange(selectedProfileIds, dateRange.start, dateRange.end),
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const prevMetricsQ = useQuery({
    queryKey: ["campaign-metrics-prev", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => {
      const prev = previousRange(dateRange.start, dateRange.end);
      return fetchCampaignMetricsRange(selectedProfileIds, prev.start, prev.end);
    },
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const royaltiesQ = useQuery({
    queryKey: ["kdp-royalties", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchKdpRoyaltiesRange(selectedProfileIds, dateRange.start, dateRange.end),
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const prevRoyaltiesQ = useQuery({
    queryKey: ["kdp-royalties-prev", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => {
      const prev = previousRange(dateRange.start, dateRange.end);
      return fetchKdpRoyaltiesRange(selectedProfileIds, prev.start, prev.end);
    },
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const yesterdayQ = useQuery({
    queryKey: ["campaign-metrics-yesterday", selectedProfileIds, yesterdayStr],
    queryFn: () => fetchCampaignMetricsRange(selectedProfileIds, yesterdayStr, yesterdayStr),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const dayBeforeQ = useQuery({
    queryKey: ["campaign-metrics-daybefore", selectedProfileIds, dayBeforeStr],
    queryFn: () => fetchCampaignMetricsRange(selectedProfileIds, dayBeforeStr, dayBeforeStr),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const yestRoyaltiesQ = useQuery({
    queryKey: ["kdp-royalties-yesterday", selectedProfileIds, yesterdayStr],
    queryFn: () => fetchKdpRoyaltiesRange(selectedProfileIds, yesterdayStr, yesterdayStr),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const dayBeforeRoyaltiesQ = useQuery({
    queryKey: ["kdp-royalties-daybefore", selectedProfileIds, dayBeforeStr],
    queryFn: () => fetchKdpRoyaltiesRange(selectedProfileIds, dayBeforeStr, dayBeforeStr),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const topCampaignsQ = useQuery({
    queryKey: ["top-campaigns-range", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopCampaignsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        limit: 10,
      }),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const topBooksQ = useQuery({
    queryKey: ["top-books-range", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate: 0,
        limit: 4,
        filterUserId: adminFilterUserId,
      }),
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const topBooksYesterdayQ = useQuery({
    queryKey: ["top-books-yesterday", selectedProfileIds, yesterdayStr],
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: yesterdayStr,
        end: yesterdayStr,
        royaltyRate: 0,
        limit: 2,
      }),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const placementMixQ = useQuery({
    queryKey: ["placement-mix-range", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchPlacementMixRange(selectedProfileIds, dateRange.start, dateRange.end),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const syncLogsQ = useQuery({
    queryKey: ["sync-logs", selectedProfileIds],
    queryFn: () => fetchProfileSyncLogs(selectedProfileIds),
    enabled: sellerReady,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  const todayMetricsQ = useQuery({
    queryKey: ["campaign-metrics-today", selectedProfileIds, todayStr],
    queryFn: () => fetchCampaignMetricsRange(selectedProfileIds, todayStr, todayStr),
    enabled: false,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  const allBudgetsQ = useQuery({
    queryKey: ["all-campaign-budgets", selectedProfileIds],
    queryFn: () => fetchAllCampaignBudgets(selectedProfileIds),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const ruleExecsQ = useQuery({
    queryKey: ["rule-executions-dashboard", user?.id, selectedProfileIds],
    queryFn: () => fetchRuleExecutions({ userId: user!.id, profileIds: selectedProfileIds }),
    enabled: false,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  // Rule names for Automation Pulse display
  const rulesQ = useQuery({
    queryKey: ["optimization-rules", user?.id, selectedProfileIds],
    queryFn: () => fetchOptimizationRules(user!.id, selectedProfileIds),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  // Today's execution stats from rule_execution_batches
  const todayStatsQ = useQuery({
    queryKey: ["today-execution-stats", user?.id, selectedProfileIds, todayStr],
    queryFn: () => fetchTodayExecutionStats(user!.id, selectedProfileIds),
    enabled: false,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  // Hourly metrics from ams_messages for heatmap (last 7 days)
  const last7Start = toDateString(addDays(todayDate, -6));
  const hourlyQ = useQuery({
    queryKey: ["hourly-metrics", selectedProfileIds, last7Start, todayStr],
    queryFn: () => fetchHourlyMetrics(selectedProfileIds, last7Start, todayStr),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const searchTermsPulseQ = useQuery({
    queryKey: ["search-terms-pulse", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchSearchTerms(selectedProfileIds, { start: dateRange.start, end: dateRange.end, limit: 8 }),
    enabled: false,
    ...OVERVIEW_QUERY_CACHE,
  });

  const bleedersQ = useQuery({
    queryKey: ["bleeding-keywords", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchKeywords(selectedProfileIds, { start: dateRange.start, end: dateRange.end, limit: 40, filterUserId: adminFilterUserId }),
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
  });

  const bidBotStatusQ = useQuery({
    queryKey: ["bid-engine-status", adminFilterUserId ?? "self"],
    queryFn: () => fetchBidEngineStatus(adminFilterUserId),
    enabled: false,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  const adminMetrics = viewingAsAdmin ? bootstrapToCampaignMetrics(bootstrapQ.data) : null;
  const adminRoyalties = viewingAsAdmin ? bootstrapToRoyalties(bootstrapQ.data) : null;
  const adminPrevMetrics = viewingAsAdmin
    ? previousMetricsToCampaignRows(bootstrapQ.data?.metrics?.previousMetrics, dateRange.start)
    : null;
  const adminPrevRoyalties = viewingAsAdmin
    ? previousMetricsToRoyalties(bootstrapQ.data?.metrics?.previousMetrics, dateRange.start)
    : null;
  const adminTopBooks = viewingAsAdmin ? bootstrapToTopBooks(bootstrapQ.data) : null;
  const adminBleeders = viewingAsAdmin ? bootstrapToBleeders(bootstrapQ.data) : null;

  // ── derived data ──
  const royaltyRange = adminRoyalties ?? royaltiesQ.data;
  const prevRoyaltyRange = adminPrevRoyalties ?? prevRoyaltiesQ.data;
  const kdpReady = !!royaltyRange?.hasKdpData;
  const prevKdpReady = !!prevRoyaltyRange?.hasKdpData;
  const adsReady = viewingAsAdmin
    ? !(bootstrapQ.isError && !bootstrapQ.data)
    : !metricsQ.isError;
  const financeComplete = kdpReady && adsReady;
  const metricRows = adminMetrics ?? metricsQ.data ?? [];
  const prevMetricRows = adminPrevMetrics ?? prevMetricsQ.data ?? [];
  const topCampaigns = adminCampaignsQ.data ?? topCampaignsQ.data ?? [];
  const topBooks = adminTopBooks ?? topBooksQ.data ?? [];
  const bleeders = adminBleeders ?? bleedersQ.data ?? [];
  const loading = viewingAsAdmin ? bootstrapQ.isLoading : metricsQ.isLoading || royaltiesQ.isLoading;
  const daily = aggregateDailyMetrics(metricRows);
  const prevDaily = aggregateDailyMetrics(prevMetricRows);
  const royaltyByDate = useMemo(
    () => new Map((royaltyRange?.daily ?? []).map((day) => [day.date, day.royalties])),
    [royaltyRange],
  );
  const fallbackRoyalties = (_sales: number) => 0;
  const royaltiesForDate = (date: string, sales: number) => royaltyByDate.get(date) ?? fallbackRoyalties(sales);
  const totals = useMemo(() => {
    const acc = daily.reduce(
      (a, m) => ({
        impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks,
        orders: a.orders + m.orders,
        spend: a.spend + m.spend,
        sales: a.sales + m.sales,
      }),
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
    const royalties = royaltyRange?.hasKdpData ? royaltyRange.totalRoyalties : fallbackRoyalties(acc.sales);
    const bookOrders = royaltyRange?.hasKdpData ? royaltyRange.totalOrders : acc.orders;
    const organicOrders = royaltyRange?.hasKdpData ? Math.max(0, bookOrders - acc.orders) : 0;
    const net = royalties - acc.spend;
    const acos = safeDivide(acc.spend, acc.sales) * 100;
    const ctr = safeDivide(acc.clicks, acc.impressions) * 100;
    const cvr = safeDivide(acc.orders, acc.clicks) * 100;
    return { ...acc, royalties, bookOrders, organicOrders, net, acos, ctr, cvr };
  }, [daily, royaltyRange]);

  const breakEvenAcos = useMemo(() => {
    const royaltyPerBookOrder =
      royaltyRange?.hasKdpData && totals.bookOrders > 0
        ? safeDivide(totals.royalties, totals.bookOrders)
        : 0;
    const adSalePerOrder = totals.orders > 0 ? safeDivide(totals.sales, totals.orders) : 0;
    const realBreakEven =
      royaltyPerBookOrder > 0 && adSalePerOrder > 0
        ? (royaltyPerBookOrder / adSalePerOrder) * 100
        : 0;

    // Break-even ACoS comes only from real KDP royalty data (per book, like the
    // Top Books widget) — no manual/settings override.
    return Number.isFinite(realBreakEven) && realBreakEven > 0 ? realBreakEven : 0;
  }, [
    royaltyRange?.hasKdpData,
    totals.bookOrders,
    totals.orders,
    totals.royalties,
    totals.sales,
  ]);

  const prevTotals = useMemo(() => {
    const acc = prevDaily.reduce(
      (a, m) => ({
        impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks,
        orders: a.orders + m.orders,
        spend: a.spend + m.spend,
        sales: a.sales + m.sales,
      }),
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
    const royalties = prevRoyaltyRange?.hasKdpData ? prevRoyaltyRange.totalRoyalties : fallbackRoyalties(acc.sales);
    return {
      ...acc,
      royalties,
      net: royalties - acc.spend,
      acos: safeDivide(acc.spend, acc.sales) * 100,
      ctr: safeDivide(acc.clicks, acc.impressions) * 100,
      cvr: safeDivide(acc.orders, acc.clicks) * 100,
    };
  }, [prevDaily, prevRoyaltyRange]);

  function pctDelta(curr: number, prev: number) {
    if (!prev) return 0;
    return ((curr - prev) / prev) * 100;
  }

  const deltas = {
    net: pctDelta(totals.net, prevTotals.net),
    royalties: pctDelta(totals.royalties, prevTotals.royalties),
    spend: pctDelta(totals.spend, prevTotals.spend),
    acos: pctDelta(totals.acos, prevTotals.acos),
    orders: pctDelta(totals.orders, prevTotals.orders),
    clicks: pctDelta(totals.clicks, prevTotals.clicks),
    ctr: pctDelta(totals.ctr, prevTotals.ctr),
    cvr: pctDelta(totals.cvr, prevTotals.cvr),
    impressions: pctDelta(totals.impressions, prevTotals.impressions),
  };

  // Yesterday totals
  const yestTotals = useMemo(() => {
    const rows = viewingAsAdmin
      ? metricRows.filter((row) => row.date === yesterdayStr)
      : yesterdayQ.data ?? [];
    const acc = rows.reduce(
      (a, m: any) => ({
        impressions: a.impressions + (Number(m.impressions) || 0),
        clicks: a.clicks + (Number(m.clicks) || 0),
        orders: a.orders + (Number(m.orders) || 0),
        spend: a.spend + (Number(m.spend) || 0),
        sales: a.sales + (Number(m.sales) || 0),
      }),
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
    const royalties = viewingAsAdmin
      ? royaltiesForDate(yesterdayStr, acc.sales)
      : yestRoyaltiesQ.data?.hasKdpData ? yestRoyaltiesQ.data.totalRoyalties : fallbackRoyalties(acc.sales);
    return {
      ...acc,
      royalties,
      net: royalties - acc.spend,
      acos: safeDivide(acc.spend, acc.sales) * 100,
      ctr: safeDivide(acc.clicks, acc.impressions) * 100,
      cvr: safeDivide(acc.orders, acc.clicks) * 100,
    };
  }, [viewingAsAdmin, metricRows, yesterdayStr, yesterdayQ.data, yestRoyaltiesQ.data, royaltyByDate]);

  const dayBeforeTotals = useMemo(() => {
    const rows = viewingAsAdmin
      ? metricRows.filter((row) => row.date === dayBeforeStr)
      : dayBeforeQ.data ?? [];
    const acc = rows.reduce(
      (a, m: any) => ({
        impressions: a.impressions + (Number(m.impressions) || 0),
        clicks: a.clicks + (Number(m.clicks) || 0),
        orders: a.orders + (Number(m.orders) || 0),
        spend: a.spend + (Number(m.spend) || 0),
        sales: a.sales + (Number(m.sales) || 0),
      }),
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
    const royalties = viewingAsAdmin
      ? royaltiesForDate(dayBeforeStr, acc.sales)
      : dayBeforeRoyaltiesQ.data?.hasKdpData ? dayBeforeRoyaltiesQ.data.totalRoyalties : fallbackRoyalties(acc.sales);
    return { ...acc, royalties, net: royalties - acc.spend };
  }, [viewingAsAdmin, metricRows, dayBeforeStr, dayBeforeQ.data, dayBeforeRoyaltiesQ.data, royaltyByDate]);

  const yestDeltas = {
    royalties: pctDelta(yestTotals.royalties, dayBeforeTotals.royalties),
    spend: pctDelta(yestTotals.spend, dayBeforeTotals.spend),
    net: pctDelta(yestTotals.net, dayBeforeTotals.net),
    orders: pctDelta(yestTotals.orders, dayBeforeTotals.orders),
    clicks: pctDelta(yestTotals.clicks, dayBeforeTotals.clicks),
    impressions: pctDelta(yestTotals.impressions, dayBeforeTotals.impressions),
    ctr: pctDelta(yestTotals.ctr, safeDivide(dayBeforeTotals.clicks, dayBeforeTotals.impressions) * 100),
    cvr: pctDelta(yestTotals.cvr, safeDivide(dayBeforeTotals.orders, dayBeforeTotals.clicks) * 100),
  };

  // Net profit sparkline
  const netSeries = useMemo(
    () => daily.map((m) => ({ value: royaltiesForDate(m.date, m.sales) - m.spend, label: formatDateShort(m.date) })),
    [daily, royaltyByDate],
  );

  const ordersSeries = useMemo(() => daily.slice(-14).map((m) => ({ value: m.orders, label: formatDateShort(m.date) })), [daily]);

  // Ads Engine chart data
  const adsEngineImpressions = useMemo(
    () => daily.map((m) => ({ value: m.impressions, label: formatDateShort(m.date) })),
    [daily],
  );
  const adsEngineClicks = useMemo(() => daily.map((m) => ({ value: m.clicks })), [daily]);
  const adsEngineOrders = useMemo(() => daily.map((m) => ({ value: m.orders })), [daily]);
  const adsEngineAcos = useMemo(
    () => daily.map((m) => ({ value: safeDivide(m.spend, m.sales) * 100 })),
    [daily],
  );

  // Hero overlay lines (royalties + ad spend, shown alongside net profit)
  const btRoyalties = useMemo(
    () => daily.map((m) => ({ value: royaltiesForDate(m.date, m.sales), label: formatDateShort(m.date) })),
    [daily, royaltyByDate],
  );
  const btSpend = useMemo(() => daily.map((m) => ({ value: m.spend })), [daily]);

  // Budget pace uses today's synced row when present, otherwise the latest synced
  // campaign metric day in the selected range. That avoids showing a false $0
  // while the current day has not been imported yet.
  const latestBudgetDay = useMemo(() => {
    const todayRows = viewingAsAdmin
      ? daily.filter((row) => row.date === todayStr)
      : aggregateDailyMetrics(todayMetricsQ.data ?? []);
    if (todayRows.length) return todayRows[0];
    return daily[daily.length - 1] ?? null;
  }, [daily, todayMetricsQ.data, viewingAsAdmin, todayStr]);
  const budgetSpend = latestBudgetDay?.spend ?? 0;
  const totalDailyBudget = allBudgetsQ.data ?? 0;
  const placementMix = placementMixQ.data ?? [];
  const yesterdayBooks = topBooksYesterdayQ.data ?? [];

  // Top Books privacy blur toggle
  const [blurBooks, setBlurBooks] = useState(false);

  // Campaign filter state — default to "attention" so leaks surface first
  const [campFilter, setCampFilter] = useState<"attention" | "top" | "spend" | "acos" | "orders">("attention");
  const filteredCampaigns = useMemo(() => {
    const rows = topCampaigns;
    if (campFilter === "spend") return [...rows].sort((a, b) => b.spend - a.spend);
    if (campFilter === "acos") return [...rows].sort((a, b) => b.acos - a.acos);
    if (campFilter === "orders") return [...rows].sort((a, b) => b.orders - a.orders);
    if (campFilter === "attention") {
      // Rank by money at risk: wasted spend (spend, no orders) + over-break-even ACOS.
      const score = (c: (typeof rows)[number]) => {
        const wasted = c.orders === 0 && c.spend > 0 ? c.spend : 0;
        const overAcos = c.sales > 0 && breakEvenAcos > 0 && c.acos > breakEvenAcos ? c.spend : 0;
        return wasted + overAcos;
      };
      return [...rows].sort((a, b) => score(b) - score(a));
    }
    return rows; // top = by sales for campaign-level ad performance
  }, [topCampaigns, campFilter, breakEvenAcos]);

  const bookColorMap = useMemo(
    () => buildBookColorMap(topBooks.map((book) => bookColorKeyFor(book))),
    [topBooks],
  );
  const bookColorFor = (
    item: Parameters<typeof bookColorKeyFor>[0],
    fallbackIndex = 0,
  ) => {
    const key = bookColorKeyFor(item);
    if (!key) return t.colors.text_tertiary;
    return bookColorMap.get(key) ?? fallbackBookColor(key, fallbackIndex);
  };

  // Automation pulse
  const ruleExecs = useMemo(() => ruleExecsQ.data ?? [], [ruleExecsQ.data]);

  // Map rule_id → rule name from optimization_rules
  const ruleNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rulesQ.data ?? []) m.set(r.id, r.name);
    return m;
  }, [rulesQ.data]);

  // Today stats — use real rule_execution_batches data
  const pulseStats = todayStatsQ.data ?? { rulesRun: 0, entitiesEdited: 0, batchCount: 0 };

  // Real heatmap from ams_messages (7 days × 24 hours)
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxValue = 0;
    for (const m of hourlyQ.data ?? []) {
      const day = new Date(`${m.date}T12:00:00`).getDay(); // 0=Sun … 6=Sat
      const h = Number(m.hour);
      if (h >= 0 && h < 24) {
        grid[day][h] += Number(m.orders) || 0;
        if (grid[day][h] > maxValue) maxValue = grid[day][h];
      }
    }
    return { grid, maxValue };
  }, [hourlyQ.data]);

  // Connection status from sync
  const syncRows = syncLogsQ.data ?? [];
  const lastSync = syncRows[0];
  const latestSyncStatus = lastSync?.status?.toLowerCase();
  const recentCompletedSync = syncRows.find((row) => row.status?.toLowerCase() === "completed");
  const lastSyncStartedAt = lastSync?.started_at ? new Date(lastSync.started_at).getTime() : 0;
  const lastSyncAgeMs = lastSyncStartedAt > 0 ? Date.now() - lastSyncStartedAt : Number.POSITIVE_INFINITY;
  const latestStatusIsActive =
    latestSyncStatus === "pending" ||
    latestSyncStatus === "running" ||
    latestSyncStatus === "processing" ||
    latestSyncStatus === "in_progress";
  const syncStale = latestStatusIsActive && lastSyncAgeMs > 45 * 60_000;
  const syncWarning =
    syncStale ||
    latestSyncStatus === "failed" ||
    latestSyncStatus === "partial" ||
    latestSyncStatus === "partial_failed" ||
    latestSyncStatus === "partial_fail" ||
    latestSyncStatus === "error";
  const syncActive = latestStatusIsActive && !syncStale;
  const connected = !!recentCompletedSync && !syncWarning && !syncActive;

  // Profile label
  const primaryProfile =
    selectedProfiles.length === 1
      ? selectedProfiles[0]?.nickname ?? selectedProfiles[0]?.account_name ?? selectedProfiles[0]?.profile_id ?? "Selected profile"
      : selectedProfiles.length > 1
        ? `${selectedProfiles.length} profiles`
        : "All profiles";

  // ── Header freshness: Ads sync time + KDP data recency ──
  const kdpDaily = royaltyRange?.daily ?? [];
  const kdpLatestDate = kdpDaily.length ? kdpDaily[kdpDaily.length - 1].date : null;
  const kdpStale = !!kdpLatestDate && kdpLatestDate < yesterdayStr;

  // ── Action Required: money at risk + automation health ──
  const wastedSpendCampaigns = useMemo(
    () => topCampaigns.filter((c) => c.spend > 0 && c.orders === 0),
    [topCampaigns],
  );
  const highAcosCampaigns = useMemo(
    () => topCampaigns.filter((c) => c.sales > 0 && breakEvenAcos > 0 && c.acos > breakEvenAcos),
    [topCampaigns, breakEvenAcos],
  );
  const failedRuleRuns = useMemo(
    () => ruleExecs.filter((ex) => ex.status && ex.status.toLowerCase() !== "completed").length,
    [ruleExecs],
  );
  const wastedSpendTotal = wastedSpendCampaigns.reduce((sum, c) => sum + c.spend, 0);
  const budgetUsedPct = totalDailyBudget > 0 ? (budgetSpend / totalDailyBudget) * 100 : 0;
  const budgetDanger = totalDailyBudget > 0 && budgetUsedPct >= 90;

  const actionItems = useMemo(() => {
    const items: DashboardActionItem[] = [];
    if (failedRuleRuns > 0)
      items.push({ icon: "alert-circle", text: `${failedRuleRuns} rule run${failedRuleRuns === 1 ? "" : "s"} failed`, tone: "danger", route: "/more/rule-history" });
    if (wastedSpendCampaigns.length > 0)
      items.push({
        icon: "cash-outline",
        text: `${wastedSpendCampaigns.length} campaign${wastedSpendCampaigns.length === 1 ? "" : "s"} spent ${formatCurrency(wastedSpendTotal, primaryCurrency, { compact: true })} with 0 orders`,
        tone: "danger",
        route: "/(tabs)/campaigns",
      });
    if (highAcosCampaigns.length > 0)
      items.push({
        icon: "trending-up-outline",
        text: `${highAcosCampaigns.length} campaign${highAcosCampaigns.length === 1 ? "" : "s"} above break-even ACOS`,
        tone: "warning",
        route: "/(tabs)/campaigns",
      });
    if (budgetDanger)
      items.push({ icon: "wallet-outline", text: `Today's ad budget ${Math.round(budgetUsedPct)}% used`, tone: "warning", route: "/(tabs)/campaigns" });
    if (syncWarning || syncStale)
      items.push({ icon: "sync-outline", text: syncStale ? "Sync appears stuck" : "Sync needs review", tone: "warning", route: "/more/sync" });
    if (kdpStale && kdpLatestDate)
      items.push({ icon: "book-outline", text: `KDP royalties only through ${formatDateShort(kdpLatestDate)}`, tone: "warning", route: "/more/sync" });
    return items;
  }, [failedRuleRuns, wastedSpendCampaigns, highAcosCampaigns, wastedSpendTotal, budgetDanger, budgetUsedPct, syncWarning, syncStale, kdpStale, kdpLatestDate, primaryCurrency]);

  // ACOS judgment colors
  const acosKnown = totals.sales > 0 && breakEvenAcos > 0;
  const acosSafe = acosKnown && totals.acos <= breakEvenAcos;
  const acosColor = !acosKnown ? t.colors.text_primary : acosSafe ? t.colors.tone_good : t.colors.tone_danger;

  // Period navigation
  function shiftPeriod(dir: -1 | 1) {
    if (periodMode === "month") {
      const start = parseDateOnly(dateRange.start);
      start.setMonth(start.getMonth() + dir, 1);
      setDateRange(makeDashboardMonthRange(start));
      return;
    }
    const end = addDays(parseDateOnly(dateRange.end), dir * 7);
    setDateRange(makeDashboardWeekRange(end));
  }

  function applyPeriodMode(mode: "month" | "week") {
    if (mode === periodMode) return;
    setPeriodMode(mode);
    if (mode === "month") {
      setDateRange(makeDashboardMonthRange(todayDate));
      return;
    }
    setDateRange(makeDashboardWeekRange(todayDate));
  }

  const canGoNextPeriod = parseDateOnly(dateRange.end) < todayDate;
  const periodLabel = useMemo(() => formatDateRangeLabel(dateRange), [dateRange]);
  const syncColor = connected ? t.colors.tone_good : syncWarning ? t.colors.tone_danger : t.colors.tone_warning;
  const syncLabel = syncLogsQ.isLoading
    ? "Checking"
    : connected
      ? "Connected"
      : syncWarning
        ? "Sync issue"
        : syncActive
          ? "Syncing"
          : "Waiting";
  const syncCompactLabel = syncWarning ? "Issue" : connected ? "OK" : syncActive ? "Syncing" : "Sync";
  const profitAccentColor = !financeComplete
    ? t.colors.text_tertiary
    : totals.net >= 0
      ? t.colors.tone_good
      : t.colors.tone_danger;
  const profitColor = loading || !financeComplete ? t.colors.text_tertiary : profitAccentColor;
  const profitVerdict = loading
    ? "Loading"
    : !kdpReady
      ? "No royalties"
      : !adsReady
        ? "Ads unavailable"
        : totals.net >= 0
          ? "Profitable"
          : "Loss";
  const profitMargin = safeDivide(totals.net, totals.royalties) * 100;
  const royaltiesFailed = !viewingAsAdmin && royaltiesQ.isError;
  const adsFailed = !viewingAsAdmin && metricsQ.isError;
  const netDisplay = loading || !financeComplete ? "—" : formatCurrency(totals.net, primaryCurrency);
  const royaltiesDisplay = loading || !kdpReady ? "—" : formatCurrency(totals.royalties, primaryCurrency, { compact: true });
  const spendDisplay = loading || !adsReady ? "—" : formatCurrency(totals.spend, primaryCurrency, { compact: true });
  const acosDisplay = loading || !adsReady || totals.sales <= 0 ? "—" : formatPercent(totals.acos);
  const marginDisplay = loading || !kdpReady || !totals.royalties ? "—" : formatPercent(profitMargin, 0);
  const financeCaption = loading
    ? null
    : !kdpReady && !adsReady
      ? "Royalties and ad spend are unavailable."
      : !kdpReady
        ? "Royalties unavailable for this period."
        : !adsReady
          ? "Ad spend unavailable."
          : null;
  const acosValueColor =
    !loading && adsReady && totals.sales > 0 && breakEvenAcos > 0
      ? toneColor(acosTone(totals.acos, breakEvenAcos), t.colors)
      : t.colors.text_primary;
  const chartHeight = viewportWidth < 400 ? 120 : t.layout.chartHero;
  const openBook = useCallback((item: TopBookRow) => {
    const asin = item.asin || item.sku;
    if (!asin) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/product/[asin]",
      params: {
        asin,
        title: item.title ?? "",
        imageUrl: item.image_url ?? "",
      },
    });
  }, [router]);
  const openBooksTab = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/(tabs)/products");
  }, [router]);
  const engineHealthTone: "good" | "warning" | "danger" | "inactive" =
    totals.spend > 0 && totals.orders === 0
      ? "danger"
      : acosKnown && !acosSafe
        ? "warning"
        : totals.orders > 0
          ? "good"
          : "inactive";
  const engineHealthColor = toneColor(engineHealthTone, t.colors);
  const engineHealthLabel =
    engineHealthTone === "good"
      ? "Converting"
      : engineHealthTone === "danger"
        ? "Leaking spend"
        : engineHealthTone === "warning"
          ? "Needs tuning"
          : "No signal";
  const dashboardTransitionKey = `${selectedProfileIds.join(",")}:${dateRange.start}:${dateRange.end}`;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      bootstrapQ.refetch(),
      metricsQ.refetch(),
      prevMetricsQ.refetch(),
      royaltiesQ.refetch(),
      prevRoyaltiesQ.refetch(),
      topBooksQ.refetch(),
      syncLogsQ.refetch(),
      bleedersQ.refetch(),
    ]);
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0 && (profilesLoading || profilesFetching)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (selectedProfileIds.length === 0 && (profilesError || adminUsersError)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <RetryState
            title="Couldn't load accounts"
            subtitle={adminUsersError ? "Sign out and sign in again." : "Try again in a moment."}
            onRetry={() => void refetchProfiles()}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="business-outline"
            title="No Amazon account"
            subtitle={
              guestMode
                ? "Sign in to see your numbers."
                : isAdminViewer
                  ? viewingUser?.email
                    ? `Nothing is linked to ${viewingUser.email}. Pick another account in the profile menu.`
                    : "Pick a customer in the profile menu."
                  : user?.email
                    ? `Nothing is linked to ${user.email}.`
                    : "Connect an account to see your numbers."
            }
            action={
              guestMode || isAdminViewer
                ? undefined
                : { label: "Connect account", onPress: () => router.push("/more/accounts") }
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  if (viewingAsAdmin && bootstrapQ.isError && !bootstrapQ.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <RetryState
            title="Couldn't load dashboard"
            subtitle="Try again in a moment."
            onRetry={() => void bootstrapQ.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
        }
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
      >
        <View style={[styles.stickyHeader, { backgroundColor: t.colors.background_primary, borderBottomColor: t.colors.separator }]}>
          <View style={styles.headerShell}>
            <View style={styles.headerTopRow}>
              <TouchableOpacity
                style={[styles.headerAccountChip, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}
                onPress={() => router.push("/more/accounts")}
                activeOpacity={0.72}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Account, ${primaryProfile}, ${primaryCurrency}`}
              >
                <SFSymbol name="building.2" size={14} color={t.colors.tone_primary} />
                <Text style={[styles.headerAccountText, { color: t.colors.text_secondary }]} numberOfLines={1}>
                  {primaryProfile}
                </Text>
                <View style={[styles.currencyTag, { backgroundColor: t.colors.tone_primary + "16" }]}>
                  <Text style={[styles.currencyText, { color: t.colors.tone_primary }]}>{primaryCurrency}</Text>
                </View>
                <SFSymbol name="chevron.down" size={10} color={t.colors.text_tertiary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/more/sync")}
                activeOpacity={0.72}
                style={[styles.syncPill, { backgroundColor: syncColor + "14", borderColor: syncColor + "30" }]}
                accessibilityLabel={syncLabel}
                hitSlop={6}
              >
                <View style={[styles.dot, { backgroundColor: syncColor }]} />
                <Text style={[styles.syncText, { color: syncColor }]} numberOfLines={1}>
                  {syncCompactLabel}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateNavigator}>
              <TouchableOpacity
                accessibilityLabel="Previous period"
                style={[styles.dateNavButton, { backgroundColor: t.colors.background_secondary }]}
                onPress={() => shiftPeriod(-1)}
                activeOpacity={0.72}
                hitSlop={8}
                accessibilityRole="button"
              >
                <SFSymbol name="chevron.left" size={18} color={t.colors.text_primary} />
              </TouchableOpacity>
              <View
                style={styles.dateCenter}
                accessible
                accessibilityRole="header"
                accessibilityLabel={`Period, ${periodLabel}`}
              >
                <Text style={[styles.dateLabel, { color: t.colors.text_primary }]} numberOfLines={1} adjustsFontSizeToFit>
                  {periodLabel}
                </Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Next period"
                style={[styles.dateNavButton, { backgroundColor: t.colors.background_secondary, opacity: canGoNextPeriod ? 1 : 0.35 }]}
                onPress={() => shiftPeriod(1)}
                disabled={!canGoNextPeriod}
                activeOpacity={0.72}
                hitSlop={8}
              >
                <SFSymbol name="chevron.right" size={17} color={t.colors.text_primary} />
              </TouchableOpacity>
              <View style={{ minWidth: 128 }}>
                <IOSSegmentedControl
                  value={periodMode}
                  onChange={applyPeriodMode}
                  options={[
                    { key: "month", label: "Month" },
                    { key: "week", label: "Week" },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        <FadeOnChange
          watchKey={dashboardTransitionKey}
          reduceMotion={reduceMotion}
          style={{ paddingHorizontal: PAGE_PAD, paddingTop: t.spacing.sm }}
        >

          <View
            style={[styles.card, styles.profitCard, { backgroundColor: t.colors.background_secondary }]}
          >
            <Text
              style={[t.typography.footnote, { color: t.colors.text_secondary }]}
              accessibilityRole="header"
            >
              Royalties − spend
            </Text>
            <Text
              style={[t.typography.metric_massive, { color: profitColor, marginTop: t.spacing.xs }]}
              accessible
              accessibilityLabel={`Royalties minus ad spend, ${netDisplay}`}
            >
              {netDisplay}
            </Text>
            {!loading && financeComplete && prevKdpReady && (
              <View style={{ marginTop: t.spacing.sm }}>
                <StatBadge delta={deltas.net} suffix="vs previous period" />
              </View>
            )}
            {financeCaption ? (
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: t.spacing.sm }]}>
                {financeCaption}
              </Text>
            ) : null}
            {(royaltiesFailed || adsFailed) && (
              <TouchableOpacity
                onPress={() => void onRefresh()}
                accessibilityRole="button"
                accessibilityLabel="Retry financial data"
                style={{ minHeight: t.layout.minTap, justifyContent: "center", marginTop: t.spacing.xs }}
              >
                <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Retry</Text>
              </TouchableOpacity>
            )}

            <View
              style={{ marginTop: t.spacing.md, gap: t.spacing.sm }}
              accessible
              accessibilityLabel={`Royalties, ${royaltiesDisplay}. Ad spend, ${spendDisplay}. ACoS, ${acosDisplay}. Margin, ${marginDisplay}.`}
            >
              <MetricStrip
                items={[
                  { label: "Royalties", value: royaltiesDisplay },
                  { label: "Ad spend", value: spendDisplay },
                ]}
              />
              <MetricStrip
                items={[
                  { label: "ACoS", value: acosDisplay, color: acosValueColor },
                  { label: "Margin", value: marginDisplay },
                ]}
              />
            </View>

            {kdpReady && netSeries.length > 1 && (
              <View
                style={styles.profitChartShell}
                accessible
                accessibilityLabel={`Daily royalties minus ad spend for ${periodLabel}`}
              >
                <NetProfitChart
                  data={netSeries}
                  royaltiesData={btRoyalties}
                  spendData={btSpend}
                  width={heroChartWidth}
                  height={chartHeight}
                  currency={primaryCurrency}
                />
              </View>
            )}
          </View>

          <View style={[styles.card, { padding: t.spacing.card, marginTop: t.spacing.section, backgroundColor: t.colors.background_secondary }]}>
            <CardTitle
              icon="book-outline"
              tone="good"
              title="Top books"
              t={t}
              right={
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => setBlurBooks((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={blurBooks ? "Show book titles" : "Hide book titles"}
                    hitSlop={8}
                    style={{
                      minWidth: t.layout.minTap,
                      minHeight: t.layout.minTap,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: t.radii.sm,
                      backgroundColor: blurBooks ? t.colors.tone_primary + "22" : "transparent",
                    }}
                  >
                    <SFSymbol
                      name={blurBooks ? "eye.slash" : "eye"}
                      size={20}
                      color={blurBooks ? t.colors.tone_primary : t.colors.text_secondary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={openBooksTab}
                    accessibilityRole="button"
                    accessibilityLabel="Open Books"
                    hitSlop={8}
                    style={{ minHeight: t.layout.minTap, justifyContent: "center", paddingHorizontal: t.spacing.xs }}
                  >
                    <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Books</Text>
                  </TouchableOpacity>
                </View>
              }
            />
            {topBooks.length === 0
              ? (
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary, paddingVertical: t.spacing.sm }]}>
                  No book data in range
                </Text>
              )
              : topBooks.map((b, idx) => {
                const bookColor = bookColorFor(b, idx);
                const bookName = b.title || b.asin || b.sku || "Book";
                const bookNet = `${b.net >= 0 ? "+" : ""}${formatCurrency(b.net, primaryCurrency)}`;
                return (
                <TouchableOpacity
                  key={b.asin || idx}
                  onPress={() => openBook(b)}
                  disabled={!b.asin && !b.sku}
                  accessibilityRole="button"
                  accessibilityLabel={`${bookName}, royalties minus spend ${bookNet}, ad spend ${formatCurrency(b.spend, primaryCurrency)}, ACoS ${b.sales > 0 ? formatPercent(b.acos) : "not available"}`}
                  style={[
                    styles.bookRow,
                    {
                      borderBottomColor: t.colors.separator,
                      borderBottomWidth: idx === topBooks.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={[styles.bookColorBar, { backgroundColor: bookColor }]} />
                  <View style={[styles.bookThumb, { backgroundColor: bookColor + "14", borderColor: bookColor + "42" }]}>
                    {b.image_url
                      ? <Image source={{ uri: b.image_url }} style={styles.fullCoverImage} resizeMode="cover" />
                      : <SFSymbol name="book" size={18} color={bookColor} />}
                    {blurBooks && (
                      <View
                        style={{
                          ...StyleSheet.absoluteFillObject,
                          backgroundColor: t.colors.background_secondary,
                          opacity: 0.92,
                          borderRadius: t.radii.xs,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <SFSymbol name="eye.slash" size={14} color={t.colors.text_tertiary} />
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1, marginHorizontal: t.spacing.md, overflow: "hidden" }}>
                    <View style={{ overflow: "hidden" }}>
                      <Text
                        style={[t.typography.headline, { color: blurBooks ? "transparent" : t.colors.text_primary }]}
                        numberOfLines={2}
                      >
                        {bookName}
                      </Text>
                      {blurBooks && (
                        <View
                          style={{
                            ...StyleSheet.absoluteFillObject,
                            backgroundColor: t.colors.background_tertiary,
                            borderRadius: t.radii.xs,
                          }}
                        />
                      )}
                    </View>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: t.spacing.xxs }]} numberOfLines={1}>
                      {formatCurrency(b.spend, primaryCurrency, { compact: true })} spend ·{" "}
                      <Text style={{ color: b.sales > 0 && b.breakeven_acos > 0 ? toneColor(acosTone(b.acos, b.breakeven_acos), t.colors) : t.colors.text_secondary }}>
                        {b.sales > 0 ? formatPercent(b.acos) : "—"} ACoS
                      </Text>
                    </Text>
                  </View>
                  <Text
                    style={[t.typography.metric_compact, { color: b.net >= 0 ? t.colors.tone_good : t.colors.tone_danger }]}
                    numberOfLines={1}
                  >
                    {bookNet}
                  </Text>
                </TouchableOpacity>
                );
              })}
          </View>

          {(() => {
            const spendingBleeders = bleeders
              .filter((row) => Number(row.total_spend || 0) > 0 && Number(row.total_orders || 0) === 0)
              .slice(0, 5);
            if (spendingBleeders.length === 0) return null;
            return (
              <View style={[styles.card, { padding: t.spacing.card, marginTop: t.spacing.section, backgroundColor: t.colors.background_secondary }]}>
                <CardTitle icon="warning-outline" tone="warning" title="Spending without orders" t={t} mb={t.spacing.sm} />
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: t.spacing.sm }]}>
                  Ad spend with no attributed orders in this period.
                </Text>
                {spendingBleeders.map((row) => (
                  <TouchableOpacity
                    key={row.id}
                    onPress={() => router.push(`/keyword/${row.id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.keyword_text || "Keyword"}, ${formatCurrency(Number(row.total_spend || 0), primaryCurrency)} spent, no attributed orders`}
                    style={{
                      minHeight: t.layout.minTap,
                      justifyContent: "center",
                      paddingVertical: t.spacing.sm,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: t.colors.separator,
                    }}
                  >
                    <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
                      {row.keyword_text || "Keyword"}
                    </Text>
                    <Text style={[t.typography.caption1, { color: t.colors.tone_danger, marginTop: 2 }]}>
                      {formatCurrency(Number(row.total_spend || 0), primaryCurrency, { compact: true })} spent
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })()}

        </FadeOnChange>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function FadeOnChange({
  children,
  watchKey,
  style,
  reduceMotion = false,
}: {
  children: React.ReactNode;
  watchKey: string;
  style?: any;
  reduceMotion?: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0.86);
    translateY.setValue(6);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, watchKey, reduceMotion]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

function AnimatedValueText({
  value,
  style,
  ...props
}: React.ComponentProps<typeof Text> & { value: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (value === displayValue) return;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0.28,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -4,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setDisplayValue(value);
      translateY.setValue(4);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 170,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 190,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [displayValue, opacity, translateY, value]);

  return (
    <Animated.Text {...props} style={[style, { opacity, transform: [{ translateY }] }]}>
      {displayValue}
    </Animated.Text>
  );
}

function StatCard({
  label, value, delta, sparkData, sparkColor, inverse, neutral, icon, iconColor, t,
}: {
  label: string; value: string; delta?: number; sparkData: { value: number }[];
  sparkColor: string; inverse?: boolean; neutral?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; iconColor?: string; t: any;
}) {
  return (
    <View style={[styles.card, { flex: 1, padding: 14, backgroundColor: t.colors.background_secondary }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {icon && <SFSymbol name={sfFromIonicon(icon)} size={13} color={iconColor ?? t.colors.text_tertiary} />}
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{label}</Text>
      </View>
      <AnimatedValueText
        value={value}
        style={[t.typography.title2, { color: t.colors.text_primary, marginTop: 4 }]}
        numberOfLines={1}
      />
      {delta !== undefined && <DeltaBadge delta={delta} inverse={inverse} neutral={neutral} t={t} />}
      {sparkData.length > 1 && (
        <View style={{ marginTop: 8 }}>
          <Sparkline data={sparkData} color={sparkColor} height={44} />
        </View>
      )}
    </View>
  );
}

function YStat({ label, value, t }: { label: string; value: string; t: any }) {
  return (
    <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 2 }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]} numberOfLines={1}>
        {label}
      </Text>
      <AnimatedValueText
        value={value}
        style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700", marginTop: 2 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      />
    </View>
  );
}

function ActionReviewCard({
  items,
  rulesChecked,
  t,
  onOpen,
}: {
  items: DashboardActionItem[];
  rulesChecked: number;
  t: any;
  onOpen: (route: string) => void;
}) {
  const active = items.length > 0;
  const color = active ? t.colors.tone_danger : t.colors.tone_good;
  const visibleItems = items.slice(0, 3);

  return (
    <View style={[styles.actionReviewCard, { backgroundColor: t.colors.background_secondary, borderColor: color + "22" }]}>
      <View style={styles.actionReviewHeader}>
        <View style={[styles.actionReviewIcon, { backgroundColor: color + "16" }]}>
          <SFSymbol name={active ? "viewfinder" : "checkmark.shield"} size={20} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.actionReviewTitle, { color: t.colors.text_primary }]}>
            {active ? "Review queue" : "All clear"}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 1 }]} numberOfLines={1}>
            {active
              ? `${items.length} signal${items.length === 1 ? "" : "s"} need attention`
              : `${rulesChecked} rule${rulesChecked === 1 ? "" : "s"} checked today`}
          </Text>
        </View>
        <View style={[styles.actionReviewCount, { backgroundColor: color + "16" }]}>
          <Text style={[styles.actionReviewCountText, { color }]}>{active ? items.length : "OK"}</Text>
        </View>
      </View>

      {active ? (
        <View style={[styles.actionReviewList, { borderTopColor: t.colors.separator }]}>
          {visibleItems.map((item, index) => {
            const itemColor = item.tone === "danger" ? t.colors.tone_danger : t.colors.tone_warning;
            return (
              <TouchableOpacity
                key={`${item.route}-${item.text}`}
                activeOpacity={0.72}
                onPress={() => onOpen(item.route)}
                style={[
                  styles.actionReviewRow,
                  {
                    borderTopColor: t.colors.separator,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={[styles.actionReviewRowIcon, { backgroundColor: itemColor + "14" }]}>
                  <SFSymbol name={sfFromIonicon(item.icon)} size={14} color={itemColor} />
                </View>
                <Text style={[t.typography.subhead, { color: t.colors.text_primary, flex: 1 }]} numberOfLines={1}>
                  {item.text}
                </Text>
                <SFSymbol name="chevron.right" size={12} color={t.colors.text_tertiary} />
              </TouchableOpacity>
            );
          })}
          {items.length > visibleItems.length && (
            <TouchableOpacity
              activeOpacity={0.72}
              onPress={() => onOpen(items[visibleItems.length]?.route ?? "/more/rule-history")}
              style={[styles.actionMoreRow, { borderTopColor: t.colors.separator }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>
                +{items.length - visibleItems.length} more
              </Text>
              <SFSymbol name="arrow.right" size={13} color={t.colors.text_secondary} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={[styles.actionClearStrip, { backgroundColor: color + "10" }]}>
          <SFSymbol name="checkmark.circle.fill" size={15} color={color} />
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, flex: 1 }]} numberOfLines={1}>
            No wasted-spend or sync blockers detected.
          </Text>
        </View>
      )}
    </View>
  );
}

function FunnelBars({
  impressions, clicks, orders, ctrDelta, cvrDelta, t,
}: {
  impressions: number; clicks: number; orders: number;
  ctrDelta: number; cvrDelta: number; t: any;
}) {
  const ctr = safeDivide(clicks, impressions) * 100;
  const cvr = safeDivide(orders, clicks) * 100;
  // Width is proportional to the real funnel: each stage is √(value / impressions)
  // so impressions read huge, clicks much smaller, orders smaller again — honest,
  // not a fake equal-bar look. Floor keeps a nonzero stage visible.
  const maxV = Math.max(impressions, 1);
  const widthFor = (v: number) => (v <= 0 ? 0 : Math.max(0.04, Math.sqrt(v / maxV)));

  const bars = [
    { label: "Impressions", value: impressions, display: formatCompact(impressions), color: t.colors.tone_primary, barPct: widthFor(impressions), sub: "Reach", subDelta: null },
    {
      label: "Clicks",
      value: clicks,
      display: formatCompact(clicks),
      color: t.colors.tone_good,
      barPct: widthFor(clicks),
      sub: `CTR ${formatPercent(ctr, 2)}`,
      subDelta: ctrDelta,
    },
    {
      label: "Orders",
      value: orders,
      display: formatInt(orders),
      color: t.colors.tone_warning,
      barPct: widthFor(orders),
      sub: `Conv. rate ${formatPercent(cvr, 2)}`,
      subDelta: cvrDelta,
    },
  ];

  return (
    <View style={{ gap: 10 }}>
      {bars.map((b) => (
        <View key={b.label}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{b.label}</Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_primary, fontWeight: "600" }]}>
              {b.display}
            </Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.background_tertiary }}>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: b.color,
                width: `${Math.max(0, Math.min(100, b.barPct * 100))}%`,
              }}
            />
          </View>
          {b.sub && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}>
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{b.sub}</Text>
              {b.subDelta !== null && b.subDelta !== 0 && (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <SFSymbol
                    name={b.subDelta > 0 ? "arrow.up" : "arrow.down"}
                    size={10}
                    color={b.subDelta > 0 ? t.colors.tone_good : t.colors.tone_danger}
                  />
                  <Text style={{ fontSize: 11, color: b.subDelta > 0 ? t.colors.tone_good : t.colors.tone_danger, fontWeight: "600" }}>
                    {Math.abs(b.subDelta).toFixed(1)}%
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function PlacementMixRows({
  rows, currency, t,
}: {
  rows: PlacementMixRow[]; currency: string; t: any;
}) {
  const colorFor = (placement: string) => {
    if (placement === "top_of_search") return t.colors.tone_warning;
    if (placement === "product_pages") return t.colors.tone_placement;
    if (placement === "rest_of_search") return t.colors.tone_good;
    return t.colors.text_tertiary;
  };

  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => {
        const barWidth = `${Math.max(4, Math.min(100, row.share))}%` as `${number}%`;
        const color = colorFor(row.placement);
        return (
          <View key={row.placement}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={[t.typography.caption2, { color, fontWeight: "700", marginTop: 1 }]}>
                  {formatPercent(row.share, 0)} of ad spend
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[t.typography.callout, { color: row.sales > 0 ? toneColor(acosTone(row.acos), t.colors) : t.colors.text_tertiary, fontWeight: "600" }]}>
                  {row.sales > 0 ? formatPercent(row.acos, 1) : "—"}
                </Text>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 1 }]}>ACOS</Text>
              </View>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.background_tertiary, overflow: "hidden" }}>
              <View style={{ width: barWidth, height: 8, borderRadius: 4, backgroundColor: color }} />
            </View>
            <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 4 }]}>
              {formatCurrency(row.spend, currency, { compact: true })} spend · {formatInt(row.orders)} orders · CTR {formatPercent(row.ctr, 2)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function LegendDot({ color, label, t }: { color: string; label: string; t: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: t.colors.text_secondary }}>{label}</Text>
    </View>
  );
}

function ProfitBreakdownItem({
  icon,
  label,
  value,
  color,
  t,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
  t: any;
}) {
  return (
    <View style={styles.profitBreakdownItem}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <SFSymbol name={sfFromIonicon(icon)} size={13} color={color} />
        <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <AnimatedValueText
        value={value}
        style={[styles.profitBreakdownValue, { color: t.colors.text_primary }]}
        numberOfLines={1}
      />
    </View>
  );
}

function PulseStat({ label, value, t }: { label: string; value: number; t: any }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{label}</Text>
      <AnimatedValueText
        value={formatInt(value)}
        style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 2 }]}
      />
    </View>
  );
}

// Zone label — breaks the long scroll into scannable, priority-ordered groups.
function ZoneHeader({ icon, label, t }: { icon: keyof typeof Ionicons.glyphMap; label: string; t: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginTop: 26, marginBottom: 2, marginLeft: 4 }}>
      <SFSymbol name={sfFromIonicon(icon)} size={15} color={t.colors.text_secondary} />
      <Text style={{ fontSize: 13, fontWeight: "600", letterSpacing: 0.4, color: t.colors.text_secondary }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

// Card title — a tinted icon chip + title (+ optional right accessory). Gives every
// card its own identity instead of a row of identical-looking headers.
function CardTitle({
  icon,
  tone,
  title,
  t,
  right,
  mb = 14,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: "good" | "warning" | "danger" | "primary" | "product" | "inactive";
  title: string;
  t: any;
  right?: React.ReactNode;
  mb?: number;
}) {
  const col = toneColor(tone, t.colors);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: mb, minHeight: t.layout.minTap }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: col + "1F",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SFSymbol name={sfFromIonicon(icon)} size={17} color={col} />
      </View>
      <Text style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, marginLeft: 10 }]} numberOfLines={2}>
        {title}
      </Text>
      {right}
    </View>
  );
}

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor(diff / 60_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  return `${mins}m ago`;
}

// Plain-language verdict for a campaign row, ranked by money at risk.
function campaignStatus(
  c: { spend: number; orders: number; sales: number; acos: number },
  breakEven: number,
): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  if (c.spend > 0 && c.orders === 0) return { label: "Wasting spend", tone: "danger" };
  if (c.sales > 0 && breakEven > 0 && c.acos > breakEven) return { label: "Watch", tone: "warning" };
  if (c.sales > 0 && breakEven > 0 && c.acos <= breakEven) return { label: "Profitable", tone: "good" };
  return { label: "Needs review", tone: "inactive" };
}

// Auto- vs manual-targeting badge so the author can tell at a glance which
// campaigns Amazon optimizes automatically and which they steer by hand.
function targetingBadge(c: { targeting_type?: string | null; type?: string | null }): { label: string; isAuto: boolean } | null {
  const probe = `${c.targeting_type ?? ""} ${c.type ?? ""}`.toLowerCase();
  if (probe.includes("auto")) return { label: "Auto", isAuto: true };
  if (probe.includes("manual")) return { label: "Manual", isAuto: false };
  return null;
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  stickyHeader: {
    paddingHorizontal: PAGE_PAD,
    paddingTop: 0,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerShell: {
    gap: 8,
  },
  headerTopRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerTitle: {
    flexShrink: 0,
    fontSize: 25,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 28,
  },
  headerAccountChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  headerBrandText: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
  },
  headerAccountText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 15,
  },
  syncPill: {
    flexShrink: 0,
    minHeight: 44,
    maxWidth: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  syncText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  actionReviewCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
  },
  actionReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionReviewIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  actionReviewTitle: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 21,
  },
  actionReviewCount: {
    minWidth: 38,
    height: 30,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  actionReviewCountText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  actionReviewList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 11,
    paddingTop: 2,
  },
  actionReviewRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionReviewRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  actionMoreRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    justifyContent: "center",
  },
  actionClearStrip: {
    minHeight: 34,
    borderRadius: 12,
    marginTop: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  actionTapRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  currencyTag: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  currencyText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  periodPills: {
    flexShrink: 0,
    width: 98,
    flexDirection: "row",
    borderRadius: 11,
    padding: 2,
    gap: 2,
  },
  periodPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: 9,
  },
  periodPillText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 13,
  },
  dateNavigator: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dateNavButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dateCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingHorizontal: 2,
  },
  dateLabel: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 20,
    maxWidth: "100%",
  },
  card: {
    backgroundColor: "transparent",
    borderRadius: CARD_RADIUS,
  },
  profitCard: {
    padding: 16,
    borderRadius: 10,
  },
  profitHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profitTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  profitIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  profitEyebrow: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.4,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  profitStatePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: 126,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  profitStateText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  profitMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 16,
  },
  profitMetric: {
    marginTop: 12,
    fontSize: 40,
    fontWeight: "300",
    letterSpacing: 0,
    lineHeight: 44,
    fontVariant: ["tabular-nums"],
  },
  profitDeltaRow: {
    marginTop: 8,
  },
  profitChartShell: {
    marginTop: 10,
    overflow: "hidden",
  },
  profitBreakdown: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 12,
  },
  profitBreakdownItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  profitBreakdownValue: {
    width: "100%",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 21,
    marginTop: 3,
  },
  profitDivider: {
    width: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
  profitLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 13,
    marginTop: 12,
  },
  row2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
    marginTop: 8,
  },
  yesterdayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  yesterdayStrip: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 10,
  },
  yDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
  },
  yBookLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  yBookHighlight: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    padding: 8,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    overflow: "hidden",
  },
  yBookAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  yBookCover: {
    width: 32,
    height: 42,
    borderRadius: 6,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  yBookKicker: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
    textTransform: "uppercase",
  },
  yBookNetPill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  yBookNetText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  fullCoverImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  bookRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  bookThumb: {
    width: 42,
    height: 56,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  bookColorBar: {
    width: 4,
    height: 42,
    borderRadius: 2,
    marginRight: 8,
  },
  bookColorChip: {
    alignSelf: "flex-start",
    marginTop: 5,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  bookColorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  bookColorText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  targetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  campaignBookRail: {
    width: 5,
    height: 38,
    borderRadius: 3,
  },
  campaignBookChip: {
    maxWidth: 118,
    minHeight: 19,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  campaignBookDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  campaignBookChipText: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  tableHeaderTxt: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0,
    width: 56,
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
  },
  insightBadge: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
  },
  engineHealthPill: {
    minHeight: 28,
    borderRadius: 12,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  engineHealthDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  engineHealthText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  engineMetricGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  engineMetric: {
    flex: 1,
    minWidth: 0,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 9,
  },
  engineMetricIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },
  engineMetricLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 12,
    textTransform: "uppercase",
  },
  engineMetricValue: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: 2,
  },
  engineMetricDetail: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12,
    marginTop: 1,
  },
  engineFlowCard: {
    borderRadius: 14,
    padding: 10,
    gap: 9,
    marginBottom: 10,
  },
  engineStage: {
    gap: 5,
  },
  engineStageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  engineStageTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
  },
  engineStageFill: {
    height: 7,
    borderRadius: 4,
  },
  pulseSummary: {
    flexDirection: "row",
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  execRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  execDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
