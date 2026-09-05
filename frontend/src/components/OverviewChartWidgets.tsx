import React, { useMemo } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  AdsEngineChart,
  KDP_FORMAT_CHART_COLORS,
  KdpFormatRoyaltiesChart,
  type KdpFormatStackDay,
} from "@/src/components/Charts";
import { SwipeEmpty } from "@/src/components/OverviewSwipeWidget";
import { formatCurrency, formatPercent } from "@/src/lib/format";
import {
  adsEnginePeriodLabel,
  dailyToAdsEngineSeries,
  type AdsEngineSeries,
} from "@/src/lib/adsEngineSeries";
import {
  formatKdpChartDate,
  formatSharePct,
  type KdpFormatRoyaltyRange,
} from "@/src/lib/kdpFormatRoyalties";
import {
  fetchKeywordDailyAggregate,
  fetchSearchTermDailyAggregate,
} from "@/src/lib/queries";
import { HOME_PERIOD_QUERY_CACHE, sortedProfileIds } from "@/src/lib/periodQuery";
import { ADS_ENGINE_FUNNEL_TIMEOUT_MS, withQueryTimeout } from "@/src/lib/queryTimeout";
import { hasAuthoritativeBreakEven } from "@/src/lib/kdpTitlePresentation";
import { dashboard, useTheme, type Theme } from "@/src/lib/theme";

export type { AdsEngineSeries } from "@/src/lib/adsEngineSeries";
export { adsEnginePeriodLabel, dailyToAdsEngineSeries } from "@/src/lib/adsEngineSeries";

function FormatMixTile({
  label,
  amount,
  pct,
  color,
  currency,
  t,
}: {
  label: string;
  amount: number;
  pct: number;
  color: string;
  currency: string;
  t: Theme;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        paddingVertical: 8,
        paddingHorizontal: 8,
        borderRadius: dashboard.chipRadius,
        backgroundColor: t.colors.background_tertiary,
        gap: 4,
      }}
      accessible
      accessibilityLabel={`${label} ${formatCurrency(amount, currency)} ${Math.round(pct)} percent`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, letterSpacing: 0.4 }]} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </View>
      <Text style={[t.typography.metric_compact, { color: t.colors.text_primary }]} numberOfLines={1}>
        {formatCurrency(amount, currency, { compact: true })}
      </Text>
      <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>{Math.round(pct)}%</Text>
      <View style={{ height: 3, borderRadius: 1.5, backgroundColor: t.colors.border, overflow: "hidden", marginTop: 2 }}>
        <View style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: "100%", backgroundColor: color }} />
      </View>
    </View>
  );
}

export function KdpRoyaltiesFormatPage({
  range,
  currency,
  width,
  loading,
  error,
  onRetry,
  onImportRoyalties,
}: {
  range: KdpFormatRoyaltyRange | undefined;
  currency: string;
  width: number;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onImportRoyalties?: () => void;
}) {
  const t = useTheme();

  if (loading) return <SwipeEmpty message="Loading KDP royalties…" t={t} />;
  if (error) {
    return (
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <SwipeEmpty message="Couldn't load format mix. Tap to retry." t={t} />
      </TouchableOpacity>
    );
  }
  if (!range?.hasKdpData) {
    return (
      <TouchableOpacity onPress={onImportRoyalties} accessibilityRole="button">
        <SwipeEmpty
          message="No KDP royalties in this period. Import with Chrome or the iPhone helper."
          t={t}
        />
      </TouchableOpacity>
    );
  }
  if (!range.hasFormatData) {
    return (
      <TouchableOpacity onPress={onImportRoyalties} accessibilityRole="button">
        <SwipeEmpty
          message={`KDP royalties ${formatCurrency(range.total, currency)} are available, but format breakdown isn't in this sync yet. Re-sync with Chrome or the iPhone helper.`}
          t={t}
        />
      </TouchableOpacity>
    );
  }

  const total = range.total || 1;
  const days: KdpFormatStackDay[] = range.daily.map((day) => ({
    date: day.date,
    label: formatKdpChartDate(day.date),
    paperback: day.paperback,
    ku: day.ku,
    kindle: day.kindle,
    total: day.total,
  }));

  return (
    <View style={{ gap: dashboard.compactGap }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <FormatMixTile
          label="Paperback"
          amount={range.paperback}
          pct={formatSharePct(range.paperback, total)}
          color={KDP_FORMAT_CHART_COLORS.paperback}
          currency={currency}
          t={t}
        />
        <FormatMixTile
          label="KU"
          amount={range.ku}
          pct={formatSharePct(range.ku, total)}
          color={KDP_FORMAT_CHART_COLORS.ku}
          currency={currency}
          t={t}
        />
        <FormatMixTile
          label="Kindle"
          amount={range.kindle}
          pct={formatSharePct(range.kindle, total)}
          color={KDP_FORMAT_CHART_COLORS.kindle}
          currency={currency}
          t={t}
        />
      </View>
      {days.length > 1 ? <KdpFormatRoyaltiesChart days={days} width={width} currency={currency} /> : null}
    </View>
  );
}

export function AdsEngineCampaignsPage({
  series,
  breakEvenAcos,
  width,
  emptyMessage = "No ads metrics in this period.",
}: {
  series: AdsEngineSeries;
  breakEvenAcos: number;
  width: number;
  emptyMessage?: string;
}) {
  const t = useTheme();
  if (!series.impressions.length) return <SwipeEmpty message={emptyMessage} t={t} />;
  return (
    <AdsEngineChart
      impressionsData={series.impressions}
      clicksData={series.clicks}
      ordersData={series.orders}
      acosData={series.acos}
      totals={series.totals}
      periodLabel={adsEnginePeriodLabel(series)}
      breakEvenAcos={breakEvenAcos}
      width={width}
    />
  );
}

/** Lazy Keywords page — fetches when this swipe page mounts. */
export function AdsEngineKeywordsPage({
  profileIds,
  start,
  end,
  breakEvenAcos,
  width,
}: {
  profileIds: string[];
  start: string;
  end: string;
  breakEvenAcos: number;
  width: number;
}) {
  const t = useTheme();
  const ids = useMemo(() => sortedProfileIds(profileIds), [profileIds]);
  const q = useQuery({
    queryKey: ["ads-engine-keywords-daily", ids, start, end],
    queryFn: () => withQueryTimeout(fetchKeywordDailyAggregate(ids, start, end), ADS_ENGINE_FUNNEL_TIMEOUT_MS),
    enabled: ids.length > 0,
    ...HOME_PERIOD_QUERY_CACHE,
  });
  const series = useMemo(() => dailyToAdsEngineSeries(q.data?.daily ?? []), [q.data]);

  if (q.isPending) return <SwipeEmpty message="Loading keyword funnel…" t={t} />;
  if (q.isError) {
    return (
      <TouchableOpacity onPress={() => void q.refetch()} accessibilityRole="button">
        <SwipeEmpty message="Couldn't load keyword metrics. Tap to retry." t={t} />
      </TouchableOpacity>
    );
  }
  return (
    <AdsEngineCampaignsPage
      series={series}
      breakEvenAcos={breakEvenAcos}
      width={width}
      emptyMessage={
        (q.data?.entityCount ?? 0) === 0
          ? "No keywords imported for these profiles yet."
          : "No keyword metrics in this period."
      }
    />
  );
}

/** Lazy Search terms page — fetches when this swipe page mounts. */
export function AdsEngineSearchTermsPage({
  profileIds,
  start,
  end,
  breakEvenAcos,
  width,
}: {
  profileIds: string[];
  start: string;
  end: string;
  breakEvenAcos: number;
  width: number;
}) {
  const t = useTheme();
  const ids = useMemo(() => sortedProfileIds(profileIds), [profileIds]);
  const q = useQuery({
    queryKey: ["ads-engine-search-terms-daily", ids, start, end],
    queryFn: () => withQueryTimeout(fetchSearchTermDailyAggregate(ids, start, end), ADS_ENGINE_FUNNEL_TIMEOUT_MS),
    enabled: ids.length > 0,
    ...HOME_PERIOD_QUERY_CACHE,
  });
  const series = useMemo(() => dailyToAdsEngineSeries(q.data?.daily ?? []), [q.data]);

  if (q.isPending) return <SwipeEmpty message="Loading search-term funnel…" t={t} />;
  if (q.isError) {
    return (
      <TouchableOpacity onPress={() => void q.refetch()} accessibilityRole="button">
        <SwipeEmpty message="Couldn't load search-term metrics. Tap to retry." t={t} />
      </TouchableOpacity>
    );
  }
  return (
    <AdsEngineCampaignsPage
      series={series}
      breakEvenAcos={breakEvenAcos}
      width={width}
      emptyMessage={
        (q.data?.entityCount ?? 0) === 0
          ? "No search terms imported for these profiles yet."
          : "No search-term metrics in this period."
      }
    />
  );
}

export function formatBreakEvenHint(breakEvenAcos: number): string {
  if (!hasAuthoritativeBreakEven(breakEvenAcos)) return "Impressions · clicks · orders · ACoS";
  return `Break-even ${formatPercent(breakEvenAcos, 0)}`;
}
