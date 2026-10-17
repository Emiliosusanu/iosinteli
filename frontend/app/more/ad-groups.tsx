import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  Pressable,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EntityStateSwitch, assertNotViewingAsOtherUser } from "@/src/components/Mutations";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, dashboard, toneColor, useReduceMotion, layout, spacing } from "@/src/lib/theme";
import { applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityState } from "@/src/lib/invalidateAds";
import { updateAdGroupState } from "@/src/lib/mutations";
import { AD_GROUPS_LIST_LIMIT, fetchAdGroups, fetchOverviewActiveAdGroups } from "@/src/lib/queries";
import { matchesEntityStateFilter, statusLabel } from "@/src/lib/campaigns";
import { optionalMetric } from "@/src/lib/metricEvidence";
import { enabledSelectedProfileIds } from "@/src/lib/booksProfileScope";
import { compareByAcosAscending, compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { overviewReadLabel } from "@/src/lib/overviewReadEvidence";
import { formatCurrency, formatInt, formatPercent, safeDivide } from "@/src/lib/format";
import { LIST_PERIOD_QUERY_CACHE } from "@/src/lib/periodQuery";
import { HOME_QUERY_TIMEOUT_MS, isHomeQueryTimeout, withAbortableQueryTimeout, withQueryTimeout } from "@/src/lib/queryTimeout";
import { EmptyState, ToneDot, DenseMetricLine, FilterChrome, FilterSearchRow, FilterIconButton, ActiveFilterChip, ActiveFilterRow, ScreenSpinner, ListCard, RetryState } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl } from "@/src/components/ios/Native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type StateFilter = "all" | "enabled" | "paused";
type SortKey = "spend" | "orders" | "acos" | "acos-high" | "ctr";

const SORT_CONFIG: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "orders", label: "Orders" },
  { key: "acos", label: "ACoS" },
  { key: "acos-high", label: "High ACoS" },
  { key: "ctr", label: "CTR" },
];

function adGroupContentLabel(item: any): { label: string; tone: "primary" | "good" | "warning" | "product" } | null {
  const kwCount: number = item.keyword_count ?? 0;
  const ptCount: number = item.product_target_count ?? 0; // real ASIN targets only

  // Auto detection uses the enriched is_auto flag (based on auto-clause expression types)
  if (item.is_auto) return { label: "Auto", tone: "warning" };
  if (kwCount > 0 && ptCount === 0) return { label: "Keywords", tone: "primary" };
  if (ptCount > 0 && kwCount === 0) return { label: "Products", tone: "product" };
  if (kwCount > 0 && ptCount > 0) return { label: "Mixed", tone: "good" };
  return null;
}

function adGroupVerdict(item: any): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = optionalMetric(item.total_spend);
  const orders = optionalMetric(item.total_orders);
  const sales = optionalMetric(item.total_sales);
  const acos = optionalMetric(item.total_acos);
  if (spend != null && spend > 0 && orders === 0) return { label: "Spend without orders", tone: "danger" };
  if (sales != null && sales > 0 && acos != null) {
    return acos > 35 ? { label: "ACoS >35%", tone: "warning" } : { label: "ACoS ≤35%", tone: "good" };
  }
  if (spend === 0) return { label: "No spend in period", tone: "inactive" };
  return { label: "Metrics incomplete", tone: "inactive" };
}

function emptyCopy(search: string, stateFilter: StateFilter, rawCount: number) {
  if (search.trim()) return { title: "No matching ad groups", subtitle: "Try a different name." };
  if (rawCount === 0) return { title: "No ad groups", subtitle: "None in this period." };
  if (stateFilter === "enabled") return { title: "No active ad groups", subtitle: "Try All or Paused." };
  if (stateFilter === "paused") return { title: "No paused ad groups", subtitle: "Try All or Active." };
  return { title: "No ad groups", subtitle: "None in this period." };
}

function adGroupA11yLabel(item: any, verdict: { label: string }, currency: string) {
  const state = statusLabel(item.state);
  const acos = Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "not available";
  const spend = formatCurrency(Number(item.total_spend) || 0, currency);
  const orders = formatInt(Number(item.total_orders) || 0);
  return `${item.name || "Ad Group"}, ${state}, ${verdict.label}, ACoS ${acos}, Spend ${spend}, ${orders} orders`;
}

export default function AdGroupsScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const queryClient = useQueryClient();
  const { selectedProfileIds, profiles, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const { user } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const scopeProfiles = useMemo(() => enabledSelectedProfileIds(profiles, selectedProfileIds).sort(), [profiles, selectedProfileIds]);
  const params = useLocalSearchParams<{ flow?: string; enabledParents?: string; sort?: string }>();
  const contextKey = `${user?.id ?? "guest"}:${adminFilterUserId ?? "self"}:${params.flow ?? ""}:${params.enabledParents ?? ""}:${params.sort ?? ""}`;
  const [readyContext, setReadyContext] = useState(contextKey);
  const [enabledParents, setEnabledParents] = useState(params.enabledParents === "1");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("enabled");
  const [sortKey, setSortKey] = useState<SortKey>(params.sort === "acos-high" ? "acos-high" : "spend");
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setSearch(""); setStateFilter("enabled");
    setSortKey(params.sort === "acos-high" ? "acos-high" : "spend");
    setEnabledParents(params.enabledParents === "1");
    setReadyContext(contextKey);
  }, [contextKey, params.enabledParents, params.sort]);

  const { data = [], dataUpdatedAt, isFetching, isLoading, isError, isRefetching, error, refetch } = useQuery({
    queryKey: ["ad-groups-list-v2", user?.id, adminFilterUserId ?? "self", scopeProfiles, dateRange.start, dateRange.end, primaryCurrency, enabledParents],
    queryFn: ({ signal }) => {
      if (enabledParents) return withAbortableQueryTimeout(readSignal => fetchOverviewActiveAdGroups(scopeProfiles, {
        start: dateRange.start, end: dateRange.end, limit: AD_GROUPS_LIST_LIMIT,
        filterUserId: adminFilterUserId, signal: readSignal,
      }), HOME_QUERY_TIMEOUT_MS * 2, signal);
      // Customer preview must not fall back to the administrator's own RLS catalog.
      if (viewAsOtherUser) throw new Error("Customer ad groups require the enabled-parents view");
      return withQueryTimeout(
        fetchAdGroups(scopeProfiles, undefined, {
          start: dateRange.start,
          end: dateRange.end,
          limit: AD_GROUPS_LIST_LIMIT,
          enrichCounts: false,
        }),
        HOME_QUERY_TIMEOUT_MS * 2,
        signal,
      );
    },
    enabled: !!user?.id && readyContext === contextKey && scopeProfiles.length > 0,
    ...LIST_PERIOD_QUERY_CACHE,
    retry: false,
  });
  const listTruncated = !isError && data.length >= AD_GROUPS_LIST_LIMIT;

  const filtered = useMemo(() => {
    if (readyContext !== contextKey) return [];
    const needle = search.trim().toLowerCase();
    let arr = (isError ? [] : data as any[]).filter((item) => matchesEntityStateFilter(item.state, stateFilter));
    if (needle) {
      arr = arr.filter((item) => String(item.name || "").toLowerCase().includes(needle));
    }

    return arr.sort((a, b) => {
      if (sortKey === "acos") return compareByAcosAscending(a, b);
      if (sortKey === "acos-high") return compareByAcosSpendImpressionsSync(a, b);
      // Always put items with data on top
      const aHasData = a.total_spend > 0 || a.total_orders > 0;
      const bHasData = b.total_spend > 0 || b.total_orders > 0;
      if (aHasData && !bHasData) return -1;
      if (!aHasData && bHasData) return 1;

      switch (sortKey) {
        case "orders": return b.total_orders - a.total_orders;
        case "ctr":    return b.total_ctr - a.total_ctr;
        default:       return b.total_spend - a.total_spend;
      }
    });
  }, [data, isError, stateFilter, sortKey, search, readyContext, contextKey]);

  function animateList() {
    if (reduceMotion) return;
    LayoutAnimation.configureNext({
      duration: 280,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
  }

  function applyFilter(f: StateFilter) {
    if (f === stateFilter) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setStateFilter(f);
    if (f !== "enabled") setEnabledParents(false);
  }

  function applySort(s: SortKey) {
    if (s === sortKey) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setSortKey(s);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // Bound pull-to-refresh so a hung Supabase read cannot spin forever.
      await withQueryTimeout(refetch({ throwOnError: false }), HOME_QUERY_TIMEOUT_MS * 2);
    } catch {
      /* timeout / abort — banner/retry handles empty+error */
    } finally {
      setRefreshing(false);
    }
  };

  const sortLabel = SORT_CONFIG.find((entry) => entry.key === sortKey)?.label ?? "Spend";
  const sortActive = sortKey !== "spend";
  const showCount = search.trim().length > 0 || stateFilter !== "enabled" || sortActive || enabledParents || listTruncated;
  const empty = emptyCopy(search, stateFilter, data.length);

  if (scopeProfiles.length === 0) {
    return (
      <SubScreen title="Ad Groups" showDateRange>
        <EmptyState icon="business-outline" title="No enabled profile selected" />
      </SubScreen>
    );
  }

  return (
    <SubScreen title="Ad Groups" showDateRange>
      <FilterChrome>
        <FilterSearchRow>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="ad-groups-search"
              placeholder="Search ad groups"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <FilterIconButton
            testID="ad-groups-filter-btn"
            active={sortActive}
            accessibilityLabel={sortActive ? `Sort: ${sortLabel}` : "Sort ad groups"}
            accessibilityHint="Opens sort options"
            onPress={() => setFilterOpen(true)}
          />
        </FilterSearchRow>
        <IOSSegmentedControl
          testID="ad-groups-state-segments"
          value={stateFilter}
          onChange={applyFilter}
          options={[
            { key: "all", label: "All", testID: "filter-state-all" },
            { key: "enabled", label: "Active", testID: "filter-state-enabled" },
            { key: "paused", label: "Paused", testID: "filter-state-paused" },
          ]}
        />
        {sortActive || enabledParents ? (
          <ActiveFilterRow>
            {enabledParents ? <ActiveFilterChip
              testID="ad-groups-filter-chip-parents"
              label="Enabled parents"
              accessibilityLabel="Clear enabled campaign and ad group filter"
              onPress={() => setEnabledParents(false)}
            /> : null}
            {sortActive ? (
            <ActiveFilterChip
              testID="ad-groups-filter-chip-sort"
              label={`Sort: ${sortLabel}`}
              accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
              onPress={() => applySort("spend")}
            />
            ) : null}
          </ActiveFilterRow>
        ) : null}
        <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>
          {overviewReadLabel({ updatedAt: dataUpdatedAt, fetching: isFetching, failed: isError })}
        </Text>
        {showCount && readyContext === contextKey && !isLoading && !isError ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 ad group" : `${filtered.length} ad groups`}
            {listTruncated ? enabledParents ? ` · top ${AD_GROUPS_LIST_LIMIT} by period spend` : " · limited catalog" : ""}
          </Text>
        ) : null}
      </FilterChrome>

      {readyContext !== contextKey || (isLoading && data.length === 0) ? (
        <ScreenSpinner />
      ) : viewAsOtherUser && !enabledParents ? (
        <EmptyState icon="layers-outline" title="Enabled-parent context required" action={{ label: "Enabled parents", onPress: () => { setStateFilter("enabled"); setEnabledParents(true); } }} />
      ) : isError ? (
        <RetryState
          title={isHomeQueryTimeout(error) ? "Ad groups took too long" : "Couldn't load ad groups"}
          subtitle={
            isHomeQueryTimeout(error)
              ? "This period’s ad groups are still loading slowly. Retry, or narrow the date range."
              : "Check your connection and try again."
          }
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: t.layout.listGap }} />}
          ListEmptyComponent={<EmptyState icon="layers-outline" title={empty.title} subtitle={empty.subtitle} />}
          renderItem={({ item }) => {
            const contentLabel = adGroupContentLabel(item);
            const verdict = adGroupVerdict(item);
            const ctr = Number(item.total_ctr) || safeDivide(Number(item.total_clicks), Number(item.total_impressions)) * 100;
            const openDetail = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({
                pathname: "/more/ad-group/[id]",
                params: {
                  id: item.id,
                  name: item.name || "Ad Group",
                  isAuto: String(!!item.is_auto),
                  state: item.state ?? "",
                  spend: String(item.total_spend ?? 0),
                  orders: String(item.total_orders ?? 0),
                  acos: String(item.total_acos ?? 0),
                  ctr: String(ctr),
                  clicks: String(item.total_clicks ?? 0),
                  impressions: String(item.total_impressions ?? 0),
                },
              });
            };
            return (
              <TouchableOpacity
                testID={`ad-group-row-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={adGroupA11yLabel(item, verdict, primaryCurrency)}
                accessibilityHint="Opens ad group details"
                activeOpacity={0.75}
                onPress={openDetail}
              >
                <ListCard compact>
                  <View style={styles.leadRow}>
                    <View
                      onStartShouldSetResponder={() => true}
                      onTouchEnd={(event) => event.stopPropagation()}
                      style={styles.switchWell}
                    >
                      <EntityStateSwitch
                        testID={`ad-group-state-${item.id}`}
                        enabled={item.state === "enabled"}
                        noun="ad group"
                        onChange={async (next) => {
                          assertNotViewingAsOtherUser(viewAsOtherUser);
                          const previous = applyOptimisticEntityState(queryClient, "ad_group", item.id, next);
                          try {
                            await updateAdGroupState(item.id, next ? "enabled" : "paused");
                            void invalidateEntityStateQueries(queryClient, "ad_group");
                          } catch (error) {
                            revertOptimisticEntityState(queryClient, "ad_group", item.id, previous);
                            throw error;
                          }
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}
                        numberOfLines={1}
                      >
                        {item.name || "Ad Group"}
                      </Text>
                      <View style={styles.metaRow}>
                        <ToneDot value={Number(item.total_acos)} />
                        <Text style={[t.typography.caption2, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                          {verdict.label}
                        </Text>
                        <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>
                          {[statusLabel(item.state), contentLabel?.label].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      <DenseMetricLine
                        items={[
                          {
                            label: "ACoS",
                            value: item.total_sales > 0 ? formatPercent(Number(item.total_acos)) : "—",
                            color: toneColor(acosTone(Number(item.total_acos)), t.colors),
                          },
                          { label: "Spend", value: formatCurrency(item.total_spend, primaryCurrency, { compact: true }) },
                          { label: "Impr", value: formatInt(item.total_impressions) },
                          { label: "Clicks", value: formatInt(item.total_clicks) },
                          { label: "Ord", value: formatInt(item.total_orders) },
                        ]}
                      />
                    </View>
                  </View>
                </ListCard>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal
        visible={filterOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setFilterOpen(false)}
      >
        {Platform.OS === "ios" ? (
          <View style={[styles.filterSheet, { backgroundColor: t.colors.background_secondary }]}>
            <SortSheetBody t={t} sortKey={sortKey} onSort={applySort} onDone={() => setFilterOpen(false)} />
          </View>
        ) : (
          <Pressable style={[styles.filterOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setFilterOpen(false)}>
            <Pressable
              style={[styles.filterSheetAndroid, { backgroundColor: t.colors.background_secondary }]}
              onPress={(event) => event.stopPropagation()}
            >
              <SortSheetBody t={t} sortKey={sortKey} onSort={applySort} onDone={() => setFilterOpen(false)} />
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </SubScreen>
  );
}

function SortSheetBody({
  t,
  sortKey,
  onSort,
  onDone,
}: {
  t: any;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  onDone: () => void;
}) {
  return (
    <>
      <View style={styles.filterSheetHeader}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Sort</Text>
        <TouchableOpacity
          testID="ad-groups-filter-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onDone}
          hitSlop={4}
          style={styles.sheetDone}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterSheetBody}>
        <IOSSegmentedControl
          testID="ad-groups-sort-segments"
          value={sortKey}
          onChange={onSort}
          options={SORT_CONFIG.map((sc) => ({ key: sc.key, label: sc.label, testID: `filter-sort-${sc.key}` }))}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sheetDone: {
    minHeight: layout.minTap,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  filterSheet: { flex: 1 },
  filterSheetAndroid: {
    borderTopLeftRadius: dashboard.cardRadius,
    borderTopRightRadius: dashboard.cardRadius,
    paddingBottom: spacing.xxl,
  },
  filterOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  filterSheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  filterSheetBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  leadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchWell: { minWidth: 42, alignItems: "flex-start", justifyContent: "center" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
