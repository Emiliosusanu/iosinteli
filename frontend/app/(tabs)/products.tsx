import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { fetchTopBooksRange, type TopBookRow } from "@/src/lib/queries";
import { fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor, useReduceMotion } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { buildBookColorMap, bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState, RetryState, MetricStrip, FilterChrome, ScreenSpinner, ListCard } from "@/src/components/Primitives";
import { IOSSearchBar, IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Sort = "net" | "spend" | "acos" | "orders";

function emptyCopy(search: string) {
  if (search.trim()) {
    return { title: "No matching books", subtitle: "Try a different title or ASIN." };
  }
  return { title: "No book data in range", subtitle: "Try a longer date range or different profile filter." };
}

function bookStatus(item: TopBookRow, hasBreakEven: boolean): { label: string; tone: "good" | "warning" | "danger" } {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
  if (item.net >= 0) return { label: "Profitable", tone: "good" };
  if (hasBreakEven && item.acos > item.breakeven_acos) return { label: "Over break-even", tone: "warning" };
  return { label: "Losing money", tone: "danger" };
}

function bookA11yLabel(item: TopBookRow, status: { label: string }, currency: string) {
  const title = item.title || item.asin || item.sku || "Untitled book";
  const royalties = formatCurrency(Number(item.royalties) || 0, currency);
  const spend = formatCurrency(Number(item.spend) || 0, currency);
  const acos = Number(item.sales) > 0 ? formatPercent(Number(item.acos)) : "not available";
  const orders = formatInt(Number(item.orders) || 0);
  const profit = formatCurrency(Number(item.net) || 0, currency);
  const parts = [
    title,
    status.label,
    `Royalties ${royalties}`,
    `Ad spend ${spend}`,
    `ACoS ${acos}`,
    `${orders} orders`,
    `Profit ${profit}`,
  ];
  if (item.breakeven_acos > 0 && item.breakeven_acos < 200) {
    parts.push(`Break-even ACoS ${formatPercent(item.breakeven_acos, 0)}`);
  }
  return parts.join(". ");
}

function bookRowKey(item: TopBookRow, index: number) {
  return item.book_key || item.asin || item.sku || `book-${index}`;
}

export default function ProductsScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId, isAdminViewer } = useApp();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("net");
  const [refreshing, setRefreshing] = useState(false);

  const { data: books = [], isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ["products-range", adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate: 0,
        limit: 300,
        filterUserId: adminFilterUserId,
      }),
    enabled: selectedProfileIds.length > 0,
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
        case "acos":
          return (a.acos || Infinity) - (b.acos || Infinity);
        case "orders":
          return b.orders - a.orders;
        case "net":
        default:
          return b.net - a.net;
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

  const empty = emptyCopy(search);
  const showSearchCount = search.trim().length > 0 && !isLoading;

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Books" />
        <EmptyState
          icon="business-outline"
          title={isAdminViewer ? "No Amazon account" : "No account connected"}
          subtitle={isAdminViewer ? "Pick a customer in the profile menu." : "Connect an Amazon account to see your books."}
          action={isAdminViewer ? undefined : { label: "Connect account", onPress: () => router.push("/more/accounts") }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Books" />

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
            { key: "net", label: "Profit" },
            { key: "spend", label: "Spend" },
            { key: "acos", label: "ACoS" },
            { key: "orders", label: "Orders" },
          ]}
        />
        {showSearchCount ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>
            {filtered.length === 1 ? "1 book" : `${filtered.length} books`}
          </Text>
        ) : null}
      </FilterChrome>

      {isLoading && books.length === 0 ? (
        <ScreenSpinner />
      ) : isError && books.length === 0 ? (
        <RetryState
          title="Books failed to load"
          subtitle="Check your connection and try again."
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={bookRowKey}
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={ItemSeparator}
          ListEmptyComponent={<EmptyState icon="cube-outline" title={empty.title} subtitle={empty.subtitle} />}
          renderItem={({ item, index }) => (
            <ProductCard
              item={item}
              currency={primaryCurrency}
              color={bookColorMap.get(bookColorKeyFor(item)) ?? fallbackBookColor(bookColorKeyFor(item), index)}
              onOpen={openBook}
            />
          )}
        />
      )}
    </SafeAreaView>
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
  onOpen,
}: {
  item: TopBookRow;
  currency: string;
  color: string;
  onOpen: (item: TopBookRow) => void;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [coverFailed, setCoverFailed] = useState(false);

  const tone = acosTone(item.acos, item.breakeven_acos);
  const netPos = item.net >= 0;
  const hasBreakEven = item.breakeven_acos > 0 && item.breakeven_acos < 200;
  const coverUrl = !coverFailed ? item.image_url || fallbackAsinCoverUrl(item.asin || item.sku) : null;
  const status = bookStatus(item, hasBreakEven);
  const statusColor = toneColor(status.tone, t.colors);
  const acosOver = hasBreakEven && item.acos > 0 ? item.acos > item.breakeven_acos : false;
  const rowKey = item.asin || item.sku || item.book_key;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <ListCard accent={color} testID={rowKey ? `book-row-${rowKey}` : undefined}>
        <TouchableOpacity
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel={bookA11yLabel(item, status, currency)}
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
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[styles.coverWrapper, { backgroundColor: color + "16", borderColor: color + "44" }]}
            >
              {coverUrl ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={styles.cover}
                  contentFit="cover"
                  transition={reduceMotion ? 0 : 200}
                  cachePolicy="memory-disk"
                  recyclingKey={item.book_key || item.asin || item.sku || undefined}
                  onError={() => setCoverFailed(true)}
                  accessible={false}
                />
              ) : (
                <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: color + "12" }]}>
                  <SFSymbol name="book" size={26} color={color} />
                </View>
              )}
            </View>

            <View style={styles.titleBlock}>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={3}>
                {item.title || item.asin || item.sku}
              </Text>
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
                style={[t.typography.metric_compact, { color: netPos ? t.colors.tone_good : t.colors.tone_danger }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {netPos ? "+" : ""}
                {formatCurrency(item.net, currency, { compact: true })}
              </Text>
              <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>Profit</Text>
            </View>
          </View>

          {hasBreakEven && item.acos > 0 ? (
            <View style={styles.breakEven} accessible={false} importantForAccessibility="no">
              <View style={styles.breakEvenLabels}>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, flex: 1, flexShrink: 1 }]}>
                  ACoS {formatPercent(item.acos, 0)} · BE {formatPercent(item.breakeven_acos, 0)}
                </Text>
                <Text style={[t.typography.caption2, { color: toneColor(tone, t.colors), fontWeight: "600" }]}>
                  {acosOver ? "OVER" : "SAFE"}
                </Text>
              </View>
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
            </View>
          ) : null}

          <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
            <MetricStrip
              items={[
                { label: "Royalties", value: formatCurrency(item.royalties, currency, { compact: true }), color: t.colors.tone_good },
                { label: "Spend", value: formatCurrency(item.spend, currency, { compact: true }) },
                { label: "Orders", value: formatInt(item.orders) },
                {
                  label: "ACoS",
                  value: item.sales > 0 ? formatPercent(item.acos) : "—",
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
  profitBlock: {
    alignItems: "flex-end",
    paddingTop: 2,
    minWidth: 72,
    flexShrink: 0,
  },
  coverWrapper: {
    width: 52,
    height: 70,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    flexShrink: 0,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
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
