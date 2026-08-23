import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
  ActionSheetIOS,
  RefreshControl,
  Modal,
  Pressable,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { alertMutationError } from "@/src/components/Mutations";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { acosTone, layout, radii, spacing, toneColor, useReduceMotion, useTheme } from "@/src/lib/theme";
import { addSearchTermAsTarget, negateSearchTerm } from "@/src/lib/mutations";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { SIGN_IN_TO_MUTATE_MESSAGE } from "@/src/lib/rulesApi";
import { fetchSearchTerms } from "@/src/lib/queries";
import { formatCurrency, formatInt, formatPercent } from "@/src/lib/format";
import type { SearchTerm } from "@/src/lib/types";
import { EmptyState, ListCard, MetricStrip, FilterChrome, RetryState, ScreenSpinner, ToneDot } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SortKey = "acos" | "orders" | "spend" | "sales";
type PerformanceFilter = "all" | "converting" | "wasted";
type AddMatch = "exact" | "phrase" | "broad";
type NegateMatch = "negativeExact" | "negativePhrase";

const SORT_CONFIG: { key: SortKey; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "acos", label: "ACoS" },
  { key: "spend", label: "Spend" },
  { key: "sales", label: "Sales" },
];

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function searchTermLooksTargeted(item: any): boolean {
  if (truthyFlag(item?.targeted) || truthyFlag(item?.is_targeted) || truthyFlag(item?.has_target)) return true;
  const status = String(item?.status ?? item?.state ?? "").toLowerCase();
  return status === "targeted" || status.includes("targeted");
}

export function searchTermLooksNegated(item: any): boolean {
  if (truthyFlag(item?.negated) || truthyFlag(item?.has_negative) || truthyFlag(item?.hasNegative)) return true;
  const status = String(item?.status ?? item?.state ?? "").toLowerCase();
  return status === "negated" || status.includes("negat");
}

function guardGuest(guestMode: boolean): boolean {
  if (!guestMode) return true;
  Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
  return false;
}

function presentChoices(title: string, message: string, options: { label: string; onPress: () => void }[]) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [...options.map((option) => option.label), "Cancel"],
        cancelButtonIndex: options.length,
      },
      (buttonIndex) => {
        if (buttonIndex == null || buttonIndex >= options.length) return;
        options[buttonIndex].onPress();
      },
    );
    return;
  }
  Alert.alert(title, message, [
    ...options.map((option) => ({ text: option.label, onPress: option.onPress })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

export function promptAddSearchTerm(args: {
  guestMode: boolean;
  id: string;
  term: string;
  onSuccess: () => Promise<void> | void;
}) {
  if (!guardGuest(args.guestMode)) return;
  presentChoices("Add as keyword", `Add “${args.term}” with which match type?`, [
    { label: "Exact", onPress: () => confirmNegateSource("exact") },
    { label: "Phrase", onPress: () => confirmNegateSource("phrase") },
    { label: "Broad", onPress: () => confirmNegateSource("broad") },
  ]);

  function confirmNegateSource(matchType: AddMatch) {
    Alert.alert("Also negate source?", `Add “${args.term}” as ${matchType}. Also negate the source term?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Add only", onPress: () => void runAdd(matchType, false) },
      { text: "Also negate source", onPress: () => void runAdd(matchType, true) },
    ]);
  }

  async function runAdd(matchType: AddMatch, negateInSource: boolean) {
    try {
      const result = await addSearchTermAsTarget(args.id, { matchType, negateInSource });
      Alert.alert("Added", result?.message ?? "Added as a keyword.");
      await args.onSuccess();
    } catch (error) {
      alertMutationError(error, "Couldn't add that search term.");
    }
  }
}

export function promptNegateSearchTerm(args: {
  guestMode: boolean;
  id: string;
  term: string;
  onSuccess: () => Promise<void> | void;
}) {
  if (!guardGuest(args.guestMode)) return;
  presentChoices("Negate", `Negate “${args.term}” as…`, [
    { label: "Negative exact", onPress: () => void runNegate("negativeExact") },
    { label: "Negative phrase", onPress: () => void runNegate("negativePhrase") },
  ]);

  async function runNegate(matchType: NegateMatch) {
    try {
      const result = await negateSearchTerm(args.id, { matchType });
      Alert.alert("Negated", result?.message ?? "Search term negated.");
      await args.onSuccess();
    } catch (error) {
      alertMutationError(error, "Couldn't negate that search term.");
    }
  }
}

function termVerdict(item: SearchTerm): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  if (searchTermLooksNegated(item)) return { label: "Negated", tone: "danger" };
  if (searchTermLooksTargeted(item)) return { label: "Already a keyword", tone: "good" };
  if (spend > 0 && orders === 0) return { label: "No orders", tone: "danger" };
  if (orders > 0) return { label: "Converting", tone: "good" };
  return { label: "No spend yet", tone: "inactive" };
}

function emptyCopy(search: string, perfFilter: PerformanceFilter) {
  if (search.trim()) return { title: "No matching search terms", subtitle: "Try a different term, campaign, or ad group." };
  if (perfFilter === "converting") return { title: "No converting terms", subtitle: "None in this period have orders. Try All." };
  if (perfFilter === "wasted") return { title: "No wasted spend", subtitle: "No terms spent without orders in this period. Try All." };
  return { title: "No search terms in this period", subtitle: "None for the selected dates." };
}

function termA11yLabel(item: SearchTerm, verdict: { label: string }, currency: string) {
  const term = item.search_term || "Search term";
  const acos = Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "not available";
  const spend = formatCurrency(Number(item.total_spend) || 0, currency);
  const orders = formatInt(Number(item.total_orders) || 0);
  return `${term}. ${verdict.label}. Spend ${spend}. ${orders} orders. ACoS ${acos}`;
}

function contextCaption(item: SearchTerm) {
  const campaign = item.campaign_name || "Campaign";
  return item.ad_group_name ? `${campaign} · ${item.ad_group_name}` : campaign;
}

export default function SearchTermsScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { guestMode } = useAuth();
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange } = useApp();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("orders");
  const [perfFilter, setPerfFilter] = useState<PerformanceFilter>("all");
  const [sortOpen, setSortOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data = [], isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["search-terms", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchSearchTerms(selectedProfileIds, { start: dateRange.start, end: dateRange.end }),
    enabled: selectedProfileIds.length > 0,
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const arr = data.filter((item) => {
      if (
        needle &&
        !`${item.search_term ?? ""} ${item.campaign_name ?? ""} ${item.ad_group_name ?? ""}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (perfFilter === "converting") return Number(item.total_orders) > 0;
      if (perfFilter === "wasted") return Number(item.total_spend) > 0 && Number(item.total_orders) === 0;
      return true;
    });

    return [...arr].sort((a, b) => {
      const aHasData = Number(a.total_spend) > 0;
      const bHasData = Number(b.total_spend) > 0;
      if (aHasData && !bHasData) return -1;
      if (!aHasData && bHasData) return 1;

      switch (sortKey) {
        case "acos":
          return (Number(a.total_acos) || Infinity) - (Number(b.total_acos) || Infinity);
        case "spend":
          return Number(b.total_spend) - Number(a.total_spend);
        case "sales":
          return Number(b.total_sales) - Number(a.total_sales);
        default:
          return Number(b.total_orders) - Number(a.total_orders);
      }
    });
  }, [data, search, sortKey, perfFilter]);

  function animateList() {
    if (reduceMotion) return;
    LayoutAnimation.configureNext({
      duration: 280,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
  }

  function applySort(next: SortKey) {
    if (next === sortKey) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setSortKey(next);
  }

  function applyPerf(next: PerformanceFilter) {
    if (next === perfFilter) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateList();
    setPerfFilter(next);
  }

  const refreshTerms = useCallback(() => invalidateAds(["search-terms"]), [invalidateAds]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openTerm = useCallback(
    (item: SearchTerm) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({
        pathname: "/search-term/[id]",
        params: {
          id: item.id,
          term: item.search_term ?? "",
          campaign: item.campaign_name ?? "",
          adGroup: item.ad_group_name ?? "",
        },
      });
    },
    [router],
  );

  const onAdd = useCallback(
    (item: SearchTerm) => {
      promptAddSearchTerm({
        guestMode,
        id: item.id,
        term: item.search_term ?? "search term",
        onSuccess: refreshTerms,
      });
    },
    [guestMode, refreshTerms],
  );

  const onNegate = useCallback(
    (item: SearchTerm) => {
      promptNegateSearchTerm({
        guestMode,
        id: item.id,
        term: item.search_term ?? "search term",
        onSuccess: refreshTerms,
      });
    },
    [guestMode, refreshTerms],
  );

  const sortLabel = SORT_CONFIG.find((entry) => entry.key === sortKey)?.label ?? "Orders";
  const sortActive = sortKey !== "orders";
  const showCount = search.trim().length > 0 || perfFilter !== "all" || sortActive;
  const empty = emptyCopy(search, perfFilter);
  const listLoading = isLoading && data.length === 0;
  const listFailed = isError && data.length === 0;

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Search Terms" showDateRange>
        <EmptyState
          icon="business-outline"
          title="No account connected"
          subtitle="Connect an Amazon account to see search terms."
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title="Search Terms" showDateRange>
      <FilterChrome>
        <View style={styles.searchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="search-terms-search"
              placeholder="Search terms"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            testID="search-terms-sort-btn"
            accessibilityRole="button"
            accessibilityLabel={sortActive ? `Sort: ${sortLabel}` : "Sort search terms"}
            accessibilityHint="Opens sort options"
            onPress={() => setSortOpen(true)}
            style={[
              styles.sortBtn,
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
            {sortActive ? <View style={[styles.sortDot, { backgroundColor: t.colors.tone_primary }]} /> : null}
          </TouchableOpacity>
        </View>
        <IOSSegmentedControl
          testID="search-terms-perf-segments"
          value={perfFilter}
          onChange={applyPerf}
          options={[
            { key: "all", label: "All" },
            { key: "converting", label: "Converting" },
            { key: "wasted", label: "No orders" },
          ]}
        />
        {sortActive ? (
          <View style={styles.activeFilters}>
            <TouchableOpacity
              testID="search-terms-sort-chip"
              accessibilityRole="button"
              accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
              onPress={() => applySort("orders")}
              style={[styles.filterChip, { backgroundColor: t.colors.tone_primary + "14" }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                Sort: {sortLabel}
              </Text>
              <SFSymbol name="xmark" size={10} color={t.colors.tone_primary} />
            </TouchableOpacity>
          </View>
        ) : null}
        {showCount && !listLoading && !listFailed ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 search term" : `${filtered.length} search terms`}
          </Text>
        ) : null}
      </FilterChrome>

      {listLoading ? (
        <ScreenSpinner />
      ) : listFailed ? (
        <RetryState
          title="Search terms failed to load"
          subtitle="Check your connection and try again."
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: 60 }}
          initialNumToRender={18}
          maxToRenderPerBatch={24}
          windowSize={9}
          removeClippedSubviews={Platform.OS !== "ios"}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: t.layout.listGap }} />}
          ListEmptyComponent={<EmptyState icon="search-outline" title={empty.title} subtitle={empty.subtitle} />}
          renderItem={({ item }) => (
            <TermRow item={item} currency={primaryCurrency} onOpen={openTerm} onAdd={onAdd} onNegate={onNegate} />
          )}
        />
      )}

      <Modal
        visible={sortOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setSortOpen(false)}
      >
        {Platform.OS === "ios" ? (
          <View style={[styles.filterSheet, { backgroundColor: t.colors.background_secondary }]}>
            <SortSheetBody t={t} sortKey={sortKey} onSort={applySort} onDone={() => setSortOpen(false)} />
          </View>
        ) : (
          <Pressable style={[styles.filterOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setSortOpen(false)}>
            <Pressable
              style={[styles.filterSheetAndroid, { backgroundColor: t.colors.background_secondary }]}
              onPress={(event) => event.stopPropagation()}
            >
              <SortSheetBody t={t} sortKey={sortKey} onSort={applySort} onDone={() => setSortOpen(false)} />
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </SubScreen>
  );
}

const TermRow = React.memo(function TermRow({
  item,
  currency,
  onOpen,
  onAdd,
  onNegate,
}: {
  item: SearchTerm;
  currency: string;
  onOpen: (item: SearchTerm) => void;
  onAdd: (item: SearchTerm) => void;
  onNegate: (item: SearchTerm) => void;
}) {
  const t = useTheme();
  const verdict = termVerdict(item);
  const alreadyTargeted = searchTermLooksTargeted(item);
  const alreadyNegated = searchTermLooksNegated(item);
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  const addPrimary = !alreadyTargeted && orders > 0;
  const negatePrimary = !alreadyNegated && spend > 0 && orders === 0;

  return (
    <ListCard testID={`search-term-row-${item.id}`}>
      <TouchableOpacity
        testID={`search-term-open-${item.id}`}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={termA11yLabel(item, verdict, currency)}
        accessibilityHint="Opens search term details"
        onPress={() => onOpen(item)}
        style={{ minHeight: t.layout.minTap }}
      >
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={3}>
          {item.search_term || "Untitled term"}
        </Text>
        <View style={styles.metaRow}>
          <ToneDot value={Number(item.total_acos) || 0} />
          <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
            {verdict.label}
          </Text>
          {item.match_type || item.term_type ? (
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]} numberOfLines={1}>
              {item.match_type || item.term_type}
            </Text>
          ) : null}
        </View>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 4 }]} numberOfLines={1}>
          {contextCaption(item)}
        </Text>
        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
          <MetricStrip
            items={[
              {
                label: "ACoS",
                value: Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "—",
                color: toneColor(acosTone(Number(item.total_acos)), t.colors),
              },
              { label: "Spend", value: formatCurrency(Number(item.total_spend), currency, { compact: true }) },
              { label: "Orders", value: formatInt(Number(item.total_orders)) },
              { label: "Sales", value: formatCurrency(Number(item.total_sales), currency, { compact: true }) },
            ]}
          />
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          testID={`search-term-add-${item.id}`}
          disabled={alreadyTargeted}
          accessibilityRole="button"
          accessibilityLabel={alreadyTargeted ? "Already added as a keyword" : `Add ${item.search_term || "search term"} as keyword`}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAdd(item);
          }}
          style={[
            styles.actionBtn,
            {
              backgroundColor: addPrimary ? t.colors.tone_good + "22" : t.colors.background_tertiary,
              opacity: alreadyTargeted ? 0.45 : 1,
            },
          ]}
        >
          <SFSymbol name="plus.circle" size={16} color={addPrimary ? t.colors.tone_good : t.colors.text_secondary} />
          <Text
            style={[
              t.typography.footnote,
              { fontWeight: "600", color: addPrimary ? t.colors.tone_good : t.colors.text_secondary },
            ]}
          >
            {alreadyTargeted ? "Already added" : "Add as keyword"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID={`search-term-negate-${item.id}`}
          disabled={alreadyNegated}
          accessibilityRole="button"
          accessibilityLabel={alreadyNegated ? "Already negated" : `Negate ${item.search_term || "search term"}`}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onNegate(item);
          }}
          style={[
            styles.actionBtn,
            {
              backgroundColor: negatePrimary ? t.colors.tone_danger + "18" : t.colors.background_tertiary,
              opacity: alreadyNegated ? 0.45 : 1,
            },
          ]}
        >
          <SFSymbol name="minus.circle" size={16} color={negatePrimary ? t.colors.tone_danger : t.colors.text_secondary} />
          <Text
            style={[
              t.typography.footnote,
              { fontWeight: "600", color: negatePrimary ? t.colors.tone_danger : t.colors.text_secondary },
            ]}
          >
            {alreadyNegated ? "Already negated" : "Negate"}
          </Text>
        </TouchableOpacity>
      </View>
    </ListCard>
  );
});

function SortSheetBody({
  t,
  sortKey,
  onSort,
  onDone,
}: {
  t: ReturnType<typeof useTheme>;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  onDone: () => void;
}) {
  return (
    <>
      <View style={styles.filterSheetHeader}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Sort</Text>
        <TouchableOpacity
          testID="search-terms-sort-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onDone}
          style={styles.sheetDone}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterSheetBody}>
        <IOSSegmentedControl
          testID="search-terms-sort-segments"
          value={sortKey}
          onChange={onSort}
          options={SORT_CONFIG.map((entry) => ({
            key: entry.key,
            label: entry.label,
            testID: `filter-sort-${entry.key}`,
          }))}
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
  sortBtn: {
    width: layout.minTap,
    height: layout.minTap,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sortDot: {
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
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap",
  },
  metricsRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 10,
    alignSelf: "stretch",
    width: "100%",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    minHeight: layout.minTap,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 10,
    gap: 4,
  },
});
