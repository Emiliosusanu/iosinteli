import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { AppScreen } from "@/src/components/ScreenAmbient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { fetchTopCampaignsRange, type TopCampaignRow } from "@/src/lib/queries";
import {
  BIDDING_STRATEGY_OPTIONS,
  biddingStrategyLabel,
  isDynamicBiddingStrategy,
  matchesEntityStateFilter,
  normalizeBiddingStrategyCode,
  shouldShowActiveOrPausedWithData,
  statusLabel,
  type BiddingStrategyCode,
} from "@/src/lib/campaigns";
import { getCampaignSettingsCooldown } from "@/src/lib/bidCooldown";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, toneColor, useReduceMotion, dashboard, spacing, layout } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import {
  fetchCampaignApi,
  prefetchCampaignPlacementAdjustments,
  updateCampaign,
  updateCampaignState,
  type PlacementAdjustments,
} from "@/src/lib/mutations";
import { applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { TopBar } from "@/src/components/TopBar";
import {
  alertMutationError,
  assertNotViewingAsOtherUser,
  BidBudgetEditor,
  blockIfCannotWriteAmazon,
  EntityStateSwitch,
  MutationTap,
} from "@/src/components/Mutations";
import { EmptyState, RetryState, DenseMetricLine, FilterChrome, FilterSearchRow, FilterIconButton, ActiveFilterChip, ActiveFilterRow, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { withQueryTimeout } from "@/src/lib/queryTimeout";
import { takePendingQaFilters } from "@/src/lib/qaCommand";
import { compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { loadCampaignsFilterMemory, saveCampaignsFilterMemory } from "@/src/lib/filterMemory";
import {
  LIST_PERIOD_QUERY_CACHE,
  sortedProfileIds,
} from "@/src/lib/periodQuery";
import { countriesForSponsoredCampaign, marketplaceFlagsA11y } from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { CampaignMarketplaceFlags } from "@/src/components/MarketplaceFlags";

type PlacementField = keyof PlacementAdjustments;

const PLACEMENT_FIELDS: { key: PlacementField; label: string; title: string }[] = [
  { key: "top_of_search", label: "Top", title: "Top of search" },
  { key: "product_pages", label: "Product", title: "Product pages" },
  { key: "rest_of_search", label: "Rest", title: "Rest of search" },
];

function campaignVerdict(item: any): { label: string; tone: "good" | "warning" | "danger" | "inactive"; direction: "up" | "down" | "flat" } {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  const sales = Number(item.sales) || 0;
  const acos = Number(item.acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Wasting spend", tone: "danger", direction: "down" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning", direction: "down" };
  if (sales > 0) return { label: "Profitable", tone: "good", direction: "up" };
  return { label: "No spend yet", tone: "inactive", direction: "flat" };
}

function emptyCopy(search: string, stateFilter: StateFilter) {
  if (search.trim()) return { title: "No matching campaigns", subtitle: undefined as string | undefined };
  if (stateFilter === "enabled") return { title: "No active campaigns", subtitle: undefined as string | undefined };
  if (stateFilter === "paused") return { title: "No paused campaigns", subtitle: undefined as string | undefined };
  return { title: "No campaigns", subtitle: undefined as string | undefined };
}

function campaignA11yLabel(item: any, verdict: { label: string }, currency: string, marketplaceLabel?: string | null) {
  const state = statusLabel(item.state);
  const acos = Number(item.sales) > 0 ? formatPercent(Number(item.acos)) : "not available";
  const spend = formatCurrency(Number(item.spend) || 0, currency);
  const orders = formatInt(Number(item.orders) || 0);
  return [item.name, marketplaceLabel, state, verdict.label, `ACoS ${acos}`, `Spend ${spend}`, `${orders} orders`]
    .filter(Boolean)
    .join(", ");
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

function CampaignsListSeparator() {
  const t = useTheme();
  return <View style={{ height: t.layout.listGap }} />;
}

export default function CampaignsScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reduceMotion = useReduceMotion();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer, entityCooldownHours } = useApp();
  const marketplaceIndex = useSponsoredMarketplaceIndex();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };
  const invalidateAds = useInvalidateAds();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("enabled");
  const [sortKey, setSortKey] = useState<SortKey>("acos");
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: number } | null>(null);
  const [placementAdj, setPlacementAdj] = useState<Record<string, PlacementAdjustments>>({});
  const [placementEdit, setPlacementEdit] = useState<{
    id: string;
    field: PlacementField;
    title: string;
    value: number;
  } | null>(null);
  const [strategyEdit, setStrategyEdit] = useState<{
    id: string;
    name: string;
    strategy: string | null;
  } | null>(null);

  useEffect(() => {
    const qa = takePendingQaFilters();
    if (qa) {
      if (qa.campaignsState) setStateFilter(qa.campaignsState);
      if (qa.campaignsSort) setSortKey(qa.campaignsSort);
      if (qa.campaignsState || qa.campaignsSort) {
        console.log(
          `[inteliads:qa] campaigns filters state=${qa.campaignsState ?? "-"} sort=${qa.campaignsSort ?? "-"}`,
        );
      }
      return;
    }
    void loadCampaignsFilterMemory().then((mem) => {
      if (mem.stateFilter === "all" || mem.stateFilter === "enabled" || mem.stateFilter === "paused") {
        setStateFilter(mem.stateFilter);
      }
      if (mem.sortKey && SORT_CONFIG.some((s) => s.key === mem.sortKey)) {
        setSortKey(mem.sortKey as SortKey);
      }
    });
  }, []);

  useEffect(() => {
    void saveCampaignsFilterMemory({ sortKey, stateFilter });
  }, [sortKey, stateFilter]);

  const scopeProfiles = useMemo(() => sortedProfileIds(selectedProfileIds), [selectedProfileIds]);
  const campaignsListKey = [
    "campaigns-list-range-v3",
    adminFilterUserId ?? "self",
    scopeProfiles,
    dateRange.start,
    dateRange.end,
    primaryCurrency,
  ] as const;

  const {
    data: campaigns = [],
    isPending,
    isError,
    isRefetching,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: campaignsListKey,
    queryFn: ({ signal }) =>
      withQueryTimeout(
        fetchTopCampaignsRange({
          profileIds: scopeProfiles,
          start: dateRange.start,
          end: dateRange.end,
          limit: 0,
          filterUserId: adminFilterUserId,
        }),
        undefined,
        signal,
      ),
    enabled: scopeProfiles.length > 0,
    ...LIST_PERIOD_QUERY_CACHE,
    // Never warm from Overview top-80 — that painted a spend-biased subset as the full list.
    placeholderData: undefined,
    retry: false,
  });

  const showBlockingSpinner = (isPending || !!isPlaceholderData) && campaigns.length === 0;
  const listUpdating = (isFetching || !!isPlaceholderData) && campaigns.length > 0 && !isError;

  const filtered = useMemo(() => {
    let arr = campaigns.filter((c) => {
      if (!shouldShowActiveOrPausedWithData(c as any, c.state)) return false;
      if (stateFilter !== "all" && !matchesEntityStateFilter(c.state, stateFilter)) return false;
      if (search) return c.name.toLowerCase().includes(search.toLowerCase());
      return true;
    });
    return [...arr].sort((a, b) => {
      switch (sortKey) {
        case "spend":
          return b.spend - a.spend;
        case "orders":
          return b.orders - a.orders;
        case "top":
          return b.roas - a.roas;
        case "acos":
        default:
          return compareByAcosSpendImpressionsSync(
            {
              total_acos: a.acos,
              total_spend: a.spend,
              total_sales: a.sales,
              total_impressions: a.impressions,
              metrics_updated_at: (a as any).metrics_updated_at,
              updated_at: (a as any).updated_at,
            },
            {
              total_acos: b.acos,
              total_spend: b.spend,
              total_sales: b.sales,
              total_impressions: b.impressions,
              metrics_updated_at: (b as any).metrics_updated_at,
              updated_at: (b as any).updated_at,
            },
          );
      }
    });
  }, [campaigns, search, stateFilter, sortKey]);

  useEffect(() => {
    if (!filtered.length) return;
    let cancelled = false;
    const missing = filtered
      .map((row) => String(row.id || ""))
      .filter((id) => id && placementAdj[id] == null)
      .slice(0, 40);
    if (!missing.length) return;
    void prefetchCampaignPlacementAdjustments(missing).then((map) => {
      if (cancelled || !Object.keys(map).length) return;
      setPlacementAdj((prev) => ({ ...map, ...prev }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

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

  const openPlacementEditor = async (item: TopCampaignRow, field: PlacementField) => {
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    try {
      let adj = placementAdj[item.id];
      if (!adj) {
        const api = await fetchCampaignApi(item.id);
        adj = api.placementAdjustments ?? {};
        setPlacementAdj((prev) => ({ ...prev, [item.id]: adj! }));
      }
      const meta = PLACEMENT_FIELDS.find((entry) => entry.key === field);
      Haptics.selectionAsync();
      setPlacementEdit({
        id: item.id,
        field,
        title: meta?.title ?? "Placement",
        value: Number(adj[field] ?? 0),
      });
    } catch (error) {
      alertMutationError(error, "Couldn't load placement bids.");
    }
  };

  const sortLabel = SORT_CONFIG.find((entry) => entry.key === sortKey)?.label ?? "ACoS";
  const sortActive = sortKey !== "acos";
  const empty = emptyCopy(search, stateFilter);
  const showCount = search.trim().length > 0 || stateFilter !== "enabled" || sortActive;

  if (selectedProfileIds.length === 0) {
    return (
      <AppScreen>
        <TopBar title="Campaigns" />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see your campaigns."}
          action={isAdminViewer ? undefined : { label: "Connect account", onPress: () => router.push("/more/accounts") }}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <TopBar title="Campaigns" />

      <FilterChrome>
        <FilterSearchRow>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="campaigns-search"
              placeholder="Search campaigns"
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <FilterIconButton
            testID="campaigns-filter-btn"
            active={sortActive}
            accessibilityLabel={sortActive ? `Sort: ${sortLabel}` : "Sort campaigns"}
            accessibilityHint="Opens sort options"
            onPress={() => setFilterOpen(true)}
          />
        </FilterSearchRow>
        <IOSSegmentedControl
          testID="campaigns-state-segments"
          value={stateFilter}
          onChange={applyStateFilter}
          options={[
            { key: "enabled", label: "Active", testID: "filter-state-enabled" },
            { key: "paused", label: "Paused", testID: "filter-state-paused" },
            { key: "all", label: "All", testID: "filter-state-all" },
          ]}
        />
        {sortActive ? (
          <ActiveFilterRow>
            <ActiveFilterChip
              testID="campaigns-filter-chip-sort"
              label={`Sort: ${sortLabel}`}
              accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
              onPress={() => applySort("acos")}
            />
          </ActiveFilterRow>
        ) : null}
        {showCount && !showBlockingSpinner && !isError ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 campaign" : `${filtered.length} campaigns`}
            {listUpdating ? " · updating" : ""}
          </Text>
        ) : null}
      </FilterChrome>

      {showBlockingSpinner ? (
        <ScreenSpinner />
      ) : isError && campaigns.length === 0 ? (
        <RetryState
          title="Couldn't load campaigns"
          subtitle="Check your connection and try again."
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "ios"}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={CampaignsListSeparator}
          ListEmptyComponent={<EmptyState icon="megaphone-outline" title={empty.title} subtitle={empty.subtitle} />}
          ListFooterComponent={null}
          // Complete period list via fetchTopCampaignsRange(limit: 0) — no silent 500 cap.
          renderItem={({ item }) => {
            const colorKey = bookColorKeyFor(item);
            const campaignColor = colorKey ? fallbackBookColor(colorKey) : t.colors.tone_primary;
            const verdict = campaignVerdict(item);
            const strategy = biddingStrategyLabel(item.bidding_strategy);
            const settingsCooldown = getCampaignSettingsCooldown(item, entityCooldownHours);
            const marketplaceCountries = countriesForSponsoredCampaign(marketplaceIndex, item);
            return (
              <AnimatedCard
                key={item.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/campaign/${item.id}`);
                }}
                onLongPress={() => {
                  if (blockIfCannotWriteAmazon(writeGuard)) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  setStrategyEdit({
                    id: item.id,
                    name: item.name,
                    strategy: item.bidding_strategy,
                  });
                }}
                delayLongPress={380}
                testID={`campaign-row-${item.id}`}
                accessibilityLabel={campaignA11yLabel(
                  item,
                  verdict,
                  primaryCurrency,
                  marketplaceFlagsA11y(marketplaceCountries),
                )}
                accessibilityHint="Long press to change bidding strategy"
              >
                <ListCard compact>
                  <View style={styles.leadRow}>
                    <View onStartShouldSetResponder={() => true} style={styles.switchWell}>
                      <EntityStateSwitch
                        enabled={item.state === "enabled"}
                        noun="campaign"
                        testID={`campaign-state-${item.id}`}
                        onChange={async (next) => {
                          assertNotViewingAsOtherUser(viewAsOtherUser);
                          const previous = applyOptimisticEntityState(queryClient, "campaign", item.id, next);
                          try {
                            await updateCampaignState(item.id, next ? "enabled" : "paused");
                            void invalidateEntityStateQueries(queryClient, "campaign");
                          } catch (error) {
                            revertOptimisticEntityState(queryClient, "campaign", item.id, previous);
                            throw error;
                          }
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.titleRow}>
                        <Text
                          style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1, minWidth: 0 }]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <CampaignMarketplaceFlags
                          index={marketplaceIndex}
                          campaign={item}
                          style={[t.typography.callout, { flexShrink: 0 }]}
                        />
                        <View onStartShouldSetResponder={() => true}>
                          <TouchableOpacity
                            testID={`campaign-budget-${item.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={
                              item.budget != null
                                ? `Daily budget ${formatCurrency(Number(item.budget), primaryCurrency)}. Double tap to edit.`
                                : "No budget set. Double tap to edit."
                            }
                            accessibilityHint="Opens the budget editor. Saving writes Amazon Ads."
                            activeOpacity={0.7}
                            onPress={() => {
                              if (blockIfCannotWriteAmazon(writeGuard)) return;
                              Haptics.selectionAsync();
                              setBudgetEdit({ id: item.id, value: Number(item.budget) || 0 });
                            }}
                            style={[
                              styles.budgetChip,
                              {
                                backgroundColor: t.colors.tone_primary + "12",
                                borderColor: t.colors.tone_primary + "44",
                              },
                            ]}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Text style={[t.typography.caption2, { color: t.colors.tone_primary, fontWeight: "600" }]}>
                                Budget
                              </Text>
                              <SFSymbol name="pencil" size={11} color={t.colors.tone_primary} />
                            </View>
                            <Text style={[t.typography.caption1, { color: t.colors.text_primary, fontWeight: "700" }]}>
                              {item.budget != null
                                ? `${formatCurrency(Number(item.budget), primaryCurrency, { compact: true })}/d`
                                : "Set…"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={styles.metaRow}>
                        <CampaignVerdictBadge verdict={verdict} t={t} />
                        <TouchableOpacity
                          testID={`campaign-strategy-${item.id}`}
                          onPress={() => {
                            if (blockIfCannotWriteAmazon(writeGuard)) return;
                            Haptics.selectionAsync();
                            setStrategyEdit({
                              id: item.id,
                              name: item.name,
                              strategy: item.bidding_strategy,
                            });
                          }}
                          hitSlop={6}
                        >
                          <Text
                            style={[
                              t.typography.caption2,
                              {
                                color: settingsCooldown.isInCooldown
                                  ? t.colors.tone_warning
                                  : isDynamicBiddingStrategy(item.bidding_strategy)
                                    ? t.colors.tone_primary
                                    : t.colors.text_secondary,
                                fontWeight: "600",
                              },
                            ]}
                          >
                            {strategy}
                            {settingsCooldown.isInCooldown ? " · Cooldown" : ""}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <DenseMetricLine
                        items={[
                          {
                            label: "ACoS",
                            value: item.sales > 0 ? formatPercent(item.acos) : "—",
                            color: toneColor(acosTone(item.acos), t.colors),
                          },
                          { label: "Spend", value: formatCurrency(item.spend, primaryCurrency, { compact: true }) },
                          { label: "Impr", value: formatInt(Number(item.impressions) || 0) },
                          { label: "Clicks", value: formatInt(Number(item.clicks) || 0) },
                          { label: "Ord", value: formatInt(item.orders) },
                        ]}
                      />
                      <PlacementSharePills
                        item={item}
                        adjustments={placementAdj[item.id]}
                        cooldown={settingsCooldown}
                        onEdit={(field) => void openPlacementEditor(item, field)}
                      />
                    </View>
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
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          await updateCampaign(budgetEdit.id, { budget: next });
          await invalidateAds(["campaign-api", "campaign"]);
          await refetch();
        }}
      />

      <BidBudgetEditor
        visible={placementEdit != null}
        title={`${placementEdit?.title ?? "Placement"} %`}
        value={placementEdit?.value ?? 0}
        kind="percent"
        min={0}
        max={900}
        testID={placementEdit ? `campaign-placement-editor-${placementEdit.id}` : undefined}
        onClose={() => setPlacementEdit(null)}
        onSave={async (next) => {
          if (!placementEdit) return;
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          // Patch only the edited field — never default missing siblings to 0.
          const payload: PlacementAdjustments = { [placementEdit.field]: next };
          await updateCampaign(placementEdit.id, { placementAdjustments: payload });
          setPlacementAdj((prev) => ({
            ...prev,
            [placementEdit.id]: { ...(prev[placementEdit.id] ?? {}), ...payload },
          }));
          await invalidateAds(["campaign-api", "campaign"]);
          await refetch();
        }}
      />

      <Modal
        visible={strategyEdit != null}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setStrategyEdit(null)}
      >
        {Platform.OS === "ios" ? (
          <View style={[styles.filterSheet, { backgroundColor: t.colors.background_secondary }]}>
            <BiddingStrategySheet
              t={t}
              campaignName={strategyEdit?.name ?? ""}
              current={strategyEdit?.strategy ?? null}
              onClose={() => setStrategyEdit(null)}
              onPick={async (code) => {
                if (!strategyEdit) return;
                if (blockIfCannotWriteAmazon(writeGuard)) return;
                try {
                  await updateCampaign(strategyEdit.id, { biddingStrategy: code });
                  setStrategyEdit(null);
                  await invalidateAds(["campaign-api", "campaign"]);
                  await refetch();
                } catch (error) {
                  alertMutationError(error, "Couldn't update bidding strategy.");
                }
              }}
            />
          </View>
        ) : (
          <Pressable style={[styles.filterOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setStrategyEdit(null)}>
            <Pressable
              style={[styles.filterSheetAndroid, { backgroundColor: t.colors.background_secondary }]}
              onPress={(event) => event.stopPropagation()}
            >
              <BiddingStrategySheet
                t={t}
                campaignName={strategyEdit?.name ?? ""}
                current={strategyEdit?.strategy ?? null}
                onClose={() => setStrategyEdit(null)}
                onPick={async (code) => {
                  if (!strategyEdit) return;
                  if (blockIfCannotWriteAmazon(writeGuard)) return;
                  try {
                    await updateCampaign(strategyEdit.id, { biddingStrategy: code });
                    setStrategyEdit(null);
                    await invalidateAds(["campaign-api", "campaign"]);
                    await refetch();
                  } catch (error) {
                    alertMutationError(error, "Couldn't update bidding strategy.");
                  }
                }}
              />
            </Pressable>
          </Pressable>
        )}
      </Modal>

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
    </AppScreen>
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

function BiddingStrategySheet({
  t,
  campaignName,
  current,
  onClose,
  onPick,
}: {
  t: any;
  campaignName: string;
  current: string | null;
  onClose: () => void;
  onPick: (code: BiddingStrategyCode) => Promise<void>;
}) {
  const currentCode = normalizeBiddingStrategyCode(current);
  const [saving, setSaving] = useState<BiddingStrategyCode | null>(null);
  return (
    <>
      <View style={styles.filterSheetHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Bidding strategy</Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]} numberOfLines={1}>
            {campaignName}
          </Text>
        </View>
        <TouchableOpacity
          testID="campaigns-strategy-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          onPress={onClose}
          hitSlop={4}
          style={styles.sheetDone}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.filterSheetBody, { gap: 10 }]}>
        {BIDDING_STRATEGY_OPTIONS.map((opt) => {
          const selected = currentCode === opt.code;
          return (
            <TouchableOpacity
              key={opt.code}
              testID={`campaign-strategy-option-${opt.code}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${opt.label}. ${opt.hint}`}
              disabled={saving != null}
              onPress={() => {
                if (selected) {
                  onClose();
                  return;
                }
                setSaving(opt.code);
                void onPick(opt.code).finally(() => setSaving(null));
              }}
              style={[
                styles.strategyOption,
                {
                  borderColor: selected ? t.colors.tone_primary : t.colors.separator,
                  backgroundColor: selected ? t.colors.tone_primary + "14" : t.colors.background_tertiary,
                },
              ]}
            >
              <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]}>
                {opt.label}
                {saving === opt.code ? "…" : ""}
              </Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>{opt.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

function AnimatedCard({
  children,
  onPress,
  onLongPress,
  delayLongPress,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        activeOpacity={1}
        delayLongPress={delayLongPress}
        onPressIn={() => {
          if (reduceMotion) return;
          Animated.spring(scale, { toValue: 0.968, useNativeDriver: true, damping: 20, stiffness: 450 }).start();
        }}
        onPressOut={() => {
          if (reduceMotion) return;
          Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 320 }).start();
        }}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

function CampaignVerdictBadge({
  verdict,
  t,
}: {
  verdict: { label: string; tone: "good" | "warning" | "danger" | "inactive"; direction: "up" | "down" | "flat" };
  t: ReturnType<typeof useTheme>;
}) {
  const col = toneColor(verdict.tone, t.colors);
  const up = verdict.direction === "up";
  const down = verdict.direction === "down";
  return (
    <View
      accessibilityLabel={verdict.label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: up ? 8 : 7,
        paddingVertical: 3,
        borderRadius: up ? 999 : 7,
        backgroundColor: up ? col + "1F" : down ? "transparent" : t.colors.background_tertiary,
        borderWidth: down ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: down ? col : "transparent",
      }}
    >
      {up ? <SFSymbol name="arrow.up.right" size={10} color={col} /> : null}
      {down ? <SFSymbol name="arrow.down.right" size={10} color={col} /> : null}
      <Text style={[t.typography.caption2, { color: col, fontWeight: "700" }]}>{verdict.label}</Text>
    </View>
  );
}

function PlacementSharePills({
  item,
  adjustments,
  cooldown,
  onEdit,
}: {
  item: any;
  adjustments?: PlacementAdjustments;
  cooldown?: ReturnType<typeof getCampaignSettingsCooldown> | null;
  onEdit: (field: PlacementField) => void;
}) {
  return (
    <View onStartShouldSetResponder={() => true} style={styles.placementTaps}>
      {PLACEMENT_FIELDS.map((field) => (
        <MutationTap
          key={field.key}
          testID={`campaign-placement-${field.key}-${item.id}`}
          label={field.label}
          compact
          value={
            adjustments
              ? adjustments[field.key] == null || !Number.isFinite(Number(adjustments[field.key]))
                ? "—"
                : formatPercent(Number(adjustments[field.key]), 0)
              : "…"
          }
          cooldown={cooldown ?? undefined}
          onPress={() => onEdit(field.key)}
        />
      ))}
    </View>
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  budgetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  placementTaps: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
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
  strategyOption: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
