import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { AppScreen } from "@/src/components/ScreenAmbient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { markPerf } from "@/src/lib/perf";
import { noPeriodPlaceholder, financialPeriodQueryKey, LIST_PERIOD_QUERY_CACHE, STABLE_SCOPED_CACHE, sortedProfileIds } from "@/src/lib/periodQuery";
import { takePendingQaFilters } from "@/src/lib/qaCommand";
import { isHomeQueryTimeout, queryStillWaiting, TARGETING_BOOK_OPTIONS_TIMEOUT_MS, TARGETING_QUERY_TIMEOUT_MS, withQueryTimeout } from "@/src/lib/queryTimeout";
import {
  fetchAdGroupDefaultBids,
  fetchMobileTargetingCatalogTail,
  fetchMobileTargetingPage,
  fetchTargetingBookOptions,
  fillMissingProductTargetTitlesFromRetail,
  isMobileTargetingSnapshotChanged,
  productTargetDisplayAsin,
  type MobileTargetingSort,
  type TargetingBookOption,
} from "@/src/lib/queries";
import { TARGETING_PAGE_SIZE } from "@/src/lib/targetingPage";
import { filterTargetingBookOptions } from "@/src/lib/targetingBookFilter";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { BookMarketplaceFlags } from "@/src/components/MarketplaceFlags";
import {
  DEFAULT_TARGETING_STATE_FILTER,
  resolveTargetingStateFilter,
  type EntityStateFilter,
} from "@/src/lib/campaigns";
import {
  clampAmazonBid,
  dismissNotFoundPermanentBulkFailures,
  dismissPermanentBulkFailures,
  drainBulkOutbox,
  enqueueBulkAmazonWrites,
  enqueueEntityBidWrite,
  getBulkOutboxSnapshot,
  isBulkWritableTargetingRow,
  listPermanentFailEntityIds,
  loadBulkSelectionMemory,
  requeuePermanentBulkFailures,
  saveBulkSelectionMemory,
  type BulkEntityKind,
  type EnqueueBulkInput,
} from "@/src/lib/bulkOutbox";
import {
  buildNestBulkItemsFromInputs,
  collectFailedEntityIds,
  collectNotFoundFailIds,
  collectPermanentFailIds,
  collectPermanentFailMessages,
  collectSkippedEntityIds,
  dismissCompletedNestBulkFailures,
  getNestBulkJobsSnapshot,
  listNestPermanentFailEntityIds,
  refreshOpenNestBulkJobs,
  resubmitFailedNestBulkJobs,
  submitNestBulkManual,
  trackNestBulkJob,
} from "@/src/lib/nestBulkJobs";
import {
  bulkFailureAlertBody,
  bulkFailureAlertTitle,
  classifyBulkFailureSource,
  nestBulkConfirmedSucceeded,
  nestBulkRevertPlan,
  nestBulkSkipAlert,
  shouldRevertNestBulkEntity,
} from "@/src/lib/bulkOutboxContract";
import {
  describeProductTarget,
  fallbackAsinCoverUrl,
  formatMatchTypeLabel,
  isCategoryTarget,
  isExactMatchType,
  isUsableBookTitle,
  productTargetHeading,
  readTargetBid,
} from "@/src/lib/targeting";
import {
  loadTargetingFilterMemory,
  saveTargetingFilterMemory,
} from "@/src/lib/filterMemory";
import {
  applyBidDeltaPercent,
  applyBidDeltaUsd,
  BID_CHANGE_CONFIRM_PCT,
  countActiveAdvancedFilters,
  EMPTY_TARGETING_ADVANCED_FILTERS,
  hasActiveAdvancedFilters,
  normalizeTargetingAdvancedFilters,
  parseFilterRangeInput,
  requiresBidChangeConfirm,
  resolveTargetingSortKey,
  advancedFiltersForSegment,
  rowMetricsFromEntity,
  type TargetingAdvancedFilters,
  type TargetingSortKey,
} from "@/src/lib/targetingFilters";
import {
  fetchCampaignApi,
  prefetchCampaignPlacementAdjustments,
  updateCampaign,
  updateKeywordManual,
  updateProductTargetManual,
  type PlacementAdjustments,
} from "@/src/lib/mutations";
import {
  alertMutationError,
  assertNotViewingAsOtherUser,
  BidBudgetEditor,
  blockIfCannotWriteAmazon,
  EntityStateSwitch,
  MutationTap,
} from "@/src/components/Mutations";
import {
  formatCooldownRemaining,
  getPlacementAdjCooldown,
  getEntityBidCooldown,
  type EntityBidCooldownFields,
} from "@/src/lib/bidCooldown";
import { applyOptimisticEntityBid, applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityBid, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, acosTone, dashboard, density, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt, formatOptionalPercent } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, RetryState, DenseMetricLine, FilterSearchRow, FilterIconButton, ActiveFilterChip, ActiveFilterRow, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import {
  TargetingModePills,
  type TargetingModeKey,
} from "@/src/components/TargetingModePills";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { rowCurrencyOfProfile } from "@/src/lib/accountsUi";
import { enabledSpoken, matchTypeSpoken, targetingSpeech } from "@/src/lib/targetingA11y";
import { type Href, useRouter } from "expo-router";

type Segment = TargetingModeKey;

function rowDisplayName(segment: Segment, row: any): string {
  if (segment === "keywords") return String(row?.keyword_text || row?.id || "Keyword");
  if (segment === "placement") return String(row?.name || row?.id || "Campaign");
  return String(
    row?.title ||
      productTargetHeading(row) ||
      describeProductTarget(row?.expression, row?.expression_type).label ||
      row?.id ||
      "Target",
  );
}

function selectedCooldownSummary(
  segment: Segment,
  selectedIds: string[],
  rows: any[],
  cooldownHours?: number,
): { count: number; labels: string[]; remainingHint: string } {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const labels: string[] = [];
  let maxRemaining = 0;
  for (const id of selectedIds) {
    const row = byId.get(String(id)) as EntityBidCooldownFields | undefined;
    if (!row) continue;
    const info = getEntityBidCooldown(row, cooldownHours);
    if (!info.isInCooldown) continue;
    labels.push(rowDisplayName(segment, row));
    maxRemaining = Math.max(maxRemaining, info.remainingSeconds);
  }
  return {
    count: labels.length,
    labels,
    remainingHint: maxRemaining > 0 ? formatCooldownRemaining(maxRemaining) : "",
  };
}

type SortKey = TargetingSortKey;
type PerfFilter =
  | "all"
  | "wasting"
  | "high_acos"
  | "low_acos"
  | "no_sales"
  | "profitable"
  | "has_clicks"
  | "has_orders"
  | "has_impressions";
type PlacementField = "top_of_search" | "product_pages" | "rest_of_search";
type BulkDeltaMode = "increase_usd" | "decrease_usd" | "increase_pct" | "decrease_pct";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "keywords", label: "Keywords" },
  { key: "asins", label: "ASINs" },
  { key: "auto", label: "Auto" },
  { key: "category", label: "Category" },
  { key: "placement", label: "Placement" },
];

const PERF_FILTERS: { key: PerfFilter; label: string; hint: string }[] = [
  { key: "all", label: "All", hint: "No performance preset" },
  { key: "wasting", label: "Waste", hint: "Spend with no orders" },
  { key: "high_acos", label: "ACoS high", hint: "ACoS above ~35%" },
  { key: "low_acos", label: "ACoS low", hint: "ACoS at or under 20%" },
  { key: "no_sales", label: "No sales", hint: "Spend, zero sales" },
  { key: "profitable", label: "Profit", hint: "Sales and ACoS at or under 35%" },
  { key: "has_clicks", label: "Clicks", hint: "At least 1 click" },
  { key: "has_orders", label: "Orders", hint: "At least 1 order" },
  { key: "has_impressions", label: "Impr", hint: "At least 1 impression" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "acos", label: "ACoS" },
  { key: "bid", label: "Bid" },
  { key: "spend", label: "Spend" },
  { key: "orders", label: "Orders" },
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impr" },
];

const PLACEMENT_FIELDS: { key: PlacementField; label: string; title: string }[] = [
  { key: "top_of_search", label: "Top of search", title: "Top of search bid adjustment" },
  { key: "product_pages", label: "Product pages", title: "Product pages bid adjustment" },
  { key: "rest_of_search", label: "Rest of search", title: "Rest of search bid adjustment" },
];

function rowMetrics(item: any) {
  return rowMetricsFromEntity(item, null);
}

export function normalizePlacementCampaignMetrics(row: any) {
  return {
    ...row,
    total_spend: row.total_spend ?? row.spend,
    total_impressions: row.total_impressions ?? row.impressions,
    total_clicks: row.total_clicks ?? row.clicks,
    total_orders: row.total_orders ?? row.orders,
    total_sales: row.total_sales ?? row.sales,
    total_acos: row.total_acos ?? row.acos,
  };
}

/** Nest campaigns omit book_* — fill from product_ads book map without inventing covers. */
export function enrichPlacementRowWithBook(
  row: any,
  bookByCampaignId: Map<string, { asin: string; title: string; image_url: string | null }>,
) {
  const id = String(row?.id || "");
  const linked = id ? bookByCampaignId.get(id) : undefined;
  const asin =
    String(row.book_asin || linked?.asin || "")
      .trim()
      .toUpperCase() || null;
  const title = String(row.book_title || linked?.title || "").trim() || null;
  const image = String(row.book_image_url || linked?.image_url || "").trim() || null;
  return {
    ...row,
    book_asin: asin,
    book_title: title,
    book_image_url: image,
  };
}

export function buildCampaignBookMap(
  books: TargetingBookOption[],
  preferredAsin?: string | null,
): Map<string, { asin: string; title: string; image_url: string | null }> {
  const map = new Map<string, { asin: string; title: string; image_url: string | null }>();
  const needle = String(preferredAsin || "")
    .trim()
    .toUpperCase();
  // Preferred book first so multi-book campaigns show the filtered ASIN cover.
  const ordered = needle
    ? [...books].sort((a, b) => {
        const aMatch = String(a.asin || "").toUpperCase() === needle ? 0 : 1;
        const bMatch = String(b.asin || "").toUpperCase() === needle ? 0 : 1;
        return aMatch - bMatch;
      })
    : books;
  for (const book of ordered) {
    const asin = String(book.asin || "")
      .trim()
      .toUpperCase();
    if (!asin) continue;
    const meta = {
      asin,
      title: String(book.title || asin).trim() || asin,
      image_url: book.image_url ? String(book.image_url).trim() : null,
    };
    for (const campaignId of book.campaignIds ?? []) {
      const id = String(campaignId || "").trim();
      if (!id) continue;
      const existing = map.get(id);
      if (!existing) {
        map.set(id, meta);
        continue;
      }
      // Prefer preferred ASIN; else prefer a row that has a real image.
      if (needle && existing.asin !== needle && asin === needle) {
        map.set(id, meta);
      } else if (!existing.image_url && meta.image_url && (!needle || existing.asin !== needle)) {
        map.set(id, meta);
      }
    }
  }
  return map;
}

function formatPlacementAdjustmentValue(
  adjustments: PlacementAdjustments | undefined,
  field: PlacementField,
): string {
  if (!adjustments) return "…";
  const raw = adjustments[field];
  if (raw == null || !Number.isFinite(Number(raw))) return "—";
  return formatPercent(Number(raw), 0);
}

function targetingMetricItems(item: any, currency: string, t: any) {
  const m = rowMetrics(item);
  return [
    {
      label: "ACoS",
      value: m.sales > 0 ? formatPercent(m.acos) : "—",
      color: toneColor(acosTone(m.acos), t.colors),
    },
    { label: "Spend", value: formatCurrency(m.spend, currency, { compact: true }) },
    { label: "Impr", value: formatInt(m.impressions) },
    { label: "Clicks", value: formatInt(m.clicks) },
    { label: "Ord", value: formatInt(m.orders) },
  ];
}

function matchesPerf(item: any, filter: PerfFilter) {
  if (filter === "all") return true;
  const { spend, sales, orders, acos, clicks, impressions } = rowMetrics(item);
  if (filter === "wasting") return spend > 0 && orders === 0;
  if (filter === "high_acos") return sales > 0 && acos > 35;
  if (filter === "low_acos") return sales > 0 && acos > 0 && acos <= 20;
  if (filter === "no_sales") return spend > 0 && sales === 0;
  if (filter === "profitable") return sales > 0 && acos > 0 && acos <= 35;
  if (filter === "has_clicks") return clicks > 0;
  if (filter === "has_orders") return orders > 0;
  if (filter === "has_impressions") return impressions > 0;
  return sales > 0;
}

function entityKindForSegment(segment: Segment): BulkEntityKind {
  if (segment === "keywords") return "keyword";
  if (segment === "placement") return "campaign";
  return "product_target";
}

function baseBidForRow(
  segment: Segment,
  item: any,
  defaultBidByAdGroupId?: Record<string, number>,
): number | null {
  if (segment === "keywords") {
    return readTargetBid(
      { bid_amount: item.bid_amount, bid: item.bid },
      item.ad_group_id ? defaultBidByAdGroupId?.[String(item.ad_group_id)] : undefined,
    );
  }
  if (segment === "placement") return null;
  return readTargetBid(
    item,
    item.ad_group_id ? defaultBidByAdGroupId?.[String(item.ad_group_id)] : undefined,
  );
}

function searchPlaceholder(segment: Segment) {
  if (segment === "keywords") return "Search keywords";
  if (segment === "auto") return "Search auto targets";
  if (segment === "category") return "Search categories";
  if (segment === "placement") return "Search campaigns";
  return "Search ASINs";
}

function emptyCopy(segment: Segment, stateFilter: EntityStateFilter = DEFAULT_TARGETING_STATE_FILTER) {
  const title =
    segment === "keywords"
      ? "No keywords"
      : segment === "auto"
        ? "No auto targets"
        : segment === "category"
          ? "No categories"
          : segment === "placement"
            ? "No campaigns"
            : "No ASINs";
  const icon =
    segment === "keywords"
      ? ("search-outline" as const)
      : segment === "auto"
        ? ("options-outline" as const)
        : segment === "category"
          ? ("pricetags-outline" as const)
          : segment === "placement"
            ? ("layers-outline" as const)
            : ("cube-outline" as const);
  if (stateFilter === "enabled") {
    return {
      icon,
      title,
      // Active = entity + ad group + campaign (fail-closed). Short hint → try All.
      subtitle: "Try All",
    };
  }
  if (stateFilter === "paused") {
    return { icon, title, subtitle: "Try All" };
  }
  return { icon, title, subtitle: undefined as string | undefined };
}

function ResponderBox({ children }: { children: React.ReactNode }) {
  return (
    <View onStartShouldSetResponder={() => true} onTouchEnd={(event) => event.stopPropagation()}>
      {children}
    </View>
  );
}

function TargetingListSeparator() {
  const t = useTheme();
  return <View style={{ height: t.layout.listGap }} />;
}

export default function TargetingScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer, entityCooldownHours, profiles } = useApp();
  const { user, guestMode } = useAuth();
  const viewAsOtherUser = Boolean(adminFilterUserId && adminFilterUserId !== user?.id);
  const writeGuard = { guestMode, viewAsOtherUser };
  const [segment, setSegment] = useState<Segment>("keywords");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("acos");
  const [perf, setPerf] = useState<PerfFilter>("all");
  const [stateFilter, setStateFilter] = useState<EntityStateFilter>(DEFAULT_TARGETING_STATE_FILTER);
  const [bookAsin, setBookAsin] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [placementAdj, setPlacementAdj] = useState<Record<string, PlacementAdjustments>>({});
  const [moneyEditor, setMoneyEditor] = useState<{
    entity: "keyword" | "target";
    id: string;
    title: string;
    value: number;
    forceCooldown?: boolean;
  } | null>(null);
  const [percentEditor, setPercentEditor] = useState<{
    id: string;
    title: string;
    field: PlacementField;
    value: number;
  } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeltaEditor, setBulkDeltaEditor] = useState<BulkDeltaMode | null>(null);
  const [advanced, setAdvanced] = useState<TargetingAdvancedFilters>({ ...EMPTY_TARGETING_ADVANCED_FILTERS });
  const [outboxPending, setOutboxPending] = useState(0);
  /** Match Campaigns: collapse TopBar + filter chrome while scrolling the list. */
  const [topChromeVisible, setTopChromeVisible] = useState(true);
  const topChromeVisibleRef = useRef(true);
  const [outboxFailed, setOutboxFailed] = useState(0);
  const [pageSnapshot, setPageSnapshot] = useState<string | null>(null);
  /** Ranked pages 2..N appended under the same snapshot — never re-sorted or invented. */
  const [catalogTail, setCatalogTail] = useState<any[]>([]);
  const [catalogTailLoading, setCatalogTailLoading] = useState(false);
  const [catalogTailIncomplete, setCatalogTailIncomplete] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    markPerf("targets.mount");
    const qa = takePendingQaFilters();
    if (qa) {
      if (qa.targetsSegment) setSegment(qa.targetsSegment);
      if (qa.targetsPerf) setPerf(qa.targetsPerf);
      if (qa.targetsSort) setSort(qa.targetsSort);
      if (qa.targetsAdvanced) {
        setAdvanced(
          normalizeTargetingAdvancedFilters({
            ...EMPTY_TARGETING_ADVANCED_FILTERS,
            ...qa.targetsAdvanced,
          }),
        );
      }
      if (qa.targetsSegment || qa.targetsPerf || qa.targetsSort || qa.targetsAdvanced) {
        const adv = qa.targetsAdvanced
          ? Object.entries(qa.targetsAdvanced)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}=${v}`)
              .join(",")
          : "-";
        console.log(
          `[inteliads:qa] targets filters segment=${qa.targetsSegment ?? "-"} perf=${qa.targetsPerf ?? "-"} sort=${qa.targetsSort ?? "-"} advanced=${adv || "-"}`,
        );
      }
      if (qa.targetsOpenFilter) {
        console.log("[inteliads:qa] targets open Filter sheet");
        setFilterOpen(true);
      }
      return;
    }
    void Promise.all([loadTargetingFilterMemory(), loadBulkSelectionMemory()]).then(([filters, sel]) => {
      const nextSegment =
        sel.segment && SEGMENTS.some((s) => s.key === sel.segment)
          ? (sel.segment as Segment)
          : filters.segment && SEGMENTS.some((s) => s.key === filters.segment)
            ? (filters.segment as Segment)
            : null;
      if (nextSegment) setSegment(nextSegment);
      if (filters.perf && PERF_FILTERS.some((s) => s.key === filters.perf)) setPerf(filters.perf as PerfFilter);
      // Remembered value wins; missing/invalid → keep Active default (do not force on empty {}).
      if ("stateFilter" in filters) {
        setStateFilter(resolveTargetingStateFilter(filters.stateFilter));
      }
      if (typeof filters.bookAsin === "string" && filters.bookAsin) setBookAsin(filters.bookAsin);
      if (filters.sort && SORT_OPTIONS.some((s) => s.key === filters.sort)) setSort(filters.sort as SortKey);
      if (filters.advanced) setAdvanced(normalizeTargetingAdvancedFilters(filters.advanced));
      if (Array.isArray(sel.ids)) setSelectedIds(sel.ids.filter((id) => typeof id === "string"));
      if (sel.selectMode) setSelectMode(true);
    });
    void refreshOutboxCounts();
    void drainBulkOutbox().then(() => refreshOutboxCounts());
    void (async () => {
      await refreshOpenNestBulkJobs();
      await refreshOutboxCounts();
    })();
  }, []);

  useEffect(() => {
    void saveTargetingFilterMemory({
      segment,
      perf,
      sort,
      bookAsin: bookAsin ?? undefined,
      stateFilter,
      advanced,
    });
  }, [segment, perf, sort, bookAsin, stateFilter, advanced]);

  useEffect(() => {
    void saveBulkSelectionMemory({ segment, ids: selectedIds, selectMode });
  }, [segment, selectedIds, selectMode]);

  async function refreshOutboxCounts() {
    const [local, nest] = await Promise.all([getBulkOutboxSnapshot(), getNestBulkJobsSnapshot()]);
    setOutboxPending(local.pending + local.inFlight + nest.pending);
    setOutboxFailed(local.failed + nest.failed);
  }

  const scopeProfiles = useMemo(() => sortedProfileIds(selectedProfileIds), [selectedProfileIds]);
  const periodKey = financialPeriodQueryKey(dateRange, scopeProfiles, primaryCurrency);
  const profileScopeKey = scopeProfiles.join("|");
  const searchNeedle = search.trim();
  const advancedForRpc = advancedFiltersForSegment(segment, advanced);
  const advancedScopeKey = JSON.stringify(advancedForRpc);
  const targetingListCache = {
    ...LIST_PERIOD_QUERY_CACHE,
    placeholderData: noPeriodPlaceholder,
  } as const;

  const adGroupDefaultBidsQ = useQuery({
    queryKey: ["targeting-adgroup-default-bids", adminFilterUserId ?? "self", profileScopeKey],
    queryFn: () => fetchAdGroupDefaultBids(scopeProfiles),
    enabled: scopeProfiles.length > 0,
    ...STABLE_SCOPED_CACHE,
  });
  const defaultBidByAdGroupId = adGroupDefaultBidsQ.data ?? {};

  const booksQ = useQuery({
    queryKey: ["targeting-book-options-v2", adminFilterUserId ?? "self", profileScopeKey],
    queryFn: ({ signal }) =>
      withQueryTimeout(
        fetchTargetingBookOptions(scopeProfiles, { filterUserId: adminFilterUserId }),
        TARGETING_BOOK_OPTIONS_TIMEOUT_MS,
        signal,
      ),
    enabled: scopeProfiles.length > 0,
    ...STABLE_SCOPED_CACHE,
  });
  const bookOptions = booksQ.data ?? [];
  const selectedBook = bookAsin ? bookOptions.find((b) => b.asin === bookAsin) ?? null : null;
  const bookFilterActive = Boolean(bookAsin);
  // Nest aggregated campaigns often omit book_asin — match via book→campaign map.
  // bookCampaignIds.has(campaignId) scope is passed as campaignIds to the RPC.
  const bookCampaignIdList = useMemo(
    () => [...new Set(selectedBook?.campaignIds ?? [])].map(String).sort(),
    [selectedBook],
  );
  const campaignBookById = useMemo(
    () => buildCampaignBookMap(bookOptions, bookAsin),
    [bookOptions, bookAsin],
  );

  // Drop a remembered book filter that isn't in the current profile set — never
  // show an empty misleading "book filter" with no matching campaigns.
  useEffect(() => {
    if (!bookAsin) return;
    if (booksQ.isLoading || booksQ.isFetching) return;
    if (!booksQ.isFetched) return;
    if (selectedBook) return;
    setBookAsin(null);
  }, [bookAsin, booksQ.isFetched, booksQ.isFetching, booksQ.isLoading, selectedBook]);

  // Scope / filter / sort / segment / period / book change: drop tail + snapshot so
  // we never paint another selection's ranking under a stale catalog.
  useEffect(() => {
    setPageSnapshot(null);
    setCatalogTail([]);
    setCatalogTailLoading(false);
    setCatalogTailIncomplete(false);
  }, [
    periodKey,
    profileScopeKey,
    bookAsin,
    adminFilterUserId,
    stateFilter,
    searchNeedle,
    perf,
    sort,
    advancedScopeKey,
    segment,
  ]);

  const effectiveSortKey = resolveTargetingSortKey(sort, advanced);
  const serverSort: MobileTargetingSort =
    effectiveSortKey === "bid" ||
    effectiveSortKey === "spend" ||
    effectiveSortKey === "orders" ||
    effectiveSortKey === "clicks" ||
    effectiveSortKey === "impressions" ||
    effectiveSortKey === "acos"
      ? effectiveSortKey
      : "acos";

  const mobilePageQueryKey = [
    "mobile-targeting-page-v1",
    adminFilterUserId ?? "self",
    // Include signed-in owner id so persisted cache cannot paint another account's rows.
    viewAsOtherUser ? "view" : user?.id ?? "anon",
    periodKey,
    profileScopeKey,
    bookAsin ?? "all",
    bookCampaignIdList.join("|"),
    segment,
    stateFilter,
    searchNeedle,
    perf,
    serverSort,
    advancedScopeKey,
    "catalog-head",
  ] as const;

  // Book filter: wait for options before enabling the page query (so we don't
  // send campaignIds:[] and paint an unscoped list). On books error, enable
  // without campaignIds so RetryState can paint — never infinite blank.
  // Don't apply book filter until options are fetched — otherwise a remembered
  // ASIN empties the list while booksQ is still loading (misleading "no matches").
  const booksPendingForFilter =
    bookFilterActive && !booksQ.isSuccess && !booksQ.isError;
  const canReadPage =
    scopeProfiles.length > 0 && (!bookFilterActive || booksQ.isSuccess || booksQ.isError);

  const mobilePageQ = useQuery({
    queryKey: mobilePageQueryKey,
    queryFn: async ({ signal }) => {
      markPerf("targets.page.start");
      try {
        const bookCampaignScope =
          bookFilterActive && booksQ.isSuccess && bookCampaignIdList.length > 0
            ? { campaignIds: bookCampaignIdList }
            : {};
        return await withQueryTimeout(
          fetchMobileTargetingPage({
            segment,
            sort: serverSort,
            page: 1,
            pageSize: TARGETING_PAGE_SIZE,
            start: dateRange.start,
            end: dateRange.end,
            profiles: scopeProfiles,
            // Keep parent ownership: view-as uses admin filter; self uses signed-in user.
            ownerId: viewAsOtherUser ? adminFilterUserId : user?.id ?? null,
            ...bookCampaignScope,
            // Active = keyword enabled + ad group enabled + campaign enabled (fail-closed).
            // ASINs / Auto / Category: Active = target + ad group + campaign enabled.
            // Placement rows are campaigns — Active = campaign enabled (no ad-group parent).
            // Paused = entity paused AND live parents (ad group + campaign enabled) — use All to see paused-under-paused.
            // RPC mobile_targeting_page_v1 enforces the same parent-chain rules server-side.
            state: stateFilter,
            search: searchNeedle,
            perf,
            advanced: advancedForRpc,
            signal,
          }),
          TARGETING_QUERY_TIMEOUT_MS,
          signal,
        );
      } finally {
        markPerf("targets.page.end");
      }
    },
    enabled: canReadPage,
    ...targetingListCache,
  });

  useEffect(() => {
    const snap = mobilePageQ.data?.snapshot;
    if (typeof snap === "string" && snap.length > 0 && snap !== pageSnapshot) {
      setPageSnapshot(snap);
    }
  }, [mobilePageQ.data?.snapshot, pageSnapshot]);

  useEffect(() => {
    if (!isMobileTargetingSnapshotChanged(mobilePageQ.error)) return;
    setPageSnapshot(null);
    setCatalogTail([]);
    setCatalogTailIncomplete(false);
  }, [mobilePageQ.error]);

  // After page-1 paints, walk remaining RPC pages under the same snapshot (no truncate).
  // Depend on stable page identity only — title patches mutate row objects via
  // setQueryData and must NOT restart / cancel catalog-tail fetches.
  const catalogHeadRef = useRef(mobilePageQ.data);
  catalogHeadRef.current = mobilePageQ.data;
  const catalogHeadSnapshot = mobilePageQ.data?.snapshot ?? null;
  const catalogHeadTotal = mobilePageQ.data?.total ?? 0;
  const catalogHeadLen = mobilePageQ.data?.rows?.length ?? 0;
  useEffect(() => {
    const head = catalogHeadRef.current;
    if (!head?.rows || mobilePageQ.isFetching) return;
    if (head.rows.length >= head.total) {
      setCatalogTail([]);
      setCatalogTailLoading(false);
      setCatalogTailIncomplete(false);
      return;
    }
    let cancelled = false;
    setCatalogTailLoading(true);
    setCatalogTailIncomplete(false);
    void (async () => {
      try {
        const tail = await fetchMobileTargetingCatalogTail({
          head,
          segment,
          sort: serverSort,
          pageSize: TARGETING_PAGE_SIZE,
          start: dateRange.start,
          end: dateRange.end,
          profiles: scopeProfiles,
          ownerId: viewAsOtherUser ? adminFilterUserId : user?.id ?? null,
          ...(bookFilterActive && booksQ.isSuccess && bookCampaignIdList.length > 0
            ? { campaignIds: bookCampaignIdList }
            : {}),
          state: stateFilter,
          search: searchNeedle,
          perf,
          advanced: advancedForRpc,
        });
        if (cancelled) return;
        setCatalogTail(tail);
        setCatalogTailLoading(false);
        setCatalogTailIncomplete(head.rows.length + tail.length < head.total);
      } catch (error) {
        if (cancelled) return;
        if (isMobileTargetingSnapshotChanged(error)) {
          setPageSnapshot(null);
          setCatalogTail([]);
          void queryClient.invalidateQueries({ queryKey: mobilePageQueryKey });
        }
        setCatalogTailLoading(false);
        setCatalogTailIncomplete(true);
        // eslint-disable-next-line no-console
        console.warn("[inteliads:targeting] catalog tail failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    catalogHeadSnapshot,
    catalogHeadTotal,
    catalogHeadLen,
    mobilePageQ.isFetching,
    segment,
    serverSort,
    dateRange.start,
    dateRange.end,
    scopeProfiles,
    viewAsOtherUser,
    adminFilterUserId,
    user?.id,
    bookFilterActive,
    bookCampaignIdList,
    stateFilter,
    searchNeedle,
    perf,
    advancedForRpc,
    mobilePageQueryKey,
    queryClient,
  ]);

  // Page load skips Amazon retail HTML (spinner hang). Fill remaining titles
  // after paint — covers already work via CDN; titles need retail for competitors.
  // Serialize waves + merge by ASIN; retry misses (never permanent one-shot blacklist).
  const retailTitleDoneRef = useRef<Set<string>>(new Set());
  const retailTitleAttemptsRef = useRef<Map<string, number>>(new Map());
  const retailTitleInFlightRef = useRef<Set<string>>(new Set());
  const retailFillBusyRef = useRef(false);
  const retailFillQueuedRef = useRef(false);
  const [retailFillKick, setRetailFillKick] = useState(0);
  const resetRetailTitleFill = () => {
    retailTitleDoneRef.current = new Set();
    retailTitleAttemptsRef.current = new Map();
    retailTitleInFlightRef.current = new Set();
    retailFillBusyRef.current = false;
    retailFillQueuedRef.current = false;
  };
  useEffect(() => {
    resetRetailTitleFill();
  }, [segment, mobilePageQ.data?.snapshot]);

  useEffect(() => {
    if (segment !== "asins" && segment !== "auto" && segment !== "category") return;
    const page = mobilePageQ.data;
    if (!page?.rows?.length) return;
    if (retailFillBusyRef.current) {
      retailFillQueuedRef.current = true;
      return;
    }
    const headRows = page.rows as any[];
    const rows = catalogTail.length ? [...headRows, ...catalogTail] : headRows;
    const RETAIL_MAX_ATTEMPTS = 3;
    const pendingAsins: string[] = [];
    for (const row of rows) {
      const asin = productTargetDisplayAsin(row);
      if (!asin || isUsableBookTitle(row.title)) continue;
      if (retailTitleDoneRef.current.has(asin)) continue;
      if (retailTitleInFlightRef.current.has(asin)) continue;
      const attempts = retailTitleAttemptsRef.current.get(asin) ?? 0;
      if (attempts >= RETAIL_MAX_ATTEMPTS) continue;
      pendingAsins.push(asin);
    }
    if (!pendingAsins.length) return;

    const profileHit = profiles.find(
      (p) =>
        scopeProfiles.includes(String((p as { id?: string }).id ?? "")) ||
        scopeProfiles.includes(String((p as { profile_id?: string }).profile_id ?? "")),
    ) as { country_code?: string; countryCode?: string } | undefined;
    const countryCode = profileHit?.country_code ?? profileHit?.countryCode ?? null;

    const wave = pendingAsins.slice(0, 80);
    for (const asin of wave) retailTitleInFlightRef.current.add(asin);
    retailFillBusyRef.current = true;
    void (async () => {
      try {
        const { rows: nextRows, filled } = await fillMissingProductTargetTitlesFromRetail(
          rows,
          {
            countryCode: countryCode ? String(countryCode) : null,
            maxAsins: 80,
          },
        );
        const titleByAsin = new Map<string, string>();
        for (const row of nextRows as any[]) {
          const asin = productTargetDisplayAsin(row);
          if (!asin || !isUsableBookTitle(row.title)) continue;
          titleByAsin.set(asin, String(row.title).trim());
        }
        for (const asin of wave) {
          retailTitleInFlightRef.current.delete(asin);
          const got = titleByAsin.has(asin);
          if (got) {
            retailTitleDoneRef.current.add(asin);
            retailTitleAttemptsRef.current.delete(asin);
          } else {
            const next = (retailTitleAttemptsRef.current.get(asin) ?? 0) + 1;
            retailTitleAttemptsRef.current.set(asin, next);
            if (next >= RETAIL_MAX_ATTEMPTS) retailTitleDoneRef.current.add(asin);
          }
        }
        if (filled > 0) {
          // Merge by ASIN into the *latest* head/tail — never replace wholesale.
          const patchTitles = (list: any[]) =>
            list.map((row) => {
              const asin = productTargetDisplayAsin(row);
              if (!asin || isUsableBookTitle(row.title)) return row;
              const title = titleByAsin.get(asin);
              return title ? { ...row, title } : row;
            });
          queryClient.setQueryData(mobilePageQueryKey, (prev: typeof page | undefined) => {
            if (!prev || prev.snapshot !== page.snapshot) return prev;
            return { ...prev, rows: patchTitles(prev.rows as any[]) };
          });
          setCatalogTail((prev) => (prev.length ? patchTitles(prev) : prev));
        }
        // Keep waving until pending ASINs are titled or exhausted.
        retailFillQueuedRef.current = true;
      } catch {
        for (const asin of wave) {
          retailTitleInFlightRef.current.delete(asin);
          const next = (retailTitleAttemptsRef.current.get(asin) ?? 0) + 1;
          retailTitleAttemptsRef.current.set(asin, next);
          if (next >= RETAIL_MAX_ATTEMPTS) retailTitleDoneRef.current.add(asin);
        }
        retailFillQueuedRef.current = true;
      } finally {
        retailFillBusyRef.current = false;
        if (retailFillQueuedRef.current) {
          retailFillQueuedRef.current = false;
          setRetailFillKick((n) => n + 1);
        }
      }
    })();
  }, [
    segment,
    catalogTail,
    mobilePageQ.data,
    mobilePageQueryKey,
    profiles,
    queryClient,
    scopeProfiles,
    retailFillKick,
  ]);

  // Display-only enrichment — do not re-filter or re-sort a server page.
  const data = useMemo(() => {
    const headRows = (mobilePageQ.data?.rows ?? []) as any[];
    const rows = catalogTail.length ? [...headRows, ...catalogTail] : headRows;
    return rows.map((row) => {
      if (segment === "placement") {
        const campaignId = String(row.campaign_id || String(row.id || "").split("::")[0] || "");
        return enrichPlacementRowWithBook(
          {
            ...normalizePlacementCampaignMetrics(row),
            id: row.id,
            campaign_id: campaignId,
            placement_key: row.placement_key,
            placement_label: row.placement_label,
            placement_share:
              row.placement_share == null || row.placement_share === "" || !Number.isFinite(Number(row.placement_share))
                ? null
                : Number(row.placement_share),
          },
          campaignBookById,
        );
      }
      if (segment === "keywords") return row;
      const described = describeProductTarget(row.expression, row.expression_type, row.resolved_expression);
      return {
        ...row,
        __targetingDescription: described,
        __targetingIsCategory: isCategoryTarget(row.expression, row.expression_type),
      };
    });
  }, [mobilePageQ.data?.rows, catalogTail, segment, campaignBookById]);

  // Prefetch real Amazon placement % (never invent 0 when Amazon returns null).
  useEffect(() => {
    if (segment !== "placement") return;
    if (!data.length) return;
    let cancelled = false;
    const missing = data
      .map((row: any) => String(row.campaign_id || String(row.id || "").split("::")[0] || ""))
      .filter((id: string) => id && placementAdj[id] == null);
    const unique = [...new Set(missing)];
    if (!unique.length) return;
    void prefetchCampaignPlacementAdjustments(unique, { concurrency: 8 }).then((map) => {
      if (cancelled || !Object.keys(map).length) return;
      setPlacementAdj((prev) => ({ ...map, ...prev }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, mobilePageQ.data?.snapshot, data.length]);

  const serverTotal = Number(mobilePageQ.data?.total ?? 0);

  const activeQuery = mobilePageQ;
  const isError = activeQuery.isError || (bookFilterActive && booksQ.isError);
  const isRefetching = activeQuery.isRefetching;

  useEffect(() => {
    const err = activeQuery.error instanceof Error ? activeQuery.error.message : activeQuery.isError ? "error" : "ok";
    console.log(
      `[inteliads:targeting] segment=${segment} period=${dateRange.start}..${dateRange.end} ` +
        `loaded=${data.length}/${mobilePageQ.data?.total ?? "-"} ` +
        `tail=${catalogTailLoading ? "loading" : catalogTailIncomplete ? "incomplete" : "ok"} ` +
        `status=${activeQuery.fetchStatus} active=${err}`,
    );
  }, [
    segment,
    dateRange.start,
    dateRange.end,
    catalogTailLoading,
    catalogTailIncomplete,
    mobilePageQ.data?.total,
    data.length,
    activeQuery.fetchStatus,
    activeQuery.isError,
    activeQuery.error,
  ]);

  // Never block the list forever on a disabled query (isPending + idle) or book
  // options that never resolve — paint empty/error instead of an infinite spinner.
  // While a remembered book filter waits on booksQ, show spinner even if the page
  // query is still disabled (canReadPage false) — otherwise FlatList flashes empty.
  const showBlockingSpinner =
    data.length === 0 &&
    !activeQuery.isPlaceholderData &&
    !isError &&
    (booksPendingForFilter ||
      (canReadPage &&
        (queryStillWaiting(activeQuery) || activeQuery.isFetching)));
  const listUpdating =
    ((activeQuery.isFetching || !!activeQuery.isPlaceholderData || catalogTailLoading) &&
      data.length > 0 &&
      !isError);

  // Honest catalog footer — server total from RPC; never invent a 500-cap story.
  const pageSummary = mobilePageQ.data
    ? catalogTailLoading && data.length < serverTotal
      ? `${data.length} of ${serverTotal} loaded`
      : catalogTailIncomplete && data.length < serverTotal
        ? `${data.length} of ${serverTotal} loaded · rest unavailable`
        : `${serverTotal} rows${listUpdating ? " · updating" : ""}`
    : null;

  // Placement list is 3 rows per campaign; Amazon writes once per campaign.
  const visibleWriteCount = useMemo(() => {
    if (segment !== "placement") return data.length;
    return new Set(
      data.map((row) => String((row as { campaign_id?: string }).campaign_id || String(row.id).split("::")[0])),
    ).size;
  }, [data, segment]);
  const selectedWriteCount = useMemo(() => {
    if (segment !== "placement") return selectedIds.length;
    return new Set(selectedIds.map((id) => id.split("::")[0])).size;
  }, [selectedIds, segment]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      resetRetailTitleFill();
      setCatalogTail([]);
      setCatalogTailIncomplete(false);
      if (bookFilterActive && booksQ.isError) await booksQ.refetch();
      else await activeQuery.refetch();
      setRetailFillKick((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const onListScroll = (event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = event.nativeEvent.contentOffset.y;
    const nextVisible = topChromeVisibleRef.current ? y < 104 : y <= 28;
    if (nextVisible === topChromeVisibleRef.current) return;
    topChromeVisibleRef.current = nextVisible;
    // Instant toggle — avoid scroll-driven layout storms during tab switches.
    setTopChromeVisible(nextVisible);
  };

  const openPlacementEditor = async (item: any, field: PlacementField) => {
    const campaignId = String(item.campaign_id || item.id || "");
    try {
      let adj = placementAdj[campaignId];
      if (!adj) {
        const api = await fetchCampaignApi(campaignId);
        adj = api.placementAdjustments ?? {};
        setPlacementAdj((prev) => ({ ...prev, [campaignId]: adj! }));
      }
      const meta = PLACEMENT_FIELDS.find((entry) => entry.key === field);
      const rawAdj = adj[field];
      const knownAdj = rawAdj == null || !Number.isFinite(Number(rawAdj)) ? Number.NaN : Number(rawAdj);
      setPercentEditor({
        id: campaignId,
        title: meta?.title ?? item.placement_label ?? "Placement",
        field,
        value: knownAdj,
      });
    } catch (error) {
      alertMutationError(error, "Couldn't load placement bids.");
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    setSelectedIds(data.map((row) => row.id));
    setSelectMode(true);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectMode(false);
  };

  const enqueueSelected = async (
    action: "pause" | "enable" | "bid_delta" | "set_bid",
    opts?: { deltaUsd?: number; nextBids?: Map<string, number> },
  ) => {
    if (!selectedIds.length) return;
    if (blockIfCannotWriteAmazon(writeGuard)) return;
    if ((action === "bid_delta" || action === "set_bid") && segment === "placement") {
      Alert.alert("Not available", "Dollar bid bulk edits apply to keywords and targets. Use placement % on each campaign, or Pause / Enable here.");
      return;
    }
    const kind = entityKindForSegment(segment);
    const byId = new Map(data.map((row) => [row.id, row]));
    const [localDead, nestDead] = await Promise.all([
      listPermanentFailEntityIds(),
      listNestPermanentFailEntityIds(),
    ]);
    const knownDeadIds = new Set([...localDead, ...nestDead]);

    // Optional harden: Paused/All + large selection — warn so sellers don't
    // silently enqueue non-Active hierarchy writes.
    const LARGE_BULK_ACTIVE_WARN = 25;
    if (
      stateFilter !== "enabled" &&
      selectedIds.length >= LARGE_BULK_ACTIVE_WARN &&
      (kind === "keyword" || kind === "product_target")
    ) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Not on Active filter",
          `You're about to queue ${selectedIds.length} changes while viewing ${
            stateFilter === "paused" ? "Paused" : "All"
          }. Rows with paused parents may be skipped or fail. Switch to Active for safer bulk writes, or continue anyway.`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Continue", style: "destructive", onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    const inputs: EnqueueBulkInput[] = [];
    let skippedNoBid = 0;
    let skippedUnwritable = 0;
    const skippedNoBidLabels: string[] = [];
    const skippedUnwritableLabels: string[] = [];
    const seenCampaignIds = new Set<string>();
    for (const id of selectedIds) {
      const row = byId.get(id);
      const entityId =
        segment === "placement"
          ? String(row?.campaign_id || id.split("::")[0] || id)
          : id;
      if (segment === "placement") {
        if (seenCampaignIds.has(entityId)) continue;
        seenCampaignIds.add(entityId);
      }
      // Stale selection (id not in current filtered rows) must not bypass the gate.
      if (!row) {
        skippedUnwritable += 1;
        if (skippedUnwritableLabels.length < 8) skippedUnwritableLabels.push(entityId);
        continue;
      }
      const writable = isBulkWritableTargetingRow({
        entityState: segment === "keywords" ? row.status : row.state,
        campaignState:
          segment === "placement" ? row.state : (row as any).campaign_state,
        ...(segment === "placement"
          ? {}
          : { adGroupState: (row as any).ad_group_state }),
        stateFilter,
        knownPermanentFailIds: knownDeadIds,
        entityId,
      });
      if (!writable) {
        skippedUnwritable += 1;
        if (skippedUnwritableLabels.length < 8) {
          skippedUnwritableLabels.push(rowDisplayName(segment, row));
        }
        continue;
      }
      const baseBid = row ? baseBidForRow(segment, row, defaultBidByAdGroupId) : null;
      if ((action === "bid_delta" || action === "set_bid") && (baseBid == null || !(baseBid > 0))) {
        skippedNoBid += 1;
        if (row && skippedNoBidLabels.length < 8) {
          skippedNoBidLabels.push(rowDisplayName(segment, row));
        }
        continue;
      }
      if (action === "set_bid") {
        const nextBid = opts?.nextBids?.get(id);
        if (nextBid == null) {
          skippedNoBid += 1;
          continue;
        }
        inputs.push({
          entityKind: kind,
          entityId,
          action: "set_bid",
          bid: nextBid,
          baseBid,
        });
        continue;
      }
      inputs.push({
        entityKind: kind,
        entityId,
        action,
        deltaUsd: opts?.deltaUsd,
        baseBid,
      });
    }
    if (!inputs.length) {
      const namePreview = (labels: string[], total: number) => {
        if (!labels.length) return "";
        const more = total > labels.length ? `\n• …and ${total - labels.length} more` : "";
        return `\n\n• ${labels.join("\n• ")}${more}`;
      };
      Alert.alert(
        "Nothing queued",
        skippedUnwritable > 0
          ? `Selected rows aren't writable (paused parents, missing ownership, or already rejected as not found).${namePreview(skippedUnwritableLabels, skippedUnwritable)}`
          : skippedNoBid > 0
            ? `Selected rows are missing a current bid, so dollar edits were skipped.${namePreview(skippedNoBidLabels, skippedNoBid)}`
            : "Select at least one row first.",
      );
      return;
    }
    try {
      // Paint pause/enable/bids instantly; Amazon reject reverts via outbox drain bus.
      for (const input of inputs) {
        if (input.action === "pause" || input.action === "enable") {
          const enabled = input.action === "enable";
          const previous =
            kind === "keyword"
              ? applyOptimisticEntityState(queryClient, "keyword", input.entityId, enabled)
              : kind === "product_target"
                ? applyOptimisticEntityState(queryClient, "product_target", input.entityId, enabled)
                : kind === "campaign"
                  ? applyOptimisticEntityState(queryClient, "campaign", input.entityId, enabled)
                  : null;
          input.previousEnabled = previous;
        } else if (
          (input.action === "bid_delta" || input.action === "set_bid") &&
          (kind === "keyword" || kind === "product_target")
        ) {
          const nextBid =
            input.action === "set_bid"
              ? clampAmazonBid(Number(input.bid))
              : clampAmazonBid(Number(input.baseBid) + Number(input.deltaUsd || 0));
          input.previousBid = applyOptimisticEntityBid(queryClient, kind, input.entityId, nextBid);
          input.bid = nextBid;
        }
      }
      const skipNoteParts: string[] = [];
      if (skippedNoBid > 0) {
        const sample = skippedNoBidLabels.slice(0, 3).join(", ");
        skipNoteParts.push(
          `${skippedNoBid} without a current bid${sample ? ` (${sample}${skippedNoBid > 3 ? ", …" : ""})` : ""}`,
        );
      }
      if (skippedUnwritable > 0) {
        const sample = skippedUnwritableLabels.slice(0, 3).join(", ");
        skipNoteParts.push(
          `${skippedUnwritable} not writable${sample ? ` (${sample}${skippedUnwritable > 3 ? ", …" : ""})` : ""}`,
        );
      }
      const skipNote = skipNoteParts.length ? ` Skipped ${skipNoteParts.join("; ")}.` : "";

      // Keywords: Nest /keywords/bulk/manual (async at 100+). Product targets
      // have no Nest ID-list bulk route — device outbox drains in background.
      if (kind === "keyword") {
        const built = buildNestBulkItemsFromInputs(inputs);
        if (!built) {
          throw new Error("Couldn't build Nest bulk payload.");
        }
        const submitted = await submitNestBulkManual({
          entityKind: "keyword",
          items: built.items,
        });
        const stamp = new Date().toISOString();
        await trackNestBulkJob({
          jobId: submitted.jobId,
          entityKind: "keyword",
          total: submitted.total,
          processed: submitted.syncResult ? submitted.total : 0,
          status: submitted.syncResult ? "completed" : "pending",
          revertItems: built.revertItems,
          items: built.items,
          createdAt: stamp,
          updatedAt: stamp,
          resultFailed: submitted.syncResult?.failed,
          resultSucceeded: submitted.syncResult?.succeeded,
          resultSkipped: submitted.syncResult?.skipped,
          permanentMessages: collectPermanentFailMessages(submitted.syncResult),
          permanentFailIds: collectPermanentFailIds(submitted.syncResult),
          failedIds: collectFailedEntityIds(submitted.syncResult),
          skippedIds: collectSkippedEntityIds(submitted.syncResult),
          notFoundFailIds: collectNotFoundFailIds(submitted.syncResult),
        });
        if (submitted.syncResult) {
          let restoredAny = false;
          const revertPlan = nestBulkRevertPlan({
            failedIds: collectFailedEntityIds(submitted.syncResult),
            permanentFailIds: collectPermanentFailIds(submitted.syncResult),
            skippedIds: collectSkippedEntityIds(submitted.syncResult),
            resultFailed: submitted.syncResult.failed,
            resultSucceeded: submitted.syncResult.succeeded,
            resultSkipped: submitted.syncResult.skipped,
          });
          for (const revert of built.revertItems) {
            if (!shouldRevertNestBulkEntity(revert.entityId, revertPlan)) {
              continue;
            }
            if (revert.action === "pause" || revert.action === "enable") {
              if (revert.previousEnabled != null) {
                revertOptimisticEntityState(queryClient, kind, revert.entityId, revert.previousEnabled);
                restoredAny = true;
              }
            } else {
              revertOptimisticEntityBid(queryClient, kind, revert.entityId, revert.previousBid ?? null);
              restoredAny = true;
            }
          }
          const failCount =
            collectPermanentFailIds(submitted.syncResult).length || submitted.syncResult.failed || 0;
          if (failCount > 0) {
            const detail = collectPermanentFailMessages(submitted.syncResult)[0] || null;
            const sources = collectPermanentFailMessages(submitted.syncResult).map((m) =>
              classifyBulkFailureSource(m),
            );
            const dominant =
              sources.length && sources.every((s) => s === "stale_or_unowned")
                ? "stale_or_unowned"
                : sources.length && sources.every((s) => s === "amazon")
                  ? "amazon"
                  : sources.includes("stale_or_unowned") && !sources.includes("amazon")
                    ? "stale_or_unowned"
                    : sources.includes("amazon") && !sources.includes("stale_or_unowned")
                      ? "amazon"
                      : "other";
            Alert.alert(
              bulkFailureAlertTitle(failCount, dominant),
              bulkFailureAlertBody({ detail, source: dominant, restoredAny }),
            );
          } else if ((submitted.syncResult.skipped ?? 0) > 0) {
            const skipAlert = nestBulkSkipAlert({
              succeeded: nestBulkConfirmedSucceeded(submitted.syncResult),
              skipped: submitted.syncResult.skipped ?? 0,
              restoredAny,
            });
            Alert.alert(skipAlert.title, `${skipAlert.body}${skipNote}`);
          }
          void invalidateAds();
        } else {
          void (async () => {
            for (let i = 0; i < 180; i += 1) {
              const { newlyCompleted } = await refreshOpenNestBulkJobs();
              await refreshOutboxCounts();
              for (const done of newlyCompleted) {
                let restoredAny = false;
                const revertPlan = nestBulkRevertPlan({
                  failedIds: done.failedIds,
                  permanentFailIds: done.permanentFailIds,
                  skippedIds: done.skippedIds,
                  resultFailed: done.resultFailed,
                  resultSucceeded: done.resultSucceeded,
                  resultSkipped: done.resultSkipped,
                });
                for (const revert of done.revertItems) {
                  if (!shouldRevertNestBulkEntity(revert.entityId, revertPlan)) {
                    continue;
                  }
                  if (revert.action === "pause" || revert.action === "enable") {
                    if (revert.previousEnabled != null) {
                      revertOptimisticEntityState(
                        queryClient,
                        done.entityKind,
                        revert.entityId,
                        revert.previousEnabled,
                      );
                      restoredAny = true;
                    }
                  } else {
                    revertOptimisticEntityBid(
                      queryClient,
                      done.entityKind,
                      revert.entityId,
                      revert.previousBid ?? null,
                    );
                    restoredAny = true;
                  }
                }
                const failCount = done.permanentFailIds?.length || done.resultFailed || 0;
                if (failCount > 0) {
                  const detail = done.permanentMessages?.[0] || done.lastError || null;
                  const sources = (done.permanentMessages || [detail]).map((m) =>
                    classifyBulkFailureSource(m),
                  );
                  const dominant =
                    sources.every((s) => s === "stale_or_unowned")
                      ? "stale_or_unowned"
                      : sources.every((s) => s === "amazon")
                        ? "amazon"
                        : sources.includes("stale_or_unowned") && !sources.includes("amazon")
                          ? "stale_or_unowned"
                          : sources.includes("amazon") && !sources.includes("stale_or_unowned")
                            ? "amazon"
                            : "other";
                  Alert.alert(
                    bulkFailureAlertTitle(failCount, dominant),
                    bulkFailureAlertBody({
                      detail,
                      source: dominant,
                      restoredAny,
                    }),
                  );
                } else if ((done.resultSkipped ?? done.skippedIds?.length ?? 0) > 0) {
                  const skipAlert = nestBulkSkipAlert({
                    succeeded: nestBulkConfirmedSucceeded({
                      succeeded: done.resultSucceeded,
                    }),
                    skipped: done.resultSkipped ?? done.skippedIds?.length ?? 0,
                    restoredAny,
                  });
                  Alert.alert(skipAlert.title, skipAlert.body);
                }
                void invalidateAds();
              }
              const snap = await getNestBulkJobsSnapshot();
              if (snap.pending === 0) break;
              await new Promise((r) => setTimeout(r, 2000));
            }
          })();
        }
        setSelectedIds([]);
        setSelectMode(false);
        await refreshOutboxCounts();
        if (submitted.syncResult) {
          const doneFailed =
            collectPermanentFailIds(submitted.syncResult).length || submitted.syncResult.failed || 0;
          const doneSkipped = submitted.syncResult.skipped ?? 0;
          const doneSucceeded = nestBulkConfirmedSucceeded(submitted.syncResult);
          if (doneFailed === 0 && doneSkipped === 0) {
            if (doneSucceeded > 0) {
              Alert.alert(
                "Sent to Amazon Ads",
                `${doneSucceeded} change${doneSucceeded === 1 ? "" : "s"} finished on InteliAds servers.${skipNote}`,
              );
            } else {
              Alert.alert(
                "Not confirmed on Amazon yet",
                `InteliAds accepted ${submitted.total} change${submitted.total === 1 ? "" : "s"}. Amazon confirmation is still pending.${skipNote}`,
              );
            }
          }
        } else {
          Alert.alert(
            "Writing to Amazon Ads",
            `${submitted.total} change${submitted.total === 1 ? "" : "s"} queued on InteliAds servers. Continues if you close the app.${skipNote}`,
          );
        }
        return;
      }

      const { count } = await enqueueBulkAmazonWrites(inputs);
      setSelectedIds([]);
      setSelectMode(false);
      await refreshOutboxCounts();
      Alert.alert(
        "Writing to Amazon Ads",
        `${count} change${count === 1 ? "" : "s"} queued on this iPhone. Not confirmed on Amazon yet — the app keeps retrying until Amazon accepts, or restores the previous value if Amazon rejects.${skipNote}`,
      );
      void drainBulkOutbox().then(() => refreshOutboxCounts());
    } catch (error) {
      // Queue never persisted — undo optimistic paint so the UI doesn't lie.
      for (const input of inputs) {
        if (input.action === "pause" || input.action === "enable") {
          if (input.previousEnabled == null) continue;
          if (kind === "keyword" || kind === "product_target" || kind === "campaign") {
            revertOptimisticEntityState(queryClient, kind, input.entityId, input.previousEnabled);
          }
        } else if (
          (input.action === "bid_delta" || input.action === "set_bid") &&
          (kind === "keyword" || kind === "product_target")
        ) {
          revertOptimisticEntityBid(queryClient, kind, input.entityId, input.previousBid ?? null);
        }
      }
      alertMutationError(error, "Couldn't queue those Amazon changes. Nothing was sent.");
    }
  };

  const applyBulkBidChange = async (mode: BulkDeltaMode, amount: number) => {
    if (!selectedIds.length) return;
    if (segment === "placement") {
      Alert.alert(
        "Not available",
        "Increase / decrease bid applies to keywords and targets. On Placement use Top / Product / Rest % on each campaign.",
      );
      return;
    }
    const byId = new Map(data.map((row) => [row.id, row]));
    const nextBids = new Map<string, number>();
    let needsConfirm = false;
    for (const id of selectedIds) {
      const row = byId.get(id);
      const base = row ? baseBidForRow(segment, row, defaultBidByAdGroupId) : null;
      if (base == null || !(base > 0)) continue;
      const signed = mode.startsWith("decrease") ? -Math.abs(amount) : Math.abs(amount);
      const next =
        mode.endsWith("pct") ? applyBidDeltaPercent(base, signed) : applyBidDeltaUsd(base, signed);
      nextBids.set(id, next);
      if (requiresBidChangeConfirm(base, next)) needsConfirm = true;
    }
    if (!nextBids.size) {
      Alert.alert("Nothing queued", "Selected rows are missing a current bid.");
      return;
    }

    const cooldown = selectedCooldownSummary(segment, selectedIds, data, entityCooldownHours);
    const run = () => void enqueueSelected("set_bid", { nextBids });

    const confirmLarge = (then: () => void) => {
      if (!needsConfirm) {
        then();
        return;
      }
      Alert.alert(
        "Large bid change",
        `At least one selected bid moves by more than ${BID_CHANGE_CONFIRM_PCT}%. Write to Amazon Ads anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Write to Amazon", style: "destructive", onPress: then },
        ],
      );
    };

    if (cooldown.count > 0) {
      const preview = cooldown.labels.slice(0, 8).join("\n• ");
      const more =
        cooldown.labels.length > 8 ? `\n• …and ${cooldown.labels.length - 8} more` : "";
      Alert.alert(
        `${cooldown.count} on cooldown`,
        `These were changed recently (up to ${cooldown.remainingHint} left). Editing resets cooldown:\n\n• ${preview}${more}`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Edit anyway",
            style: "destructive",
            onPress: () => confirmLarge(run),
          },
        ],
      );
      return;
    }

    confirmLarge(run);
  };

  const confirmPauseSelected = () => {
    if (!selectedIds.length) return;
    const run = () => void enqueueSelected("pause");
    const cooldown = selectedCooldownSummary(segment, selectedIds, data, entityCooldownHours);
    if (segment !== "placement" && cooldown.count > 0) {
      const preview = cooldown.labels.slice(0, 8).join("\n• ");
      const more =
        cooldown.labels.length > 8 ? `\n• …and ${cooldown.labels.length - 8} more` : "";
      Alert.alert(
        `${cooldown.count} on cooldown`,
        `These were changed recently (up to ${cooldown.remainingHint} left). Pausing still writes Amazon Ads and resets cooldown:\n\n• ${preview}${more}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Pause anyway", style: "destructive", onPress: run },
        ],
      );
      return;
    }
    Alert.alert(
      `Pause ${selectedWriteCount} ${
        segment === "placement"
          ? selectedWriteCount === 1
            ? "campaign"
            : "campaigns"
          : selectedWriteCount === 1
            ? "item"
            : "items"
      }?`,
      "Writes to Amazon Ads. Continues in the background if you leave Targets.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pause", style: "destructive", onPress: run },
      ],
    );
  };

  const confirmEnableSelected = () => {
    if (!selectedIds.length) return;
    const run = () => void enqueueSelected("enable");
    const cooldown = selectedCooldownSummary(segment, selectedIds, data, entityCooldownHours);
    if (segment !== "placement" && cooldown.count > 0) {
      const preview = cooldown.labels.slice(0, 8).join("\n• ");
      const more =
        cooldown.labels.length > 8 ? `\n• …and ${cooldown.labels.length - 8} more` : "";
      Alert.alert(
        `${cooldown.count} on cooldown`,
        `These were changed recently (up to ${cooldown.remainingHint} left). Enabling still writes Amazon Ads and resets cooldown:\n\n• ${preview}${more}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Enable anyway", style: "destructive", onPress: run },
        ],
      );
      return;
    }
    Alert.alert(
      `Enable ${selectedWriteCount} ${
        segment === "placement"
          ? selectedWriteCount === 1
            ? "campaign"
            : "campaigns"
          : selectedWriteCount === 1
            ? "item"
            : "items"
      }?`,
      "Writes to Amazon Ads. Continues in the background if you leave Targets.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Enable", onPress: run },
      ],
    );
  };

  const cooldownSelected = useMemo(
    () => selectedCooldownSummary(segment, selectedIds, data, entityCooldownHours),
    [segment, selectedIds, data, entityCooldownHours],
  );

  if (selectedProfileIds.length === 0) {
    return (
      <AppScreen>
        <TopBar />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see targets."}
        />
      </AppScreen>
    );
  }

  const empty = emptyCopy(segment, stateFilter);
  const perfLabel = PERF_FILTERS.find((entry) => entry.key === perf)?.label ?? "All";
  const sortLabel = SORT_OPTIONS.find((entry) => entry.key === sort)?.label ?? "ACoS";
  // Ranges filter only — they never override the seller's sort pick.
  const bookFilterLabel = selectedBook
    ? selectedBook.title.length > 28
      ? `${selectedBook.title.slice(0, 26)}…`
      : selectedBook.title
    : bookAsin
      ? bookAsin
      : null;
  const advancedCount = countActiveAdvancedFilters(advanced);
  const canBulkBid = segment !== "placement";
  const filtersActive =
    stateFilter !== "enabled" ||
    perf !== "all" ||
    sort !== "acos" ||
    !!bookAsin ||
    hasActiveAdvancedFilters(advanced);
  const filterSummary = [
    stateFilter !== "enabled" ? (stateFilter === "paused" ? "Paused" : "All") : null,
    bookFilterLabel ? `Book: ${bookFilterLabel}` : null,
    perf !== "all" ? perfLabel : null,
    sort !== "acos" ? `Sort: ${sortLabel}` : null,
    advancedCount > 0 ? `${advancedCount} range${advancedCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AppScreen>
      {topChromeVisible ? <TopBar /> : null}

      {topChromeVisible ? (
      <View
        style={{
          marginHorizontal: dashboard.pageInset,
          marginTop: dashboard.chromeGap,
          marginBottom: 8,
          // Keep mode switcher clear of the search row (label must not clip into search).
          gap: 12,
        }}
      >
        <TargetingModePills
          value={segment}
          onChange={(next) => {
            setSegment(next);
            setSelectedIds([]);
          }}
        />
        <FilterSearchRow>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="targeting-search"
              placeholder={searchPlaceholder(segment)}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <PressableScale
            testID="targeting-select-btn"
            accessibilityRole="button"
            accessibilityLabel={selectMode ? "Done selecting" : "Bulk select"}
            hitSlop={8}
            onPress={() => {
              if (selectMode) clearSelection();
              else setSelectMode(true);
            }}
            style={{
              minWidth: 44,
              minHeight: 44,
              paddingHorizontal: 8,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={[
                t.typography.subhead,
                {
                  color: selectMode ? t.colors.tone_primary : t.colors.text_secondary,
                  fontWeight: selectMode ? "700" : "600",
                },
              ]}
            >
              {selectMode ? "Done" : "Select"}
            </Text>
          </PressableScale>
          <FilterIconButton
            testID="targeting-filter-btn"
            active={filtersActive}
            accessibilityLabel={
              filtersActive
                ? `Filter, ${[
                    stateFilter !== "enabled" ? 1 : 0,
                    bookAsin ? 1 : 0,
                    perf !== "all" ? 1 : 0,
                    sort !== "acos" ? 1 : 0,
                    advancedCount,
                  ]
                    .reduce((a, b) => a + b, 0)} filters active. ${filterSummary}`
                : "Filters and sort"
            }
            onPress={() => setFilterOpen(true)}
          />
        </FilterSearchRow>
        {viewAsOtherUser ? (
          <Text
            testID="targeting-view-as-write-warning"
            style={[t.typography.caption2, { color: t.colors.tone_warning }]}
          >
            Viewing customer — edits off
          </Text>
        ) : null}
        {selectMode || selectedIds.length > 0 ? (
          <ActiveFilterRow>
            <ActiveFilterChip
              testID="targeting-select-all"
              label={`Select all (${visibleWriteCount})`}
              accessibilityLabel={`Select all ${visibleWriteCount} visible ${segment === "placement" ? "campaigns" : "rows"}`}
              onPress={selectAllVisible}
            />
            <ActiveFilterChip
              testID="targeting-selected-count"
              label={`${selectedWriteCount} selected`}
              accessibilityLabel={`${selectedWriteCount} selected`}
              onPress={clearSelection}
            />
            {cooldownSelected.count > 0 ? (
              <ActiveFilterChip
                testID="targeting-cooldown-selected"
                label={`${cooldownSelected.count} cooldown`}
                accessibilityLabel={`${cooldownSelected.count} selected keywords or targets are on bid cooldown. Up to ${cooldownSelected.remainingHint} remaining.`}
                onPress={() => {
                  const preview = cooldownSelected.labels.slice(0, 12).join("\n• ");
                  const more =
                    cooldownSelected.labels.length > 12
                      ? `\n• …and ${cooldownSelected.labels.length - 12} more`
                      : "";
                  Alert.alert(
                    "On cooldown",
                    `Changed recently (up to ${cooldownSelected.remainingHint} left). Bulk edit will reset cooldown:\n\n• ${preview}${more}`,
                  );
                }}
              />
            ) : null}
          </ActiveFilterRow>
        ) : null}
        {filtersActive &&
        (stateFilter !== "enabled" || bookAsin || perf !== "all" || sort !== "acos" || advancedCount > 0) ? (
          <ActiveFilterRow>
            {stateFilter !== "enabled" ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-state"
                label={stateFilter === "paused" ? "Paused" : "All"}
                accessibilityLabel={`Clear status filter. Currently ${stateFilter === "paused" ? "Paused" : "All"}`}
                onPress={() => setStateFilter(DEFAULT_TARGETING_STATE_FILTER)}
              />
            ) : null}
            {bookAsin ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-book"
                label={bookFilterLabel ?? "Book"}
                accessibilityLabel={`Clear book filter${bookFilterLabel ? ` ${bookFilterLabel}` : ""}`}
                onPress={() => setBookAsin(null)}
              />
            ) : null}
            {perf !== "all" ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-perf"
                label={perfLabel}
                accessibilityLabel={`Clear ${perfLabel} filter`}
                onPress={() => setPerf("all")}
              />
            ) : null}
            {sort !== "acos" ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-sort"
                label={`Sort: ${sortLabel}`}
                accessibilityLabel={`Clear sort. Currently ${sortLabel} high to low`}
                onPress={() => setSort("acos")}
              />
            ) : null}
            {advancedCount > 0 ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-advanced"
                label={`${advancedCount} range${advancedCount === 1 ? "" : "s"}`}
                accessibilityLabel={`Clear ${advancedCount} min max filters. Sort stays ${sortLabel}.`}
                onPress={() => setAdvanced({ ...EMPTY_TARGETING_ADVANCED_FILTERS })}
              />
            ) : null}
          </ActiveFilterRow>
        ) : null}
        {outboxPending > 0 || outboxFailed > 0 ? (
          <View
            testID="targeting-bulk-outbox"
            style={[styles.outboxBanner, { backgroundColor: t.colors.tone_primary + "18", borderColor: t.colors.tone_primary + "44" }]}
          >
            <Text style={[t.typography.caption1, { color: t.colors.text_primary, flex: 1 }]}>
              {outboxPending > 0
                ? `Writing ${outboxPending}…`
                : `${outboxFailed} need review`}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {outboxFailed > 0 && outboxPending === 0 ? (
                <TouchableOpacity
                  onPress={() =>
                    void (async () => {
                      const removedLocal = await dismissPermanentBulkFailures();
                      const removedNest = await dismissCompletedNestBulkFailures();
                      await refreshOutboxCounts();
                      const removed = removedLocal + removedNest;
                      if (removed > 0) {
                        Alert.alert(
                          "Cleared",
                          `${removed} rejected change${removed === 1 ? "" : "s"} removed from this list. On-screen bids were already restored where possible.`,
                        );
                      }
                    })()
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Clear rejected Amazon writes"
                  testID="targeting-bulk-outbox-clear"
                >
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>Clear</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() =>
                  void (async () => {
                    // Drop permanent not-found so Retry cannot loop forever on dead IDs.
                    await dismissNotFoundPermanentBulkFailures();
                    const nestResult = await resubmitFailedNestBulkJobs();
                    const nestRetried = nestResult.resubmitted;
                    const skippedStale = nestResult.skippedNotFound;
                    if (nestRetried === 0 && skippedStale > 0 && outboxFailed === 0) {
                      Alert.alert(
                        "Nothing to retry",
                        `${skippedStale} change${skippedStale === 1 ? "" : "s"} no longer in this filtered list or were permanently rejected.`,
                      );
                    }
                    if (outboxFailed > 0 || nestRetried > 0) {
                      const n = await requeuePermanentBulkFailures();
                      if (n > 0 || nestRetried > 0) {
                        setOutboxPending((p) => p + n + nestRetried);
                        setOutboxFailed(0);
                      }
                      await refreshOutboxCounts();
                      await drainBulkOutbox();
                    } else {
                      await drainBulkOutbox();
                    }
                    await refreshOpenNestBulkJobs();
                    await refreshOutboxCounts();
                  })()
                }
                accessibilityRole="button"
                accessibilityLabel="Retry Amazon writes"
                testID="targeting-bulk-outbox-retry"
              >
                <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "700" }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
      ) : null}

      {showBlockingSpinner ? (
        <ScreenSpinner />
      ) : isError && data.length === 0 ? (
        <RetryState
          title={
            segment === "keywords"
              ? "Couldn't load keywords"
              : segment === "auto"
                ? "Couldn't load auto"
                : segment === "category"
                  ? "Couldn't load categories"
                  : segment === "placement"
                    ? "Couldn't load campaigns"
                    : "Couldn't load ASINs"
          }
          subtitle={
            isHomeQueryTimeout(activeQuery.error)
              ? "This range took too long. Try Week instead of Month, or pull to retry."
              : /period metrics/i.test(
                    activeQuery.error instanceof Error ? activeQuery.error.message : "",
                  )
                ? "Couldn't load metrics"
                : "Couldn't load"
          }
          onRetry={() => {
            if (bookFilterActive && booksQ.isError) void booksQ.refetch();
            else void activeQuery.refetch();
          }}
          retrying={isRefetching || (bookFilterActive && booksQ.isFetching)}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(item: any) => item.id}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{
            padding: t.layout.pagePad,
            paddingBottom: selectedIds.length > 0 ? t.layout.tabClearance + 110 : t.layout.tabClearance,
          }}
          initialNumToRender={14}
          maxToRenderPerBatch={16}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "ios"}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={TargetingListSeparator}
          ListEmptyComponent={
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              subtitle={
                segment === "auto"
                  ? undefined
                  : filtersActive
                    ? segment === "placement" && (advanced.bidMin != null || advanced.bidMax != null)
                      ? "Bid ranges don't apply on Placement"
                      : "No matches"
                    : empty.subtitle
              }
            />
          }
          ListFooterComponent={
            mobilePageQ.data ? (
              <View style={{ gap: 8, paddingTop: 8 }}>
                {pageSummary ? (
                  <Text
                    testID="targeting-list-count-footer"
                    accessibilityLabel={pageSummary}
                    style={[t.typography.caption1, { color: t.colors.text_tertiary, textAlign: "center" }]}
                  >
                    {pageSummary}
                  </Text>
                ) : null}
              </View>
            ) : null
          }
          // Server owns ranked totals via mobile_targeting_page_v1 — full catalog, no page chrome.
          renderItem={({ item }: any) => {
            const selected = selectedIds.includes(item.id);
            const rowCurrency = rowCurrencyOfProfile(profiles, item.amazon_profile_id, primaryCurrency);
            const onRowPress = () => {
              if (selectMode) {
                toggleSelected(item.id);
                return;
              }
              if (segment === "keywords") router.push(`/keyword/${item.id}` as Href);
              else if (segment === "placement") {
                const campaignId = String(item.campaign_id || item.id.split("::")[0] || item.id);
                router.push(`/campaign/${campaignId}`);
              } else router.push(`/target/${item.id}` as Href);
            };
            const selectProps = {
              selectMode,
              selected,
              onToggleSelect: () => toggleSelected(item.id),
            };
            if (segment === "keywords") {
              return (
                <KeywordRow
                  item={item}
                  currency={rowCurrency}
                  t={t}
                  viewAsOtherUser={viewAsOtherUser}
                  onPress={onRowPress}
                  onEditBid={(opts) => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    setMoneyEditor({
                      entity: "keyword",
                      id: item.id,
                      title: item.keyword_text ?? "Keyword bid",
                      value: baseBidForRow("keywords", item, defaultBidByAdGroupId) ?? 0.02,
                      forceCooldown: opts?.forceCooldown === true,
                    });
                  }}
                  {...selectProps}
                />
              );
            }
            if (segment === "placement") {
              const campaignId = String(item.campaign_id || item.id.split("::")[0] || item.id);
              const field = (item.placement_key || "top_of_search") as PlacementField;
              return (
                <PlacementRow
                  item={item}
                  currency={rowCurrency}
                  t={t}
                  field={field}
                  adjustments={placementAdj[campaignId]}
                  onPress={onRowPress}
                  onEdit={() => {
                    if (blockIfCannotWriteAmazon(writeGuard)) return;
                    void openPlacementEditor(item, field);
                  }}
                  {...selectProps}
                />
              );
            }
            const rowAsin = productTargetDisplayAsin(item);
            const titleLoading =
              !!rowAsin &&
              !isUsableBookTitle(item.title) &&
              !retailTitleDoneRef.current.has(rowAsin);
            return (
              <ProductTargetRow
                item={item}
                currency={rowCurrency}
                inheritedDefaultBid={
                  item.ad_group_id ? defaultBidByAdGroupId[String(item.ad_group_id)] : undefined
                }
                t={t}
                titleLoading={titleLoading}
                viewAsOtherUser={viewAsOtherUser}
                onPress={onRowPress}
                onEditBid={(opts) => {
                  if (blockIfCannotWriteAmazon(writeGuard)) return;
                  setMoneyEditor({
                    entity: "target",
                    id: item.id,
                    title: item.title || describeProductTarget(item.expression, item.expression_type).label,
                    value: baseBidForRow(segment, item, defaultBidByAdGroupId) ?? 0.02,
                    forceCooldown: opts?.forceCooldown === true,
                  });
                }}
                {...selectProps}
              />
            );
          }}
        />
      )}

      {selectedIds.length > 0 ? (
        <View
          testID="targeting-bulk-bar"
          // Bulk Bid ± only writes the selected visible / filtered rows.
          style={[
            styles.bulkBar,
            {
              backgroundColor: t.colors.background_secondary,
              borderTopColor: t.colors.separator,
              paddingBottom: Math.max(t.spacing.md, 12),
              bottom: t.layout.tabClearance,
            },
          ]}
        >
          {cooldownSelected.count > 0 ? (
            <Text
              testID="targeting-bulk-cooldown-hint"
              style={[t.typography.caption2, { color: t.colors.tone_warning, marginBottom: 6, fontWeight: "600" }]}
            >
              {cooldownSelected.count} on cooldown
            </Text>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bulkScroll}
          >
            {canBulkBid ? (
              <>
                <TouchableOpacity
                  testID="targeting-bulk-increase"
                  accessibilityRole="button"
                  accessibilityLabel="Increase bid by dollar amount"
                  onPress={() => setBulkDeltaEditor("increase_usd")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_good + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "800" }]}>Bid +$</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-decrease"
                  accessibilityRole="button"
                  accessibilityLabel="Decrease bid by dollar amount"
                  onPress={() => setBulkDeltaEditor("decrease_usd")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_warning + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_warning, fontWeight: "800" }]}>Bid −$</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-increase-pct"
                  accessibilityRole="button"
                  accessibilityLabel="Increase bid by percent"
                  onPress={() => setBulkDeltaEditor("increase_pct")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_good + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "800" }]}>Bid +%</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-decrease-pct"
                  accessibilityRole="button"
                  accessibilityLabel="Decrease bid by percent"
                  onPress={() => setBulkDeltaEditor("decrease_pct")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_warning + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_warning, fontWeight: "800" }]}>Bid −%</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity
              testID="targeting-bulk-pause"
              accessibilityRole="button"
              accessibilityLabel="Pause selected"
              onPress={confirmPauseSelected}
              style={[styles.bulkBtn, { backgroundColor: t.colors.tone_danger + "22" }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_danger, fontWeight: "700" }]}>Pause</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="targeting-bulk-enable"
              accessibilityRole="button"
              accessibilityLabel="Enable selected"
              onPress={confirmEnableSelected}
              style={[styles.bulkBtn, { backgroundColor: t.colors.tone_primary + "22" }]}
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "700" }]}>Enable</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}

      <BidBudgetEditor
        visible={bulkDeltaEditor != null}
        title={
          bulkDeltaEditor === "decrease_usd"
            ? "Decrease bid by $"
            : bulkDeltaEditor === "increase_usd"
              ? "Increase bid by $"
              : bulkDeltaEditor === "decrease_pct"
                ? "Decrease bid by %"
                : "Increase bid by %"
        }
        value={bulkDeltaEditor?.endsWith("pct") ? 10 : 0.05}
        currency={primaryCurrency}
        kind={bulkDeltaEditor?.endsWith("pct") ? "percent" : "money"}
        min={0.01}
        max={bulkDeltaEditor?.endsWith("pct") ? 200 : 50}
        testID="targeting-bulk-delta-editor"
        confirmLargeChange={false}
        onClose={() => setBulkDeltaEditor(null)}
        onSave={async (amount) => {
          const mode = bulkDeltaEditor;
          setBulkDeltaEditor(null);
          if (!mode) return;
          await applyBulkBidChange(mode, amount);
        }}
      />

      <BidBudgetEditor
        visible={moneyEditor != null}
        title={moneyEditor?.title ?? "Bid"}
        value={moneyEditor?.value ?? 0}
        currency={primaryCurrency}
        min={0.01}
        testID={moneyEditor ? `targeting-bid-editor-${moneyEditor.id}` : undefined}
        onClose={() => setMoneyEditor(null)}
        onSave={async (next) => {
          if (!moneyEditor) return;
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          const entityKind = moneyEditor.entity === "keyword" ? "keyword" : "product_target";
          const previousBid = applyOptimisticEntityBid(queryClient, entityKind, moneyEditor.id, next);
          try {
            await enqueueEntityBidWrite({
              entityKind,
              entityId: moneyEditor.id,
              bid: next,
              previousBid,
              forceCooldown: moneyEditor.forceCooldown === true,
            });
          } catch (error) {
            revertOptimisticEntityBid(queryClient, entityKind, moneyEditor.id, previousBid);
            throw error;
          }
          // Amazon confirm → subscribeBulkOutboxDrain invalidates.
          // Amazon permanent reject → same bus reverts previousBid + alerts.
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
          if (blockIfCannotWriteAmazon(writeGuard)) return;
          // Patch only the edited field — never default missing siblings to 0.
          const payload: PlacementAdjustments = { [percentEditor.field]: next };
          await updateCampaign(percentEditor.id, { placementAdjustments: payload });
          setPlacementAdj((prev) => ({
            ...prev,
            [percentEditor.id]: { ...(prev[percentEditor.id] ?? {}), ...payload },
          }));
          // Optimistic cooldown stamp — only the edited placement slot on RPC page rows.
          queryClient.setQueriesData({ queryKey: ["mobile-targeting-page-v1"] }, (old: unknown) => {
            if (!old || typeof old !== "object" || !Array.isArray((old as { rows?: unknown }).rows)) return old;
            const page = old as { rows: any[] };
            const now = new Date().toISOString();
            return {
              ...page,
              rows: page.rows.map((row: any) => {
                const campaignId = String(row.campaign_id || String(row.id || "").split("::")[0] || "");
                if (campaignId !== String(percentEditor.id)) return row;
                const prevStamp =
                  row.placement_adj_last_modified_at &&
                  typeof row.placement_adj_last_modified_at === "object"
                    ? { ...row.placement_adj_last_modified_at }
                    : {};
                const prevSource =
                  row.placement_adj_change_source && typeof row.placement_adj_change_source === "object"
                    ? { ...row.placement_adj_change_source }
                    : {};
                return {
                  ...row,
                  placement_adj_last_modified_at: { ...prevStamp, [percentEditor.field]: now },
                  placement_adj_change_source: { ...prevSource, [percentEditor.field]: "manual" },
                };
              }),
            };
          });
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
            <FilterSheetFields
              t={t}
              stateFilter={stateFilter}
              perf={perf}
              sort={sort}
              bookAsin={bookAsin}
              bookOptions={bookOptions}
              advanced={advanced}
              segment={segment}
              onStateFilter={setStateFilter}
              onPerf={setPerf}
              onSort={setSort}
              onBookAsin={setBookAsin}
              onAdvanced={setAdvanced}
              onDone={() => setFilterOpen(false)}
            />
          </View>
        ) : (
          <Pressable style={[styles.filterOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setFilterOpen(false)}>
            <Pressable
              style={[styles.filterSheetAndroid, { backgroundColor: t.colors.background_secondary }]}
              onPress={(event) => event.stopPropagation()}
            >
              <FilterSheetFields
                t={t}
                stateFilter={stateFilter}
                perf={perf}
                sort={sort}
                bookAsin={bookAsin}
                bookOptions={bookOptions}
                advanced={advanced}
                segment={segment}
                onStateFilter={setStateFilter}
                onPerf={setPerf}
                onSort={setSort}
                onBookAsin={setBookAsin}
                onAdvanced={setAdvanced}
                onDone={() => setFilterOpen(false)}
              />
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </AppScreen>
  );
}

/** Settings-style checkmark row for Filter sheet Sort / Performance. */
function FilterCheckRow({
  t,
  testID,
  label,
  hint,
  selected,
  onPress,
}: {
  t: any;
  testID: string;
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={[
        styles.filterCheckRow,
        { borderBottomColor: t.colors.separator, minHeight: layout.minTap },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[
            t.typography.body,
            {
              color: selected ? t.colors.tone_primary : t.colors.text_primary,
              fontWeight: selected ? "600" : "400",
            },
          ]}
        >
          {label}
        </Text>
        {hint ? (
          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
    </Pressable>
  );
}

function FilterSheetFields({
  t,
  stateFilter,
  perf,
  sort,
  bookAsin,
  bookOptions,
  advanced,
  segment = "keywords",
  onStateFilter,
  onPerf,
  onSort,
  onBookAsin,
  onAdvanced,
  onDone,
}: {
  t: any;
  stateFilter: EntityStateFilter;
  perf: PerfFilter;
  sort: SortKey;
  bookAsin: string | null;
  bookOptions: {
    asin: string;
    title: string;
    image_url?: string | null;
    campaignIds: string[];
    campaignCount?: number;
  }[];
  advanced: TargetingAdvancedFilters;
  segment?: Segment;
  onStateFilter: (next: EntityStateFilter) => void;
  onPerf: (next: PerfFilter) => void;
  onSort: (next: SortKey) => void;
  onBookAsin: (next: string | null) => void;
  onAdvanced: (next: TargetingAdvancedFilters) => void;
  onDone: () => void;
}) {
  const rangesActive = hasActiveAdvancedFilters(advanced);
  const [advDrafts, setAdvDrafts] = useState<Partial<Record<keyof TargetingAdvancedFilters, string>>>({});
  const [bookQuery, setBookQuery] = useState("");
  const [rangesOpen, setRangesOpen] = useState(rangesActive);
  const [booksExpanded, setBooksExpanded] = useState(false);
  const marketplaceIndex = useSponsoredMarketplaceIndex();
  const INT_RANGE_KEYS = new Set<keyof TargetingAdvancedFilters>([
    "clicksMin",
    "clicksMax",
    "impressionsMin",
    "impressionsMax",
  ]);
  const BOOK_PREVIEW = 8;

  const visibleBooks = useMemo(() => {
    const filtered = filterTargetingBookOptions(bookOptions, bookQuery);
    if (!bookAsin) return filtered;
    if (filtered.some((b) => b.asin === bookAsin)) return filtered;
    const selected = bookOptions.find((b) => b.asin === bookAsin);
    return selected ? [selected, ...filtered] : filtered;
  }, [bookOptions, bookQuery, bookAsin]);

  const shownBooks =
    booksExpanded || bookQuery.trim() || visibleBooks.length <= BOOK_PREVIEW
      ? visibleBooks
      : visibleBooks.slice(0, BOOK_PREVIEW);
  const hiddenBookCount = Math.max(0, visibleBooks.length - shownBooks.length);

  const setAdvField = (key: keyof TargetingAdvancedFilters, raw: string) => {
    setAdvDrafts((prev) => ({ ...prev, [key]: raw }));
    const parsed = parseFilterRangeInput(raw, INT_RANGE_KEYS.has(key));
    if (parsed.kind === "incomplete" || parsed.kind === "invalid") return;
    onAdvanced(
      normalizeTargetingAdvancedFilters({
        ...advanced,
        [key]: parsed.kind === "empty" ? null : parsed.value,
      }),
    );
  };
  const fieldValue = (key: keyof TargetingAdvancedFilters) => {
    if (Object.prototype.hasOwnProperty.call(advDrafts, key)) return advDrafts[key] ?? "";
    const v = advanced[key];
    return v == null ? "" : String(v);
  };
  const bidRangesIgnoredOnPlacement = segment === "placement";
  const sortLabel = SORT_OPTIONS.find((entry) => entry.key === sort)?.label ?? "ACoS";
  const perfLabel = PERF_FILTERS.find((entry) => entry.key === perf)?.label ?? "All";
  const advancedCount = countActiveAdvancedFilters(advanced);

  return (
    <>
      <View style={styles.filterSheetHeader}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Filter</Text>
        <Pressable
          testID="targeting-filter-done"
          accessibilityRole="button"
          accessibilityLabel="Done"
          accessibilityHint="Closes filters and sort"
          onPress={onDone}
          hitSlop={spacing.sm}
          style={{ minHeight: layout.minTap, justifyContent: "center", paddingHorizontal: 4 }}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.filterSheetBody} keyboardShouldPersistTaps="handled">
        {/* 1. Status — Active / Paused / All */}
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: t.spacing.sm }]}>
          Status
        </Text>
        <IOSSegmentedControl
          testID="targeting-state-filter"
          value={stateFilter}
          onChange={(key) => onStateFilter(key as EntityStateFilter)}
          options={[
            { key: "enabled", label: "Active", testID: "targeting-state-enabled" },
            { key: "paused", label: "Paused", testID: "targeting-state-paused" },
            { key: "all", label: "All", testID: "targeting-state-all" },
          ]}
        />
        {/* 2. Sort */}
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginBottom: t.spacing.xs, marginTop: t.spacing.md },
          ]}
        >
          Sort
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}>
          High to low · {sortLabel}
        </Text>
        <View style={[styles.filterGroup, { backgroundColor: t.colors.background_tertiary }]}>
          {SORT_OPTIONS.map((f) => (
            <FilterCheckRow
              key={f.key}
              t={t}
              testID={`targeting-sort-${f.key}`}
              label={f.label}
              hint={`Sort by ${f.label} high to low`}
              selected={sort === f.key}
              onPress={() => onSort(f.key)}
            />
          ))}
        </View>

        {/* 2. Performance */}
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.xs },
          ]}
        >
          Performance
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}>
          {perfLabel}
        </Text>
        <View style={[styles.filterGroup, { backgroundColor: t.colors.background_tertiary }]}>
          {PERF_FILTERS.map((f) => (
            <FilterCheckRow
              key={f.key}
              t={t}
              testID={`targeting-perf-${f.key}`}
              label={f.label}
              hint={f.hint}
              selected={perf === f.key}
              onPress={() => onPerf(f.key)}
            />
          ))}
        </View>

        {/* 3. Book — title-primary rows */}
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.xs },
          ]}
        >
          Book
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}>
          One ASIN per row. Same title can be a different edition.
        </Text>
        {bookOptions.length ? (
          <View style={{ marginBottom: t.spacing.sm }}>
            <IOSSearchBar
              testID="targeting-book-search"
              placeholder="Search books or ASIN"
              value={bookQuery}
              onChangeText={setBookQuery}
            />
          </View>
        ) : null}
        <View style={[styles.filterGroup, { backgroundColor: t.colors.background_tertiary }]}>
          <Pressable
            testID="targeting-book-all"
            onPress={() => onBookAsin(null)}
            style={[styles.bookListRow, { borderBottomColor: t.colors.separator, minHeight: layout.minTap }]}
            accessibilityRole="button"
            accessibilityState={{ selected: !bookAsin }}
            accessibilityLabel="All books"
          >
            <View style={[styles.bookRowCoverSlotXs, { backgroundColor: t.colors.background_secondary }]}>
              <SFSymbol name="books.vertical" size={16} color={!bookAsin ? t.colors.tone_primary : t.colors.text_tertiary} />
            </View>
            <View style={styles.bookRowText}>
              <Text
                numberOfLines={2}
                style={[
                  t.typography.body,
                  {
                    color: !bookAsin ? t.colors.tone_primary : t.colors.text_primary,
                    fontWeight: !bookAsin ? "600" : "400",
                  },
                ]}
              >
                All books
              </Text>
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>No book filter</Text>
            </View>
            {!bookAsin ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
          </Pressable>
          {shownBooks.map((book) => {
            const active = bookAsin === book.asin;
            const camps = book.campaignCount ?? book.campaignIds.length;
            return (
              <Pressable
                key={book.asin}
                testID={`targeting-book-${book.asin}`}
                onPress={() => onBookAsin(active ? null : book.asin)}
                style={[styles.bookListRow, { borderBottomColor: t.colors.separator, minHeight: layout.minTap }]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${book.title}, ASIN ${book.asin}, ${camps} campaigns`}
              >
                <BookCover
                  uri={book.image_url}
                  fallbackUri={null}
                  asin={book.asin}
                  size="xs"
                  placeholder="book"
                  recyclingKey={`filter-${book.asin}`}
                  style={styles.bookRowCover}
                />
                <View style={styles.bookRowText}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                    <Text
                      numberOfLines={2}
                      style={[
                        t.typography.body,
                        {
                          color: active ? t.colors.tone_primary : t.colors.text_primary,
                          fontWeight: active ? "600" : "400",
                          flex: 1,
                          minWidth: 0,
                        },
                      ]}
                    >
                      {book.title}
                    </Text>
                    <BookMarketplaceFlags index={marketplaceIndex} book={book} style={t.typography.caption1} />
                  </View>
                  <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>
                    {book.asin}
                    {camps > 0 ? ` · ${camps} camp.` : ""}
                  </Text>
                </View>
                {active ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
              </Pressable>
            );
          })}
        </View>
        {hiddenBookCount > 0 ? (
          <Pressable
            testID="targeting-book-show-more"
            onPress={() => setBooksExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${hiddenBookCount} more books`}
            style={{ marginTop: t.spacing.sm, minHeight: layout.minTap, justifyContent: "center" }}
          >
            <Text style={[t.typography.callout, { color: t.colors.tone_primary, fontWeight: "600" }]}>
              Show {hiddenBookCount} more
            </Text>
          </Pressable>
        ) : null}
        {!bookOptions.length ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: t.spacing.xs }]}>
            No books with active campaigns on these profiles yet.
          </Text>
        ) : bookQuery.trim() && !visibleBooks.length ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: t.spacing.xs }]}>
            No books match “{bookQuery.trim()}”.
          </Text>
        ) : null}

        {/* 4. Ranges — progressive disclosure */}
        <Pressable
          testID="targeting-ranges-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: rangesOpen }}
          accessibilityLabel={
            rangesOpen
              ? "Hide min max ranges"
              : advancedCount > 0
                ? `Min max ranges, ${advancedCount} active`
                : "Min max ranges"
          }
          onPress={() => setRangesOpen((prev) => !prev)}
          style={[
            styles.rangesToggle,
            {
              borderColor: t.colors.separator,
              backgroundColor: t.colors.background_tertiary,
              marginTop: t.spacing.lg,
              minHeight: layout.minTap,
            },
          ]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.typography.body, { color: t.colors.text_primary, fontWeight: "600" }]}>
              Min / max ranges
            </Text>
            <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
              {advancedCount > 0 ? `${advancedCount} active` : "Bid, ACoS, clicks, impressions"}
            </Text>
          </View>
          <SFSymbol
            name={rangesOpen ? "chevron.up" : "chevron.down"}
            size={14}
            color={t.colors.text_tertiary}
          />
        </Pressable>
        {rangesOpen ? (
          <>
            <View style={[styles.advGrid, { marginTop: t.spacing.md }]}>
              {(
                [
                  ["Bid min", "bidMin", "targeting-adv-bid-min"],
                  ["Bid max", "bidMax", "targeting-adv-bid-max"],
                  ["ACoS min %", "acosMin", "targeting-adv-acos-min"],
                  ["ACoS max %", "acosMax", "targeting-adv-acos-max"],
                  ["Clicks min", "clicksMin", "targeting-adv-clicks-min"],
                  ["Clicks max", "clicksMax", "targeting-adv-clicks-max"],
                  ["Impr min", "impressionsMin", "targeting-adv-impr-min"],
                  ["Impr max", "impressionsMax", "targeting-adv-impr-max"],
                ] as const
              ).map(([label, key, testID]) => {
                const bidDisabled = bidRangesIgnoredOnPlacement && (key === "bidMin" || key === "bidMax");
                return (
                  <View key={key} style={styles.advField}>
                    <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: 4 }]}>
                      {label}
                    </Text>
                    <TextInput
                      testID={testID}
                      value={fieldValue(key)}
                      onChangeText={(raw) => setAdvField(key, raw)}
                      editable={!bidDisabled}
                      onBlur={() =>
                        setAdvDrafts((prev) => {
                          if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        })
                      }
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={t.colors.text_tertiary}
                      accessibilityLabel={bidDisabled ? `${label}, not used on Placement` : label}
                      style={[
                        t.typography.callout,
                        styles.advInput,
                        {
                          color: t.colors.text_primary,
                          borderColor: t.colors.separator,
                          backgroundColor: t.colors.background_primary,
                          opacity: bidDisabled ? 0.45 : 1,
                          minHeight: layout.minTap,
                        },
                      ]}
                    />
                  </View>
                );
              })}
            </View>
            {rangesActive ? (
              <Pressable
                testID="targeting-adv-clear"
                onPress={() => onAdvanced({ ...EMPTY_TARGETING_ADVANCED_FILTERS })}
                style={{ marginTop: t.spacing.md, minHeight: layout.minTap, justifyContent: "center" }}
                accessibilityRole="button"
                accessibilityLabel="Clear min max ranges"
              >
                <Text style={[t.typography.caption1, { color: t.colors.tone_danger, fontWeight: "700" }]}>
                  Clear ranges
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function keywordStatus(item: any): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  const sales = Number(item.total_sales) || 0;
  const acos = Number(item.total_acos) || 0;
  if (spend > 0 && orders === 0) return { label: "No sales", tone: "danger" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" };
  if (sales > 0) return { label: "Profitable", tone: "good" };
  return { label: "No spend", tone: "inactive" };
}

function KeywordRow({
  item,
  currency,
  t,
  viewAsOtherUser = false,
  onPress,
  onEditBid,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: any;
  currency: string;
  t: any;
  viewAsOtherUser?: boolean;
  onPress: () => void;
  onEditBid: (opts?: { forceCooldown?: boolean }) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const queryClient = useQueryClient();
  const { entityCooldownHours } = useApp();
  const status = keywordStatus(item);
  const sales = Number(item.total_sales) || 0;
  const rowLabel = targetingSpeech([
    item.keyword_text ?? "Keyword",
    matchTypeSpoken(item.match_type),
    status.tone !== "inactive" && status.tone !== "good" ? status.label : null,
    enabledSpoken(item.status === "enabled"),
    `ACoS ${sales > 0 ? formatPercent(Number(item.total_acos)) : "—"}`,
  ]);
  const cooldown = getEntityBidCooldown(item, entityCooldownHours);
  return (
    <ListCard testID={`keywords-row-${item.id}`} compact>
      <View style={styles.leadRow}>
        {selectMode ? (
          <TouchableOpacity
            testID={`targeting-select-${item.id}`}
            onPress={onToggleSelect}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={selected ? "Selected" : "Not selected"}
            hitSlop={8}
            style={styles.selectHit}
          >
            <SFSymbol name={selected ? "checkmark.circle.fill" : "circle"} size={22} color={selected ? t.colors.tone_primary : t.colors.text_tertiary} />
          </TouchableOpacity>
        ) : (
          <ResponderBox>
            <View style={styles.switchWell}>
              <EntityStateSwitch
                testID={`targeting-state-${item.id}`}
                enabled={item.status === "enabled"}
                noun="keyword"
                compact
                onChange={async (next) => {
                  assertNotViewingAsOtherUser(viewAsOtherUser);
                  const previous = applyOptimisticEntityState(queryClient, "keyword", item.id, next);
                  try {
                    await updateKeywordManual(item.id, { status: next ? "enabled" : "paused" });
                    void invalidateEntityStateQueries(queryClient, "keyword");
                  } catch (error) {
                    revertOptimisticEntityState(queryClient, "keyword", item.id, previous);
                    throw error;
                  }
                }}
              />
            </View>
          </ResponderBox>
        )}
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.7}
          accessible
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
          accessibilityHint={selectMode ? "Toggles bulk selection" : "Opens keyword details"}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={styles.titleRow}>
            <Text
              style={[
                t.typography.callout,
                {
                  color: t.colors.text_primary,
                  fontWeight: "600",
                  flex: 1,
                  minWidth: 0,
                },
              ]}
              numberOfLines={2}
            >
              {item.keyword_text ?? "—"}
            </Text>
            <ResponderBox>
              <MutationTap
                testID={`targeting-bid-${item.id}`}
                label="Bid"
                compact
                value={(() => {
                  const bid = readTargetBid({ bid_amount: item.bid_amount, bid: item.bid });
                  return bid != null ? formatCurrency(bid, currency) : "Set";
                })()}
                cooldownRow={item}
                onPress={onEditBid}
              />
            </ResponderBox>
          </View>
          <View style={styles.metaRow}>
            {item.match_type ? (
              <Text
                style={[
                  t.typography.caption2,
                  {
                    color: t.colors.text_secondary,
                    fontWeight: isExactMatchType(item.match_type) ? "700" : "500",
                  },
                ]}
              >
                {formatMatchTypeLabel(item.match_type)}
              </Text>
            ) : null}
            {status.tone !== "inactive" && status.tone !== "good" ? (
              <Text style={[t.typography.caption2, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
                {status.label}
              </Text>
            ) : null}
            {cooldown.isInCooldown ? (
              <Text
                testID={`targeting-cooldown-badge-${item.id}`}
                style={[t.typography.caption2, { color: t.colors.tone_warning, fontWeight: "600" }]}
              >
                Cooldown
              </Text>
            ) : null}
          </View>
          <DenseMetricLine items={targetingMetricItems(item, currency, t)} />
        </TouchableOpacity>
      </View>
    </ListCard>
  );
}

function ProductTargetRow({
  item,
  currency,
  inheritedDefaultBid,
  t,
  titleLoading = false,
  viewAsOtherUser = false,
  onPress,
  onEditBid,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: any;
  currency: string;
  inheritedDefaultBid?: number;
  t: any;
  /** True while post-paint retail fill is still trying this ASIN. */
  titleLoading?: boolean;
  viewAsOtherUser?: boolean;
  onPress: () => void;
  onEditBid: (opts?: { forceCooldown?: boolean }) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const queryClient = useQueryClient();
  const { entityCooldownHours } = useApp();
  const target = describeProductTarget(item.expression, item.expression_type, item.resolved_expression);
  const rawHeading = productTargetHeading(item);
  // Prefer ASIN over a loading placeholder so rows stay stable while retail titles fill.
  const displayTitle =
    rawHeading === "Title unavailable" && target.asin
      ? target.asin
      : titleLoading && rawHeading === "Title unavailable"
        ? target.asin || "Title unavailable"
        : rawHeading;
  const category = isCategoryTarget(item.expression, item.expression_type);
  const coverAsin = target.asin || item.cover_asin || null;
  const sales = Number(item.total_sales) || 0;
  const status = keywordStatus(item);
  const rowLabel = targetingSpeech([
    displayTitle,
    target.isAuto || category ? target.label : formatMatchTypeLabel(target.label) || target.label,
    status.tone !== "inactive" && status.tone !== "good" ? status.label : null,
    enabledSpoken(item.state === "enabled"),
    `ACoS ${sales > 0 ? formatPercent(Number(item.total_acos)) : "—"}`,
  ]);
  const cooldown = getEntityBidCooldown(item, entityCooldownHours);
  const titleMissing = displayTitle === "Title unavailable" || displayTitle === coverAsin;
  const identitySecondary = target.isAuto
    ? target.label
    : category
      ? target.asin
        ? `Category · ${target.asin}`
        : "Category"
      : target.asin && displayTitle !== target.asin
        ? `${formatMatchTypeLabel(target.label) || target.label} · ${target.asin}`
        : formatMatchTypeLabel(target.label) || target.label;

  return (
    <ListCard testID={`products-row-${item.id}`} compact>
      <View style={styles.leadRow}>
        {selectMode ? (
          <TouchableOpacity
            testID={`targeting-select-${item.id}`}
            onPress={onToggleSelect}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={selected ? "Selected" : "Not selected"}
            hitSlop={8}
            style={styles.selectHit}
          >
            <SFSymbol name={selected ? "checkmark.circle.fill" : "circle"} size={22} color={selected ? t.colors.tone_primary : t.colors.text_tertiary} />
          </TouchableOpacity>
        ) : (
          <ResponderBox>
            <View style={styles.switchWell}>
              <EntityStateSwitch
                testID={`targeting-state-${item.id}`}
                enabled={item.state === "enabled"}
                noun="target"
                compact
                onChange={async (next) => {
                  assertNotViewingAsOtherUser(viewAsOtherUser);
                  const previous = applyOptimisticEntityState(queryClient, "product_target", item.id, next);
                  try {
                    await updateProductTargetManual(item.id, { state: next ? "enabled" : "paused" });
                    void invalidateEntityStateQueries(queryClient, "product_target");
                  } catch (error) {
                    revertOptimisticEntityState(queryClient, "product_target", item.id, previous);
                    throw error;
                  }
                }}
              />
            </View>
          </ResponderBox>
        )}
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.7}
          accessible
          accessibilityRole="button"
          accessibilityLabel={rowLabel}
          accessibilityHint={selectMode ? "Toggles bulk selection" : "Opens target details"}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={styles.cardHeader}>
            <BookCover
              uri={item.image_url}
              fallbackUri={fallbackAsinCoverUrl(coverAsin)}
              asin={coverAsin}
              size="xs"
              placeholder={target.isAuto ? "auto" : category ? "category" : coverAsin ? "book" : "cube"}
              recyclingKey={coverAsin || item.id}
            />

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.titleRow}>
                <Text
                  style={[
                    t.typography.callout,
                    {
                      color: titleMissing ? t.colors.text_secondary : t.colors.text_primary,
                      fontWeight: "600",
                      flex: 1,
                      flexShrink: 1,
                      minWidth: 0,
                    },
                  ]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {displayTitle}
                </Text>
                <ResponderBox>
                  <View style={{ flexShrink: 0, maxWidth: 148 }}>
                    <MutationTap
                      testID={`targeting-bid-${item.id}`}
                      label="Bid"
                      compact
                      value={(() => {
                        const bid = readTargetBid(item, inheritedDefaultBid);
                        return bid != null ? formatCurrency(bid, currency) : "Set";
                      })()}
                      cooldownRow={item}
                      onPress={onEditBid}
                    />
                  </View>
                </ResponderBox>
              </View>
              <View style={styles.metaRow}>
                <Text
                  style={[
                    t.typography.caption2,
                    {
                      color: t.colors.text_secondary,
                      fontWeight: isExactMatchType(target.label) ? "700" : "500",
                    },
                  ]}
                  numberOfLines={2}
                >
                  {identitySecondary}
                </Text>
                {status.tone !== "inactive" && status.tone !== "good" ? (
                  <Text style={[t.typography.caption2, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
                    {status.label}
                  </Text>
                ) : null}
                {cooldown.isInCooldown ? (
                  <Text
                    testID={`targeting-cooldown-badge-${item.id}`}
                    style={[t.typography.caption2, { color: t.colors.tone_warning, fontWeight: "600" }]}
                  >
                    Cooldown
                  </Text>
                ) : null}
              </View>
              <DenseMetricLine items={targetingMetricItems(item, currency, t)} />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </ListCard>
  );
}

function PlacementRow({
  item,
  currency,
  t,
  field,
  adjustments,
  onPress,
  onEdit,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: any;
  currency: string;
  t: any;
  field: PlacementField;
  adjustments?: PlacementAdjustments;
  onPress: () => void;
  onEdit: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const campaignId = String(item.campaign_id || item.id || "");
  const coverAsin = item.book_asin ? String(item.book_asin).toUpperCase() : null;
  const hasBook = Boolean(coverAsin);
  const campaignName = String(item.name ?? "").trim() || "Campaign";
  const placementLabel = String(item.placement_label || field);
  const { entityCooldownHours } = useApp();
  // A placement edit must only inherit the placement cooldown stamp. Strategy,
  // keyword and product-target changes have independent cooldown lifecycles.
  const cooldown = getPlacementAdjCooldown(item as EntityBidCooldownFields, entityCooldownHours, Date.now(), field);
  const fieldMeta = PLACEMENT_FIELDS.find((entry) => entry.key === field);
  return (
    <ListCard testID={`placement-row-${item.id}`} compact>
      <View style={styles.leadRow}>
        {selectMode ? (
          <TouchableOpacity
            testID={`targeting-select-${item.id}`}
            onPress={onToggleSelect}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={selected ? "Selected" : "Not selected"}
            hitSlop={8}
            style={styles.selectHit}
          >
            <SFSymbol name={selected ? "checkmark.circle.fill" : "circle"} size={22} color={selected ? t.colors.tone_primary : t.colors.text_tertiary} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel={targetingSpeech([
              placementLabel,
              campaignName,
              "Placement bid adjustment",
              `Spend ${formatCurrency(Number(item.total_spend ?? item.spend) || 0, currency)}`,
              `Orders ${formatInt(Number(item.total_orders ?? item.orders) || 0)}`,
            ])}
            accessibilityHint={selectMode ? "Toggles bulk selection" : "Opens campaign details"}
          >
            <View style={styles.cardHeader}>
              <BookCover
                uri={hasBook ? item.book_image_url : null}
                fallbackUri={fallbackAsinCoverUrl(coverAsin)}
                asin={coverAsin}
                size="md"
                placeholder={hasBook ? "book" : "cube"}
                recyclingKey={coverAsin || campaignId}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[
                    t.typography.subhead,
                    {
                      color: t.colors.text_primary,
                      fontWeight: "700",
                      letterSpacing: -0.25,
                      lineHeight: 20,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {placementLabel}
                </Text>
                <Text
                  style={[
                    t.typography.caption1,
                    {
                      color: t.colors.text_secondary,
                      marginTop: 2,
                      fontWeight: "500",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {campaignName}
                </Text>
              </View>
              {cooldown.isInCooldown ? (
                <Text
                  testID={`targeting-cooldown-badge-${item.id}`}
                  style={[t.typography.caption2, { color: t.colors.tone_warning, fontWeight: "700" }]}
                >
                  Cooldown
                </Text>
              ) : null}
            </View>
            <DenseMetricLine
              items={[
                ...targetingMetricItems(item, currency, t),
                {
                  label: "Share",
                  value: formatOptionalPercent(item.placement_share, 0),
                  color: t.colors.text_secondary,
                },
              ]}
            />
          </TouchableOpacity>
          {!selectMode ? (
            <ResponderBox>
              <View style={styles.placementTaps}>
                <MutationTap
                  testID={`targeting-placement-${field}-${campaignId}`}
                  label={fieldMeta?.label ?? placementLabel}
                  compact
                  value={formatPlacementAdjustmentValue(adjustments, field)}
                  cooldown={cooldown}
                  onPress={onEdit}
                />
              </View>
            </ResponderBox>
          ) : null}
        </View>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  leadRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: layout.minTap },
  switchWell: { minWidth: 42, alignItems: "flex-start", justifyContent: "center" },
  selectHit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  placementTaps: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  filterGroup: {
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  filterCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: dashboard.pageInset,
    paddingVertical: density.listRowPad,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: dashboard.pageInset,
    paddingVertical: density.listRowPad,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookRowCoverSlotXs: {
    width: 36,
    height: 52,
    borderRadius: 8,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  bookRowCover: {
    marginRight: 0,
  },
  bookRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rangesToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: dashboard.pageInset,
    paddingVertical: density.listRowPad,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  advGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  advField: {
    width: "47%",
    minWidth: 140,
    flexGrow: 1,
  },
  advInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  outboxBanner: {
    marginTop: 8,
    marginHorizontal: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bulkBar: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  bulkScroll: {
    flexDirection: "row",
    gap: 10,
  },
  bulkBtn: {
    minWidth: 88,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
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
  filterSheet: {
    flex: 1,
  },
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
    // Extra clearance so Book / ranges clear the home indicator (and dev toast).
    paddingBottom: layout.tabClearance,
    gap: spacing.xxs,
  },
});
