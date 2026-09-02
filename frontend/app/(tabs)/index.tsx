import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
  InteractionManager,
  TouchableOpacity,
} from "react-native";
import { AppScreen } from "@/src/components/ScreenAmbient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SFSymbol, sfFromIonicon } from "@/src/components/ios/Native";
import {
  fetchCampaignMetricsRange,
  aggregateDailyMetrics,
  fetchProfileSyncLogs,
  fetchTopCampaignsRange,
  fetchTopBooksRange,
  fetchActiveBookKeysForProfiles,
  fetchKdpRoyaltiesRange,
  fetchAllCampaignBudgets,
  fetchRuleExecutions,
  fetchOptimizationRules,
  fetchTodayExecutionStats,
  fetchHourlyMetrics,
  fetchPlacementMixRange,
  fetchSearchTerms,
  fetchKeywords,
  fetchAdGroups,
  type TopBookRow,
} from "@/src/lib/queries";
import { fetchBidEngineStatus } from "@/src/lib/mutations";
import {
  bootstrapToBleeders,
  bootstrapToCampaignMetrics,
  bootstrapToRoyalties,
  bootstrapToTopBooks,
  fetchAggregatedCampaigns,
  fetchDashboardBootstrap,
  tryFetchMobileOverview,
  nestDashboardProfileIds,
  previousMetricsToCampaignRows,
  previousMetricsToRoyalties,
} from "@/src/lib/dashboardApi";
import {
  buildMobileHomeSnapshotFromAds,
  isAdsFallbackSnapshot,
  stampMobileHomeSource,
  freshnessCaption,
  isCurrentHomeSnapshot,
  usableCachedHomeSnapshot,
  isUsableMobileHomeSnapshot,
  loadMobileHomeSnapshot,
  peekMobileHomeSnapshot,
  persistMobileHomeSnapshot,
  type MobileHomeSnapshot,
} from "@/src/lib/mobileHomeSnapshot";
import { FINANCIAL_QUERY_ROOTS, financialQueryMeta } from "@/src/lib/financialReadVersion";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { dashboard, useTheme, acosTone, toneColor, useReduceMotion } from "@/src/lib/theme";
import { OverviewSwipeWidget, SwipeEmpty } from "@/src/components/OverviewSwipeWidget";
import {
  AdGroupWidgetRow,
  BookWidgetRow,
  CampaignWidgetRow,
  KeywordWidgetRow,
  PlacementMixV2,
  SearchTermWidgetRow,
  WidgetRowList,
} from "@/src/components/OverviewWidgetRows";
import {
  adGroupsHighAcos,
  booksHighAcos,
  booksLowAcos,
  booksSpendingNoAdSales,
  booksTopRoyalties,
  booksWorstProfit,
  campaignsHighAcos,
  campaignsLowAcos,
  campaignsTopSpend,
  keywordsHighAcos,
  keywordsSpendingNoOrders,
  overviewLowAcosDiffersFromHigh,
  searchTermsLowAcos,
  searchTermsSpendNoOrders,
} from "@/src/lib/overviewWidgets";
import { DashboardSurface, OverviewCardHeader, dashboardSurfaceStyle } from "@/src/components/DashboardSurface";
import { OverviewHeaderV3 } from "@/src/components/OverviewHeaderV3";
import { FirstReveal, HorizonPane, PressableScale, VerifiedValue } from "@/src/components/Motion";
import { GlassPanel } from "@/src/components/GlassPanel";
import { syncChrome } from "@/src/lib/motion";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { autoModeLabel, bidBotOperationalCopy } from "@/src/lib/bidBotContract";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  previousRange,
  safeDivide,
  formatDateShort,
  toDateString,
  parseDateOnly,
  formatDateRangeLabel,
} from "@/src/lib/format";
import { iosRolling7Range, webIsoWeekRange } from "@/src/lib/acosContract";
import {
  kdpRoyaltiesOnDate,
  publisherNetForPeriod,
} from "@/src/lib/homePeriod";
import {
  HOME_QUERY_TIMEOUT_MS,
  TARGETING_QUERY_TIMEOUT_MS,
  homeWidgetStatus,
  queryStillWaiting,
  withQueryTimeout,
} from "@/src/lib/queryTimeout";
import {
  HOME_PERIOD_LIVE_CACHE,
  HOME_PERIOD_QUERY_CACHE,
  periodFinancePending,
  periodQueryKey,
  periodQueryRefreshing,
} from "@/src/lib/periodQuery";
import { filterTopBooksByRecentActivity } from "@/src/lib/booksListActivity";
import { markPerf } from "@/src/lib/perf";
import { debugIngest } from "@/src/lib/debugIngest";
import { EmptyState, PrimaryButton, RetryState, StatBadge } from "@/src/components/Primitives";
import { BudgetArcWidget, NetProfitChart, type ChartDaySelection } from "@/src/components/Charts";
import { InteliAdsIcon } from "@/src/components/InteliAdsIcon";
import {
  NET_ROYALTIES_LABEL,
  kdpRoyaltiesAreKnown,
  netRoyalties,
  netRoyaltiesKnown,
  netRoyaltiesVoiceOver,
} from "@/src/lib/netRoyalties";

const PAGE_PAD = dashboard.pageInset;
const OVERVIEW_QUERY_CACHE = {
  ...HOME_PERIOD_QUERY_CACHE,
};
const OVERVIEW_LIVE_QUERY_CACHE = {
  ...HOME_PERIOD_LIVE_CACHE,
};
const FINANCIAL_QUERY_CACHE = {
  ...HOME_PERIOD_QUERY_CACHE,
  meta: financialQueryMeta(),
};
const FINANCIAL_LIVE_QUERY_CACHE = {
  ...HOME_PERIOD_LIVE_CACHE,
  meta: financialQueryMeta(),
};

type DateRange = { start: string; end: string; label?: string };

type DashboardActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone: "danger" | "warning";
  route: string;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

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
  const anchor = anchorEnd > today ? today : parseDateOnly(toDateString(anchorEnd));
  const iso = webIsoWeekRange(anchor);
  const isoEnd = parseDateOnly(iso.end);
  const end = isoEnd > today ? today : isoEnd;
  const range = { start: iso.start, end: toDateString(end), label: "Custom" };
  return { ...range, label: formatDateRangeLabel(range) };
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
  const nestProfileIds = useMemo(
    () => nestDashboardProfileIds(selectedProfileIds, selectedProfiles),
    [selectedProfileIds, selectedProfiles],
  );
  const [refreshing, setRefreshing] = useState(false);
  const contentWidth = Math.max(280, viewportWidth - PAGE_PAD * 2);
  const chartWidth = Math.max(240, contentWidth - 32);
  const heroChartWidth = Math.max(240, contentWidth - 36);

  // ── date range helpers ──
  const todayDate = parseDateOnly(toDateString(new Date()));
  const todayStr = toDateString(todayDate);
  const yesterdayStr = toDateString(addDays(todayDate, -1));
  const queryClient = useQueryClient();
  const [cachedSnapshot, setCachedSnapshot] = useState<MobileHomeSnapshot | null>(null);
  const [belowFoldReady, setBelowFoldReady] = useState(false);
  const [profilesWaitExpired, setProfilesWaitExpired] = useState(false);
  const nestProfileIdsRef = useRef(nestProfileIds);
  const homeScopeLoopCount = useRef(0);
  const firstUsefulCount = useRef(0);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setBelowFoldReady(true);
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    const waitingForProfiles = selectedProfileIds.length === 0 && (profilesLoading || profilesFetching);
    if (!waitingForProfiles) {
      setProfilesWaitExpired(false);
      return;
    }
    const timer = setTimeout(() => setProfilesWaitExpired(true), HOME_QUERY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [selectedProfileIds.length, profilesLoading, profilesFetching]);

  // period selector: Month / Week
  const [periodMode, setPeriodMode] = useState<"month" | "week">(() => inferDashboardPeriodMode(dateRange));

  useEffect(() => {
    setPeriodMode(inferDashboardPeriodMode(dateRange));
  }, [dateRange.start, dateRange.end]);

  // ── queries ──
  const sellerReady = !viewingAsAdmin && selectedProfileIds.length > 0;
  const homeScope = useMemo(
    () => ({
      userId: user?.id ?? "",
      viewAs: adminFilterUserId,
      profileIds: nestProfileIds,
      currency: primaryCurrency,
    }),
    [user?.id, adminFilterUserId, nestProfileIds, primaryCurrency],
  );

  useEffect(() => {
    markPerf("home.mount");
  }, []);

  useEffect(() => {
    homeScopeLoopCount.current += 1;
    const prevIds = nestProfileIdsRef.current;
    const sameRef = prevIds === nestProfileIds;
    const sameJoin = prevIds.join("|") === nestProfileIds.join("|");
    if (homeScopeLoopCount.current <= 8 || homeScopeLoopCount.current % 25 === 0) {
      // #region agent log
      debugIngest("index.tsx:homeScope", "homeScope effect", { n: homeScopeLoopCount.current, sameRef, sameJoin, idCount: nestProfileIds.length, hasUser: !!homeScope.userId }, "C");
      // #endregion
    }
    nestProfileIdsRef.current = nestProfileIds;
    if (!homeScope.userId || homeScope.profileIds.length === 0) return;
    let cancelled = false;
    void loadMobileHomeSnapshot(homeScope).then((snapshot) => {
      if (cancelled) return;
      setCachedSnapshot(snapshot && usableCachedHomeSnapshot(snapshot, homeScope, todayStr) ? snapshot : null);
    });
    return () => {
      cancelled = true;
    };
  }, [homeScope, todayStr]);

  const snapshotQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.mobileOverview, homeScope.userId, homeScope.viewAs ?? "self", homeScope.profileIds, homeScope.currency, todayStr],
    queryFn: async () => {
      markPerf("home.snapshot.start");
      const nest = await withQueryTimeout(tryFetchMobileOverview({
        profileIds: homeScope.profileIds,
        filterUserId: homeScope.viewAs,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
      if (nest && isUsableMobileHomeSnapshot(nest, homeScope) && isCurrentHomeSnapshot(nest, homeScope, todayStr)) {
        const stamped = stampMobileHomeSource(nest, "nest");
        await persistMobileHomeSnapshot(homeScope, stamped);
        setCachedSnapshot(stamped);
        markPerf("home.snapshot.nest");
        return stamped;
      }
      const seven = iosRolling7Range(todayDate);
      const rows = await withQueryTimeout(fetchCampaignMetricsRange(selectedProfileIds, seven.start, todayStr));
      const built = buildMobileHomeSnapshotFromAds({
        userId: homeScope.viewAs ?? homeScope.userId,
        profileIds: homeScope.profileIds,
        currency: homeScope.currency,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localDate: todayStr,
        rows,
      });
      await persistMobileHomeSnapshot(homeScope, built);
      setCachedSnapshot(built);
      markPerf("home.snapshot.ads");
      return built;
    },
    enabled: sellerReady && !!user?.id,
    placeholderData: cachedSnapshot ?? undefined,
    staleTime: 60_000,
    gcTime: 12 * 60 * 60_000,
    meta: financialQueryMeta(),
  });
  useEffect(() => {
    if (!snapshotQ.data && !cachedSnapshot) return;
    firstUsefulCount.current += 1;
    if (firstUsefulCount.current <= 5 || firstUsefulCount.current % 50 === 0) {
      // #region agent log
      debugIngest("index.tsx:firstUseful", "home firstUseful", { n: firstUsefulCount.current, dataUpdatedAt: snapshotQ.dataUpdatedAt, hasCache: !!cachedSnapshot, fetched: snapshotQ.isFetchedAfterMount }, "E");
      // #endregion
    }
    markPerf(snapshotQ.isFetchedAfterMount ? "home.today.server" : "home.today.cache");
    markPerf("home.firstUseful");
    if (snapshotQ.isFetchedAfterMount && snapshotQ.data) markPerf("home.fresh");
    if ((snapshotQ.data ?? cachedSnapshot)?.sevenDay.points?.length === 7) markPerf("home.7d");
  }, [snapshotQ.data, snapshotQ.dataUpdatedAt, snapshotQ.isFetchedAfterMount, cachedSnapshot]);

  const bootstrapQ = useQuery({
    queryKey: ["dashboard-bootstrap", adminFilterUserId, nestProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      withQueryTimeout(
        fetchDashboardBootstrap({
          startDate: dateRange.start,
          endDate: dateRange.end,
          profileIds: nestProfileIds,
          filterUserId: adminFilterUserId,
        }),
      ),
    enabled: viewingAsAdmin && nestProfileIds.length > 0,
    ...OVERVIEW_QUERY_CACHE,
  });

  const adminCampaignsQ = useQuery({
    queryKey: ["dashboard-campaigns", adminFilterUserId, nestProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      withQueryTimeout(
        fetchAggregatedCampaigns({
          startDate: dateRange.start,
          endDate: dateRange.end,
          profileIds: nestProfileIds,
          filterUserId: adminFilterUserId,
        }),
      ),
    enabled: viewingAsAdmin && nestProfileIds.length > 0,
    ...OVERVIEW_QUERY_CACHE,
  });

  const metricsQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetrics, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => withQueryTimeout(fetchCampaignMetricsRange(selectedProfileIds, dateRange.start, dateRange.end)),
    enabled: sellerReady,
    ...FINANCIAL_QUERY_CACHE,
  });
  useEffect(() => {
    if (!metricsQ.data) return;
    markPerf(metricsQ.isFetchedAfterMount ? "home.month.server" : "home.month.cache");
  }, [metricsQ.data, metricsQ.dataUpdatedAt, metricsQ.isFetchedAfterMount, dateRange.start, dateRange.end]);
  const sellerSecondary = sellerReady && belowFoldReady && metricsQ.isFetched;
  const adminSecondary = viewingAsAdmin && nestProfileIds.length > 0 && bootstrapQ.isFetched;

  const prevMetricsQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetricsPrev, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => {
      const prev = previousRange(dateRange.start, dateRange.end);
      return withQueryTimeout(fetchCampaignMetricsRange(selectedProfileIds, prev.start, prev.end));
    },
    enabled: sellerSecondary,
    ...FINANCIAL_QUERY_CACHE,
  });

  const royaltiesQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.kdpRoyalties, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => withQueryTimeout(fetchKdpRoyaltiesRange(selectedProfileIds, dateRange.start, dateRange.end)),
    enabled: sellerReady,
    ...OVERVIEW_QUERY_CACHE,
    meta: financialQueryMeta(),
  });

  const prevRoyaltiesQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.kdpRoyaltiesPrev, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => {
      const prev = previousRange(dateRange.start, dateRange.end);
      return withQueryTimeout(fetchKdpRoyaltiesRange(selectedProfileIds, prev.start, prev.end));
    },
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
    meta: financialQueryMeta(),
  });

  const topCampaignsQ = useQuery({
    queryKey: ["top-campaigns-range-v2", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      withQueryTimeout(
        fetchTopCampaignsRange({
          profileIds: selectedProfileIds,
          start: dateRange.start,
          end: dateRange.end,
          // Need a wide pool so ACoS → clicks → impressions → sync can fill 7 rows.
          limit: 80,
        }),
        TARGETING_QUERY_TIMEOUT_MS,
      ),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
  });

  // Warm the Campaigns tab list so Overview → Campaigns is cache-first.
  useEffect(() => {
    if (!sellerSecondary || selectedProfileIds.length === 0) return;
    if (!topCampaignsQ.isSuccess) return;
    void queryClient.prefetchQuery({
      queryKey: ["campaigns-list-range-v2", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
      queryFn: () =>
        withQueryTimeout(
          fetchTopCampaignsRange({
            profileIds: selectedProfileIds,
            start: dateRange.start,
            end: dateRange.end,
            limit: 500,
            filterUserId: adminFilterUserId,
          }),
        ),
      staleTime: OVERVIEW_QUERY_CACHE.staleTime,
      gcTime: OVERVIEW_QUERY_CACHE.gcTime,
    });
  }, [
    sellerSecondary,
    topCampaignsQ.isSuccess,
    selectedProfileIds,
    dateRange.start,
    dateRange.end,
    adminFilterUserId,
    queryClient,
  ]);

  const topBooksQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.topBooks, adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      withQueryTimeout(
        fetchTopBooksRange({
          profileIds: selectedProfileIds,
          start: dateRange.start,
          end: dateRange.end,
          royaltyRate: 0,
          limit: 16,
          activityDays: 0,
          filterUserId: adminFilterUserId,
        }),
      ),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
    meta: financialQueryMeta(),
  });

  // Warm the Books tab list so Overview → Books is cache-first (same pattern as Campaigns).
  useEffect(() => {
    if (!sellerSecondary || selectedProfileIds.length === 0) return;
    if (!topBooksQ.isSuccess) return;
    void queryClient.prefetchQuery({
      queryKey: [FINANCIAL_QUERY_ROOTS.products, adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
      queryFn: () =>
        withQueryTimeout(
          fetchTopBooksRange({
            profileIds: selectedProfileIds,
            start: dateRange.start,
            end: dateRange.end,
            royaltyRate: 0,
            limit: 300,
            filterUserId: adminFilterUserId,
          }),
        ),
      staleTime: OVERVIEW_QUERY_CACHE.staleTime,
      gcTime: OVERVIEW_QUERY_CACHE.gcTime,
      meta: financialQueryMeta(),
    });
  }, [
    sellerSecondary,
    topBooksQ.isSuccess,
    selectedProfileIds,
    dateRange.start,
    dateRange.end,
    adminFilterUserId,
    queryClient,
  ]);
  useEffect(() => {
    if (!royaltiesQ.data) return;
    markPerf("home.royalties");
  }, [royaltiesQ.data]);
  useEffect(() => {
    if (!topCampaignsQ.data) return;
    markPerf("home.campaigns");
  }, [topCampaignsQ.data]);
  useEffect(() => {
    if (!topBooksQ.data) return;
    markPerf("home.books");
  }, [topBooksQ.data]);

  const placementMixQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.placementMix, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => withQueryTimeout(fetchPlacementMixRange(selectedProfileIds, dateRange.start, dateRange.end)),
    enabled: sellerSecondary,
    ...FINANCIAL_QUERY_CACHE,
  });

  const syncLogsQ = useQuery({
    queryKey: ["sync-logs", selectedProfileIds],
    queryFn: () => withQueryTimeout(fetchProfileSyncLogs(selectedProfileIds)),
    enabled: sellerSecondary,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  const todayMetricsQ = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetricsToday, selectedProfileIds, todayStr],
    queryFn: () => withQueryTimeout(fetchCampaignMetricsRange(selectedProfileIds, todayStr, todayStr)),
    enabled: sellerSecondary,
    ...FINANCIAL_LIVE_QUERY_CACHE,
  });

  const allBudgetsQ = useQuery({
    queryKey: ["all-campaign-budgets", selectedProfileIds],
    queryFn: () => withQueryTimeout(fetchAllCampaignBudgets(selectedProfileIds)),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
  });

  const ruleExecsQ = useQuery({
    queryKey: ["rule-executions-dashboard", user?.id, selectedProfileIds],
    queryFn: () => withQueryTimeout(fetchRuleExecutions({ userId: user!.id, profileIds: selectedProfileIds })),
    enabled: sellerSecondary && !!user?.id,
    ...OVERVIEW_LIVE_QUERY_CACHE,
  });

  // Rule names for Automation Pulse display
  const rulesQ = useQuery({
    queryKey: ["optimization-rules", user?.id, selectedProfileIds],
    queryFn: () => withQueryTimeout(fetchOptimizationRules(user!.id, selectedProfileIds)),
    enabled: sellerSecondary && !!user?.id,
    ...OVERVIEW_QUERY_CACHE,
  });

  // Today's execution stats from rule_execution_batches
  const todayStatsQ = useQuery({
    queryKey: ["today-execution-stats", user?.id, selectedProfileIds, todayStr],
    queryFn: () => withQueryTimeout(fetchTodayExecutionStats(user!.id, selectedProfileIds)),
    enabled: sellerSecondary && !!user?.id,
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
    queryFn: () => fetchSearchTerms(selectedProfileIds, { start: dateRange.start, end: dateRange.end, limit: 80 }),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
  });

  const bleedersQ = useQuery({
    queryKey: ["bleeding-keywords", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => withQueryTimeout(fetchKeywords(selectedProfileIds, { start: dateRange.start, end: dateRange.end, limit: 80, filterUserId: adminFilterUserId })),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
  });

  const adGroupsQ = useQuery({
    queryKey: ["overview-ad-groups", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      withQueryTimeout(fetchAdGroups(selectedProfileIds, undefined, { start: dateRange.start, end: dateRange.end })),
    enabled: sellerSecondary,
    ...OVERVIEW_QUERY_CACHE,
  });

  const activeBookKeysQ = useQuery({
    queryKey: ["books-activity-60d", selectedProfileIds],
    queryFn: () => withQueryTimeout(fetchActiveBookKeysForProfiles(selectedProfileIds)),
    enabled: viewingAsAdmin && selectedProfileIds.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 12 * 60 * 60_000,
    placeholderData: () => undefined,
  });

  const bidBotStatusQ = useQuery({
    queryKey: ["bid-engine-status", adminFilterUserId ?? "self"],
    queryFn: () => withQueryTimeout(fetchBidEngineStatus(viewingAsAdmin ? adminFilterUserId : undefined)),
    enabled: !guestMode && !!user?.id && (sellerSecondary || adminSecondary),
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

  const activePeriodKey = periodQueryKey(dateRange, selectedProfileIds);
  const periodLoading = viewingAsAdmin
    ? queryStillWaiting(bootstrapQ)
    : periodFinancePending(metricsQ, royaltiesQ);
  const periodRefreshing =
    !periodLoading &&
    !viewingAsAdmin &&
    (periodQueryRefreshing(metricsQ) || periodQueryRefreshing(royaltiesQ));

  // ── derived data ──
  const royaltyRange = adminRoyalties ?? royaltiesQ.data;
  const prevRoyaltyRange = adminPrevRoyalties ?? prevRoyaltiesQ.data;
  const kdpReady = !!royaltyRange?.hasKdpData;
  const kdpPartial = royaltyRange?.coverage === "partial";
  const prevKdpReady = !!prevRoyaltyRange?.hasKdpData;
  const adsReady = viewingAsAdmin
    ? !(bootstrapQ.isError && !bootstrapQ.data)
    : !periodLoading && Array.isArray(metricsQ.data) && !metricsQ.isError;
  const financeComplete = kdpReady && adsReady;
  const metricRows = periodLoading && !viewingAsAdmin ? [] : adminMetrics ?? metricsQ.data ?? [];
  const prevMetricRows = adminPrevMetrics ?? prevMetricsQ.data ?? [];
  const topCampaigns = adminCampaignsQ.data ?? topCampaignsQ.data ?? [];
  const topBooksRaw = adminTopBooks ?? topBooksQ.data ?? [];
  const topBooks = useMemo(() => {
    if (!viewingAsAdmin) return topBooksRaw;
    if (activeBookKeysQ.isPending) return [];
    if (activeBookKeysQ.isError || !activeBookKeysQ.data) return topBooksRaw;
    return filterTopBooksByRecentActivity(topBooksRaw, activeBookKeysQ.data);
  }, [topBooksRaw, viewingAsAdmin, activeBookKeysQ.isPending, activeBookKeysQ.isError, activeBookKeysQ.data]);
  const bleeders = adminBleeders ?? bleedersQ.data ?? [];
  const loading = periodLoading;
  const campaignsPhase = periodLoading && !viewingAsAdmin
    ? "loading"
    : homeWidgetStatus({
    isPending: viewingAsAdmin ? adminCampaignsQ.isPending : topCampaignsQ.isPending,
    isError: viewingAsAdmin ? adminCampaignsQ.isError : topCampaignsQ.isError,
    data: viewingAsAdmin ? adminCampaignsQ.data : topCampaignsQ.data,
    error: viewingAsAdmin ? adminCampaignsQ.error : topCampaignsQ.error,
    isEmpty: topCampaigns.length === 0,
  });
  const booksPhase = periodLoading && !viewingAsAdmin
    ? "loading"
    : viewingAsAdmin && activeBookKeysQ.isPending
      ? "loading"
    : homeWidgetStatus({
    isPending: viewingAsAdmin ? bootstrapQ.isPending : topBooksQ.isPending,
    isError: viewingAsAdmin ? bootstrapQ.isError : topBooksQ.isError,
    data: viewingAsAdmin ? adminTopBooks : topBooksQ.data,
    error: viewingAsAdmin ? bootstrapQ.error : topBooksQ.error,
    isEmpty: topBooks.length === 0,
  });
  const daily = aggregateDailyMetrics(metricRows);
  const prevDaily = aggregateDailyMetrics(prevMetricRows);
  const kdpDays = useMemo(() => royaltyRange?.daily ?? [], [royaltyRange]);
  const royaltiesForDate = useCallback(
    (date: string) => kdpRoyaltiesOnDate(kdpDays, date),
    [kdpDays],
  );
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
    const royalties = royaltyRange?.hasKdpData ? royaltyRange.totalRoyalties : 0;
    const bookOrders = royaltyRange?.hasKdpData ? royaltyRange.totalOrders : acc.orders;
    const organicOrders = royaltyRange?.hasKdpData ? Math.max(0, bookOrders - acc.orders) : 0;
    const net = kdpReady ? netRoyaltiesKnown(royalties, acc.spend) : null;
    const acos = safeDivide(acc.spend, acc.sales) * 100;
    const ctr = safeDivide(acc.clicks, acc.impressions) * 100;
    const cvr = safeDivide(acc.orders, acc.clicks) * 100;
    return { ...acc, royalties, bookOrders, organicOrders, net, acos, ctr, cvr };
  }, [daily, royaltyRange, kdpReady]);

  const breakEvenAcos = useMemo(() => {
    const royaltyPerBookOrder =
      kdpReady && totals.bookOrders > 0
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
    kdpReady,
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
    const royalties = prevRoyaltyRange?.hasKdpData ? prevRoyaltyRange.totalRoyalties : 0;
    return {
      ...acc,
      royalties,
      net: prevKdpReady ? netRoyaltiesKnown(royalties, acc.spend) : null,
      acos: safeDivide(acc.spend, acc.sales) * 100,
      ctr: safeDivide(acc.clicks, acc.impressions) * 100,
      cvr: safeDivide(acc.orders, acc.clicks) * 100,
    };
  }, [prevDaily, prevRoyaltyRange, prevKdpReady]);

  function pctDelta(curr: number | null, prev: number | null) {
    if (curr == null || prev == null || !prev) return 0;
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

  // Net profit sparkline
  const netSeries = useMemo(() => {
    if (!kdpReady) return [];
    return daily.flatMap((m) => {
      const net = publisherNetForPeriod(royaltiesForDate(m.date), m.spend);
      return net == null ? [] : [{ value: net, label: formatDateShort(m.date), date: m.date, sales: m.sales }];
    });
  }, [daily, royaltiesForDate, kdpReady]);

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
    () => kdpReady
      ? daily.flatMap((m) => {
          const value = royaltiesForDate(m.date);
          return value == null ? [] : [{ value, label: formatDateShort(m.date), date: m.date }];
        })
      : [],
    [daily, royaltiesForDate, kdpReady],
  );
  const btSpend = useMemo(
    () => kdpReady
      ? daily.flatMap((m) => {
          const net = publisherNetForPeriod(royaltiesForDate(m.date), m.spend);
          return net == null ? [] : [{ value: m.spend, label: formatDateShort(m.date), date: m.date }];
        })
      : [],
    [daily, royaltiesForDate, kdpReady],
  );

  type ChartDayFinance = {
    date: string;
    label: string;
    net: number;
    royalties: number;
    spend: number;
    sales: number;
  };
  const [chartDay, setChartDay] = useState<ChartDayFinance | null>(null);
  const [chartIndex, setChartIndex] = useState<number | null>(null);

  useEffect(() => {
    setChartDay(null);
    setChartIndex(null);
  }, [activePeriodKey]);

  const clearChartSelection = useCallback(() => {
    setChartDay(null);
    setChartIndex(null);
  }, []);

  const handleChartDaySelect = useCallback((selection: ChartDaySelection) => {
    if (!selection) {
      clearChartSelection();
      return;
    }
    setChartIndex(selection.index);
    setChartDay({
      date: selection.date ?? "",
      label: selection.label ?? "Selected day",
      net: selection.net,
      royalties: selection.royalties ?? 0,
      spend: selection.spend,
      sales: selection.sales,
    });
  }, [clearChartSelection]);

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
  const searchTerms = searchTermsPulseQ.data ?? [];
  const adGroups = adGroupsQ.data ?? [];

  const [blurBooks, setBlurBooks] = useState(false);

  const keywordBleeders = useMemo(() => keywordsSpendingNoOrders(bleeders), [bleeders]);
  const keywordHighAcos = useMemo(() => keywordsHighAcos(bleeders), [bleeders]);
  const termSpendNoOrders = useMemo(() => searchTermsSpendNoOrders(searchTerms), [searchTerms]);
  const termLowAcos = useMemo(() => searchTermsLowAcos(searchTerms), [searchTerms]);
  const booksRoyalties = useMemo(() => booksTopRoyalties(topBooks), [topBooks]);
  const booksHigh = useMemo(() => booksHighAcos(topBooks), [topBooks]);
  const booksLow = useMemo(() => booksLowAcos(topBooks), [topBooks]);
  const booksProfit = useMemo(() => booksWorstProfit(topBooks), [topBooks]);
  const booksAdSpendNoSales = useMemo(() => booksSpendingNoAdSales(topBooks), [topBooks]);
  const campsHighAcos = useMemo(() => campaignsHighAcos(topCampaigns), [topCampaigns]);
  const campsLowAcos = useMemo(() => campaignsLowAcos(topCampaigns), [topCampaigns]);
  const campsTopSpend = useMemo(() => campaignsTopSpend(topCampaigns), [topCampaigns]);
  const showCampaignsLowAcos = useMemo(
    () => overviewLowAcosDiffersFromHigh(campsHighAcos, campsLowAcos),
    [campsHighAcos, campsLowAcos],
  );
  const groupsHighAcos = useMemo(() => adGroupsHighAcos(adGroups), [adGroups]);
  const placementCampaigns = useMemo(() => campaignsTopSpend(topCampaigns), [topCampaigns]);

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
  const prefetchPeriodData = useCallback(
    (range: DateRange) => {
      if (!sellerReady || selectedProfileIds.length === 0) return;
      const t0 = Date.now();
      // #region agent log
      debugIngest("index.tsx:prefetchPeriod", "period prefetch start", { start: range.start, end: range.end }, "F");
      // #endregion
      const prev = previousRange(range.start, range.end);
      const prefetchMetrics = (start: string, end: string) =>
        queryClient.prefetchQuery({
          queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetrics, selectedProfileIds, start, end],
          queryFn: () => withQueryTimeout(fetchCampaignMetricsRange(selectedProfileIds, start, end)),
          ...FINANCIAL_QUERY_CACHE,
        });
      const prefetchRoyalties = (start: string, end: string) =>
        queryClient.prefetchQuery({
          queryKey: [FINANCIAL_QUERY_ROOTS.kdpRoyalties, selectedProfileIds, start, end],
          queryFn: () => withQueryTimeout(fetchKdpRoyaltiesRange(selectedProfileIds, start, end)),
          ...OVERVIEW_QUERY_CACHE,
          meta: financialQueryMeta(),
        });

      void prefetchMetrics(range.start, range.end)
        .finally(() => {
          // #region agent log
          debugIngest("index.tsx:prefetchPeriod", "period prefetch metrics done", { ms: Date.now() - t0, start: range.start, end: range.end }, "F");
          // #endregion
        });
      void prefetchRoyalties(range.start, range.end);
      void prefetchMetrics(prev.start, prev.end);
      void prefetchRoyalties(prev.start, prev.end);
    },
    [sellerReady, selectedProfileIds, queryClient],
  );

  useEffect(() => {
    if (!sellerReady || selectedProfileIds.length === 0) return;
    const anchor = parseDateOnly(todayStr);
    prefetchPeriodData(makeDashboardMonthRange(anchor));
    prefetchPeriodData(makeDashboardWeekRange(anchor));
  }, [sellerReady, selectedProfileIds.join("|"), prefetchPeriodData, todayStr]);

  function shiftPeriod(dir: -1 | 1) {
    void playHaptic("select", reduceMotion);
    if (periodMode === "month") {
      const start = parseDateOnly(dateRange.start);
      start.setMonth(start.getMonth() + dir, 1);
      const next = makeDashboardMonthRange(start);
      prefetchPeriodData(next);
      setDateRange(next);
      return;
    }
    const end = addDays(parseDateOnly(dateRange.end), dir * 7);
    const next = makeDashboardWeekRange(end);
    prefetchPeriodData(next);
    setDateRange(next);
  }

  function applyPeriodMode(mode: "month" | "week") {
    if (mode === periodMode) return;
    void playHaptic("select", reduceMotion);
    setPeriodMode(mode);
    const next =
      mode === "month" ? makeDashboardMonthRange(todayDate) : makeDashboardWeekRange(todayDate);
    prefetchPeriodData(next);
    setDateRange(next);
  }

  const canGoNextPeriod = parseDateOnly(dateRange.end) < todayDate;
  const periodLabel = useMemo(() => formatDateRangeLabel(dateRange), [dateRange]);
  const syncPresentation = syncChrome({
    failedRefresh: snapshotQ.isError && !!(snapshotQ.data ?? cachedSnapshot),
    refreshing: refreshing || snapshotQ.isFetching,
    syncing: syncActive && !refreshing && !snapshotQ.isFetching,
    stale: syncStale,
    warning: syncWarning && !syncStale && !syncActive,
    lastCompletedAt: recentCompletedSync?.completed_at ? String(recentCompletedSync.completed_at) : null,
  });
  const syncColor =
    syncPresentation.state === "synced"
      ? t.colors.tone_good
      : syncPresentation.state === "failed" || syncPresentation.state === "stale"
        ? t.colors.tone_danger
        : t.colors.tone_warning;
  const syncLabel = syncLogsQ.isLoading ? "Checking" : syncPresentation.label;
  const syncCompactLabel = syncLogsQ.isLoading ? "Sync" : syncPresentation.compact;
  const heroRoyalties = chartDay?.royalties ?? totals.royalties;
  const heroSpend = chartDay?.spend ?? totals.spend;
  const heroSales = chartDay?.sales ?? totals.sales;
  const heroNet = chartDay?.net ?? netRoyalties({ kdpRoyalties: heroRoyalties, adsSpend: heroSpend }) ?? totals.net;
  const royaltiesKnown = !loading && kdpRoyaltiesAreKnown(heroRoyalties);
  const spendKnown = !loading && adsReady;
  const netKnown = royaltiesKnown && spendKnown && heroNet != null;
  const profitAccentColor = !netKnown
    ? t.colors.text_tertiary
    : heroNet >= 0
      ? t.colors.tone_good
      : t.colors.tone_danger;
  const profitColor = !netKnown ? t.colors.text_tertiary : profitAccentColor;
  const heroAcos = chartDay ? safeDivide(chartDay.spend, chartDay.sales) * 100 : totals.acos;
  const profitVerdict = loading
    ? null
    : chartDay
      ? chartDay.label
      : null;
  const profitMargin = heroNet == null
    ? null
    : safeDivide(heroNet, heroRoyalties) * 100;
  const royaltiesFailed = !viewingAsAdmin && royaltiesQ.isError;
  const adsFailed = !viewingAsAdmin && metricsQ.isError;
  const netDisplay = !netKnown
    ? "—"
    : formatCurrency(heroNet, primaryCurrency);
  const royaltiesDisplay = !royaltiesKnown
    ? "—"
    : formatCurrency(heroRoyalties, primaryCurrency, { compact: true });
  const spendDisplay = !spendKnown
    ? "—"
    : formatCurrency(heroSpend, primaryCurrency, { compact: true });
  const acosDisplay = !spendKnown ? "—" : formatPercent(heroAcos);
  const marginDisplay = !netKnown || !heroRoyalties || profitMargin == null
    ? "—"
    : formatPercent(profitMargin, 0);
  const financeCaption = loading
    ? null
    : periodRefreshing
      ? "Updating…"
      : !kdpReady && !adsReady
        ? "Royalties and ad spend unavailable."
        : !kdpReady
          ? "Royalties unavailable."
          : !adsReady
            ? "Ad spend unavailable."
            : null;
  const acosValueColor =
    !loading && adsReady && heroSales > 0 && breakEvenAcos > 0
      ? toneColor(acosTone(heroAcos, breakEvenAcos), t.colors)
      : t.colors.text_primary;
  const chartHeight = viewportWidth < 400 ? 138 : Math.max(t.layout.chartHero, 152);
  const openBook = useCallback((item: TopBookRow) => {
    const asin = item.asin || item.sku;
    if (!asin) return;
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
    router.push("/(tabs)/products");
  }, [router]);
  const reviewReady = viewingAsAdmin ? bootstrapQ.isFetched : metricsQ.isFetched;
  const bidBot = bidBotStatusQ.data;
  const snapshot = [snapshotQ.data, cachedSnapshot, peekMobileHomeSnapshot(homeScope)].find((candidate) =>
    candidate && usableCachedHomeSnapshot(candidate, homeScope, todayStr),
  ) ?? null;
  const snapshotAutomation = isAdsFallbackSnapshot(snapshot) ? null : snapshot?.bidBot ?? null;


  const onRefresh = async () => {
    setRefreshing(true);
    const primary: Promise<unknown>[] = [snapshotQ.refetch(), metricsQ.refetch(), royaltiesQ.refetch(), syncLogsQ.refetch()];
    if (viewingAsAdmin) primary.push(bootstrapQ.refetch());
    await Promise.all(primary);
    setRefreshing(false);
    if (belowFoldReady) {
      void Promise.all([
        prevMetricsQ.refetch(),
        prevRoyaltiesQ.refetch(),
        topBooksQ.refetch(),
        bleedersQ.refetch(),
        searchTermsPulseQ.refetch(),
        adGroupsQ.refetch(),
        adminCampaignsQ.refetch(),
        topCampaignsQ.refetch(),
        placementMixQ.refetch(),
        todayMetricsQ.refetch(),
        allBudgetsQ.refetch(),
        ruleExecsQ.refetch(),
        rulesQ.refetch(),
        todayStatsQ.refetch(),
        bidBotStatusQ.refetch(),
      ]);
    }
  };

  if (selectedProfileIds.length === 0 && (profilesLoading || profilesFetching) && !profilesWaitExpired) {
    return (
      <AppScreen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      </AppScreen>
    );
  }

  if (selectedProfileIds.length === 0 && (profilesLoading || profilesFetching) && profilesWaitExpired) {
    return (
      <AppScreen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <RetryState
            title="Accounts are taking too long"
            subtitle="Cached Home data was kept. Retry when the network is ready."
            onRetry={() => {
              setProfilesWaitExpired(false);
              void refetchProfiles();
            }}
          />
        </View>
      </AppScreen>
    );
  }

  if (selectedProfileIds.length === 0 && (profilesError || adminUsersError)) {
    return (
      <AppScreen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <RetryState
            title="Couldn't load accounts"
            subtitle={adminUsersError ? "Sign out and sign in again." : "Try again in a moment."}
            onRetry={() => void refetchProfiles()}
          />
        </View>
      </AppScreen>
    );
  }

  if (selectedProfileIds.length === 0) {
    return (
      <AppScreen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            productIcon="amazonAccounts"
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
              guestMode
                ? { label: "Sign in", onPress: () => router.push("/auth/login") }
                : isAdminViewer
                  ? undefined
                  : { label: "Connect account", onPress: () => router.push("/more/accounts") }
            }
          />
        </View>
      </AppScreen>
    );
  }

  if (viewingAsAdmin && bootstrapQ.isError && !bootstrapQ.data) {
    return (
      <AppScreen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <RetryState
            title="Couldn't load dashboard"
            subtitle="Try again in a moment."
            onRetry={() => void bootstrapQ.refetch()}
          />
        </View>
      </AppScreen>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <AppScreen testID="home-root">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
        }
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
      >
        <View style={[styles.stickyHeader, { backgroundColor: "transparent" }]}>
          <OverviewHeaderV3
            profileLabel={primaryProfile}
            currency={primaryCurrency}
            onProfilePress={() => router.push("/more/accounts")}
            syncColor={syncColor}
            syncCompact={syncCompactLabel}
            syncA11y={
              recentCompletedSync?.completed_at
                ? `${syncPresentation.label}. Last completed ${String(recentCompletedSync.completed_at).slice(0, 16)}`
                : syncPresentation.label
            }
            onSyncPress={() => router.push("/more/sync")}
            periodLabel={periodLabel}
            periodLoading={periodLoading && !viewingAsAdmin}
            periodRefreshing={periodRefreshing}
            canGoNext={canGoNextPeriod}
            onPrev={() => shiftPeriod(-1)}
            onNext={() => shiftPeriod(1)}
            periodMode={periodMode}
            onPeriodModeChange={applyPeriodMode}
          />
        </View>

        <View style={{ paddingHorizontal: dashboard.pageInset, paddingTop: dashboard.compactGap }}>
          <FirstReveal>
          <HorizonPane watchKey={activePeriodKey}>
          <DashboardSurface tone="hero" style={{ marginBottom: dashboard.sectionGap, overflow: "hidden" }} testID="home-net-royalties">
            <PressableScale
              onPress={chartDay ? clearChartSelection : undefined}
              accessibilityRole={chartDay ? "button" : "text"}
              accessibilityLabel={chartDay ? `${chartDay.label}. Tap to show period total.` : `${NET_ROYALTIES_LABEL} for ${periodLabel}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <VerifiedValue
                  value={chartDay ? chartDay.label : "Net"}
                  style={[t.typography.footnote, { color: t.colors.text_secondary }]}
                  accessibilityRole="header"
                />
                <VerifiedValue
                  value={profitVerdict ?? (!chartDay ? periodLabel : "")}
                  style={[t.typography.caption2, { color: t.colors.text_tertiary }]}
                />
              </View>
            </PressableScale>
            <VerifiedValue
              value={netDisplay}
              color={profitColor}
              style={[
                t.typography.metric_massive,
                {
                  marginTop: t.spacing.sm,
                  fontVariant: ["tabular-nums"],
                },
              ]}
              accessible
              accessibilityLabel={`${NET_ROYALTIES_LABEL}, ${netDisplay}`}
              testID="home-hero-net"
            />
            {kdpPartial && !loading ? (
              <Text style={[t.typography.caption2, { color: t.colors.tone_warning, marginTop: t.spacing.xs }]}>
                Partial royalties — net may be low.
              </Text>
            ) : null}
            {!loading && netKnown && prevKdpReady && !chartDay && (
              <View style={{ marginTop: t.spacing.sm }}>
                <StatBadge delta={deltas.net} suffix="vs prior" />
              </View>
            )}
            {financeCaption ? (
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: t.spacing.sm }]}>
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
              style={[styles.heroMetricGrid, { marginTop: t.spacing.md }]}
              accessible
              accessibilityLabel={`Royalties, ${royaltiesDisplay}. Ad spend, ${spendDisplay}. ACoS, ${acosDisplay}. Margin, ${marginDisplay}.`}
            >
              <HeroMetric label="Royalties" value={royaltiesDisplay} t={t} />
              <HeroMetric label="Ad spend" value={spendDisplay} t={t} />
              <HeroMetric label="ACoS" value={acosDisplay} t={t} color={acosValueColor} />
              <HeroMetric label="Margin" value={marginDisplay} t={t} />
            </View>

            {netKnown && netSeries.length > 1 && (
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
                  periodLabel={periodLabel}
                  selectedIndex={chartIndex}
                  onDaySelect={handleChartDaySelect}
                />
              </View>
            )}
          </DashboardSurface>
          </HorizonPane>
          </FirstReveal>

          {(sellerReady || viewingAsAdmin) ? (
          <OverviewSwipeWidget
            staggerIndex={1}
            testID="home-campaigns"
            title="Campaigns"
            icon="campaigns"
            actionLabel="View all"
            onAction={() => router.push("/(tabs)/campaigns")}
            pages={[
              {
                key: "high-acos",
                label: "High ACoS",
                hint: "Highest to lowest",
                content:
                  campaignsPhase === "loading" ? (
                    <SwipeEmpty message="Loading campaigns…" t={t} />
                  ) : campaignsPhase === "timeout" || campaignsPhase === "offline" || campaignsPhase === "error" ? (
                    <TouchableOpacity
                      onPress={() => void (viewingAsAdmin ? adminCampaignsQ.refetch() : topCampaignsQ.refetch())}
                      accessibilityRole="button"
                    >
                      <SwipeEmpty message="Couldn't load campaigns. Tap to retry." t={t} />
                    </TouchableOpacity>
                  ) : campsHighAcos.length === 0 ? (
                    <SwipeEmpty message="No campaigns in this period." t={t} />
                  ) : (
                    <WidgetRowList>
                      {campsHighAcos.map((campaign, idx) => (
                        <CampaignWidgetRow
                          key={campaign.id}
                          campaign={campaign}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === campsHighAcos.length - 1}
                          onPress={() => router.push(`/campaign/${campaign.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "low-acos",
                label: "Low ACoS",
                hint: "Lowest to highest",
                hidden: (campaignsPhase !== "success" && campaignsPhase !== "empty") || !showCampaignsLowAcos,
                content:
                  campsLowAcos.length === 0 ? (
                    <SwipeEmpty message="No campaigns in this period." t={t} />
                  ) : (
                    <WidgetRowList>
                      {campsLowAcos.map((campaign, idx) => (
                        <CampaignWidgetRow
                          key={campaign.id}
                          campaign={campaign}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === campsLowAcos.length - 1}
                          onPress={() => router.push(`/campaign/${campaign.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "top-spend",
                label: "Top spend",
                hint: "Highest to lowest",
                hidden: campaignsPhase !== "success" && campaignsPhase !== "empty",
                content:
                  campsTopSpend.length === 0 ? (
                    <SwipeEmpty message="No campaign spend in this period." t={t} />
                  ) : (
                    <WidgetRowList>
                      {campsTopSpend.map((campaign, idx) => (
                        <CampaignWidgetRow
                          key={campaign.id}
                          campaign={campaign}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === campsTopSpend.length - 1}
                          onPress={() => router.push(`/campaign/${campaign.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "ad-groups",
                label: "Ad groups",
                hint: "High ACoS first",
                hidden: adGroupsQ.isPending && !adGroupsQ.data,
                content:
                  adGroupsQ.isError && groupsHighAcos.length === 0 ? (
                    <TouchableOpacity onPress={() => void adGroupsQ.refetch()} accessibilityRole="button">
                      <SwipeEmpty message="Couldn't load ad groups. Tap to retry." t={t} />
                    </TouchableOpacity>
                  ) : groupsHighAcos.length === 0 ? (
                    <SwipeEmpty message="No ad groups in this period." t={t} />
                  ) : (
                    <WidgetRowList>
                      {groupsHighAcos.map((row, idx) => (
                        <AdGroupWidgetRow
                          key={row.id}
                          row={row}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === groupsHighAcos.length - 1}
                          onPress={() => router.push(`/more/ad-group/${row.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
            ]}
          />
          ) : null}

          {belowFoldReady ? (
          <>
          {reviewReady ? (
            <View style={{ marginTop: dashboard.sectionGap }}>
              <ActionReviewCard
                items={actionItems}
                rulesChecked={pulseStats.rulesRun}
                t={t}
                onOpen={(route) => {
                  router.push(route as never);
                }}
              />
            </View>
          ) : null}

          {totalDailyBudget > 0 || budgetSpend > 0 ? (
            <View style={[dashboardSurfaceStyle(t), { marginTop: dashboard.sectionGap }]}>
              <OverviewCardHeader title="Budget today" icon="adSpend" />
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
                <BudgetArcWidget spent={budgetSpend} budget={totalDailyBudget || budgetSpend} currency={primaryCurrency} size={132} />
                <View style={{ flex: 1, gap: t.spacing.xs }}>
                  <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
                    {totalDailyBudget > 0 ? `${Math.round(budgetUsedPct)}% used` : "Spend so far"}
                  </Text>
                  <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                    {formatCurrency(budgetSpend, primaryCurrency, { compact: true })}
                    {totalDailyBudget > 0 ? ` of ${formatCurrency(totalDailyBudget, primaryCurrency, { compact: true })}` : ""}
                  </Text>
                  {budgetDanger ? (
                    <Text style={[t.typography.footnote, { color: t.colors.tone_warning }]}>
                      Daily budget is almost gone.
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          {bidBotStatusQ.isFetched || bidBot ? (
            <PressableScale
              onPress={() => router.push("/more/bid-bot")}
              accessibilityLabel="Open BidBot"
              style={[dashboardSurfaceStyle(t), { marginTop: dashboard.sectionGap }]}
            >
              <OverviewCardHeader title="BidBot" icon="bidBot" />
              {bidBotStatusQ.isError && !bidBot ? (
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                  Status unavailable. Open BidBot to retry.
                </Text>
              ) : (
                <View style={{ gap: dashboard.compactGap }}>
                  <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
                    {bidBotOperationalCopy({
                      autoMode: bidBot?.autoMode ?? snapshotAutomation?.autoMode,
                      pendingCount: snapshotAutomation?.pendingCount ?? null,
                      lastRunAt: bidBot?.lastRunAt ?? snapshotAutomation?.lastRunAt,
                    }).title}
                  </Text>
                  <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                    {autoModeLabel(bidBot?.autoMode)} · target {bidBot?.targetAcos != null ? formatPercent(bidBot.targetAcos, 0) : "—"}
                    {bidBot?.lastRunAt
                      ? ` · Last run ${formatDateShort(String(bidBot.lastRunAt).slice(0, 10))}`
                      : ""}
                    {bidBot?.lastRunStats?.recommendations != null
                      ? ` · ${formatInt(bidBot.lastRunStats.recommendations)} recs`
                      : ""}
                  </Text>
                </View>
              )}
            </PressableScale>
          ) : null}

          {todayStatsQ.isFetched || pulseStats.batchCount > 0 || pulseStats.rulesRun > 0 ? (
            <View style={[dashboardSurfaceStyle(t), { marginTop: dashboard.sectionGap }]}>
              <OverviewCardHeader
                title="Automation"
                icon="automation"
                actionLabel="Rules"
                onAction={() => router.push("/more/automation")}
              />
              <View style={{ flexDirection: "row", marginTop: t.spacing.xs }}>
                <PulseStat label="Rules run" value={pulseStats.rulesRun} t={t} />
                <PulseStat label="Edits" value={pulseStats.entitiesEdited} t={t} />
                <PulseStat label="Batches" value={pulseStats.batchCount} t={t} />
              </View>
            </View>
          ) : null}

          {(keywordBleeders.length > 0 || keywordHighAcos.length > 0 || termSpendNoOrders.length > 0 || termLowAcos.length > 0) ? (
            <OverviewSwipeWidget
              staggerIndex={2}
              title="Keywords & search"
              icon="targeting"
              actionLabel="Targets"
              onAction={() => router.push("/(tabs)/targeting")}
              pages={[
                {
                  key: "kw-no-orders",
                  label: "Spend, no orders",
                  hint: "Keywords",
                  hidden: keywordBleeders.length === 0,
                  content: (
                    <WidgetRowList>
                      {keywordBleeders.map((row, idx) => (
                        <KeywordWidgetRow
                          key={row.id}
                          row={row}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === keywordBleeders.length - 1}
                          onPress={() => router.push(`/target/${row.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
                },
                {
                  key: "kw-high-acos",
                  label: "High ACoS",
                  hint: "Keywords · high to low",
                  hidden: keywordHighAcos.length === 0,
                  content: (
                    <WidgetRowList>
                      {keywordHighAcos.map((row, idx) => (
                        <KeywordWidgetRow
                          key={row.id}
                          row={row}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === keywordHighAcos.length - 1}
                          onPress={() => router.push(`/target/${row.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
                },
                {
                  key: "st-no-orders",
                  label: "Search spend",
                  hint: "No orders · high to low",
                  hidden: termSpendNoOrders.length === 0,
                  content: (
                    <WidgetRowList>
                      {termSpendNoOrders.map((row, idx) => (
                        <SearchTermWidgetRow
                          key={row.id ?? `${row.search_term}-${idx}`}
                          row={row}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === termSpendNoOrders.length - 1}
                        />
                      ))}
                    </WidgetRowList>
                  ),
                },
                {
                  key: "st-low-acos",
                  label: "Best ACoS",
                  hint: "Search terms · low to high",
                  hidden: termLowAcos.length === 0,
                  content: (
                    <WidgetRowList>
                      {termLowAcos.map((row, idx) => (
                        <SearchTermWidgetRow
                          key={row.id ?? `${row.search_term}-${idx}`}
                          row={row}
                          currency={primaryCurrency}
                          t={t}
                          isLast={idx === termLowAcos.length - 1}
                        />
                      ))}
                    </WidgetRowList>
                  ),
                },
              ]}
            />
          ) : null}

          {placementMix.length > 0 || placementCampaigns.length > 0 ? (
            <OverviewSwipeWidget
              staggerIndex={3}
              title="Placement mix"
              icon="targeting"
              pages={[
                {
                  key: "mix",
                  label: "Spend by placement",
                  hidden: placementMix.length === 0,
                  content: <PlacementMixV2 rows={placementMix} currency={primaryCurrency} t={t} />,
                },
                {
                  key: "campaigns",
                  label: "Campaign placement",
                  hint: "Top · Product · Rest share",
                  hidden: placementCampaigns.length === 0,
                  content: (
                    <WidgetRowList>
                      {placementCampaigns.slice(0, 7).map((campaign, idx, arr) => (
                        <CampaignWidgetRow
                          key={campaign.id}
                          campaign={campaign}
                          currency={primaryCurrency}
                          t={t}
                          showPlacement
                          isLast={idx === arr.length - 1}
                          onPress={() => router.push(`/campaign/${campaign.id}` as never)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
                },
              ]}
            />
          ) : null}

          <OverviewSwipeWidget
            staggerIndex={4}
            title="Top books"
            icon="books"
            action={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <TouchableOpacity
                  onPress={() => setBlurBooks((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={blurBooks ? "Show book titles" : "Hide book titles"}
                  hitSlop={8}
                  style={{ minWidth: t.layout.minTap, minHeight: t.layout.minTap, alignItems: "center", justifyContent: "center" }}
                >
                  <SFSymbol name={blurBooks ? "eye.slash" : "eye"} size={18} color={blurBooks ? t.colors.tone_primary : t.colors.text_tertiary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openBooksTab}
                  accessibilityRole="button"
                  accessibilityLabel="View all books"
                  hitSlop={8}
                  style={{ minHeight: t.layout.minTap, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 2 }}
                >
                  <Text style={[t.typography.meta, { color: t.colors.tone_primary }]}>View all</Text>
                  <SFSymbol name="chevron.right" size={11} color={t.colors.tone_primary} />
                </TouchableOpacity>
              </View>
            }
            pages={[
              {
                key: "top-royalties",
                label: "Top royalties",
                hint: "KDP · high to low",
                content:
                  booksPhase === "loading" ? (
                    <SwipeEmpty message="Loading books…" t={t} />
                  ) : booksPhase === "timeout" || booksPhase === "offline" || booksPhase === "error" ? (
                    <TouchableOpacity onPress={() => void topBooksQ.refetch()} accessibilityRole="button">
                      <SwipeEmpty message="Couldn't load books. Tap to retry." t={t} />
                    </TouchableOpacity>
                  ) : booksRoyalties.length === 0 ? (
                    <SwipeEmpty
                      message={
                        kdpReady && totals.royalties > 0
                          ? `Overview shows ${formatCurrency(totals.royalties, primaryCurrency)} KDP royalties, but no per-book breakdown in this period yet. Open Books or sync KDP on desktop.`
                          : "No KDP royalties on books in this period."
                      }
                      t={t}
                    />
                  ) : (
                    <WidgetRowList>
                      {booksRoyalties.map((book, idx) => (
                        <BookWidgetRow
                          key={book.asin || idx}
                          book={book}
                          currency={primaryCurrency}
                          t={t}
                          blur={blurBooks}
                          isLast={idx === booksRoyalties.length - 1}
                          onPress={() => openBook(book)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "worst-profit",
                label: "Worst profit",
                hint: "Royalties minus ad spend",
                hidden: booksPhase !== "success" && booksPhase !== "empty",
                content:
                  booksProfit.length === 0 ? (
                    <SwipeEmpty
                      message={
                        kdpReady && totals.royalties > 0
                          ? "No book-level net yet. Royalties may be account-only until KDP book sync completes."
                          : "No book profit data for this period."
                      }
                      t={t}
                    />
                  ) : (
                    <WidgetRowList>
                      {booksProfit.map((book, idx) => (
                        <BookWidgetRow
                          key={book.asin || idx}
                          book={book}
                          currency={primaryCurrency}
                          t={t}
                          blur={blurBooks}
                          isLast={idx === booksProfit.length - 1}
                          onPress={() => openBook(book)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "high-acos",
                label: "High ACoS",
                hint: "Ad-attributed sales only",
                hidden: booksPhase !== "success" && booksPhase !== "empty",
                content:
                  booksHigh.length === 0 ? (
                    <SwipeEmpty message="No ad-attributed book sales in this period. KDP royalties can still show on Top royalties." t={t} />
                  ) : (
                    <WidgetRowList>
                      {booksHigh.map((book, idx) => (
                        <BookWidgetRow
                          key={book.asin || idx}
                          book={book}
                          currency={primaryCurrency}
                          t={t}
                          blur={blurBooks}
                          isLast={idx === booksHigh.length - 1}
                          onPress={() => openBook(book)}
                        />
                      ))}
                    </WidgetRowList>
                  ),
              },
              {
                key: "ad-spend-no-sales",
                label: "Ad spend",
                hint: "Spend without ad sales",
                hidden: booksAdSpendNoSales.length === 0,
                content: (
                  <WidgetRowList>
                    {booksAdSpendNoSales.map((book, idx) => (
                      <BookWidgetRow
                        key={book.asin || idx}
                        book={book}
                        currency={primaryCurrency}
                        t={t}
                        blur={blurBooks}
                        isLast={idx === booksAdSpendNoSales.length - 1}
                        onPress={() => openBook(book)}
                      />
                    ))}
                  </WidgetRowList>
                ),
              },
              {
                key: "low-acos",
                label: "Low ACoS",
                hint: "Ad-attributed sales only",
                hidden:
                  (booksPhase !== "success" && booksPhase !== "empty") ||
                  booksLow.length === 0 ||
                  !overviewLowAcosDiffersFromHigh(
                    booksHigh.map((book) => ({ id: book.asin || book.book_key })),
                    booksLow.map((book) => ({ id: book.asin || book.book_key })),
                  ),
                content: (
                  <WidgetRowList>
                    {booksLow.map((book, idx) => (
                      <BookWidgetRow
                        key={book.asin || idx}
                        book={book}
                        currency={primaryCurrency}
                        t={t}
                        blur={blurBooks}
                        isLast={idx === booksLow.length - 1}
                        onPress={() => openBook(book)}
                      />
                    ))}
                  </WidgetRowList>
                ),
              },
            ]}
          />
          </>
          ) : null}

        </View>
      </ScrollView>
    </AppScreen>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function AnimatedValueText({
  value,
  style,
  ...props
}: React.ComponentProps<typeof Text> & { value: string }) {
  return <VerifiedValue value={value} style={style} {...props} />;
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
  const visibleItems = items.slice(0, 3);

  return (
    <View style={[styles.actionReviewCard, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}>
      <View style={styles.actionReviewHeader}>
        <InteliAdsIcon name={active ? "attention" : "success"} size={dashboard.iconLg} color={active ? t.colors.tone_warning : t.colors.text_secondary} />
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
        <View style={[styles.actionReviewCount, { backgroundColor: t.colors.background_tertiary }]}>
          <Text style={[styles.actionReviewCountText, { color: t.colors.text_primary }]}>{active ? items.length : "OK"}</Text>
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
                <SFSymbol name={sfFromIonicon(item.icon)} size={dashboard.iconSm} color={itemColor} />
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
        <View style={[styles.actionClearStrip, { backgroundColor: t.colors.background_tertiary }]}>
          <SFSymbol name="checkmark.circle.fill" size={15} color={t.colors.text_secondary} />
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, flex: 1 }]} numberOfLines={1}>
            No wasted-spend or sync blockers detected.
          </Text>
        </View>
      )}
    </View>
  );
}

function HeroMetric({
  label,
  value,
  t,
  color,
}: {
  label: string;
  value: string;
  t: any;
  color?: string;
}) {
  return (
    <GlassPanel
      strength="chip"
      style={[styles.heroMetricCell, { borderColor: t.colors.glass_stroke }]}
      contentStyle={{ paddingVertical: 10, paddingHorizontal: 12 }}
    >
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label}</Text>
      <VerifiedValue
        value={value}
        color={color ?? t.colors.text_primary}
        style={[t.typography.metric_compact, { marginTop: 2 }]}
        numberOfLines={1}
      />
    </GlassPanel>
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

// Card title grammar lives in OverviewCardHeader (DashboardSurface).

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
    paddingBottom: 6,
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  syncText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0,
  },
  actionReviewCard: {
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    padding: dashboard.cardPadding,
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
    minHeight: dashboard.headerRow,
    flexDirection: "row",
    alignItems: "center",
    gap: dashboard.compactGap,
  },
  dateNavButton: {
    width: dashboard.headerRow,
    height: dashboard.headerRow,
    borderRadius: dashboard.cardRadius,
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
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
  },
  profitCard: {
    padding: dashboard.cardPadding,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
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
    marginTop: 14,
    overflow: "visible",
  },
  heroMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: dashboard.compactGap,
  },
  heroMetricCell: {
    width: "47%",
    minWidth: 120,
    flexGrow: 1,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  yBookNetText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  bookRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
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
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
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
