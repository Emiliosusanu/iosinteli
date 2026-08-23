import React, { useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { SFSymbol } from "@/src/components/ios/Native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { SubScreen } from "@/src/components/SubScreen";
import {
  EmptyState,
  ListCard,
  RetryState,
  ScreenSpinner,
  ToneDot,
  MetricStrip,
} from "@/src/components/Primitives";
import { useApp } from "@/src/contexts/AppContext";
import { fetchBookCampaignsRange, fetchTopBooksRange, type BookCampaignRow, type TopBookRow } from "@/src/lib/queries";
import { biddingStrategyLabel, statusLabel } from "@/src/lib/campaigns";
import { fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { acosTone, toneColor, useReduceMotion, useTheme } from "@/src/lib/theme";
import { formatCurrency, formatInt, formatPercent, safeDivide } from "@/src/lib/format";

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function matchBook(rows: TopBookRow[], asin: string) {
  const key = asin.toUpperCase();
  return (
    rows.find(
      (row) =>
        (row.asin || "").toUpperCase() === key ||
        (row.sku || "").toUpperCase() === key ||
        (row.book_key || "").toUpperCase() === key,
    ) ?? null
  );
}

function bookStatus(item: TopBookRow, hasBreakEven: boolean): { label: string; tone: "good" | "warning" | "danger" } {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
  if (item.net >= 0) return { label: "Profitable", tone: "good" };
  if (hasBreakEven && item.acos > item.breakeven_acos) return { label: "Over break-even", tone: "warning" };
  return { label: "Losing money", tone: "danger" };
}

function campaignVerdict(item: BookCampaignRow): { label: string; tone: "good" | "warning" | "danger" | "inactive" } {
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  const sales = Number(item.sales) || 0;
  const acos = Number(item.acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Wasting spend", tone: "danger" };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" };
  if (sales > 0) return { label: "Profitable", tone: "good" };
  return { label: "No spend yet", tone: "inactive" };
}

function matchSourceCaption(source: BookCampaignRow["match_source"]) {
  if (source === "product_ad") return "Product ad";
  if (source === "product_target") return "Target";
  return "Name match";
}

function campaignA11yLabel(item: BookCampaignRow, verdict: { label: string }, currency: string) {
  const state = statusLabel(item.state);
  const acos = Number(item.sales) > 0 ? formatPercent(Number(item.acos)) : "not available";
  const spend = formatCurrency(Number(item.spend) || 0, currency);
  const orders = formatInt(Number(item.orders) || 0);
  return `${item.name}, ${state}, ${verdict.label}, ACoS ${acos}, Spend ${spend}, ${orders} orders`;
}

export default function ProductCampaignsScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const params = useLocalSearchParams<{ asin: string; title?: string; imageUrl?: string }>();
  const asin = paramValue(params.asin).toUpperCase();
  const paramTitle = paramValue(params.title);
  const paramImageUrl = paramValue(params.imageUrl);
  const [refreshing, setRefreshing] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const booksQ = useQuery({
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

  const campaignsQ = useQuery({
    queryKey: ["product-campaigns", adminFilterUserId ?? "self", selectedProfileIds, asin, paramTitle, dateRange.start, dateRange.end],
    queryFn: () =>
      fetchBookCampaignsRange({
        profileIds: selectedProfileIds,
        asin,
        title: paramTitle,
        start: dateRange.start,
        end: dateRange.end,
        filterUserId: adminFilterUserId,
      }),
    enabled: selectedProfileIds.length > 0 && asin.length > 0,
  });

  const book = useMemo(() => matchBook(booksQ.data ?? [], asin), [booksQ.data, asin]);
  const campaigns = campaignsQ.data ?? [];
  const title = book?.title || paramTitle || asin;
  const imageUrl = book?.image_url || paramImageUrl;
  const coverUrl = !coverFailed ? imageUrl || (asin ? fallbackAsinCoverUrl(asin) : null) : null;
  const bookColor = fallbackBookColor(bookColorKeyFor(book ?? { asin, title }));

  const adsTotals = useMemo(() => {
    return campaigns.reduce(
      (acc, row) => {
        acc.impressions += row.impressions;
        acc.clicks += row.clicks;
        acc.orders += row.orders;
        acc.spend += row.spend;
        acc.sales += row.sales;
        return acc;
      },
      { impressions: 0, clicks: 0, orders: 0, spend: 0, sales: 0 },
    );
  }, [campaigns]);
  const adsAcos = safeDivide(adsTotals.spend, adsTotals.sales) * 100;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([campaignsQ.refetch(), booksQ.refetch()]);
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Book" showDateRange>
        <EmptyState
          icon="business-outline"
          title="No account connected"
          subtitle="Connect an Amazon account to see this book."
        />
      </SubScreen>
    );
  }

  if (!asin) {
    return (
      <SubScreen title="Book" showDateRange>
        <EmptyState icon="book-outline" title="No ASIN selected" subtitle="Open a book from the Books list." />
      </SubScreen>
    );
  }

  const campaignsLoading = campaignsQ.isLoading && campaigns.length === 0;
  const campaignsFailed = campaignsQ.isError && campaigns.length === 0;

  return (
    <SubScreen title="Book" showDateRange>
      <FlatList
        data={campaignsFailed || campaignsLoading ? [] : campaigns}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
        }
        ItemSeparatorComponent={() => <View style={{ height: t.layout.listGap }} />}
        ListHeaderComponent={
          <BookHeader
            asin={asin}
            title={title}
            coverUrl={coverUrl}
            bookColor={bookColor}
            book={book}
            adsTotals={adsTotals}
            adsAcos={adsAcos}
            campaignsCount={campaigns.length}
            campaignsLoading={campaignsLoading}
            campaignsFailed={campaignsFailed}
            campaignsRetrying={campaignsQ.isRefetching}
            onRetryCampaigns={() => void campaignsQ.refetch()}
            currency={primaryCurrency}
            reduceMotion={reduceMotion}
            onCoverError={() => setCoverFailed(true)}
          />
        }
        ListEmptyComponent={
          campaignsLoading || campaignsFailed ? null : (
            <View style={{ marginTop: 8 }}>
              <EmptyState
                icon="megaphone-outline"
                title="No campaigns in this period"
                subtitle="None linked to this book for the selected dates."
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <CampaignRow
            item={item}
            currency={primaryCurrency}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push(`/campaign/${item.id}`);
            }}
          />
        )}
      />
    </SubScreen>
  );
}

function BookHeader({
  asin,
  title,
  coverUrl,
  bookColor,
  book,
  adsTotals,
  adsAcos,
  campaignsCount,
  campaignsLoading,
  campaignsFailed,
  campaignsRetrying,
  onRetryCampaigns,
  currency,
  reduceMotion,
  onCoverError,
}: {
  asin: string;
  title: string;
  coverUrl: string | null;
  bookColor: string;
  book: TopBookRow | null;
  adsTotals: { impressions: number; clicks: number; orders: number; spend: number; sales: number };
  adsAcos: number;
  campaignsCount: number;
  campaignsLoading: boolean;
  campaignsFailed: boolean;
  campaignsRetrying: boolean;
  onRetryCampaigns: () => void;
  currency: string;
  reduceMotion: boolean;
  onCoverError: () => void;
}) {
  const t = useTheme();
  const hasBreakEven = !!book && book.breakeven_acos > 0 && book.breakeven_acos < 200;
  const status = book ? bookStatus(book, hasBreakEven) : null;
  const statusColor = status ? toneColor(status.tone, t.colors) : t.colors.text_secondary;
  const netPos = book ? book.net >= 0 : false;
  const bookTone = book ? acosTone(book.acos, book.breakeven_acos) : acosTone(adsAcos);
  const acosOver = hasBreakEven && book && book.acos > 0 ? book.acos > book.breakeven_acos : false;
  const showTraffic = adsTotals.impressions > 0 || adsTotals.clicks > 0;

  const economicsItems = book
    ? [
        { label: "Royalties", value: formatCurrency(book.royalties, currency, { compact: true }), color: t.colors.tone_good },
        { label: "Spend", value: formatCurrency(book.spend, currency, { compact: true }) },
        { label: "Orders", value: formatInt(book.orders) },
        {
          label: "ACoS",
          value: book.sales > 0 ? formatPercent(book.acos) : "—",
          color: toneColor(bookTone, t.colors),
        },
      ]
    : [
        { label: "Spend", value: formatCurrency(adsTotals.spend, currency, { compact: true }) },
        { label: "Ad sales", value: formatCurrency(adsTotals.sales, currency, { compact: true }) },
        { label: "Orders", value: formatInt(adsTotals.orders) },
        {
          label: "ACoS",
          value: adsTotals.sales > 0 ? formatPercent(adsAcos) : "—",
          color: toneColor(acosTone(adsAcos), t.colors),
        },
      ];

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      <ListCard accent={bookColor} testID="book-detail-identity">
        <View
          accessible
          accessibilityRole="header"
          style={{ width: "100%" }}
          accessibilityLabel={[
            title,
            status?.label,
            book
              ? `Royalties ${formatCurrency(book.royalties, currency)}. Ad spend ${formatCurrency(book.spend, currency)}. ACoS ${book.sales > 0 ? formatPercent(book.acos) : "not available"}. Profit ${formatCurrency(book.net, currency)}`
              : undefined,
          ]
            .filter(Boolean)
            .join(". ")}
        >
          <View style={styles.identityRow}>
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.cover,
                {
                  width: t.layout.coverWidth,
                  height: t.layout.coverHeight,
                  backgroundColor: bookColor + "16",
                  borderColor: bookColor + "44",
                },
              ]}
            >
              {coverUrl ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={reduceMotion ? 0 : 200}
                  recyclingKey={asin}
                  onError={onCoverError}
                  accessible={false}
                />
              ) : (
                <SFSymbol name="book" size={26} color={bookColor} />
              )}
            </View>

            <View style={styles.titleBlock}>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={3}>
                {title}
              </Text>
              {status ? (
                <Text style={[t.typography.caption1, { color: statusColor, fontWeight: "600", marginTop: 6 }]}>
                  {status.label}
                </Text>
              ) : null}
              <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 4 }]}>{asin}</Text>
            </View>

            {book ? (
              <View style={styles.profitBlock} accessible={false} importantForAccessibility="no">
                <Text
                  style={[t.typography.metric_compact, { color: netPos ? t.colors.tone_good : t.colors.tone_danger }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {netPos ? "+" : ""}
                  {formatCurrency(book.net, currency, { compact: true })}
                </Text>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>Profit</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
          <MetricStrip items={economicsItems} />
        </View>

        {hasBreakEven && book && book.acos > 0 ? (
          <Text
            style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 10 }]}
            accessibilityLabel={`ACoS ${formatPercent(book.acos, 0)} versus break-even ${formatPercent(book.breakeven_acos, 0)}. ${acosOver ? "Over break-even" : "Safe"}`}
          >
            ACoS {formatPercent(book.acos, 0)} · BE {formatPercent(book.breakeven_acos, 0)}
            {"  "}
            <Text style={{ color: toneColor(bookTone, t.colors), fontWeight: "600" }}>{acosOver ? "OVER" : "SAFE"}</Text>
          </Text>
        ) : null}

        {showTraffic ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 8 }]}>
            {formatInt(adsTotals.impressions)} impressions · {formatInt(adsTotals.clicks)} clicks
          </Text>
        ) : null}
      </ListCard>

      <Text style={[t.typography.subhead, { color: t.colors.text_secondary, fontWeight: "600" }]}>
        {campaignsLoading ? "Campaigns" : campaignsCount === 1 ? "1 campaign" : `${campaignsCount} campaigns`}
      </Text>

      {campaignsLoading ? <ScreenSpinner /> : null}
      {campaignsFailed ? (
        <RetryState
          title="Campaigns failed to load"
          subtitle="Book identity is still available. Retry to load linked campaigns."
          onRetry={onRetryCampaigns}
          retrying={campaignsRetrying}
        />
      ) : null}
    </View>
  );
}

function CampaignRow({
  item,
  currency,
  onPress,
}: {
  item: BookCampaignRow;
  currency: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const verdict = campaignVerdict(item);
  const strategy = biddingStrategyLabel(item.bidding_strategy);
  const accent = fallbackBookColor(bookColorKeyFor(item));

  return (
    <TouchableOpacity
      testID={`book-campaign-row-${item.id}`}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={campaignA11yLabel(item, verdict, currency)}
      accessibilityHint="Opens campaign details"
      onPress={onPress}
      style={{ minHeight: t.layout.minTap }}
    >
      <ListCard accent={accent}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={styles.metaRow}>
          <ToneDot value={item.acos} />
          <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600" }]}>
            {verdict.label}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{statusLabel(item.state)}</Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]} numberOfLines={1}>
            {strategy} · {matchSourceCaption(item.match_source)}
          </Text>
        </View>
        <PlacementSharePills item={item} />
        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
          <MetricStrip
            items={[
              {
                label: "ACoS",
                value: item.sales > 0 ? formatPercent(item.acos) : "—",
                color: toneColor(acosTone(item.acos), t.colors),
              },
              { label: "Spend", value: formatCurrency(item.spend, currency, { compact: true }) },
              { label: "Sales", value: formatCurrency(item.sales, currency, { compact: true }) },
              { label: "Orders", value: formatInt(item.orders) },
            ]}
          />
        </View>
      </ListCard>
    </TouchableOpacity>
  );
}

function PlacementSharePills({ item }: { item: BookCampaignRow }) {
  const t = useTheme();
  const shares = [
    { label: "Top", value: Number(item.placement_top_share ?? 0) },
    { label: "Product", value: Number(item.placement_product_share ?? 0) },
    { label: "Rest", value: Number(item.placement_rest_share ?? 0) },
  ].filter((row) => row.value > 0);

  if (!shares.length) return null;

  return (
    <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 6 }]} numberOfLines={1}>
      {shares.map((row) => `${row.label} ${formatPercent(row.value, 0)}`).join(" · ")}
    </Text>
  );
}

const styles = StyleSheet.create({
  identityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
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
  cover: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
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
});
