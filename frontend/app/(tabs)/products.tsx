import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Animated,
  Platform,
} from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { AppScreen } from "@/src/components/ScreenAmbient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { markPerf } from "@/src/lib/perf";
import { takePendingQaFilters } from "@/src/lib/qaCommand";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { BooksReadError, fetchKdpRoyaltiesRange, fetchTopBooksRange, type TopBookRow } from "@/src/lib/queries";
import { fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { BookCover } from "@/src/components/BookCover";
import {
  formatBreakEvenAcos,
  hasAuthoritativeBreakEven,
  isOverBreakEven,
} from "@/src/lib/kdpTitlePresentation";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor, useReduceMotion, dashboard } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt, parseDateOnly, toDateString } from "@/src/lib/format";
import { useAuth } from "@/src/contexts/AuthContext";
import { useKdpRoyaltySetupPrompt } from "@/src/hooks/useKdpRoyaltySetupPrompt";
import { useScrollChromeCollapse } from "@/src/hooks/useScrollChromeCollapse";
import { NET_ROYALTIES_LABEL, netRoyaltiesVoiceOver, resolveBookNet, bookNetIsKnown } from "@/src/lib/netRoyalties";
import { buildBookColorMap, bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, RetryState, MetricStrip, FilterChrome, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { isHomeQueryTimeout, TARGETING_QUERY_TIMEOUT_MS, withQueryTimeout } from "@/src/lib/queryTimeout";
import { FINANCIAL_QUERY_ROOTS, financialQueryMeta } from "@/src/lib/financialReadVersion";
import { LIST_PERIOD_QUERY_CACHE, sameScopeWarmPlaceholder, sortedProfileIds } from "@/src/lib/periodQuery";
import { booksEmptyCopy } from "@/src/lib/booksListActivity";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import {
  isKdpOnlySessionScope,
  knownKdpRoyaltyTotal,
  kdpRoyaltiesQueryAllowed,
} from "@/src/lib/kdpRoyaltyScope";
import { compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { loadBooksFilterMemory, saveBooksFilterMemory } from "@/src/lib/filterMemory";
import { countriesForSponsoredBook, marketplaceFlagsA11y, type SponsoredMarketplaceIndex } from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { BookMarketplaceFlags } from "@/src/components/MarketplaceFlags";
import { bookDisplayTitle } from "@/src/lib/bookPresentation";
import {
  booksListAwaitingRows,
  booksMoneyProfileIds,
  booksRoyaltyScopeForSelection,
  enabledSelectedProfileIds,
  overviewKdpQueryScope,
} from "@/src/lib/booksProfileScope";

type Sort = "net" | "spend" | "acos" | "orders";

function emptyCopy(
  search: string,
  opts: { iosHelperOn: boolean; hasLinkedKdp: boolean; hasAccountRoyalties: boolean },
) {
  return booksEmptyCopy(search, opts);
}

function bookAdsReady(item: TopBookRow): boolean {
  return item.ads_state !== "pending" && item.ads_state !== "missing";
}

function bookKdpAvailable(item: TopBookRow): boolean {
  return item.kdp_state !== "missing" && item.royalties != null;
}

/** Royalties known well enough to compute net (partial coverage still shows a number). */
function bookKdpReady(item: TopBookRow): boolean {
  return bookKdpAvailable(item);
}

function bookStatus(item: TopBookRow, hasBreakEven: boolean): { label: string; tone: "good" | "warning" | "danger" } {
  if (!bookAdsReady(item)) return { label: "Loading ads", tone: "warning" };
  if (!bookKdpAvailable(item)) return { label: "Royalties unavailable", tone: "warning" };
  if (item.kdp_state === "partial") return { label: "Royalties partial", tone: "warning" };
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  // Verdict follows the SAME resolved net as the displayed profit. KDP royalties
  // can make a book net-positive even with zero ads orders, so the net sign wins
  // first; "Spending without sales" only applies when net is negative/unknown.
  const resolved = resolveBookNet(item);
  if (resolved != null) {
    if (resolved >= 0) return { label: "Net positive", tone: "good" };
    if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
    return { label: "Net negative", tone: "danger" };
  }
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
  if (hasBreakEven && item.acos > item.breakeven_acos) return { label: "Over break-even", tone: "warning" };
  return { label: "Net negative", tone: "danger" };
}

function bookA11yLabel(item: TopBookRow, status: { label: string }, currency: string, marketplaceLabel?: string | null) {
  const title = item.title || item.asin || item.sku || "Untitled book";
  const royalties = bookKdpAvailable(item) ? formatCurrency(item.royalties!, currency) : "unavailable";
  const spend = formatCurrency(Number(item.spend) || 0, currency);
  const acos = Number(item.sales) > 0 ? formatPercent(Number(item.acos)) : "not available";
  const orders = formatInt(Number(item.orders) || 0);
  const net = bookNetIsKnown(item)
    ? formatCurrency(resolveBookNet(item)!, currency)
    : "unavailable";
  const adsSales = Number(item.sales) > 0 ? formatCurrency(Number(item.sales), currency) : undefined;
  const parts = [
    title,
    marketplaceLabel,
    status.label,
    netRoyaltiesVoiceOver({
      kdpRoyalties: royalties,
      adsSpend: spend,
      netRoyalties: net,
      adsSales,
    }),
    `Amazon Ads ACoS ${acos}`,
    `${orders} ads orders`,
  ];
  parts.push(`Break-even ACoS ${formatBreakEvenAcos(item.breakeven_acos)}`);
  return parts.join(". ");
}

function bookRowKey(item: TopBookRow, index: number) {
  return item.book_key || item.asin || item.sku || `book-${index}`;
}

export default function ProductsScreen() {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const { profiles, selectedProfileIds, selectedProfiles, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer, kdpRoyaltySource } = useApp();
  const { guestMode } = useAuth();
  const {
    onScroll: onBooksScroll,
    chromeAnimatedStyle,
    onChromeLayout,
    scrollEventThrottle,
  } = useScrollChromeCollapse({ reduceMotion });
  const yesterdayYmd = useMemo(() => {
    const today = parseDateOnly(toDateString(new Date()));
    today.setDate(today.getDate() - 1);
    return toDateString(today);
  }, []);
  const enabledSelectedIds = useMemo(
    () => enabledSelectedProfileIds(profiles, selectedProfileIds),
    [profiles, selectedProfileIds],
  );
  const moneyProfileIds = useMemo(
    () => sortedProfileIds(booksMoneyProfileIds(profiles, selectedProfileIds)),
    [profiles, selectedProfileIds],
  );
  const royaltyScope = useMemo(
    () => booksRoyaltyScopeForSelection(profiles, moneyProfileIds),
    [profiles, moneyProfileIds],
  );
  const marketplaceIndex = useSponsoredMarketplaceIndex();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("acos");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const qa = takePendingQaFilters();
    if (qa?.booksSort) {
      setSort(qa.booksSort);
      console.log(`[inteliads:qa] books filters sort=${qa.booksSort}`);
      return;
    }
    void loadBooksFilterMemory().then((mem) => {
      if (mem.sort === "net" || mem.sort === "spend" || mem.sort === "acos" || mem.sort === "orders") {
        setSort(mem.sort);
      }
    });
  }, []);

  useEffect(() => {
    void saveBooksFilterMemory({ sort });
  }, [sort]);

  const royaltyProfiles = useMemo(
    () => sortedProfileIds(royaltyScope.profileIds),
    [royaltyScope.profileIds],
  );
  // Same Gross widen as Overview when every enabled Ads profile is selected —
  // otherwise Books hides owned KDP shelves that still have royalties in range.
  const kdpQueryScope = overviewKdpQueryScope(profiles, selectedProfileIds, royaltyScope);
  const kdpOnlyBooks = !isAdminViewer && !guestMode && isKdpOnlySessionScope(royaltyScope);
  const booksKey = [FINANCIAL_QUERY_ROOTS.products, adminFilterUserId ?? "self", moneyProfileIds, royaltyProfiles, dateRange.start, dateRange.end, primaryCurrency, kdpQueryScope, 0] as const;
  const overviewBooksKey = [
    FINANCIAL_QUERY_ROOTS.topBooks,
    adminFilterUserId ?? "self",
    moneyProfileIds,
    royaltyProfiles,
    dateRange.start,
    dateRange.end,
    primaryCurrency,
    kdpQueryScope,
  ] as const;

  const { data: booksData, isPending, isError, isRefetching, isFetching, refetch, error } = useQuery({
    queryKey: booksKey,
    queryFn: ({ signal }) => {
      markPerf("books.query.start");
      return withQueryTimeout(
        fetchTopBooksRange({
          profileIds: moneyProfileIds,
          kdpProfileIds: royaltyProfiles,
          kdpScope: kdpQueryScope,
          start: dateRange.start,
          end: dateRange.end,
          royaltyRate: 0,
          limit: 0,
          filterUserId: adminFilterUserId,
          activityDays: 0,
        }).then((rows) => {
          markPerf("books.query.end");
          return rows;
        }),
        TARGETING_QUERY_TIMEOUT_MS,
        signal,
      );
    },
    enabled: moneyProfileIds.length > 0 || kdpOnlyBooks,
    ...LIST_PERIOD_QUERY_CACHE,
    placeholderData: sameScopeWarmPlaceholder(
      queryClient.getQueryData<TopBookRow[]>(overviewBooksKey),
    ),
    retry: false,
    meta: financialQueryMeta(),
  });

  const books = booksData ?? [];
  const overviewBooksWarm = queryClient.getQueryData(overviewBooksKey) as TopBookRow[] | undefined;
  const showBlockingSpinner =
    booksListAwaitingRows({ isPending, isError, isFetching, data: booksData }) && !overviewBooksWarm;

  const { data: periodRoyalties } = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.kdpRoyalties, royaltyProfiles, dateRange.start, dateRange.end, primaryCurrency, kdpQueryScope],
    queryFn: () => fetchKdpRoyaltiesRange(royaltyProfiles, dateRange.start, dateRange.end, { kdpScope: kdpQueryScope }),
    enabled:
      kdpRoyaltiesQueryAllowed(royaltyScope) &&
      !showBlockingSpinner &&
      !booksListAwaitingRows({ isPending, isError, isFetching, data: booksData }) &&
      books.length === 0,
    ...LIST_PERIOD_QUERY_CACHE,
    meta: financialQueryMeta(),
  });
  const latestImportedYmd = periodRoyalties?.daily?.length
    ? String(periodRoyalties.daily[periodRoyalties.daily.length - 1]?.date ?? "").slice(0, 10) || null
    : null;
  const royaltySetup = useKdpRoyaltySetupPrompt({
    enabled: selectedProfileIds.length > 0 && !guestMode && !adminFilterUserId,
    royaltyScopeReason: royaltyScope.reason,
    latestImportedYmd,
    yesterdayYmd,
  });

  const bookColorMap = useMemo(
    () => buildBookColorMap(books.map((b) => bookColorKeyFor(b))),
    [books],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = books;
    if (q) {
      arr = arr.filter(
        (p) =>
          (p.asin || "").toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q) ||
          (p.title || "").toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      switch (sort) {
        case "spend":
          return b.spend - a.spend;
        case "orders":
          return b.orders - a.orders;
        case "net": {
          const netA = resolveBookNet(a) ?? Number.NEGATIVE_INFINITY;
          const netB = resolveBookNet(b) ?? Number.NEGATIVE_INFINITY;
          return netB - netA;
        }
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
  }, [books, search, sort]);

  const applySort = useCallback(
    (next: Sort) => {
      if (next === sort) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Instant reorder — avoid Yoga layout storms on dense list resorts.
      setSort(next);
    },
    [sort],
  );

  const openBook = useCallback(
    (item: TopBookRow) => {
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
    },
    [router],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const hasLinkedKdp = selectedProfiles.some((p) => (p.kdp_account_count ?? 0) > 0);
  const knownAccountRoyalties = knownKdpRoyaltyTotal(periodRoyalties);
  const hasAccountRoyalties = knownAccountRoyalties != null && knownAccountRoyalties > 0;
  const empty = emptyCopy(search, {
    iosHelperOn: isIosHelperEnabled(kdpRoyaltySource),
    hasLinkedKdp,
    hasAccountRoyalties,
  });
  const showSearchCount = search.trim().length > 0 && !showBlockingSpinner;


  if (enabledSelectedIds.length === 0 && !kdpOnlyBooks) {
    return (
      <AppScreen>
        <TopBar />
        <EmptyState
          icon="business-outline"
          title={
            selectedProfileIds.length > 0
              ? "No enabled profiles"
              : isAdminViewer
                ? "No Amazon account"
                : "No account connected"
          }
          subtitle={
            selectedProfileIds.length > 0
              ? "Turn on an Amazon Ads profile in Accounts to see its books."
              : isAdminViewer
                ? "Pick a customer in the profile menu."
                : "Connect an Amazon account to see your books."
          }
          action={
            isAdminViewer
              ? undefined
              : {
                  label: selectedProfileIds.length > 0 ? "Open Accounts" : "Connect account",
                  onPress: () => router.push("/more/accounts"),
                }
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      {/* Soft collapse: stays mounted so profile/search return on scroll-up. */}
      <ReanimatedAnimated.View
        testID="books-scroll-chrome"
        onLayout={onChromeLayout}
        style={[{ overflow: "hidden", zIndex: 2 }, chromeAnimatedStyle]}
      >
        <TopBar />
        <FilterChrome>
          <IOSSearchBar
            testID="products-search"
            placeholder="Search by title or ASIN"
            value={search}
            onChangeText={setSearch}
          />
          <IOSSegmentedControl
            testID="products-sort-segments"
            value={sort}
            onChange={applySort}
            options={[
              { key: "net", label: "Net roy." },
              { key: "spend", label: "Spend" },
              { key: "acos", label: "ACoS" },
              { key: "orders", label: "Orders" },
            ]}
          />
          {filtered.length > 0 ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, fontWeight: "600" }]}>
              {filtered.length === 1 ? "1 book" : `${filtered.length} books`}
              {search.trim() ? " matching" : " with royalties, ads, or campaigns"}
              {isFetching && books.length > 0 ? " · updating" : ""}
            </Text>
          ) : showSearchCount ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, fontWeight: "600" }]}>
              0 books matching
            </Text>
          ) : null}
        </FilterChrome>
      </ReanimatedAnimated.View>

      {showBlockingSpinner ? (
        <ScreenSpinner />
      ) : isError && books.length === 0 ? (
        <RetryState
          title="Couldn't load books"
          subtitle={
            isHomeQueryTimeout(error)
              ? "This is taking longer than usual. Pull to retry."
              : error instanceof BooksReadError
                ? "Something went wrong loading your books. Pull to retry."
                : "Check your connection and try again."
          }
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <ReanimatedAnimated.FlatList
          data={filtered}
          keyExtractor={bookRowKey}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "ios"}
          onScroll={onBooksScroll}
          scrollEventThrottle={scrollEventThrottle}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={ItemSeparator}
          ListEmptyComponent={
            <EmptyState
              productIcon="books"
              title={empty.title}
              subtitle={empty.subtitle}
              action={
                empty.actionLabel && !guestMode
                  ? { label: empty.actionLabel, onPress: royaltySetup.openCollection }
                  : undefined
              }
            />
          }
          renderItem={({ item, index }) => (
            <ProductCard
              item={item}
              currency={primaryCurrency}
              color={bookColorMap.get(bookColorKeyFor(item)) ?? fallbackBookColor(bookColorKeyFor(item), index)}
              marketplaceIndex={marketplaceIndex}
              onOpen={openBook}
            />
          )}
        />
      )}
    </AppScreen>
  );
}

function ItemSeparator() {
  const t = useTheme();
  return <View style={{ height: t.layout.listGap }} />;
}

const ProductCard = React.memo(function ProductCard({
  item,
  currency,
  color,
  marketplaceIndex,
  onOpen,
}: {
  item: TopBookRow;
  currency: string;
  color: string;
  marketplaceIndex: SponsoredMarketplaceIndex;
  onOpen: (item: TopBookRow) => void;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const adsReady = bookAdsReady(item);
  const kdpAvailable = bookKdpAvailable(item);
  const kdpReady = bookKdpReady(item);
  const hasBreakEven = hasAuthoritativeBreakEven(item.breakeven_acos);
  const tone = adsReady
    ? hasBreakEven
      ? acosTone(item.acos, item.breakeven_acos)
      : "inactive"
    : acosTone(0);
  const netPos = (() => {
    const net = resolveBookNet(item);
    return net != null && net >= 0;
  })();
  const resolvedNet = resolveBookNet(item);
  const amazonCover = fallbackAsinCoverUrl(item.asin || item.sku);
  const status = bookStatus(item, hasBreakEven);
  const statusChipTone =
    status.tone === "good" ? t.statusChip.good : status.tone === "warning" ? t.statusChip.warning : t.statusChip.danger;
  const acosOver = isOverBreakEven(item.acos, item.breakeven_acos);
  const rowKey = item.asin || item.sku || item.book_key;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <ListCard testID={rowKey ? `book-row-${rowKey}` : undefined}>
        <TouchableOpacity
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel={bookA11yLabel(
            item,
            status,
            currency,
            marketplaceFlagsA11y(countriesForSponsoredBook(marketplaceIndex, item)),
          )}
          accessibilityHint="Opens book details"
          onPressIn={() => {
            if (reduceMotion) return;
            Animated.spring(scale, { toValue: 0.972, useNativeDriver: true, damping: 20, stiffness: 450 }).start();
          }}
          onPressOut={() => {
            if (reduceMotion) return;
            Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 320 }).start();
          }}
          onPress={() => onOpen(item)}
        >
          <View style={styles.identityRow}>
            <BookCover
              uri={item.image_url}
              fallbackUri={amazonCover}
              asin={item.asin || item.sku}
              size="lg"
              recyclingKey={item.book_key || item.asin || item.sku || undefined}
            />

            <View style={styles.titleBlock}>
              <View style={styles.titleWithFlags}>
                <Text
                  style={[
                    t.typography.headline,
                    {
                      color: t.colors.text_primary,
                      flex: 1,
                      minWidth: 0,
                      fontWeight: "700",
                      letterSpacing: -0.25,
                      lineHeight: 22,
                    },
                  ]}
                  numberOfLines={2}
                >
                  {bookDisplayTitle(item)}
                </Text>
                <BookMarketplaceFlags
                  index={marketplaceIndex}
                  book={item}
                  style={t.typography.headline}
                />
              </View>
              <View
                accessible={false}
                importantForAccessibility="no"
                style={[
                  styles.statusPill,
                  {
                    backgroundColor: statusChipTone.bg,
                    borderColor: statusChipTone.fg + "55",
                  },
                ]}
              >
                <SFSymbol
                  name={status.tone === "good" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
                  size={12}
                  color={statusChipTone.fg}
                />
                <Text style={[t.typography.caption2, { fontWeight: "700", color: statusChipTone.fg, letterSpacing: 0.1 }]} numberOfLines={1}>
                  {status.label}
                </Text>
              </View>
            </View>

            <View style={styles.profitBlock} accessible={false} importantForAccessibility="no">
              <Text
                style={[
                  t.typography.metric,
                  {
                    fontSize: 22,
                    lineHeight: 26,
                    fontWeight: "800",
                    letterSpacing: -0.45,
                    color: resolvedNet == null ? t.colors.text_tertiary : netPos ? t.colors.tone_good : t.colors.tone_danger,
                    textAlign: "right",
                    fontVariant: ["tabular-nums"],
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                {resolvedNet == null ? "—" : `${netPos ? "+" : ""}${formatCurrency(resolvedNet, currency, { compact: true })}`}
              </Text>
              <Text
                style={[
                  t.typography.caption2,
                  {
                    color: t.colors.text_tertiary,
                    marginTop: 2,
                    fontWeight: "700",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  },
                ]}
              >
                Net
              </Text>
            </View>
          </View>

          {adsReady && item.acos > 0 ? (
            <View style={styles.breakEven} accessible={false} importantForAccessibility="no">
              <View style={styles.breakEvenLabels}>
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, flex: 1, flexShrink: 1 }]}>
                  ACoS {formatPercent(item.acos, 0)}
                  <Text style={{ color: t.colors.text_tertiary }}> · BE {formatBreakEvenAcos(item.breakeven_acos)}</Text>
                </Text>
                {hasBreakEven ? (
                  <View
                    style={[
                      styles.efficiencyBadge,
                      {
                        backgroundColor: toneColor(tone, t.colors) + "1F",
                        borderColor: toneColor(tone, t.colors) + "55",
                      },
                    ]}
                  >
                    <Text style={[t.typography.caption2, { color: toneColor(tone, t.colors), fontWeight: "800", letterSpacing: 0.5 }]}>
                      {acosOver ? "OVER" : "SAFE"}
                    </Text>
                  </View>
                ) : null}
              </View>
              {hasBreakEven ? (
                <View style={[styles.breakEvenTrack, { backgroundColor: t.colors.background_tertiary }]}>
                  <View
                    style={{
                      height: 5,
                      borderRadius: 3,
                      borderCurve: "continuous",
                      width: `${Math.min(100, (item.acos / item.breakeven_acos) * 100)}%`,
                      backgroundColor: toneColor(tone, t.colors),
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
            <MetricStrip
              variant="book"
              items={[
                { label: "Royalties", value: kdpAvailable ? formatCurrency(item.royalties!, currency, { compact: true }) : "—", color: kdpAvailable ? t.colors.tone_good : t.colors.text_tertiary },
                { label: "Spend", value: adsReady ? formatCurrency(item.spend, currency, { compact: true }) : "—" },
                { label: "Orders", value: formatInt(item.orders) },
                {
                  label: "ACoS",
                  value: adsReady && item.sales > 0 ? formatPercent(item.acos) : "—",
                  color: toneColor(tone, t.colors),
                },
              ]}
            />
          </View>
        </TouchableOpacity>
      </ListCard>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  identityRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleWithFlags: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  profitBlock: {
    alignItems: "flex-end",
    paddingTop: 1,
    minWidth: 76,
    flexShrink: 0,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: dashboard.statusChipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  breakEven: {
    marginTop: 10,
  },
  breakEvenLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
  },
  efficiencyBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  breakEvenTrack: {
    height: 5,
    borderRadius: 3,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  metricsRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    width: "100%",
  },
});
