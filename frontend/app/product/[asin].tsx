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
  SecondaryButton,
  ToneDot,
  MetricStrip,
} from "@/src/components/Primitives";
import { useApp } from "@/src/contexts/AppContext";
import {
  fetchBookCampaignsRange,
  fetchOwnedBookIdentity,
  fetchTopBooksRange,
  type BookCampaignRow,
  type TopBookRow,
} from "@/src/lib/queries";
import { isKdpOnlySessionScope } from "@/src/lib/kdpRoyaltyScope";
import {
  booksMoneyProfileIds,
  booksRoyaltyScopeForSelection,
  overviewKdpQueryScope,
} from "@/src/lib/booksProfileScope";
import {
  defaultCreateFormatAsin,
  FORMAT_KIND_ACCENT,
  formatsFromWorkKey,
  preferredEnabledProfileId,
  type BookFormatOption,
} from "@/src/lib/bookCampaignFormats";
import { sortedProfileIds } from "@/src/lib/periodQuery";
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
import {
  countriesForSponsoredBook,
  marketplaceFlagsA11y,
  type SponsoredBookRef,
  type SponsoredMarketplaceIndex,
} from "@/src/lib/bookMarketplaces";
import { useSponsoredMarketplaceIndex } from "@/src/lib/bookMarketplacesQuery";
import { BookMarketplaceFlags, CampaignMarketplaceFlags } from "@/src/components/MarketplaceFlags";

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
  const { profiles, selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const marketplaceIndex = useSponsoredMarketplaceIndex();
  const params = useLocalSearchParams<{ asin: string; title?: string; imageUrl?: string }>();
  const asin = paramValue(params.asin).toUpperCase();
  const paramTitle = paramValue(params.title);
  const paramImageUrl = paramValue(params.imageUrl);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const moneyProfileIds = useMemo(
    () => sortedProfileIds(booksMoneyProfileIds(profiles, selectedProfileIds)),
    [profiles, selectedProfileIds],
  );
  const royaltyScope = useMemo(
    () => booksRoyaltyScopeForSelection(profiles, moneyProfileIds),
    [profiles, moneyProfileIds],
  );
  const royaltyProfiles = useMemo(
    () => sortedProfileIds(royaltyScope.profileIds),
    [royaltyScope.profileIds],
  );
  const kdpQueryScope = overviewKdpQueryScope(profiles, selectedProfileIds, royaltyScope);
  // Keep limit in the key so Overview/Books caches cannot cross-hydrate a truncated list.
  const booksKey = [FINANCIAL_QUERY_ROOTS.products, adminFilterUserId ?? "self", moneyProfileIds, royaltyProfiles, dateRange.start, dateRange.end, primaryCurrency, kdpQueryScope, 300] as const;

  const booksQ = useQuery({
    queryKey: booksKey,
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: moneyProfileIds,
        kdpProfileIds: royaltyProfiles,
        kdpScope: kdpQueryScope,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate: 0,
        limit: 300,
        filterUserId: adminFilterUserId,
        activityDays: 0,
      }),
    enabled: moneyProfileIds.length > 0 || isKdpOnlySessionScope(royaltyScope),
    staleTime: 5 * 60_000,
    placeholderData: () => queryClient.getQueryData(booksKey),
    meta: financialQueryMeta(),
  });

  const campaignsQ = useQuery({
    queryKey: ["product-campaigns", adminFilterUserId ?? "self", moneyProfileIds, asin, paramTitle, dateRange.start, dateRange.end, primaryCurrency],
    queryFn: () =>
      fetchBookCampaignsRange({
        profileIds: moneyProfileIds,
        asin,
        title: paramTitle,
        start: dateRange.start,
        end: dateRange.end,
        displayCurrency: primaryCurrency,
        filterUserId: adminFilterUserId,
      }),
    enabled: moneyProfileIds.length > 0 && asin.length > 0,
  });

  const identityQ = useQuery({
    queryKey: ["owned-book-identity", adminFilterUserId ?? "self", asin],
    queryFn: () => fetchOwnedBookIdentity(asin),
    enabled: !adminFilterUserId && asin.length > 0,
    staleTime: 15 * 60_000,
  });

  const book = useMemo(() => matchBook(booksQ.data ?? [], asin), [booksQ.data, asin]);
  useEffect(() => {
    markPerf("book_detail.mount");
  }, []);
  const campaigns = campaignsQ.data ?? [];
  const identity = identityQ.data ?? null;
  const title = book?.title || identity?.title || paramTitle || "Book";
  const imageUrl = book?.image_url ?? identity?.image_url ?? paramImageUrl;
  const bookIdentity = book ?? {
    title,
    asin,
    book_key: identity?.book_key ?? asin,
  };
  const amazonCover = fallbackAsinCoverUrl(asin);
  const bookColor = fallbackBookColor(bookColorKeyFor(book ?? { asin, title }));

  const formatOptions = useMemo(
    () => formatsFromWorkKey(bookIdentity.book_key),
    [bookIdentity.book_key],
  );
  const createAsin = useMemo(() => {
    const fromFormats = defaultCreateFormatAsin(formatOptions);
    return fromFormats || asin;
  }, [formatOptions, asin]);
  const createProfileId = useMemo(() => {
    const countries = countriesForSponsoredBook(marketplaceIndex, bookIdentity);
    const preferredCountry = countries[0] ?? null;
    return preferredEnabledProfileId(profiles, preferredCountry);
  }, [marketplaceIndex, bookIdentity, profiles]);

  const openCreateCampaign = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/campaign/create",
      params: {
        asin: createAsin,
        workKey: bookIdentity.book_key ?? "",
        profileId: createProfileId ?? "",
      },
    });
  };

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
    await Promise.all([campaignsQ.refetch(), booksQ.refetch(), identityQ.refetch()]);
    setRefreshing(false);
  };

  if (moneyProfileIds.length === 0) {
    return (
      <SubScreen title="Book" showDateRange>
        <EmptyState
          icon="business-outline"
          title="No enabled Ads profile"
          subtitle="Enable an Amazon Ads profile to see this book's campaigns."
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
            bookIdentity={bookIdentity}
            adsTotals={adsTotals}
            adsAcos={adsAcos}
            campaignsCount={campaigns.length}
            campaignsLoading={campaignsLoading}
            campaignsFailed={campaignsFailed}
            campaignsRetrying={campaignsQ.isRefetching}
            onRetryCampaigns={() => void campaignsQ.refetch()}
            currency={primaryCurrency}
            marketplaceIndex={marketplaceIndex}
            formatOptions={formatOptions}
            onCreateCampaign={openCreateCampaign}
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
            marketplaceIndex={marketplaceIndex}
            profiles={profiles}
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
  bookIdentity,
  adsTotals,
  adsAcos,
  campaignsCount,
  campaignsLoading,
  campaignsFailed,
  campaignsRetrying,
  onRetryCampaigns,
  currency,
  marketplaceIndex,
  formatOptions,
  onCreateCampaign,
}: {
  asin: string;
  title: string;
  imageUrl?: string | null;
  fallbackUri?: string | null;
  bookColor: string;
  book: TopBookRow | null;
  bookIdentity: SponsoredBookRef;
  adsTotals: { impressions: number; clicks: number; orders: number; spend: number; sales: number };
  adsAcos: number;
  campaignsCount: number;
  campaignsLoading: boolean;
  campaignsFailed: boolean;
  campaignsRetrying: boolean;
  onRetryCampaigns: () => void;
  currency: string;
  marketplaceIndex: SponsoredMarketplaceIndex;
  formatOptions: ReturnType<typeof formatsFromWorkKey>;
  onCreateCampaign: () => void;
}) {
  const t = useTheme();
  const adsReady = !campaignsLoading && !campaignsFailed;
  // The campaign list below is the exact-ASIN/product-ad authority for this
  // book. Drive every Ads figure in the header from that same sum so the hero
  // can never show 0 impressions while its own linked campaigns show traffic.
  const displayBook = book && adsReady
    ? {
        ...book,
        impressions: adsTotals.impressions,
        clicks: adsTotals.clicks,
        orders: adsTotals.orders,
        spend: adsTotals.spend,
        sales: adsTotals.sales,
        acos: adsAcos,
        roas: adsTotals.spend > 0 ? adsTotals.sales / adsTotals.spend : 0,
        net:
          typeof book.royalties === "number"
            ? book.royalties - adsTotals.spend
            : null,
        ads_state: "ready" as const,
      }
    : book;
  const hasBreakEven = !!displayBook && hasAuthoritativeBreakEven(displayBook.breakeven_acos);
  const status = displayBook ? bookStatus(displayBook, hasBreakEven) : null;
  const statusColor = status ? toneColor(status.tone, t.colors) : t.colors.text_secondary;
  const kdpAvailable = !!displayBook && displayBook.kdp_state !== "missing" && displayBook.royalties != null;
  const netReady = !!displayBook && bookNetIsKnown(displayBook);
  const resolvedNet = displayBook ? resolveBookNet(displayBook) : null;
  const netPos = resolvedNet != null && resolvedNet >= 0;
  const bookTone = displayBook
    ? hasBreakEven
      ? acosTone(displayBook.acos, displayBook.breakeven_acos)
      : "inactive"
    : acosTone(adsAcos);
  const acosOver = !!displayBook && isOverBreakEven(displayBook.acos, displayBook.breakeven_acos);
  const showTraffic = adsTotals.impressions > 0 || adsTotals.clicks > 0;

  const economicsItems = displayBook
    ? [
        { label: "Royalties", value: kdpAvailable ? formatCurrency(displayBook.royalties!, currency, { compact: true }) : "—", color: kdpAvailable ? t.colors.tone_good : t.colors.text_tertiary },
        { label: "Ads spend", value: adsReady ? formatCurrency(adsTotals.spend, currency, { compact: true }) : "—" },
        {
          label: "Ads ACoS",
          value: adsReady && adsTotals.sales > 0 ? formatPercent(adsAcos) : "—",
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
            marketplaceFlagsA11y(countriesForSponsoredBook(marketplaceIndex, bookIdentity)),
            status?.label,
            displayBook
              ? `${netRoyaltiesVoiceOver({
                  kdpRoyalties: kdpAvailable ? formatCurrency(displayBook.royalties!, currency) : "unavailable",
                  adsSpend: formatCurrency(adsTotals.spend, currency),
                  netRoyalties: netReady && resolvedNet != null ? formatCurrency(resolvedNet, currency) : "unavailable",
                })}. Amazon Ads ACoS ${adsTotals.sales > 0 ? formatPercent(adsAcos) : "not available"}. ${formatInt(adsTotals.impressions)} impressions. ${formatInt(adsTotals.clicks)} clicks`
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
              size="lg"
              recyclingKey={asin}
            />

            <View style={styles.titleBlock}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                <Text
                  style={[
                    t.typography.title3,
                    {
                      color: t.colors.text_primary,
                      flex: 1,
                      minWidth: 0,
                      fontWeight: "700",
                      letterSpacing: -0.3,
                    },
                  ]}
                  numberOfLines={3}
                >
                  {title}
                </Text>
                <BookMarketplaceFlags
                  index={marketplaceIndex}
                  book={bookIdentity}
                  style={t.typography.headline}
                />
              </View>
              {status ? (
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor: statusColor + "18",
                      borderColor: statusColor + "44",
                    },
                  ]}
                >
                  <SFSymbol
                    name={status.tone === "good" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
                    size={12}
                    color={statusColor}
                  />
                  <Text style={[t.typography.caption2, { color: statusColor, fontWeight: "700", letterSpacing: 0.1 }]}>
                    {status.label}
                  </Text>
                </View>
              ) : null}
              <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 6, fontVariant: ["tabular-nums"] }]}>
                {asin}
              </Text>
            </View>

            {book ? (
              <View style={styles.profitBlock} accessible={false} importantForAccessibility="no">
                <Text
                  style={[
                    t.typography.metric,
                    {
                      color: !netReady ? t.colors.text_tertiary : netPos ? t.colors.tone_good : t.colors.tone_danger,
                      textAlign: "right",
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                >
                  {netReady && resolvedNet != null ? `${netPos ? "+" : ""}${formatCurrency(resolvedNet, currency, { compact: true })}` : "—"}
                </Text>
                <Text
                  style={[
                    t.typography.caption2,
                    {
                      color: t.colors.text_tertiary,
                      marginTop: 3,
                      fontWeight: "600",
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    },
                  ]}
                >
                  Net
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]} accessible={false} importantForAccessibility="no">
          <MetricStrip items={economicsItems} variant="book" />
        </View>

        {displayBook ? (
          <Text style={[t.typography.footnote, { color: t.colors.text_tertiary, marginTop: 10, lineHeight: 18 }]}>
            {NET_ROYALTIES_CAPTION}
          </Text>
        ) : null}

        {formatOptions.length > 0 ? (
          <BookFormatBadges formats={formatOptions} />
        ) : null}

        {displayBook ? (
          <View style={styles.efficiencyRow}>
            <Text
              style={[t.typography.caption1, { color: t.colors.text_secondary, flex: 1 }]}
              accessibilityLabel={`ACoS ${adsTotals.sales > 0 ? formatPercent(adsAcos, 0) : "not available"} versus break-even ${formatBreakEvenAcos(displayBook.breakeven_acos)}. ${hasBreakEven ? (acosOver ? "Over break-even" : "Safe") : "Break-even unavailable"}`}
            >
              ACoS {adsTotals.sales > 0 ? formatPercent(adsAcos, 0) : "—"}
              <Text style={{ color: t.colors.text_tertiary }}> · BE {formatBreakEvenAcos(displayBook.breakeven_acos)}</Text>
            </Text>
            {hasBreakEven ? (
              <View
                style={[
                  styles.efficiencyBadge,
                  {
                    backgroundColor: toneColor(bookTone, t.colors) + "1F",
                    borderColor: toneColor(bookTone, t.colors) + "55",
                  },
                ]}
              >
                <Text style={[t.typography.caption2, { color: toneColor(bookTone, t.colors), fontWeight: "800", letterSpacing: 0.5 }]}>
                  {acosOver ? "OVER" : "SAFE"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {showTraffic ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 8 }]}>
            {formatInt(adsTotals.impressions)} impressions · {formatInt(adsTotals.clicks)} clicks · {formatInt(adsTotals.orders)} orders
          </Text>
        ) : null}

        <View style={styles.createCampaignRow}>
          <SecondaryButton
            label="Create campaign"
            icon="add-outline"
            onPress={onCreateCampaign}
            testID="book-detail-create-campaign"
          />
        </View>
      </ListCard>

      <Text style={[t.typography.sectionTitle, { color: t.colors.text_primary, marginTop: 4 }]}>
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

function BookFormatBadges({ formats }: { formats: readonly BookFormatOption[] }) {
  const t = useTheme();
  // Only formats encoded on the work key (real ASINs) — never decorative placeholders.
  if (!formats.length) return null;

  return (
    <View
      style={styles.formatBadgesRow}
      accessibilityRole="text"
      accessibilityLabel={`Formats: ${formats.map((f) => `${f.label} ${f.asin}`).join(", ")}`}
    >
      <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginRight: 2 }]}>
        Formats
      </Text>
      {formats.map((fmt) => {
        const accent = FORMAT_KIND_ACCENT[fmt.kind];
        return (
          <View
            key={`${fmt.kind}-${fmt.asin}`}
            style={[
              styles.formatBadge,
              {
                backgroundColor: accent + "18",
                borderColor: accent + "44",
              },
            ]}
            accessibilityLabel={`${fmt.label}, ASIN ${fmt.asin}`}
          >
            <View style={[styles.formatBadgeDot, { backgroundColor: accent }]} />
            <Text
              style={[
                t.typography.caption1,
                {
                  color: accent,
                  fontWeight: "700",
                  letterSpacing: 0.2,
                },
              ]}
            >
              {fmt.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CampaignRow({
  item,
  currency,
  marketplaceIndex,
  profiles,
  onPress,
}: {
  item: BookCampaignRow;
  currency: string;
  marketplaceIndex: SponsoredMarketplaceIndex;
  profiles: Parameters<typeof CampaignMarketplaceFlags>[0]["profiles"];
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
        <View style={styles.campaignTitleRow}>
          <Text style={[t.typography.headline, { color: t.colors.text_primary, flex: 1, minWidth: 0, fontWeight: "700", letterSpacing: -0.2 }]} numberOfLines={2}>
            {item.name}
          </Text>
          <CampaignMarketplaceFlags
            index={marketplaceIndex}
            profiles={profiles}
            campaign={item}
            style={t.typography.headline}
          />
        </View>
        <View style={styles.metaRow}>
          <ToneDot value={item.acos ?? 0} />
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
            variant="book"
            items={[
              {
                label: "ACoS",
                value: item.sales > 0 ? formatPercent(item.acos ?? 0) : "—",
                color: toneColor(acosTone(item.acos ?? 0), t.colors),
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
    minWidth: 76,
    flexShrink: 0,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
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
  formatBadgesRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  formatBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  formatBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  efficiencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  efficiencyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  createCampaignRow: {
    marginTop: 14,
    alignItems: "flex-start",
  },
  campaignTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
});
