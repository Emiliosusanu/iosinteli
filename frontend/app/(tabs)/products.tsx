import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
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
import { useTheme, acosTone, toneColor, useReduceMotion } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { NET_ROYALTIES_LABEL, netRoyaltiesVoiceOver, resolveBookNet, bookNetIsKnown } from "@/src/lib/netRoyalties";
import { buildBookColorMap, bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, RetryState, MetricStrip, FilterChrome, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { isHomeQueryTimeout, TARGETING_QUERY_TIMEOUT_MS, withQueryTimeout, queryStillWaiting } from "@/src/lib/queryTimeout";
import { FINANCIAL_QUERY_ROOTS, financialQueryMeta } from "@/src/lib/financialReadVersion";
import { LIST_PERIOD_QUERY_CACHE, sameScopeWarmPlaceholder, sortedProfileIds } from "@/src/lib/periodQuery";
import { booksEmptyCopy } from "@/src/lib/booksListActivity";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import { knownKdpRoyaltyTotal, selectKdpRoyaltyScope } from "@/src/lib/kdpRoyaltyScope";
import { compareByAcosSpendImpressionsSync } from "@/src/lib/overviewWidgets";
import { loadBooksFilterMemory, saveBooksFilterMemory } from "@/src/lib/filterMemory";
import { countriesForSponsoredBook, marketplaceFlagsA11y, type SponsoredMarketplaceIndex } from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { BookMarketplaceFlags } from "@/src/components/MarketplaceFlags";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { profiles, selectedProfileIds, selectedProfiles, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer, kdpRoyaltySource } = useApp();
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

  const scopeProfiles = useMemo(() => sortedProfileIds(selectedProfileIds), [selectedProfileIds]);
  const royaltyProfiles = useMemo(
    () => sortedProfileIds(selectKdpRoyaltyScope(profiles).profileIds),
    [profiles],
  );
  const booksKey = [FINANCIAL_QUERY_ROOTS.products, adminFilterUserId ?? "self", scopeProfiles, royaltyProfiles, dateRange.start, dateRange.end, primaryCurrency] as const;
  const overviewBooksKey = [
    FINANCIAL_QUERY_ROOTS.topBooks,
    adminFilterUserId ?? "self",
    scopeProfiles,
    royaltyProfiles,
    dateRange.start,
    dateRange.end,
    primaryCurrency,
  ] as const;

  const { data: books = [], isPending, isError, isRefetching, isFetching, refetch, error } = useQuery({
    queryKey: booksKey,
    queryFn: ({ signal }) => {
      markPerf("books.query.start");
      return withQueryTimeout(
        fetchTopBooksRange({
          profileIds: scopeProfiles,
          kdpProfileIds: royaltyProfiles,
          start: dateRange.start,
          end: dateRange.end,
          royaltyRate: 0,
          limit: 300,
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
    enabled: scopeProfiles.length > 0,
    ...LIST_PERIOD_QUERY_CACHE,
    placeholderData: () =>
      sameScopeWarmPlaceholder(
        queryClient.getQueryData(overviewBooksKey) as TopBookRow[] | undefined,
      ),
    retry: false,
    meta: financialQueryMeta(),
  });

  const overviewBooksWarm = queryClient.getQueryData(overviewBooksKey) as TopBookRow[] | undefined;
  const showBlockingSpinner =
    queryStillWaiting({ isPending, isError, data: books }) && books.length === 0 && !overviewBooksWarm;

  const { data: periodRoyalties } = useQuery({
    queryKey: [FINANCIAL_QUERY_ROOTS.kdpRoyalties, royaltyProfiles, dateRange.start, dateRange.end],
    queryFn: () => fetchKdpRoyaltiesRange(royaltyProfiles, dateRange.start, dateRange.end),
    enabled: scopeProfiles.length > 0 && royaltyProfiles.length > 0 && !showBlockingSpinner && books.length === 0,
    ...LIST_PERIOD_QUERY_CACHE,
    meta: financialQueryMeta(),
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
      if (!reduceMotion) {
        LayoutAnimation.configureNext({
          duration: 280,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
        });
      }
      setSort(next);
    },
    [reduceMotion, sort],
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


  if (selectedProfileIds.length === 0) {
    return (
      <AppScreen>
        <TopBar />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see your books."}
          action={isAdminViewer ? undefined : { label: "Connect account", onPress: () => router.push("/more/accounts") }}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
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
        {showSearchCount ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 book" : `${filtered.length} books`}
            {isFetching && books.length > 0 ? " · updating" : ""}
          </Text>
        ) : null}
      </FilterChrome>

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
        <FlatList
          data={filtered}
          keyExtractor={bookRowKey}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== "ios"}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={ItemSeparator}
          ListEmptyComponent={<EmptyState productIcon="books" title={empty.title} subtitle={empty.subtitle} />}
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
  const tone = adsReady ? acosTone(item.acos, hasBreakEven ? item.breakeven_acos : 30) : acosTone(0);
  const netPos = (() => {
    const net = resolveBookNet(item);
    return net != null && net >= 0;
  })();
  const resolvedNet = resolveBookNet(item);
  const amazonCover = fallbackAsinCoverUrl(item.asin || item.sku);
  const status = bookStatus(item, hasBreakEven);
  const statusColor = toneColor(status.tone, t.colors);
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
              size="md"
              recyclingKey={item.book_key || item.asin || item.sku || undefined}
            />

            <View style={styles.titleBlock}>
              <View style={styles.titleWithFlags}>
                <Text style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, minWidth: 0 }]} numberOfLines={3}>
                  {item.title || item.asin || item.sku}
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
                style={[styles.statusPill, { backgroundColor: statusColor + "18" }]}
              >
                <SFSymbol
                  name={status.tone === "good" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
                  size={12}
                  color={statusColor}
                />
                <Text style={[t.typography.caption2, { fontWeight: "600", color: statusColor }]} numberOfLines={1}>
                  {status.label}
                </Text>
              </View>
            </View>

            <View style={styles.profitBlock} accessible={false} importantForAccessibility="no">
              <Text
                style={[t.typography.metric_compact, { color: resolvedNet == null ? t.colors.text_tertiary : netPos ? t.colors.tone_good : t.colors.tone_danger }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {resolvedNet == null ? "—" : `${netPos ? "+" : ""}${formatCurrency(resolvedNet, currency, { compact: true })}`}
              </Text>
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>{NET_ROYALTIES_LABEL}</Text>
            </View>
          </View>

          {adsReady && item.acos > 0 ? (
            <View style={styles.breakEven} accessible={false} importantForAccessibility="no">
              <View style={styles.breakEvenLabels}>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, flex: 1, flexShrink: 1 }]}>
                  ACoS {formatPercent(item.acos, 0)} · BE {formatBreakEvenAcos(item.breakeven_acos)}
                </Text>
                {hasBreakEven ? (
                  <Text style={[t.typography.caption2, { color: toneColor(tone, t.colors), fontWeight: "600" }]}>
                    {acosOver ? "OVER" : "SAFE"}
                  </Text>
                ) : null}
              </View>
              {hasBreakEven ? (
                <View style={[styles.breakEvenTrack, { backgroundColor: t.colors.background_tertiary }]}>
                  <View
                    style={{
                      height: 6,
                      borderRadius: 3,
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
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  titleWithFlags: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  profitBlock: {
    alignItems: "flex-end",
    paddingTop: 2,
    minWidth: 72,
    flexShrink: 0,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  breakEven: {
    marginTop: 12,
  },
  breakEvenLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
  },
  breakEvenTrack: {
    height: 6,
    borderRadius: 3,
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
