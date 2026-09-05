import React, { useEffect, useMemo, useState } from "react";
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
import { noPeriodPlaceholder, periodQueryKey, LIST_PERIOD_QUERY_CACHE, STABLE_SCOPED_CACHE, sortedProfileIds } from "@/src/lib/periodQuery";
import { takePendingQaFilters } from "@/src/lib/qaCommand";
import { isHomeQueryTimeout, queryStillWaiting, TARGETING_QUERY_TIMEOUT_MS, withQueryTimeout } from "@/src/lib/queryTimeout";
import {
  fetchAdGroupDefaultBids,
  fetchKeywords,
  fetchProductTargets,
  fetchTargetingBookOptions,
  fetchTopCampaignsRange,
  TARGETING_LIST_LIMIT,
  type TargetingBookOption,
} from "@/src/lib/queries";
import { shouldShowActiveOrPausedWithData } from "@/src/lib/campaigns";
import {
  clampAmazonBid,
  drainBulkOutbox,
  enqueueBulkAmazonWrites,
  enqueueEntityBidWrite,
  getBulkOutboxSnapshot,
  loadBulkSelectionMemory,
  retryPermanentBulkFailures,
  saveBulkSelectionMemory,
  type BulkEntityKind,
  type EnqueueBulkInput,
} from "@/src/lib/bulkOutbox";
import {
  describeProductTarget,
  extractTargetAsin,
  fallbackAsinCoverUrl,
  isCategoryTarget,
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
  compareTargetingRows,
  countActiveAdvancedFilters,
  EMPTY_TARGETING_ADVANCED_FILTERS,
  hasActiveAdvancedFilters,
  matchesAdvancedFilters,
  normalizeTargetingAdvancedFilters,
  parseFilterRangeInput,
  requiresBidChangeConfirm,
  resolveTargetingSortKey,
  advancedSortOverridesExplicit,
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
import { alertMutationError, BidBudgetEditor, EntityStateSwitch, MutationTap } from "@/src/components/Mutations";
import {
  formatCooldownRemaining,
  getEntityBidCooldown,
  type EntityBidCooldownFields,
} from "@/src/lib/bidCooldown";
import { applyOptimisticEntityBid, applyOptimisticEntityState, invalidateEntityStateQueries, revertOptimisticEntityBid, revertOptimisticEntityState, useInvalidateAds } from "@/src/lib/invalidateAds";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, dashboard, toneColor, layout, radii, spacing } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, ToneDot, RetryState, DenseMetricLine, FilterChrome, FilterSearchRow, FilterIconButton, ActiveFilterChip, ActiveFilterRow, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, SFSymbol } from "@/src/components/ios/Native";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { enabledSpoken, matchTypeSpoken, targetingSpeech } from "@/src/lib/targetingA11y";
import { type Href, useRouter } from "expo-router";

type Segment = "keywords" | "asins" | "auto" | "category" | "placement";

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
): { count: number; labels: string[]; remainingHint: string } {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const labels: string[] = [];
  let maxRemaining = 0;
  for (const id of selectedIds) {
    const row = byId.get(String(id)) as EntityBidCooldownFields | undefined;
    if (!row) continue;
    const info = getEntityBidCooldown(row);
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

const PERF_FILTERS: { key: PerfFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "wasting", label: "Waste" },
  { key: "high_acos", label: "ACoS high" },
  { key: "low_acos", label: "ACoS low" },
  { key: "no_sales", label: "$0" },
  { key: "profitable", label: "Profit" },
  { key: "has_clicks", label: "Clicks" },
  { key: "has_orders", label: "Orders" },
  { key: "has_impressions", label: "Impr" },
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
  { key: "top_of_search", label: "Top", title: "Top of search" },
  { key: "product_pages", label: "Product", title: "Product pages" },
  { key: "rest_of_search", label: "Rest", title: "Rest of search" },
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
    { label: "Spend", value: formatCurrency(m.spend, currency, { compact: true }) },
    { label: "Impr", value: formatInt(m.impressions) },
    { label: "Clicks", value: formatInt(m.clicks) },
    { label: "Ord", value: formatInt(m.orders) },
    {
      label: "ACoS",
      value: m.sales > 0 ? formatPercent(m.acos) : "—",
      color: toneColor(acosTone(m.acos), t.colors),
    },
  ];
}

function matchesPerf(item: any, filter: PerfFilter) {
  if (filter === "all") return true;
  const { spend, sales, orders, acos, clicks, impressions } = rowMetrics(item);
  if (filter === "wasting") return spend > 0 && orders === 0;
  if (filter === "high_acos") return sales > 0 && acos > 35;
  if (filter === "low_acos") return sales > 0 && acos > 0 && acos <= 20;
  if (filter === "no_sales") return sales === 0;
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

function emptyCopy(segment: Segment) {
  if (segment === "keywords") return { icon: "search-outline" as const, title: "No keywords found" };
  if (segment === "auto") return { icon: "options-outline" as const, title: "No auto targets found" };
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
  const queryClient = useQueryClient();
  const invalidateAds = useInvalidateAds();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer } = useApp();
  const [segment, setSegment] = useState<Segment>("keywords");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("acos");
  const [perf, setPerf] = useState<PerfFilter>("all");
  const [bookAsin, setBookAsin] = useState<string | null>(null);
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeltaEditor, setBulkDeltaEditor] = useState<BulkDeltaMode | null>(null);
  const [advanced, setAdvanced] = useState<TargetingAdvancedFilters>({ ...EMPTY_TARGETING_ADVANCED_FILTERS });
  const [outboxPending, setOutboxPending] = useState(0);
  const [outboxFailed, setOutboxFailed] = useState(0);

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
      if (typeof filters.bookAsin === "string" && filters.bookAsin) setBookAsin(filters.bookAsin);
      if (filters.sort && SORT_OPTIONS.some((s) => s.key === filters.sort)) setSort(filters.sort as SortKey);
      if (filters.advanced) setAdvanced(normalizeTargetingAdvancedFilters(filters.advanced));
      if (Array.isArray(sel.ids)) setSelectedIds(sel.ids.filter((id) => typeof id === "string"));
      if (sel.selectMode) setSelectMode(true);
    });
    void refreshOutboxCounts();
    void drainBulkOutbox().then(() => refreshOutboxCounts());
  }, []);

  useEffect(() => {
    void saveTargetingFilterMemory({
      segment,
      perf,
      sort,
      bookAsin: bookAsin ?? undefined,
      advanced,
    });
  }, [segment, perf, sort, bookAsin, advanced]);

  useEffect(() => {
    void saveBulkSelectionMemory({ segment, ids: selectedIds, selectMode });
  }, [segment, selectedIds, selectMode]);

  async function refreshOutboxCounts() {
    const snap = await getBulkOutboxSnapshot();
    setOutboxPending(snap.pending + snap.inFlight);
    setOutboxFailed(snap.failed);
  }

  const listQueryOpts = {
    start: dateRange.start,
    end: dateRange.end,
    limit: TARGETING_LIST_LIMIT,
    filterUserId: adminFilterUserId,
  } as const;
  const scopeProfiles = useMemo(() => sortedProfileIds(selectedProfileIds), [selectedProfileIds]);
  const periodKey = periodQueryKey(dateRange, scopeProfiles);
  const profileScopeKey = scopeProfiles.join("|");
  const targetingListCache = {
    ...LIST_PERIOD_QUERY_CACHE,
    placeholderData: noPeriodPlaceholder,
  } as const;

  const keywordsQ = useQuery({
    queryKey: ["targeting-keywords", adminFilterUserId ?? "self", periodKey],
    queryFn: async ({ signal }) => {
      markPerf("targets.keywords.start");
      const rows = await withQueryTimeout(
        fetchKeywords(scopeProfiles, listQueryOpts),
        TARGETING_QUERY_TIMEOUT_MS,
        signal,
      );
      markPerf("targets.keywords.end");
      return rows;
    },
    enabled: scopeProfiles.length > 0,
    ...targetingListCache,
  });

  const productsQ = useQuery({
    queryKey: ["targeting-products", adminFilterUserId ?? "self", periodKey, "skip-kdp"],
    queryFn: async ({ signal }) => {
      markPerf("targets.products.start");
      const rows = await withQueryTimeout(
        fetchProductTargets(scopeProfiles, { ...listQueryOpts, skipKdpEnrich: true }),
        TARGETING_QUERY_TIMEOUT_MS,
        signal,
      );
      markPerf("targets.products.end");
      return rows;
    },
    enabled: scopeProfiles.length > 0,
    ...targetingListCache,
  });

  const adGroupDefaultBidsQ = useQuery({
    queryKey: ["targeting-adgroup-default-bids", adminFilterUserId ?? "self", profileScopeKey],
    queryFn: () => fetchAdGroupDefaultBids(scopeProfiles),
    enabled: scopeProfiles.length > 0,
    ...STABLE_SCOPED_CACHE,
  });
  const defaultBidByAdGroupId = adGroupDefaultBidsQ.data ?? {};

  const booksQ = useQuery({
    queryKey: ["targeting-book-options-v2", adminFilterUserId ?? "self", profileScopeKey],
    queryFn: () =>
      fetchTargetingBookOptions(scopeProfiles, { filterUserId: adminFilterUserId }),
    enabled: scopeProfiles.length > 0,
    ...STABLE_SCOPED_CACHE,
  });
  const bookOptions = booksQ.data ?? [];
  const selectedBook = bookAsin ? bookOptions.find((b) => b.asin === bookAsin) ?? null : null;
  const bookCampaignIds = useMemo(
    () => new Set(selectedBook?.campaignIds ?? []),
    [selectedBook],
  );
  const campaignBookById = useMemo(
    () => buildCampaignBookMap(bookOptions, bookAsin),
    [bookOptions, bookAsin],
  );

  const productSegmentBuckets = useMemo(() => {
    const buckets: Record<Exclude<Segment, "keywords" | "placement">, any[]> = {
      asins: [],
      auto: [],
      category: [],
    };
    for (const product of productsQ.data ?? []) {
      const described = describeProductTarget(product.expression, product.expression_type, product.resolved_expression);
      const category = isCategoryTarget(product.expression, product.expression_type);
      const enriched = { ...product, __targetingDescription: described, __targetingIsCategory: category };
      if (described.isAuto) buckets.auto.push(enriched);
      else if (category) buckets.category.push(enriched);
      else buckets.asins.push(enriched);
    }
    return buckets;
  }, [productsQ.data]);

  // Drop a remembered book filter that isn't in the current profile set — never
  // show an empty misleading "book filter" with no matching campaigns.
  useEffect(() => {
    if (!bookAsin) return;
    if (booksQ.isLoading || booksQ.isFetching) return;
    if (!booksQ.isFetched) return;
    if (selectedBook) return;
    setBookAsin(null);
  }, [bookAsin, booksQ.isFetched, booksQ.isFetching, booksQ.isLoading, selectedBook]);

  const placementsQ = useQuery({
    queryKey: ["targeting-placements-v2", adminFilterUserId ?? "self", periodKey],
    queryFn: async ({ signal }) => {
      markPerf("targets.placements.start");
      const rows = await withQueryTimeout(
        fetchTopCampaignsRange({
          profileIds: scopeProfiles,
          start: dateRange.start,
          end: dateRange.end,
          limit: TARGETING_LIST_LIMIT,
          filterUserId: adminFilterUserId,
        }),
        TARGETING_QUERY_TIMEOUT_MS,
        signal,
      );
      markPerf("targets.placements.end");
      return rows;
    },
    enabled: scopeProfiles.length > 0,
    ...targetingListCache,
  });

  // Prefetch real Amazon placement % (never invent 0 when Amazon returns null).
  useEffect(() => {
    const rows = placementsQ.data;
    if (!rows?.length) return;
    let cancelled = false;
    const missing = rows
      .map((row: any) => String(row.id || ""))
      .filter((id: string) => id && placementAdj[id] == null);
    if (!missing.length) return;
    void prefetchCampaignPlacementAdjustments(missing, { concurrency: 8 }).then((map) => {
      if (cancelled || !Object.keys(map).length) return;
      setPlacementAdj((prev) => ({ ...map, ...prev }));
    });
    return () => {
      cancelled = true;
    };
    // Only re-run when the placement list identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementsQ.data]);

  const data = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows: any[] = [];

    if (segment === "keywords") {
      rows = (keywordsQ.data ?? [])
        .filter((k) => shouldShowActiveOrPausedWithData(k as any, k.status))
        .filter((k) => (needle ? (k.keyword_text ?? "").toLowerCase().includes(needle) : true));
    } else if (segment === "placement") {
      rows = (placementsQ.data ?? [])
        .map(normalizePlacementCampaignMetrics)
        .map((c) => enrichPlacementRowWithBook(c, campaignBookById))
        .filter((c) => shouldShowActiveOrPausedWithData(c as any, c.state))
        .filter((c) => (needle ? (c.name ?? "").toLowerCase().includes(needle) : true));
    } else {
      rows = productSegmentBuckets[segment]
        .filter((p) => shouldShowActiveOrPausedWithData(p as any, p.state))
        .filter((p) => {
          if (!needle) return true;
          const described = p.__targetingDescription;
          return (
            (p.title ?? "").toLowerCase().includes(needle) ||
            productTargetHeading(p).toLowerCase().includes(needle) ||
            String(described?.label ?? "")
              .toLowerCase()
              .includes(needle) ||
            String(described?.name ?? "")
              .toLowerCase()
              .includes(needle) ||
            String(described?.asin ?? "")
              .toLowerCase()
              .includes(needle) ||
            extractTargetAsin(p.expression).toLowerCase().includes(needle)
          );
        });
    }

    rows = rows.filter((row) => matchesPerf(row, perf));

    // Don't apply book filter until options are fetched — otherwise a remembered
    // ASIN empties the list while booksQ is still loading (misleading "no matches").
    if (bookAsin && booksQ.isFetched) {
      const needleAsin = bookAsin.toUpperCase();
      rows = rows.filter((row: any) => {
        if (segment === "placement") {
          // Nest aggregated campaigns often omit book_asin — match via book→campaign map.
          if (bookCampaignIds.has(String(row.id || ""))) return true;
          return String(row.book_asin || "").toUpperCase() === needleAsin;
        }
        if (segment === "keywords") {
          return bookCampaignIds.has(String(row.campaign_id || ""));
        }
        const described =
          row.__targetingDescription ??
          describeProductTarget(row.expression, row.expression_type, row.resolved_expression);
        const asin = (
          described?.asin ||
          extractTargetAsin(row.expression) ||
          String(row.cover_asin || "")
        ).toUpperCase();
        if (asin && asin === needleAsin) return true;
        // Auto / category under a book campaign
        return bookCampaignIds.has(String(row.campaign_id || ""));
      });
    }

    if (hasActiveAdvancedFilters(advanced)) {
      const filtersForSegment = advancedFiltersForSegment(segment, advanced);
      rows = rows.filter((row: any) => {
        const bid = baseBidForRow(segment, row, defaultBidByAdGroupId);
        return matchesAdvancedFilters(rowMetricsFromEntity(row, bid), filtersForSegment);
      });
    }

    const effectiveSort = resolveTargetingSortKey(sort, advanced);
    return [...rows].sort((a: any, b: any) =>
      compareTargetingRows(
        rowMetricsFromEntity(a, baseBidForRow(segment, a, defaultBidByAdGroupId)),
        rowMetricsFromEntity(b, baseBidForRow(segment, b, defaultBidByAdGroupId)),
        effectiveSort,
      ),
    );
  }, [
    segment,
    search,
    sort,
    perf,
    bookAsin,
    bookCampaignIds,
    campaignBookById,
    booksQ.isFetched,
    advanced,
    defaultBidByAdGroupId,
    keywordsQ.data,
    productSegmentBuckets,
    placementsQ.data,
  ]);

  const activeQuery = segment === "keywords" ? keywordsQ : segment === "placement" ? placementsQ : productsQ;
  const isError = activeQuery.isError;
  const isRefetching = activeQuery.isRefetching;

  useEffect(() => {
    const err = activeQuery.error instanceof Error ? activeQuery.error.message : activeQuery.isError ? "error" : "ok";
    console.log(
      `[inteliads:targeting] segment=${segment} period=${dateRange.start}..${dateRange.end} ` +
        `kw=${keywordsQ.fetchStatus}/${keywordsQ.data?.length ?? "-"} ` +
        `prod=${productsQ.fetchStatus}/${productsQ.data?.length ?? "-"} ` +
        `place=${placementsQ.fetchStatus}/${placementsQ.data?.length ?? "-"} active=${err}`,
    );
  }, [
    segment,
    dateRange.start,
    dateRange.end,
    keywordsQ.fetchStatus,
    keywordsQ.data?.length,
    productsQ.fetchStatus,
    productsQ.data?.length,
    placementsQ.fetchStatus,
    placementsQ.data?.length,
    activeQuery.isError,
    activeQuery.error,
  ]);

  const showBlockingSpinner =
    data.length === 0 &&
    !activeQuery.isPlaceholderData &&
    !isError &&
    (queryStillWaiting(activeQuery) || activeQuery.isFetching);
  const listTruncated =
    !showBlockingSpinner &&
    !isError &&
    Array.isArray(activeQuery.data) &&
    activeQuery.data.length >= TARGETING_LIST_LIMIT;

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
    if ((action === "bid_delta" || action === "set_bid") && segment === "placement") {
      Alert.alert("Not available", "Dollar bid bulk edits apply to keywords and targets. Use placement % on each campaign, or Pause / Enable here.");
      return;
    }
    const kind = entityKindForSegment(segment);
    const byId = new Map(data.map((row) => [row.id, row]));
    const inputs: EnqueueBulkInput[] = [];
    let skippedNoBid = 0;
    for (const id of selectedIds) {
      const row = byId.get(id);
      const baseBid = row ? baseBidForRow(segment, row, defaultBidByAdGroupId) : null;
      if ((action === "bid_delta" || action === "set_bid") && (baseBid == null || !(baseBid > 0))) {
        skippedNoBid += 1;
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
          entityId: id,
          action: "set_bid",
          bid: nextBid,
          baseBid,
        });
        continue;
      }
      inputs.push({
        entityKind: kind,
        entityId: id,
        action,
        deltaUsd: opts?.deltaUsd,
        baseBid,
      });
    }
    if (!inputs.length) {
      Alert.alert(
        "Nothing queued",
        skippedNoBid > 0
          ? "Selected rows are missing a current bid, so dollar edits were skipped."
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
      const { count } = await enqueueBulkAmazonWrites(inputs);
      setSelectedIds([]);
      setSelectMode(false);
      await refreshOutboxCounts();
      const skipNote =
        skippedNoBid > 0 ? ` Skipped ${skippedNoBid} without a current bid.` : "";
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

    const cooldown = selectedCooldownSummary(segment, selectedIds, data);
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
    Alert.alert(
      `Pause ${selectedIds.length} ${selectedIds.length === 1 ? "item" : "items"}?`,
      "Writes to Amazon Ads. Continues in the background if you leave Targets.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pause", style: "destructive", onPress: () => void enqueueSelected("pause") },
      ],
    );
  };

  const confirmEnableSelected = () => {
    if (!selectedIds.length) return;
    Alert.alert(
      `Enable ${selectedIds.length} ${selectedIds.length === 1 ? "item" : "items"}?`,
      "Writes to Amazon Ads. Continues in the background if you leave Targets.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Enable", onPress: () => void enqueueSelected("enable") },
      ],
    );
  };

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

  const empty = emptyCopy(segment);
  const perfLabel = PERF_FILTERS.find((entry) => entry.key === perf)?.label ?? "All";
  const sortLabel = SORT_OPTIONS.find((entry) => entry.key === sort)?.label ?? "ACoS";
  const effectiveSortKey = resolveTargetingSortKey(sort, advanced);
  const effectiveSortLabel =
    SORT_OPTIONS.find((entry) => entry.key === effectiveSortKey)?.label ?? "ACoS";
  const sortOverridden = advancedSortOverridesExplicit(sort, advanced);
  const bookFilterLabel = selectedBook
    ? selectedBook.title.length > 28
      ? `${selectedBook.title.slice(0, 26)}…`
      : selectedBook.title
    : bookAsin
      ? bookAsin
      : null;
  const advancedCount = countActiveAdvancedFilters(advanced);
  const cooldownSelected = useMemo(
    () => selectedCooldownSummary(segment, selectedIds, data),
    [segment, selectedIds, data],
  );
  const canBulkBid = segment !== "placement";

  const filtersActive =
    perf !== "all" || sort !== "acos" || !!bookAsin || hasActiveAdvancedFilters(advanced);
  const filterSummary = [
    bookFilterLabel ? `Book: ${bookFilterLabel}` : null,
    perf !== "all" ? perfLabel : null,
    sortOverridden
      ? `Sort: ${effectiveSortLabel} (from range)`
      : sort !== "acos"
        ? `Sort: ${sortLabel}`
        : hasActiveAdvancedFilters(advanced)
          ? `Sort: ${effectiveSortLabel}`
          : null,
    advancedCount > 0 ? `${advancedCount} range` : null,
  ].filter(Boolean).join(" · ");

  return (
    <AppScreen>
      <TopBar />

      <FilterChrome>
        <View
          testID="targeting-segments"
          style={styles.segmentWrap}
          accessibilityRole="tablist"
        >
          {SEGMENTS.map((s) => {
            const active = segment === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                testID={`segment-${s.key}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.label}
                onPress={() => {
                  setSegment(s.key);
                  setSelectedIds([]);
                }}
                style={[
                  styles.segmentChip,
                  {
                    backgroundColor: active ? t.colors.tone_primary + "22" : t.colors.background_tertiary,
                    borderColor: active ? t.colors.tone_primary + "66" : t.colors.separator,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    {
                      color: active ? t.colors.tone_primary : t.colors.text_secondary,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <FilterSearchRow>
          <View style={{ flex: 1, minWidth: 0 }}>
            <IOSSearchBar
              testID="targeting-search"
              placeholder={searchPlaceholder(segment)}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <ActiveFilterChip
            testID="targeting-select-btn"
            label={selectMode ? "Done" : "Select"}
            accessibilityLabel={selectMode ? "Exit bulk select" : "Bulk select"}
            onPress={() => {
              if (selectMode) clearSelection();
              else setSelectMode(true);
            }}
          />
          <FilterIconButton
            testID="targeting-filter-btn"
            active={filtersActive}
            accessibilityLabel={filtersActive ? `Filters: ${filterSummary}` : "Filters and sort"}
            accessibilityHint="Opens performance, ranges, and sort options"
            onPress={() => setFilterOpen(true)}
          />
        </FilterSearchRow>
        {selectMode || selectedIds.length > 0 ? (
          <ActiveFilterRow>
            <ActiveFilterChip
              testID="targeting-select-all"
              label={`Select all (${data.length})`}
              accessibilityLabel={`Select all ${data.length} visible rows`}
              onPress={selectAllVisible}
            />
            <ActiveFilterChip
              testID="targeting-selected-count"
              label={`${selectedIds.length} selected`}
              accessibilityLabel={`${selectedIds.length} selected. Bulk bid actions appear below.`}
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
        {selectMode && selectedIds.length === 0 ? (
          <Text
            style={[
              t.typography.caption1,
              { color: t.colors.text_tertiary, marginHorizontal: 16, marginBottom: 4 },
            ]}
          >
            {canBulkBid
              ? "Tap rows to select, then use Bid +$ / −$ / +% / −% below."
              : "Tap campaigns to select, then Pause or Enable. Bid ± is for Keywords / ASINs / Auto / Category."}
          </Text>
        ) : null}
        {filtersActive ? (
          <ActiveFilterRow>
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
            {sortOverridden ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-sort"
                label={`Sort: ${effectiveSortLabel} · range`}
                accessibilityLabel={`Sort is ${effectiveSortLabel} because an advanced range is active. Clear ranges to use manual sort.`}
                onPress={() => setAdvanced({ ...EMPTY_TARGETING_ADVANCED_FILTERS })}
              />
            ) : sort !== "acos" ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-sort"
                label={`Sort: ${sortLabel}`}
                accessibilityLabel={`Clear sort. Currently ${sortLabel}`}
                onPress={() => setSort("acos")}
              />
            ) : null}
            {advancedCount > 0 ? (
              <ActiveFilterChip
                testID="targeting-filter-chip-advanced"
                label={`${advancedCount} range · ${effectiveSortKey.toUpperCase()}`}
                accessibilityLabel={`Clear advanced min max filters. List sorted by ${effectiveSortLabel}.`}
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
                ? `Writing ${outboxPending} Amazon change${outboxPending === 1 ? "" : "s"}… keeps going if you leave.`
                : `${outboxFailed} change${outboxFailed === 1 ? "" : "s"} need review.`}
            </Text>
            <TouchableOpacity
              onPress={() =>
                void (async () => {
                  if (outboxFailed > 0) await retryPermanentBulkFailures();
                  else await drainBulkOutbox();
                  await refreshOutboxCounts();
                })()
              }
              accessibilityRole="button"
              accessibilityLabel="Retry Amazon writes"
            >
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "700" }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </FilterChrome>

      {showBlockingSpinner ? (
        <ScreenSpinner />
      ) : isError && data.length === 0 ? (
        <RetryState
          title={
            segment === "keywords"
              ? "Couldn't load keywords"
              : segment === "auto"
                ? "Couldn't load auto targets"
                : segment === "category"
                  ? "Couldn't load category targets"
                  : segment === "placement"
                    ? "Couldn't load campaigns"
                    : "Couldn't load product targets"
          }
          subtitle={
            isHomeQueryTimeout(activeQuery.error)
              ? "This range took too long. Try Week instead of Month, or pull to retry."
              : /period metrics/i.test(
                    activeQuery.error instanceof Error ? activeQuery.error.message : "",
                  )
                ? "Period metrics couldn't be loaded, so nothing is shown instead of fake zeros. Pull to retry."
                : "Check your connection and try again."
          }
          onRetry={() => {
            void activeQuery.refetch();
          }}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{
            padding: t.layout.pagePad,
            paddingBottom: selectedIds.length > 0 ? t.layout.tabClearance + 110 : t.layout.tabClearance,
          }}
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
                  : filtersActive
                    ? segment === "placement" && (advanced.bidMin != null || advanced.bidMax != null)
                      ? "Bid min/max apply to keywords and targets, not Placement. Clear bid ranges or switch segment."
                      : "No rows match these period filters — not missing data. Clear a filter or widen the range."
                    : undefined
              }
            />
          }
          ListFooterComponent={
            listTruncated ? (
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, textAlign: "center", marginTop: t.spacing.md }]}>
                List capped at {TARGETING_LIST_LIMIT} rows for speed (not an Amazon write limit). fair per-profile fetch
                across {scopeProfiles.length} profile{scopeProfiles.length === 1 ? "" : "s"} for this period. Filter by
                book / performance or narrow dates to see a different set. Bulk Bid ± still writes every selected row to
                Amazon via the background outbox.
              </Text>
            ) : null
          }
          renderItem={({ item }: any) => {
            const selected = selectedIds.includes(item.id);
            const onRowPress = () => {
              if (selectMode) {
                toggleSelected(item.id);
                return;
              }
              if (segment === "keywords") router.push(`/keyword/${item.id}` as Href);
              else if (segment === "placement") router.push(`/campaign/${item.id}`);
              else router.push(`/target/${item.id}` as Href);
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
                  currency={primaryCurrency}
                  t={t}
                  onPress={onRowPress}
                  onEditBid={() =>
                    setMoneyEditor({
                      entity: "keyword",
                      id: item.id,
                      title: item.keyword_text ?? "Keyword bid",
                      value: baseBidForRow("keywords", item, defaultBidByAdGroupId) ?? 0.02,
                    })
                  }
                  {...selectProps}
                />
              );
            }
            if (segment === "placement") {
              return (
                <PlacementRow
                  item={item}
                  currency={primaryCurrency}
                  t={t}
                  adjustments={placementAdj[item.id]}
                  onPress={onRowPress}
                  onEdit={(field) => void openPlacementEditor(item, field)}
                  {...selectProps}
                />
              );
            }
            return (
              <ProductTargetRow
                item={item}
                currency={primaryCurrency}
                inheritedDefaultBid={
                  item.ad_group_id ? defaultBidByAdGroupId[String(item.ad_group_id)] : undefined
                }
                t={t}
                onPress={onRowPress}
                onEditBid={() =>
                  setMoneyEditor({
                    entity: "target",
                    id: item.id,
                    title: item.title || describeProductTarget(item.expression, item.expression_type).label,
                    value: baseBidForRow(segment, item, defaultBidByAdGroupId) ?? 0.02,
                  })
                }
                {...selectProps}
              />
            );
          }}
        />
      )}

      {selectedIds.length > 0 ? (
        <View
          testID="targeting-bulk-bar"
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
              {cooldownSelected.count} selected on cooldown · tap chip above for names
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
                  <Text style={[t.typography.caption2, { color: t.colors.tone_good }]}>by amount</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-decrease"
                  accessibilityRole="button"
                  accessibilityLabel="Decrease bid by dollar amount"
                  onPress={() => setBulkDeltaEditor("decrease_usd")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_warning + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_warning, fontWeight: "800" }]}>Bid −$</Text>
                  <Text style={[t.typography.caption2, { color: t.colors.tone_warning }]}>by amount</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-increase-pct"
                  accessibilityRole="button"
                  accessibilityLabel="Increase bid by percent"
                  onPress={() => setBulkDeltaEditor("increase_pct")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_good + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "800" }]}>Bid +%</Text>
                  <Text style={[t.typography.caption2, { color: t.colors.tone_good }]}>by percent</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="targeting-bulk-decrease-pct"
                  accessibilityRole="button"
                  accessibilityLabel="Decrease bid by percent"
                  onPress={() => setBulkDeltaEditor("decrease_pct")}
                  style={[styles.bulkBtn, { backgroundColor: t.colors.tone_warning + "22" }]}
                >
                  <Text style={[t.typography.caption1, { color: t.colors.tone_warning, fontWeight: "800" }]}>Bid −%</Text>
                  <Text style={[t.typography.caption2, { color: t.colors.tone_warning }]}>by percent</Text>
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
          const entityKind = moneyEditor.entity === "keyword" ? "keyword" : "product_target";
          const previousBid = applyOptimisticEntityBid(queryClient, entityKind, moneyEditor.id, next);
          try {
            await enqueueEntityBidWrite({
              entityKind,
              entityId: moneyEditor.id,
              bid: next,
              previousBid,
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
          // Patch only the edited field — never default missing siblings to 0.
          const payload: PlacementAdjustments = { [percentEditor.field]: next };
          await updateCampaign(percentEditor.id, { placementAdjustments: payload });
          setPlacementAdj((prev) => ({
            ...prev,
            [percentEditor.id]: { ...(prev[percentEditor.id] ?? {}), ...payload },
          }));
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
              perf={perf}
              sort={sort}
              effectiveSortKey={effectiveSortKey}
              sortOverridden={sortOverridden}
              bookAsin={bookAsin}
              bookOptions={bookOptions}
              advanced={advanced}
              segment={segment}
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
                perf={perf}
                sort={sort}
                effectiveSortKey={effectiveSortKey}
                sortOverridden={sortOverridden}
                bookAsin={bookAsin}
                bookOptions={bookOptions}
                advanced={advanced}
                segment={segment}
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

function FilterSheetFields({
  t,
  perf,
  sort,
  effectiveSortKey = "acos",
  sortOverridden = false,
  bookAsin,
  bookOptions,
  advanced,
  segment = "keywords",
  onPerf,
  onSort,
  onBookAsin,
  onAdvanced,
  onDone,
}: {
  t: any;
  perf: PerfFilter;
  sort: SortKey;
  effectiveSortKey?: SortKey;
  sortOverridden?: boolean;
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
  onPerf: (next: PerfFilter) => void;
  onSort: (next: SortKey) => void;
  onBookAsin: (next: string | null) => void;
  onAdvanced: (next: TargetingAdvancedFilters) => void;
  onDone: () => void;
}) {
  const [advDrafts, setAdvDrafts] = useState<Partial<Record<keyof TargetingAdvancedFilters, string>>>({});
  const INT_RANGE_KEYS = new Set<keyof TargetingAdvancedFilters>([
    "clicksMin",
    "clicksMax",
    "impressionsMin",
    "impressionsMax",
  ]);

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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.filterSheetBody} keyboardShouldPersistTaps="handled">
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: 4 }]}>
          Book
        </Text>
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}>
          Sponsored ASINs on enabled campaigns (same as web).
        </Text>
        <View style={styles.bookGrid}>
          <TouchableOpacity
            testID="targeting-book-all"
            onPress={() => onBookAsin(null)}
            style={[
              styles.bookCard,
              {
                backgroundColor: !bookAsin ? t.colors.tone_primary + "18" : t.colors.background_tertiary,
                borderColor: !bookAsin ? t.colors.tone_primary : t.colors.separator,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: !bookAsin }}
          >
            <View style={[styles.bookCardCoverSlot, { backgroundColor: t.colors.background_secondary }]}>
              <SFSymbol name="books.vertical" size={22} color={!bookAsin ? t.colors.tone_primary : t.colors.text_tertiary} />
            </View>
            <Text
              numberOfLines={2}
              style={[
                t.typography.caption1,
                {
                  color: !bookAsin ? t.colors.tone_primary : t.colors.text_secondary,
                  fontWeight: !bookAsin ? "700" : "600",
                  textAlign: "center",
                },
              ]}
            >
              All books
            </Text>
          </TouchableOpacity>
          {bookOptions.map((book) => {
            const active = bookAsin === book.asin;
            const camps = book.campaignCount ?? book.campaignIds.length;
            return (
              <TouchableOpacity
                key={book.asin}
                testID={`targeting-book-${book.asin}`}
                onPress={() => onBookAsin(active ? null : book.asin)}
                style={[
                  styles.bookCard,
                  {
                    backgroundColor: active ? t.colors.tone_primary + "18" : t.colors.background_tertiary,
                    borderColor: active ? t.colors.tone_primary : t.colors.separator,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${book.title}, ${camps} campaigns`}
              >
                <BookCover
                  uri={book.image_url}
                  fallbackUri={null}
                  asin={null}
                  size="sm"
                  placeholder="book"
                  recyclingKey={`filter-${book.asin}`}
                  style={styles.bookCardCover}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    t.typography.caption1,
                    {
                      color: active ? t.colors.tone_primary : t.colors.text_primary,
                      fontWeight: active ? "700" : "600",
                      textAlign: "center",
                    },
                  ]}
                >
                  {book.title}
                </Text>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, textAlign: "center" }]}>
                  {camps} camp.
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!bookOptions.length ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: t.spacing.xs }]}>
            No active sponsored books on these profiles yet.
          </Text>
        ) : null}
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.sm },
          ]}
        >
          Performance
        </Text>
        <View style={styles.chipWrap}>
          {PERF_FILTERS.map((f) => {
            const active = perf === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`targeting-perf-${f.key}`}
                onPress={() => onPerf(f.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? t.colors.tone_primary + "22" : t.colors.background_tertiary,
                    borderColor: active ? t.colors.tone_primary + "66" : t.colors.separator,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    { color: active ? t.colors.tone_primary : t.colors.text_secondary, fontWeight: active ? "700" : "500" },
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.sm },
          ]}
        >
          {sortOverridden
            ? `Sorting by ${SORT_OPTIONS.find((s) => s.key === effectiveSortKey)?.label ?? effectiveSortKey} (from active range). Clear ranges to use manual sort.`
            : "Sort (high → low). Active bid / ACoS / impr / clicks ranges override this."}
        </Text>
        <View style={styles.chipWrap}>
          {SORT_OPTIONS.map((f) => {
            const active = sortOverridden ? f.key === effectiveSortKey : sort === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                testID={`targeting-sort-${f.key}`}
                onPress={() => onSort(f.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? t.colors.tone_primary + "22" : t.colors.background_tertiary,
                    borderColor: active ? t.colors.tone_primary + "66" : t.colors.separator,
                    opacity: sortOverridden && f.key !== effectiveSortKey ? 0.55 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    { color: active ? t.colors.tone_primary : t.colors.text_secondary, fontWeight: active ? "700" : "500" },
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={[
            t.typography.footnote,
            { color: t.colors.text_secondary, marginTop: t.spacing.lg, marginBottom: t.spacing.sm },
          ]}
        >
          Ranges (period metrics)
          {bidRangesIgnoredOnPlacement ? " · Bid min/max ignored on Placement" : ""}
        </Text>
        <View style={styles.advGrid}>
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
          ).map(([label, key, testID]) => (
            <View key={key} style={styles.advField}>
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginBottom: 4 }]}>{label}</Text>
              <TextInput
                testID={testID}
                value={fieldValue(key)}
                onChangeText={(raw) => setAdvField(key, raw)}
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
                style={[
                  t.typography.callout,
                  styles.advInput,
                  {
                    color: t.colors.text_primary,
                    borderColor: t.colors.separator,
                    backgroundColor: t.colors.background_primary,
                    opacity: bidRangesIgnoredOnPlacement && (key === "bidMin" || key === "bidMax") ? 0.5 : 1,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        {hasActiveAdvancedFilters(advanced) ? (
          <TouchableOpacity
            testID="targeting-adv-clear"
            onPress={() => onAdvanced({ ...EMPTY_TARGETING_ADVANCED_FILTERS })}
            style={{ marginTop: t.spacing.md }}
            accessibilityRole="button"
            accessibilityLabel="Clear advanced ranges"
          >
            <Text style={[t.typography.caption1, { color: t.colors.tone_danger, fontWeight: "700" }]}>
              Clear ranges
            </Text>
          </TouchableOpacity>
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
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: any;
  currency: string;
  t: any;
  onPress: () => void;
  onEditBid: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const queryClient = useQueryClient();
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
                onChange={async (next) => {
                  const previous = applyOptimisticEntityState(queryClient, "keyword", item.id, next);
                  try {
                    await updateKeywordManual(item.id, { status: next ? "enabled" : "paused", forceCooldown: true });
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
              style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1, minWidth: 0 }]}
              numberOfLines={1}
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
            <ToneDot value={Number(item.total_acos)} />
            <Text style={[t.typography.caption2, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
              {status.label}
            </Text>
            {item.match_type ? (
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{item.match_type}</Text>
            ) : null}
            {getEntityBidCooldown(item).isInCooldown ? (
              <Text
                testID={`targeting-cooldown-badge-${item.id}`}
                style={[t.typography.caption2, { color: t.colors.tone_warning, fontWeight: "700" }]}
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
  onPress: () => void;
  onEditBid: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const queryClient = useQueryClient();
  const target = describeProductTarget(item.expression, item.expression_type, item.resolved_expression);
  const displayTitle = productTargetHeading(item);
  const category = isCategoryTarget(item.expression, item.expression_type);
  const coverAsin = target.asin || item.cover_asin || null;
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
                onChange={async (next) => {
                  const previous = applyOptimisticEntityState(queryClient, "product_target", item.id, next);
                  try {
                    await updateProductTargetManual(item.id, { state: next ? "enabled" : "paused", forceCooldown: true });
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
                  style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", flex: 1, minWidth: 0 }]}
                  numberOfLines={1}
                >
                  {displayTitle}
                </Text>
                <ResponderBox>
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
                </ResponderBox>
              </View>
              <View style={styles.metaRow}>
                <ToneDot value={Number(item.total_acos)} />
                <Text style={[t.typography.caption2, { color: toneColor(target.tone, t.colors) }]}>
                  {target.isAuto
                    ? `Auto · ${target.label}`
                    : category
                      ? target.asin
                        ? `Category · ${target.asin}`
                        : "Category"
                      : target.asin && displayTitle !== target.asin
                        ? `${target.label} · ${target.asin}`
                        : target.label}
                </Text>
                {getEntityBidCooldown(item).isInCooldown ? (
                  <Text
                    testID={`targeting-cooldown-badge-${item.id}`}
                    style={[t.typography.caption2, { color: t.colors.tone_warning, fontWeight: "700" }]}
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
  adjustments?: PlacementAdjustments;
  onPress: () => void;
  onEdit: (field: PlacementField) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const coverAsin = item.book_asin ? String(item.book_asin).toUpperCase() : null;
  const hasBook = Boolean(coverAsin);
  const bookSubtitle = item.book_title
    ? String(item.book_title)
    : hasBook
      ? coverAsin
      : "No linked book";
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
              item.name ?? "Campaign",
              hasBook ? bookSubtitle : "No linked book",
              "Placement bid adjustments",
              `Spend ${formatCurrency(Number(item.total_spend ?? item.spend) || 0, currency)}`,
              `Orders ${formatInt(Number(item.total_orders ?? item.orders) || 0)}`,
            ])}
            accessibilityHint={selectMode ? "Toggles bulk selection" : "Opens campaign details"}
          >
            <View style={styles.cardHeader}>
              <BookCover
                // Prefer KDP/product image only — Amazon P/{ASIN} often returns a blank gray tile.
                uri={hasBook ? item.book_image_url : null}
                fallbackUri={null}
                asin={null}
                size="xs"
                placeholder={hasBook ? "book" : "cube"}
                recyclingKey={coverAsin || item.id}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
                  {item.name ?? "Campaign"}
                </Text>
                <Text
                  style={[
                    t.typography.caption2,
                    {
                      color: hasBook ? t.colors.text_secondary : t.colors.text_tertiary,
                      marginTop: 2,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {bookSubtitle}
                </Text>
              </View>
            </View>
            <DenseMetricLine items={targetingMetricItems(item, currency, t)} />
          </TouchableOpacity>
          {!selectMode ? (
            <ResponderBox>
              <View style={styles.placementTaps}>
                {PLACEMENT_FIELDS.map((field) => (
                  <MutationTap
                    key={field.key}
                    testID={`targeting-placement-${field.key}-${item.id}`}
                    label={field.label}
                    compact
                    value={formatPlacementAdjustmentValue(adjustments, field.key)}
                    onPress={() => onEdit(field.key)}
                  />
                ))}
              </View>
            </ResponderBox>
          ) : null}
        </View>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  leadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  switchWell: { minWidth: 42, alignItems: "flex-start", justifyContent: "center" },
  selectHit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  segmentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
    paddingLeft: 2,
    paddingRight: 2,
  },
  segmentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bookGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  bookCard: {
    width: "30%",
    minWidth: 96,
    maxWidth: 120,
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    alignItems: "center",
    gap: 6,
  },
  bookCardCoverSlot: {
    width: 40,
    height: 58,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  bookCardCover: {
    marginRight: 0,
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
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingBottom: spacing.lg,
    gap: spacing.xxs,
  },
});
