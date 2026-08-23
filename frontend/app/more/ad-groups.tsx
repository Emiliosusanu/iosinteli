import React, { useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EntityStateSwitch } from "@/src/components/Mutations";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor, useReduceMotion, layout, radii, spacing } from "@/src/lib/theme";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { updateAdGroupState } from "@/src/lib/mutations";
import { fetchAdGroups } from "@/src/lib/queries";
import { statusLabel } from "@/src/lib/campaigns";
import { formatCurrency, formatInt, formatPercent, safeDivide } from "@/src/lib/format";
import { EmptyState, ToneDot, MetricStrip, FilterChrome, ScreenSpinner, ListCard, RetryState } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type StateFilter = "all" | "enabled" | "paused";
type SortKey = "spend" | "orders" | "acos" | "ctr";

const SORT_CONFIG: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "orders", label: "Orders" },
  { key: "acos", label: "ACoS" },
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
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  const sales = Number(item.total_sales) || 0;
  const acos = Number(item.total_acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Wasting spend", tone: "danger" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" };
  if (sales > 0) return { label: "Profitable", tone: "good" };
  return { label: "No spend yet", tone: "inactive" };
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
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("enabled");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [filterOpen, setFilterOpen] = useState(false);

  const { data = [], isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["ad-groups-list", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchAdGroups(selectedProfileIds, undefined, { start: dateRange.start, end: dateRange.end }),
    enabled: selectedProfileIds.length > 0,
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let arr = (data as any[]).filter((item) => {
      if (stateFilter === "enabled") return item.state === "enabled";
      if (stateFilter === "paused") return item.state === "paused";
      return true;
    });
    if (needle) {
      arr = arr.filter((item) => String(item.name || "").toLowerCase().includes(needle));
    }

    return arr.sort((a, b) => {
      // Always put items with data on top
      const aHasData = a.total_spend > 0 || a.total_orders > 0;
      const bHasData = b.total_spend > 0 || b.total_orders > 0;
      if (aHasData && !bHasData) return -1;
      if (!aHasData && bHasData) return 1;

      switch (sortKey) {
        case "orders": return b.total_orders - a.total_orders;
        case "acos":   return (a.total_acos || Infinity) - (b.total_acos || Infinity);
        case "ctr":    return b.total_ctr - a.total_ctr;
        default:       return b.total_spend - a.total_spend;
      }
    });
  }, [data, stateFilter, sortKey, search]);

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
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const sortLabel = SORT_CONFIG.find((entry) => entry.key === sortKey)?.label ?? "Spend";
  const sortActive = sortKey !== "spend";
  const showCount = search.trim().length > 0 || stateFilter !== "enabled" || sortActive;
  const empty = emptyCopy(search, stateFilter, data.length);

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Ad Groups" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see ad groups." />
      </SubScreen>
    );
  }

  return (
    <SubScreen title="Ad Groups" showDateRange>
      <FilterChrome>
        <View style={styles.searchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="ad-groups-search"
              placeholder="Search ad groups"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            testID="ad-groups-filter-btn"
            accessibilityRole="button"
            accessibilityLabel={sortActive ? `Sort: ${sortLabel}` : "Sort ad groups"}
            accessibilityHint="Opens sort options"
            onPress={() => setFilterOpen(true)}
            hitSlop={4}
            style={[
              styles.filterBtn,
              {
                backgroundColor: sortActive ? t.colors.tone_primary + "18" : t.colors.background_tertiary,
              },
            ]}
          >
            <SFSymbol
              name="slider.horizontal.3"
              size={16}
              color={sortActive ? t.colors.tone_primary : t.colors.text_secondary}
            />
            {sortActive ? <View style={[styles.filterDot, { backgroundColor: t.colors.tone_primary }]} /> : null}
          </TouchableOpacity>
        </View>
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
        {sortActive ? (
          <View style={styles.activeFilters}>
            <TouchableOpacity
              testID="ad-groups-filter-chip-sort"
              accessibilityRole="button"
              accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
              onPress={() => applySort("spend")}
              style={[styles.filterChip, { backgroundColor: t.colors.tone_primary + "14" }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                Sort: {sortLabel}
              </Text>
              <SFSymbol name="xmark" size={10} color={t.colors.tone_primary} />
            </TouchableOpacity>
          </View>
        ) : null}
        {showCount && !isLoading && !(isError && data.length === 0) ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 ad group" : `${filtered.length} ad groups`}
          </Text>
        ) : null}
      </FilterChrome>

      {isLoading && data.length === 0 ? (
        <ScreenSpinner />
      ) : isError && data.length === 0 ? (
        <RetryState
          title="Ad groups failed to load"
          subtitle="Check your connection and try again."
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
                <ListCard>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[t.typography.headline, { color: t.colors.text_primary }]}
                        numberOfLines={2}
                      >
                        {item.name || "Ad Group"}
                      </Text>
                      <View style={styles.metaRow}>
                        <ToneDot value={Number(item.total_acos)} />
                        <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                          {verdict.label}
                        </Text>
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                          {[statusLabel(item.state), contentLabel?.label].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                    </View>
                    <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()}>
                      <EntityStateSwitch
                        testID={`ad-group-state-${item.id}`}
                        enabled={item.state === "enabled"}
                        noun="ad group"
                        onChange={async (next) => {
                          await updateAdGroupState(item.id, next ? "enabled" : "paused");
                          await invalidateAds();
                        }}
                      />
                    </View>
                  </View>
                  <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]}>
                    <MetricStrip
                      items={[
                        {
                          label: "ACoS",
                          value: item.total_sales > 0 ? formatPercent(Number(item.total_acos)) : "—",
                          color: toneColor(acosTone(Number(item.total_acos)), t.colors),
                        },
                        { label: "Spend", value: formatCurrency(item.total_spend, primaryCurrency, { compact: true }) },
                        { label: "Sales", value: formatCurrency(item.total_sales, primaryCurrency, { compact: true }) },
                        { label: "Orders", value: formatInt(item.total_orders) },
                      ]}
                    />
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  filterBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDot: {
    position: "absolute",
    top: spacing.tight,
    right: spacing.tight,
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radii.pill,
  },
  activeFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: layout.minTap,
    borderRadius: radii.pill,
  },
  sheetDone: {
    minHeight: layout.minTap,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  filterSheet: { flex: 1 },
  filterSheetAndroid: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.xs,
  },
  metricsRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
