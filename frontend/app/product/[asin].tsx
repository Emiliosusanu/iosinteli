import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { SFSymbol } from "@/src/components/ios/Native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { markPerf } from "@/src/lib/perf";
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
import { bookRowMatchesOpenedAsin } from "@/src/lib/kdpBookIdentity";
import {
  formatBreakEvenAcos,
  hasAuthoritativeBreakEven,
  isOverBreakEven,
} from "@/src/lib/kdpTitlePresentation";
import { bookColorKeyFor, fallbackBookColor } from "@/src/lib/bookColors";
import { acosTone, toneColor, useTheme } from "@/src/lib/theme";
import { formatCurrency, formatInt, formatPercent, safeDivide } from "@/src/lib/format";
import {
  ADS_SPEND_LABEL,
  KDP_ROYALTIES_LABEL,
  NET_ROYALTIES_CAPTION,
  NET_ROYALTIES_LABEL,
  netRoyaltiesVoiceOver,
  resolveBookNet,
  bookNetIsKnown,
} from "@/src/lib/netRoyalties";
import { FINANCIAL_QUERY_ROOTS, financialQueryMeta } from "@/src/lib/financialReadVersion";

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function matchBook(rows: TopBookRow[], asin: string) {
  return rows.find((row) => bookRowMatchesOpenedAsin(row, asin)) ?? null;
}

function bookStatus(item: TopBookRow, hasBreakEven: boolean): { label: string; tone: "good" | "warning" | "danger" } {
  if (item.ads_state === "pending" || item.ads_state === "missing") return { label: "Loading ads", tone: "warning" };
  if (item.kdp_state === "missing" || item.royalties == null) {
    return { label: "Royalties unavailable", tone: "warning" };
  }
  if (item.kdp_state === "partial") return { label: "Royalties partial", tone: "warning" };
  const spend = Number(item.spend) || 0;
  const orders = Number(item.orders) || 0;
  // Drive the verdict from the SAME resolved net as the big number, so the pill
  // can never contradict the displayed profit (e.g. green +net with a red pill).
  const net = resolveBookNet(item);
  if (net != null) {
    if (net >= 0) return { label: "Net positive", tone: "good" };
    if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
    return { label: "Net negative", tone: "danger" };
  }
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" };
  if (hasBreakEven && item.acos > item.breakeven_acos) return { label: "Over break-even", tone: "warning" };
  return { label: "Net negative", tone: "danger" };
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
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const params = useLocalSearchParams<{ asin: string; title?: string; imageUrl?: string }>();
  const asin = paramValue(params.asin).toUpperCase();
  const paramTitle = paramValue(params.title);
  const paramImageUrl = paramValue(params.imageUrl);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const booksKey = [FINANCIAL_QUERY_ROOTS.products, adminFilterUserId ?? "self", selectedProfileIds, dateRange.start, dateRange.end] as const;

  const booksQ = useQuery({
    queryKey: booksKey,
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate: 0,
        limit: 300,
        filterUserId: adminFilterUserId,
        activityDays: 0,
      }),
    enabled: selectedProfileIds.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: () => queryClient.getQueryData(booksKey),
    meta: financialQueryMeta(),
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
  useEffect(() => {
    markPerf("book_detail.mount");
  }, []);
  const campaigns = campaignsQ.data ?? [];
  const title = book?.title || paramTitle || asin;
  const imageUrl = book?.image_url ?? paramImageUrl;
  const amazonCover = fallbackAsinCoverUrl(asin);
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
            imageUrl={imageUrl}
            fallbackUri={amazonCover}
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
  imageUrl,
  fallbackUri,
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
}: {
  asin: string;
  title: string;
  imageUrl?: string | null;
  fallbackUri?: string | null;
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
}) {
  const t = useTheme();
  const hasBreakEven = !!book && hasAuthoritativeBreakEven(book.breakeven_acos);
  const status = book ? bookStatus(book, hasBreakEven) : null;
  const statusColor = status ? toneColor(status.tone, t.colors) : t.colors.text_secondary;
  const kdpAvailable = !!book && book.kdp_state !== "missing" && book.royalties != null;
  const netReady = !!book && bookNetIsKnown(book);
  const resolvedNet = book ? resolveBookNet(book) : null;
  const netPos = resolvedNet != null && resolvedNet >= 0;
  const bookTone = book
    ? acosTone(book.acos, hasBreakEven ? book.breakeven_acos : 30)
    : acosTone(adsAcos);
  const acosOver = !!book && isOverBreakEven(book.acos, book.breakeven_acos);
  const showTraffic = adsTotals.impressions > 0 || adsTotals.clicks > 0;

  const adsReady = !!book && book.ads_state !== "pending" && book.ads_state !== "missing";
  const economicsItems = book
    ? [
        { label: KDP_ROYALTIES_LABEL, value: kdpAvailable ? formatCurrency(book.royalties!, currency, { compact: true }) : "—", color: kdpAvailable ? t.colors.tone_good : t.colors.text_tertiary },
        { label: ADS_SPEND_LABEL, value: adsReady ? formatCurrency(book.spend, currency, { compact: true }) : "—" },
        { label: "Impr", value: adsReady ? formatInt(book.impressions) : "—" },
        { label: "Clicks", value: adsReady ? formatInt(book.clicks) : "—" },
        {
          label: "Ads ACoS",
          value: adsReady && book.sales > 0 ? formatPercent(book.acos) : "—",
          color: toneColor(bookTone, t.colors),
        },
      ]
    : [
        { label: ADS_SPEND_LABEL, value: formatCurrency(adsTotals.spend, currency, { compact: true }) },
        { label: "Impr", value: formatInt(adsTotals.impressions) },
        { label: "Clicks", value: formatInt(adsTotals.clicks) },
        { label: "Ads orders", value: formatInt(adsTotals.orders) },
        {
          label: "ACoS",
          value: adsTotals.sales > 0 ? formatPercent(adsAcos) : "—",
          color: toneColor(acosTone(adsAcos), t.colors),
        },
      ];

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      <ListCard testID="book-detail-identity">
        <View
          accessible
          accessibilityRole="header"
          style={{ width: "100%" }}
          accessibilityLabel={[
            title,
            status?.label,
            book
              ? `${netRoyaltiesVoiceOver({
                  kdpRoyalties: kdpAvailable ? formatCurrency(book.royalties!, currency) : "unavailable",
                  adsSpend: formatCurrency(book.spend, currency),
                  netRoyalties: netReady && resolvedNet != null ? formatCurrency(resolvedNet, currency) : "unavailable",
                })}. Amazon Ads ACoS ${book.sales > 0 ? formatPercent(book.acos) : "not available"}. ${formatInt(book.impressions)} impressions. ${formatInt(book.clicks)} clicks`
              : undefined,
          ]
            .filter(Boolean)
            .join(". ")}
        >
          <View style={styles.identityRow}>
            <BookCover
              uri={imageUrl}
              fallbackUri={fallbackUri}
              asin={asin}
              size="md"
              recyclingKey={asin}
            />

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
                  style={[t.typography.metric_compact, { color: !netReady ? t.colors.text_tertiary : netPos ? t.colors.tone_good : t.colors.tone_danger }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {netReady && resolvedNet != null ? `${netPos ? "+" : ""}${formatCurrency(resolvedNet, currency, { compact: true })}` : "—"}
                </Text>
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>{NET_ROYALTIES_LABEL}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
          <MetricStrip items={economicsItems} />
        </View>

        {book ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 10 }]}>
            {NET_ROYALTIES_CAPTION}
          </Text>
        ) : null}

        {book ? (
          <Text
            style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 6 }]}
            accessibilityLabel={`ACoS ${book.sales > 0 ? formatPercent(book.acos, 0) : "not available"} versus break-even ${formatBreakEvenAcos(book.breakeven_acos)}. ${hasBreakEven ? (acosOver ? "Over break-even" : "Safe") : "Break-even unavailable"}`}
          >
            ACoS {book.sales > 0 ? formatPercent(book.acos, 0) : "—"} · BE {formatBreakEvenAcos(book.breakeven_acos)}
            {hasBreakEven ? (
              <>
                {"  "}
                <Text style={{ color: toneColor(bookTone, t.colors), fontWeight: "600" }}>{acosOver ? "OVER" : "SAFE"}</Text>
              </>
            ) : null}
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
          title="Couldn't load campaigns"
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
      <ListCard>
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
              { label: "Impr", value: formatInt(item.impressions) },
              { label: "Clicks", value: formatInt(item.clicks) },
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
