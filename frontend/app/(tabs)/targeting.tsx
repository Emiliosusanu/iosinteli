import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Platform,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import { fetchKeywords, fetchProductTargets, fetchTopCampaignsRange } from "@/src/lib/queries";
import { shouldShowActiveOrPausedWithData } from "@/src/lib/campaigns";
import {
  describeProductTarget,
  extractTargetAsin,
  fallbackAsinCoverUrl,
  isCategoryTarget,
} from "@/src/lib/targeting";
import {
  fetchCampaignApi,
  updateCampaign,
  updateKeywordManual,
  updateProductTargetManual,
  type PlacementAdjustments,
} from "@/src/lib/mutations";
import { alertMutationError, BidBudgetEditor, EntityStateSwitch, MutationTap } from "@/src/components/Mutations";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, ToneDot, RetryState, MetricStrip, FilterChrome, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { enabledSpoken, matchTypeSpoken, targetingSpeech } from "@/src/lib/targetingA11y";

type Segment = "keywords" | "asins" | "auto" | "category" | "placement";
type SortKey = "spend" | "acos" | "orders";
type PerfFilter = "all" | "wasting" | "high_acos" | "no_sales" | "profitable";
type PlacementField = "top_of_search" | "product_pages" | "rest_of_search";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "keywords", label: "Keywords" },
  { key: "asins", label: "ASINs" },
  { key: "auto", label: "Auto" },
  { key: "category", label: "Cat" },
  { key: "placement", label: "Place" },
];

const PERF_FILTERS: { key: PerfFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wasting", label: "Waste" },
  { key: "high_acos", label: "ACOS" },
  { key: "no_sales", label: "$0" },
  { key: "profitable", label: "Profit" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "acos", label: "ACoS" },
  { key: "orders", label: "Orders" },
];

const PLACEMENT_FIELDS: { key: PlacementField; label: string; title: string }[] = [
  { key: "top_of_search", label: "Top", title: "Top of search" },
  { key: "product_pages", label: "Product", title: "Product pages" },
  { key: "rest_of_search", label: "Rest", title: "Rest of search" },
];

function rowMetrics(item: any) {
  return {
    spend: Number(item.total_spend ?? item.spend) || 0,
    sales: Number(item.total_sales ?? item.sales) || 0,
    orders: Number(item.total_orders ?? item.orders) || 0,
    acos: Number(item.total_acos ?? item.acos) || 0,
  };
}

function matchesPerf(item: any, filter: PerfFilter) {
  if (filter === "all") return true;
  const { spend, sales, orders, acos } = rowMetrics(item);
  if (filter === "wasting") return spend > 0 && orders === 0;
  if (filter === "high_acos") return acos > 35;
  if (filter === "no_sales") return sales === 0;
  return sales > 0;
}

function searchPlaceholder(segment: Segment) {
  if (segment === "keywords") return "Search keywords";
  if (segment === "auto") return "Search auto targets";
  if (segment === "category") return "Search categories";
  if (segment === "placement") return "Search campaigns";
  return "Search ASINs";
}

function emptyCopy(segment: Segment) {
  if (segment === "keywords") return { icon: "search-outline" as const, title: "No keywords found" };
  if (segment === "auto") return { icon: "sparkles-outline" as const, title: "No auto targets found" };
  if (segment === "category") return { icon: "pricetags-outline" as const, title: "No category targets found" };
  if (segment === "placement") return { icon: "layers-outline" as const, title: "No campaigns found" };
  return { icon: "cube-outline" as const, title: "No ASIN targets found" };
}

function ResponderBox({ children }: { children: React.ReactNode }) {
  return (
    <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()}>
      {children}
    </View>
  );
}

export default function TargetingScreen() {
  const t = useTheme();
  const router = useRouter();
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer } = useApp();
  const [segment, setSegment] = useState<Segment>("keywords");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("spend");
  const [perf, setPerf] = useState<PerfFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [placementAdj, setPlacementAdj] = useState<Record<string, PlacementAdjustments>>({});
  const [moneyEditor, setMoneyEditor] = useState<{
    entity: "keyword" | "target";
    id: string;
    title: string;
    value: number;
  } | null>(null);
  const [percentEditor, setPercentEditor] = useState<{
    id: string;
    title: string;
    field: PlacementField;
    value: number;
  } | null>(null);

  const keywordsQ = useQuery({
    queryKey: ["targeting-keywords", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchKeywords(selectedProfileIds, { start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: selectedProfileIds.length > 0 && segment === "keywords",
  });

  const productsQ = useQuery({
    queryKey: ["targeting-products", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchProductTargets(selectedProfileIds, { start: dateRange.start, end: dateRange.end, filterUserId: adminFilterUserId }),
    enabled: selectedProfileIds.length > 0 && (segment === "asins" || segment === "auto" || segment === "category"),
  });

  const placementsQ = useQuery({
    queryKey: ["targeting-placements", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopCampaignsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        limit: 500,
        filterUserId: adminFilterUserId,
      }),
    enabled: selectedProfileIds.length > 0 && segment === "placement",
  });

  const data = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows: any[] = [];

    if (segment === "keywords") {
      rows = (keywordsQ.data ?? [])
        .filter((k) => shouldShowActiveOrPausedWithData(k as any, k.status))
        .filter((k) => (needle ? (k.keyword_text ?? "").toLowerCase().includes(needle) : true));
    } else if (segment === "placement") {
      rows = (placementsQ.data ?? [])
        .filter((c) => shouldShowActiveOrPausedWithData(c as any, c.state))
        .filter((c) => (needle ? (c.name ?? "").toLowerCase().includes(needle) : true));
    } else {
      rows = (productsQ.data ?? [])
        .filter((p) => shouldShowActiveOrPausedWithData(p as any, p.state))
        .filter((p) => {
          const described = describeProductTarget(p.expression, p.expression_type);
          const category = isCategoryTarget(p.expression, p.expression_type);
          if (segment === "auto") return described.isAuto;
          if (segment === "category") return category;
          return !described.isAuto && !category;
        })
        .filter((p) => {
          if (!needle) return true;
          const described = describeProductTarget(p.expression, p.expression_type);
          return (
            (p.title ?? "").toLowerCase().includes(needle) ||
            described.label.toLowerCase().includes(needle) ||
            described.asin.toLowerCase().includes(needle) ||
            extractTargetAsin(p.expression).toLowerCase().includes(needle)
          );
        });
    }

    rows = rows.filter((row) => matchesPerf(row, perf));

    const effectiveSort = sort ?? "spend";
    return [...rows].sort((a: any, b: any) => {
      const aHas = rowMetrics(a).spend > 0 ? 1 : 0;
      const bHas = rowMetrics(b).spend > 0 ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (effectiveSort === "acos") return (rowMetrics(a).acos || Infinity) - (rowMetrics(b).acos || Infinity);
      if (effectiveSort === "orders") return rowMetrics(b).orders - rowMetrics(a).orders;
      return rowMetrics(b).spend - rowMetrics(a).spend;
    });
  }, [segment, search, sort, perf, keywordsQ.data, productsQ.data, placementsQ.data]);

  const activeQuery = segment === "keywords" ? keywordsQ : segment === "placement" ? placementsQ : productsQ;
  const isLoading = activeQuery.isLoading;
  const isError = activeQuery.isError;
  const isRefetching = activeQuery.isRefetching;

  const onRefresh = async () => {
    setRefreshing(true);
    await activeQuery.refetch();
    setRefreshing(false);
  };

  const openPlacementEditor = async (item: any, field: PlacementField) => {
    try {
      let adj = placementAdj[item.id];
      if (!adj) {
        const api = await fetchCampaignApi(item.id);
        adj = api.placementAdjustments ?? {};
        setPlacementAdj((prev) => ({ ...prev, [item.id]: adj! }));
      }
      const meta = PLACEMENT_FIELDS.find((entry) => entry.key === field);
      setPercentEditor({
        id: item.id,
        title: meta?.title ?? "Placement",
        field,
        value: Number(adj[field] ?? 0),
      });
    } catch (error) {
      alertMutationError(error, "Couldn't load placement bids.");
    }
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Targets" />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see targets."}
        />
      </SafeAreaView>
    );
  }

  const empty = emptyCopy(segment);
  const perfLabel = PERF_FILTERS.find((entry) => entry.key === perf)?.label ?? "All";
  const sortLabel = SORT_OPTIONS.find((entry) => entry.key === sort)?.label ?? "Spend";
  const filtersActive = perf !== "all" || sort !== "spend";
  const filterSummary = [
    perf !== "all" ? perfLabel : null,
    sort !== "spend" ? `Sort: ${sortLabel}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Targets" />

      <FilterChrome>
        <IOSSegmentedControl
          testID="targeting-segments"
          value={segment}
          onChange={setSegment}
          options={SEGMENTS.map((s) => ({ key: s.key, label: s.label, testID: `segment-${s.key}` }))}
        />
        <View style={styles.searchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="targeting-search"
              placeholder={searchPlaceholder(segment)}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity
            testID="targeting-filter-btn"
            accessibilityRole="button"
            accessibilityLabel={filtersActive ? `Filters: ${filterSummary}` : "Filters and sort"}
            accessibilityHint="Opens performance and sort options"
            onPress={() => setFilterOpen(true)}
            hitSlop={4}
            style={[
              styles.filterBtn,
              {
                backgroundColor: filtersActive ? t.colors.tone_primary + "18" : t.colors.background_tertiary,
              },
            ]}
          >
            <SFSymbol
              name="slider.horizontal.3"
              size={16}
              color={filtersActive ? t.colors.tone_primary : t.colors.text_secondary}
            />
            {filtersActive ? (
              <View style={[styles.filterDot, { backgroundColor: t.colors.tone_primary }]} />
            ) : null}
          </TouchableOpacity>
        </View>
        {filtersActive ? (
          <View style={styles.activeFilters}>
            {perf !== "all" ? (
              <TouchableOpacity
                testID="targeting-filter-chip-perf"
                accessibilityRole="button"
                accessibilityLabel={`Clear ${perfLabel} filter`}
                onPress={() => setPerf("all")}
                style={[styles.filterChip, { backgroundColor: t.colors.tone_primary + "14" }]}
              >
                <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "600" }]}>{perfLabel}</Text>
                <SFSymbol name="xmark" size={10} color={t.colors.tone_primary} />
              </TouchableOpacity>
            ) : null}
            {sort !== "spend" ? (
              <TouchableOpacity
                testID="targeting-filter-chip-sort"
                accessibilityRole="button"
                accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
                onPress={() => setSort("spend")}
                style={[styles.filterChip, { backgroundColor: t.colors.tone_primary + "14" }]}
              >
                <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                  Sort: {sortLabel}
                </Text>
                <SFSymbol name="xmark" size={10} color={t.colors.tone_primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </FilterChrome>

      {isLoading ? (
        <ScreenSpinner />
      ) : isError ? (
        <RetryState
          title={
            segment === "keywords"
              ? "Keywords failed to load"
              : segment === "auto"
                ? "Auto targets failed to load"
                : segment === "category"
                  ? "Category targets failed to load"
                  : segment === "placement"
                    ? "Campaigns failed to load"
                    : "Product targets failed to load"
          }
          subtitle="Check your connection and try again."
          onRetry={() => {
            void activeQuery.refetch();
          }}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          initialNumToRender={18}
          maxToRenderPerBatch={24}
          windowSize={9}
          removeClippedSubviews={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: t.layout.listGap }} />}
          ListEmptyComponent={
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              subtitle={
                segment === "auto"
                  ? undefined
                  : perf !== "all"
                    ? "Try a different filter."
                    : undefined
              }
            />
          }
          renderItem={({ item }: any) =>
            segment === "keywords" ? (
              <KeywordRow
                item={item}
                currency={primaryCurrency}
                t={t}
                onPress={() => router.push(`/keyword/${item.id}` as Href)}
                onEditBid={() =>
                  setMoneyEditor({
                    entity: "keyword",
                    id: item.id,
                    title: item.keyword_text ?? "Keyword bid",
                    value: Number(item.bid_amount) || 0,
                  })
                }
              />
            ) : segment === "placement" ? (
              <PlacementRow
                item={item}
                currency={primaryCurrency}
                t={t}
                adjustments={placementAdj[item.id]}
                onPress={() => router.push(`/campaign/${item.id}`)}
                onEdit={(field) => void openPlacementEditor(item, field)}
              />
            ) : (
              <ProductTargetRow
                item={item}
                currency={primaryCurrency}
                t={t}
                onPress={() => router.push(`/target/${item.id}` as Href)}
                onEditBid={() =>
                  setMoneyEditor({
                    entity: "target",
                    id: item.id,
                    title: item.title || describeProductTarget(item.expression, item.expression_type).label,
                    value: Number(item.bid) || 0,
                  })
                }
              />
            )
          }
        />
      )}

      <BidBudgetEditor
        visible={moneyEditor != null}
        title={moneyEditor?.title ?? "Bid"}
        value={moneyEditor?.value ?? 0}
        currency={primaryCurrency}
        testID={moneyEditor ? `targeting-bid-editor-${moneyEditor.id}` : undefined}
        onClose={() => setMoneyEditor(null)}
        onSave={async (next) => {
          if (!moneyEditor) return;
          if (moneyEditor.entity === "keyword") {
            await updateKeywordManual(moneyEditor.id, { bid: next });
          } else {
            await updateProductTargetManual(moneyEditor.id, { bid: next });
          }
          await invalidateAds();
        }}
      />

      <BidBudgetEditor
        visible={percentEditor != null}
        title={percentEditor?.title ?? "Placement"}
        value={percentEditor?.value ?? 0}
        kind="percent"
        min={0}
        max={900}
        testID={percentEditor ? `targeting-placement-editor-${percentEditor.id}` : undefined}
        onClose={() => setPercentEditor(null)}
        onSave={async (next) => {
          if (!percentEditor) return;
          const current = placementAdj[percentEditor.id] ?? {};
          const payload: PlacementAdjustments = {
            top_of_search: current.top_of_search ?? 0,
            product_pages: current.product_pages ?? 0,
            rest_of_search: current.rest_of_search ?? 0,
            [percentEditor.field]: next,
          };
          await updateCampaign(percentEditor.id, { placementAdjustments: payload });
          setPlacementAdj((prev) => ({ ...prev, [percentEditor.id]: payload }));
          await invalidateAds();
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
            <FilterSheetFields t={t} perf={perf} sort={sort} onPerf={setPerf} onSort={setSort} onDone={() => setFilterOpen(false)} />
          </View>
        ) : (
          <Pressable style={[styles.filterOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setFilterOpen(false)}>
            <Pressable
              style={[styles.filterSheetAndroid, { backgroundColor: t.colors.background_secondary }]}
              onPress={(event) => event.stopPropagation()}
            >
              <FilterSheetFields t={t} perf={perf} sort={sort} onPerf={setPerf} onSort={setSort} onDone={() => setFilterOpen(false)} />
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </SafeAreaView>
  );
}

function FilterSheetFields({
  t,
  perf,
  sort,
  onPerf,
  onSort,
  onDone,
}: {
  t: any;
  perf: PerfFilter;
  sort: SortKey;
  onPerf: (next: PerfFilter) => void;
  onSort: (next: SortKey) => void;
  onDone: () => void;
}) {
  return (
    <>
      <View style={styles.filterSheetHeader}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Filter</Text>
        <TouchableOpacity
          testID="targeting-filter-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          accessibilityHint="Closes filters and sort"
          onPress={onDone}
          hitSlop={spacing.sm}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterSheetBody}>
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: t.spacing.sm }]}>
          Performance
        </Text>
        <IOSSegmentedControl
          testID="targeting-perf-segments"
          value={perf}
          onChange={onPerf}
          options={PERF_FILTERS.map((f) => ({ key: f.key, label: f.label, testID: `targeting-perf-${f.key}` }))}
        />
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.sm },
          ]}
        >
          Sort
        </Text>
        <IOSSegmentedControl
          testID="targeting-sort-segments"
          value={sort}
          onChange={onSort}
          options={SORT_OPTIONS.map((option) => ({ key: option.key, label: option.label }))}
        />
      </View>
    </>
  );
}

function keywordStatus(item: any): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  const sales = Number(item.total_sales) || 0;
  const acos = Number(item.total_acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" };
  if (sales > 0) return { label: "Profitable", tone: "good" };
  return { label: "No spend yet", tone: "inactive" };
}

function KeywordRow({
  item,
  currency,
  t,
  onPress,
  onEditBid,
}: {
  item: any;
  currency: string;
  t: any;
  onPress: () => void;
  onEditBid: () => void;
}) {
  const invalidateAds = useInvalidateAds();
  const status = keywordStatus(item);
  const sales = Number(item.total_sales) || 0;
  const rowLabel = targetingSpeech([
    item.keyword_text ?? "Keyword",
    matchTypeSpoken(item.match_type),
    status.label,
    enabledSpoken(item.status === "enabled"),
    `ACoS ${sales > 0 ? formatPercent(Number(item.total_acos)) : "not available"}`,
    `Spend ${formatCurrency(Number(item.total_spend) || 0, currency)}`,
  ]);
  return (
    <ListCard testID={`keywords-row-${item.id}`}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessible
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        accessibilityHint="Opens keyword details"
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[t.typography.headline, { color: t.colors.text_primary }]}
              numberOfLines={1}
            >
              {item.keyword_text ?? "—"}
            </Text>
            <View style={styles.metaRow}>
              <ToneDot value={Number(item.total_acos)} />
              <Text style={[t.typography.caption1, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
                {status.label}
              </Text>
              {item.match_type ? (
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{item.match_type}</Text>
              ) : null}
            </View>
          </View>
        </View>
        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator, marginTop: t.spacing.md, paddingTop: t.spacing.md }]}>
          <MetricStrip
            items={[
              { label: "Spend", value: formatCurrency(Number(item.total_spend), currency, { compact: true }) },
              { label: "Sales", value: formatCurrency(Number(item.total_sales), currency, { compact: true }) },
              { label: "Orders", value: formatInt(Number(item.total_orders)) },
              {
                label: "ACoS",
                value: Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "—",
                color: toneColor(acosTone(Number(item.total_acos)), t.colors),
              },
            ]}
          />
        </View>
      </TouchableOpacity>
      <ResponderBox>
        <View style={styles.actionsRow}>
          <EntityStateSwitch
            testID={`targeting-state-${item.id}`}
            enabled={item.status === "enabled"}
            noun="keyword"
            onChange={async (next) => {
              await updateKeywordManual(item.id, { status: next ? "enabled" : "paused" });
              await invalidateAds();
            }}
          />
          <MutationTap
            testID={`targeting-bid-${item.id}`}
            label="Bid"
            value={item.bid_amount ? formatCurrency(Number(item.bid_amount), currency) : "—"}
            onPress={onEditBid}
          />
        </View>
      </ResponderBox>
    </ListCard>
  );
}

function ProductTargetRow({
  item,
  currency,
  t,
  onPress,
  onEditBid,
}: {
  item: any;
  currency: string;
  t: any;
  onPress: () => void;
  onEditBid: () => void;
}) {
  const invalidateAds = useInvalidateAds();
  const [coverFailed, setCoverFailed] = useState(false);
  const target = describeProductTarget(item.expression, item.expression_type);
  const coverUrl = !coverFailed ? item.image_url || fallbackAsinCoverUrl(target.asin) : null;
  const displayTitle = item.title || (target.isAuto ? target.label : target.asin || target.label);
  const accent = target.asin ? fallbackBookColor(bookColorKeyFor({ asin: target.asin })) : toneColor(target.tone, t.colors);
  const sales = Number(item.total_sales) || 0;
  const rowLabel = targetingSpeech([
    displayTitle,
    target.label,
    keywordStatus(item).label,
    enabledSpoken(item.state === "enabled"),
    `ACoS ${sales > 0 ? formatPercent(Number(item.total_acos)) : "not available"}`,
    `Spend ${formatCurrency(Number(item.total_spend) || 0, currency)}`,
  ]);

  return (
    <ListCard testID={`products-row-${item.id}`} accent={accent}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessible
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        accessibilityHint="Opens target details"
      >
        <View style={styles.cardHeader}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.cover, { backgroundColor: accent + "14", borderColor: accent + "44" }]}
          >
            {coverUrl ? (
              <Image
                source={{ uri: coverUrl }}
                style={styles.coverImg}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
                recyclingKey={target.asin || item.id}
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <SFSymbol name={target.isAuto ? "sparkles" : target.asin ? "book" : "cube"} size={22} color={accent} />
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[t.typography.headline, { color: t.colors.text_primary }]}
              numberOfLines={2}
            >
              {displayTitle}
            </Text>
            <View style={styles.metaRow}>
              <ToneDot value={Number(item.total_acos)} />
              <Text style={[t.typography.caption1, { color: toneColor(target.tone, t.colors) }]}>{target.label}</Text>
              {target.asin ? (
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]} numberOfLines={1}>
                  {target.asin}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator, marginTop: t.spacing.md, paddingTop: t.spacing.md }]}>
          <MetricStrip
            items={[
              { label: "Spend", value: formatCurrency(Number(item.total_spend), currency, { compact: true }) },
              { label: "Sales", value: formatCurrency(Number(item.total_sales), currency, { compact: true }) },
              { label: "Orders", value: formatInt(Number(item.total_orders)) },
              {
                label: "ACoS",
                value: Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "—",
                color: toneColor(acosTone(Number(item.total_acos)), t.colors),
              },
            ]}
          />
        </View>
      </TouchableOpacity>
      <ResponderBox>
        <View style={styles.actionsRow}>
          <EntityStateSwitch
            testID={`targeting-state-${item.id}`}
            enabled={item.state === "enabled"}
            noun="target"
            onChange={async (next) => {
              await updateProductTargetManual(item.id, { state: next ? "enabled" : "paused" });
              await invalidateAds();
            }}
          />
          <MutationTap
            testID={`targeting-bid-${item.id}`}
            label="Bid"
            value={item.bid ? formatCurrency(Number(item.bid), currency) : "—"}
            onPress={onEditBid}
          />
        </View>
      </ResponderBox>
    </ListCard>
  );
}

function PlacementRow({
  item,
  currency,
  t,
  adjustments,
  onPress,
  onEdit,
}: {
  item: any;
  currency: string;
  t: any;
  adjustments?: PlacementAdjustments;
  onPress: () => void;
  onEdit: (field: PlacementField) => void;
}) {
  return (
    <ListCard testID={`placement-row-${item.id}`}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessible
        accessibilityRole="button"
        accessibilityLabel={targetingSpeech([
          item.name ?? "Campaign",
          "Placement",
          `Spend ${formatCurrency(Number(item.spend) || 0, currency)}`,
        ])}
        accessibilityHint="Opens campaign details"
      >
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={2}>
          {item.name ?? "Campaign"}
        </Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 4 }]}>
          {formatCurrency(Number(item.spend), currency, { compact: true })} spend
        </Text>
      </TouchableOpacity>
      <ResponderBox>
        <View style={styles.placementTaps}>
          {PLACEMENT_FIELDS.map((field) => (
            <MutationTap
              key={field.key}
              testID={`targeting-placement-${field.key}-${item.id}`}
              label={field.label}
              value={adjustments ? formatPercent(Number(adjustments[field.key] ?? 0), 0) : "—"}
              onPress={() => onEdit(field.key)}
            />
          ))}
        </View>
      </ResponderBox>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  cardHeader: { flexDirection: "row", alignItems: "center" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.xs,
  },
  metricsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.sm },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    gap: spacing.md,
  },
  placementTaps: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cover: {
    width: layout.coverWidth,
    height: layout.coverHeight,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginRight: spacing.md,
    flexShrink: 0,
  },
  coverImg: { width: layout.coverWidth, height: layout.coverHeight },
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  filterSheet: {
    flex: 1,
  },
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
    gap: spacing.xxs,
  },
});
