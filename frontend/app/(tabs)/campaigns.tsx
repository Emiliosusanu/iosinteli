import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { fetchTopCampaignsRange } from "@/src/lib/queries";
import { biddingStrategyLabel, shouldShowActiveOrPausedWithData, statusLabel } from "@/src/lib/campaigns";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor, useReduceMotion, radii, spacing, layout } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { updateCampaign, updateCampaignState } from "@/src/lib/mutations";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { TopBar } from "@/src/components/TopBar";
import { BidBudgetEditor, EntityStateSwitch } from "@/src/components/Mutations";
import { EmptyState, ToneDot, RetryState, MetricStrip, FilterChrome, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";

function campaignVerdict(item: any): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  const sales = Number(item.sales) || 0;
  const acos = Number(item.acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Wasting spend", tone: "danger" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" };
  if (sales > 0) return { label: "Profitable", tone: "good" };
  return { label: "No spend yet", tone: "inactive" };
}

function emptyCopy(search: string, stateFilter: StateFilter) {
  if (search.trim()) return { title: "No matching campaigns", subtitle: "Try a different name." };
  if (stateFilter === "enabled") return { title: "No active campaigns", subtitle: "Try All or Paused." };
  if (stateFilter === "paused") return { title: "No paused campaigns", subtitle: "Try All or Active." };
  return { title: "No campaigns", subtitle: "None in this period." };
}

function campaignA11yLabel(item: any, verdict: { label: string }, currency: string) {
  const state = statusLabel(item.state);
  const acos = Number(item.sales) > 0 ? formatPercent(Number(item.acos)) : "not available";
  const spend = formatCurrency(Number(item.spend) || 0, currency);
  const orders = formatInt(Number(item.orders) || 0);
  return `${item.name}, ${state}, ${verdict.label}, ACoS ${acos}, Spend ${spend}, ${orders} orders`;
}

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type StateFilter = "all" | "enabled" | "paused";
type SortKey = "top" | "spend" | "orders" | "acos";

const SORT_CONFIG: { key: SortKey; label: string }[] = [
  { key: "top", label: "ROAS" },
  { key: "spend", label: "Spend" },
  { key: "orders", label: "Orders" },
  { key: "acos", label: "ACoS" },
];

export default function CampaignsScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer } = useApp();
  const invalidateAds = useInvalidateAds();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("top");
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: number } | null>(null);

  const { data: campaigns = [], isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["campaigns-list-range", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopCampaignsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        limit: 500,
        filterUserId: adminFilterUserId,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const filtered = useMemo(() => {
    let arr = campaigns.filter((c) => {
      if (!shouldShowActiveOrPausedWithData(c as any, c.state)) return false;
      if (stateFilter !== "all" && c.state !== stateFilter) return false;
      if (search) return c.name.toLowerCase().includes(search.toLowerCase());
      return true;
    });
    return [...arr].sort((a, b) => {
      switch (sortKey) {
        case "spend":   return b.spend - a.spend;
        case "orders":  return b.orders - a.orders;
        case "acos":    return (a.acos || Infinity) - (b.acos || Infinity);
        default:        return b.roas - a.roas;
      }
    });
  }, [campaigns, search, stateFilter, sortKey]);

  function animateList() {
    if (reduceMotion) return;
    LayoutAnimation.configureNext({
      duration: 280,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
  }

  function applySort(key: SortKey) {
    if (key === sortKey) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setSortKey(key);
  }

  function applyStateFilter(f: StateFilter) {
    if (f === stateFilter) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setStateFilter(f);
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const sortLabel = SORT_CONFIG.find((entry) => entry.key === sortKey)?.label ?? "ROAS";
  const sortActive = sortKey !== "top";
  const empty = emptyCopy(search, stateFilter);
  const showCount = search.trim().length > 0 || stateFilter !== "all" || sortActive;

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Campaigns" />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see your campaigns."}
          action={isAdminViewer ? undefined : { label: "Connect account", onPress: () => router.push("/more/accounts") }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Campaigns" />

      <FilterChrome>
        <View style={styles.searchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="campaigns-search"
              placeholder="Search campaigns"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            testID="campaigns-filter-btn"
            accessibilityRole="button"
            accessibilityLabel={sortActive ? `Sort: ${sortLabel}` : "Sort campaigns"}
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
          testID="campaigns-state-segments"
          value={stateFilter}
          onChange={applyStateFilter}
          options={[
            { key: "all", label: "All", testID: "filter-state-all" },
            { key: "enabled", label: "Active", testID: "filter-state-enabled" },
            { key: "paused", label: "Paused", testID: "filter-state-paused" },
          ]}
        />
        {sortActive ? (
          <View style={styles.activeFilters}>
            <TouchableOpacity
              testID="campaigns-filter-chip-sort"
              accessibilityRole="button"
              accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
              onPress={() => applySort("top")}
              style={[styles.filterChip, { backgroundColor: t.colors.tone_primary + "14" }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                Sort: {sortLabel}
              </Text>
              <SFSymbol name="xmark" size={10} color={t.colors.tone_primary} />
            </TouchableOpacity>
          </View>
        ) : null}
        {showCount && !isLoading && !isError ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 campaign" : `${filtered.length} campaigns`}
          </Text>
        ) : null}
      </FilterChrome>

      {isLoading ? (
        <ScreenSpinner />
      ) : isError && campaigns.length === 0 ? (
        <RetryState
          title="Campaigns failed to load"
          subtitle="Check your connection and try again."
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: t.layout.listGap }} />}
          ListEmptyComponent={<EmptyState icon="megaphone-outline" title={empty.title} subtitle={empty.subtitle} />}
          renderItem={({ item }) => {
            const colorKey = bookColorKeyFor(item);
            const campaignColor = colorKey ? fallbackBookColor(colorKey) : t.colors.tone_primary;
            const verdict = campaignVerdict(item);
            const strategy = biddingStrategyLabel(item.bidding_strategy);
            return (
              <AnimatedCard
                key={item.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/campaign/${item.id}`);
                }}
                testID={`campaign-row-${item.id}`}
                accessibilityLabel={campaignA11yLabel(item, verdict, primaryCurrency)}
              >
                <ListCard accent={campaignColor}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[t.typography.headline, { color: t.colors.text_primary }]}
                        numberOfLines={2}
                      >
                        {item.name}
                      </Text>
                      <View style={styles.metaRow}>
                        <ToneDot value={item.acos} />
                        <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
                          {verdict.label}
                        </Text>
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{strategy}</Text>
                      </View>
                    </View>
                    <View onStartShouldSetResponder={() => true}>
                      <EntityStateSwitch
                        enabled={item.state === "enabled"}
                        noun="campaign"
                        testID={`campaign-state-${item.id}`}
                        onChange={async (next) => {
                          await updateCampaignState(item.id, next ? "enabled" : "paused");
                          await invalidateAds(["campaign-api", "campaign"]);
                        }}
                      />
                    </View>
                  </View>

                  <View style={styles.campaignMeta}>
                    <View onStartShouldSetResponder={() => true}>
                      <TouchableOpacity
                        testID={`campaign-budget-${item.id}`}
                        accessibilityLabel={
                          item.budget != null
                            ? `Daily budget ${formatCurrency(Number(item.budget), primaryCurrency)}. Edit budget.`
                            : "No budget. Edit budget."
                        }
                        activeOpacity={0.7}
                        onPress={() => setBudgetEdit({ id: item.id, value: Number(item.budget) || 0 })}
                      >
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                          {item.budget != null
                            ? `${formatCurrency(Number(item.budget), primaryCurrency, { compact: true })}/day`
                            : "No budget"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <PlacementSharePills item={item} t={t} />
                  </View>

                  <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]}>
                    <MetricStrip
                      items={[
                        {
                          label: "ACoS",
                          value: item.sales > 0 ? formatPercent(item.acos) : "—",
                          color: toneColor(acosTone(item.acos), t.colors),
                        },
                        { label: "Spend", value: formatCurrency(item.spend, primaryCurrency, { compact: true }) },
                        { label: "Sales", value: formatCurrency(item.sales, primaryCurrency, { compact: true }) },
                        { label: "Orders", value: formatInt(item.orders) },
                      ]}
                    />
                  </View>
                </ListCard>
              </AnimatedCard>
            );
          }}
        />
      )}

      <BidBudgetEditor
        visible={budgetEdit != null}
        title="Daily budget"
        value={budgetEdit?.value ?? 0}
        currency={primaryCurrency}
        kind="money"
        testID={budgetEdit ? `campaign-budget-editor-${budgetEdit.id}` : undefined}
        onClose={() => setBudgetEdit(null)}
        onSave={async (next) => {
          if (!budgetEdit) return;
          await updateCampaign(budgetEdit.id, { budget: next });
          await invalidateAds(["campaign-api", "campaign"]);
          await refetch();
        }}
      />

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
    </SafeAreaView>
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
          testID="campaigns-filter-done"
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
          testID="campaigns-sort-segments"
          value={sortKey}
          onChange={onSort}
          options={SORT_CONFIG.map((sc) => ({ key: sc.key, label: sc.label, testID: `filter-sort-${sc.key}` }))}
        />
      </View>
    </>
  );
}

function AnimatedCard({
  children,
  onPress,
  testID,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        activeOpacity={1}
        onPressIn={() => {
          if (reduceMotion) return;
          Animated.spring(scale, { toValue: 0.968, useNativeDriver: true, damping: 20, stiffness: 450 }).start();
        }}
        onPressOut={() => {
          if (reduceMotion) return;
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 320 }).start();
        }}
        onPress={onPress}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

function PlacementSharePills({ item, t }: { item: any; t: any }) {
  const shares = [
    { label: "Top", value: Number(item.placement_top_share ?? 0), color: t.colors.tone_warning },
    { label: "Product", value: Number(item.placement_product_share ?? 0), color: t.colors.tone_placement },
    { label: "Rest", value: Number(item.placement_rest_share ?? 0), color: t.colors.tone_good },
  ].filter((row) => row.value > 0);

  if (!shares.length) return null;

  return (
    <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, flexShrink: 1 }]} numberOfLines={1}>
      {shares.map((row) => `${row.label} ${formatPercent(row.value, 0)}`).join(" · ")}
    </Text>
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
  campaignMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metricsRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
