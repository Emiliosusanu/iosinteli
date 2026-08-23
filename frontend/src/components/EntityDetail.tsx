import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SFSymbol } from "./ios/Native";
import { useRouter } from "expo-router";
import { Funnel, CampaignDailyChart } from "./Charts";
import { MetricStrip, RetryState, ScreenSpinner, SectionCard } from "./Primitives";
import { formatCurrency, formatDateShort, formatInt, formatPercent, safeDivide } from "../lib/format";
import type { EntityDailyPoint } from "../lib/queries";
import { acosTone, layout, radii, spacing, toneColor, useTheme } from "../lib/theme";

export function targetingPerfStatus(item: {
  total_spend?: number;
  total_orders?: number;
  total_sales?: number;
  total_acos?: number;
}) {
  const spend = Number(item.total_spend) || 0;
  const orders = Number(item.total_orders) || 0;
  const sales = Number(item.total_sales) || 0;
  const acos = Number(item.total_acos) || 0;
  if (spend > 0 && orders === 0) return { label: "Spending without sales", tone: "danger" as const };
  if (sales > 0 && acos > 35) return { label: "High ACoS", tone: "warning" as const };
  if (sales > 0) return { label: "Profitable", tone: "good" as const };
  return { label: "No spend yet", tone: "inactive" as const };
}

export function ParentLinks({
  campaignId,
  campaignName,
  adGroupId,
  adGroupName,
}: {
  campaignId?: string | null;
  campaignName?: string | null;
  adGroupId?: string | null;
  adGroupName?: string | null;
}) {
  const t = useTheme();
  const router = useRouter();
  if (!campaignId && !adGroupId) return null;

  return (
    <View style={styles.parentRow}>
      {campaignId ? (
        <TouchableOpacity
          testID="entity-parent-campaign"
          accessibilityRole="button"
          accessibilityLabel={`Campaign ${campaignName || "Campaign"}`}
          onPress={() => router.push(`/campaign/${campaignId}` as any)}
          hitSlop={4}
          style={styles.parentLink}
        >
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]} numberOfLines={1}>
            {campaignName || "Campaign"}
          </Text>
        </TouchableOpacity>
      ) : null}
      {campaignId && adGroupId ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>·</Text>
      ) : null}
      {adGroupId ? (
        <TouchableOpacity
          testID="entity-parent-ad-group"
          accessibilityRole="button"
          accessibilityLabel={`Ad group ${adGroupName || "Ad group"}`}
          onPress={() =>
            router.push({
              pathname: "/more/ad-group/[id]",
              params: { id: adGroupId, name: adGroupName || "Ad group" },
            } as any)
          }
          hitSlop={4}
          style={styles.parentLink}
        >
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]} numberOfLines={1}>
            {adGroupName || "Ad group"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function EntityBidControl({
  value,
  testID,
  onPress,
}: {
  value: string;
  testID?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Current bid ${value}. Edit bid.`}
      accessibilityHint="Opens the bid editor. Saving writes Amazon Ads."
      onPress={onPress}
      activeOpacity={0.75}
      style={[styles.bidRow, { borderTopColor: t.colors.separator }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary }]}>Current bid</Text>
        <Text
          style={[
            t.typography.title2,
            { color: t.colors.text_primary, fontVariant: ["tabular-nums"], marginTop: 2 },
          ]}
        >
          {value}
        </Text>
      </View>
      <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Edit</Text>
    </TouchableOpacity>
  );
}

export function EntityPerformance({
  spend,
  sales,
  orders,
  impressions,
  clicks,
  currency,
  daily,
  chartWidth,
  dailyLoading,
  dailyError,
  onRetryDaily,
}: {
  spend: number;
  sales: number;
  orders: number;
  impressions: number;
  clicks: number;
  currency?: string | null;
  daily: EntityDailyPoint[];
  chartWidth: number;
  dailyLoading?: boolean;
  dailyError?: boolean;
  onRetryDaily?: () => void;
}) {
  const t = useTheme();
  const acos = safeDivide(spend, sales) * 100;
  const ctr = safeDivide(clicks, impressions) * 100;
  const cvr = safeDivide(orders, clicks) * 100;
  const cpc = safeDivide(spend, clicks);
  const roas = safeDivide(sales, spend);
  const perf = {
    impressions: daily.map((row) => ({ value: row.impressions, label: formatDateShort(row.date) })),
    spend: daily.map((row) => ({ value: row.spend, label: formatDateShort(row.date) })),
    orders: daily.map((row) => ({ value: row.orders, label: formatDateShort(row.date) })),
    acos: daily.map((row) => ({
      value: row.sales > 0 ? (row.spend / row.sales) * 100 : 0,
      label: formatDateShort(row.date),
    })),
  };

  return (
    <>
      <View style={[styles.metricsCard, { backgroundColor: t.colors.background_secondary }]}>
        <Text
          style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}
          accessibilityRole="header"
        >
          Outcome
        </Text>
        <MetricStrip
          items={[
            {
              label: "ACoS",
              value: sales > 0 ? formatPercent(acos) : "—",
              color: toneColor(acosTone(acos), t.colors),
            },
            { label: "Spend", value: formatCurrency(spend, currency) },
            { label: "Orders", value: formatInt(orders) },
            { label: "Sales", value: formatCurrency(sales, currency) },
          ]}
        />
        <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
        <Text
          style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: t.spacing.sm }]}
          accessibilityRole="header"
        >
          Traffic
        </Text>
        <MetricStrip
          items={[
            { label: "Clicks", value: formatInt(clicks) },
            { label: "Impr.", value: formatInt(impressions) },
            { label: "CTR", value: impressions > 0 ? formatPercent(ctr, 2) : "—" },
            { label: "CVR", value: clicks > 0 ? formatPercent(cvr, 1) : "—" },
          ]}
        />
        <View style={[styles.metricsSplit, { backgroundColor: t.colors.separator }]} />
        <MetricStrip
          items={[
            { label: "ROAS", value: spend > 0 ? `${roas.toFixed(2)}x` : "—" },
            { label: "CPC", value: clicks > 0 ? formatCurrency(cpc, currency) : "—" },
          ]}
        />
      </View>

      <SectionCard title="Conversion funnel">
        <Funnel impressions={impressions} clicks={clicks} orders={orders} />
      </SectionCard>

      {dailyError ? (
        <SectionCard title="Daily performance">
          <RetryState
            title="Trend failed to load"
            subtitle="Metrics above are still for this date range."
            onRetry={onRetryDaily ?? (() => undefined)}
          />
        </SectionCard>
      ) : dailyLoading && daily.length === 0 ? (
        <SectionCard title="Daily performance">
          <ScreenSpinner />
        </SectionCard>
      ) : daily.length > 0 ? (
        <SectionCard title="Daily performance">
          <CampaignDailyChart
            impressionsData={perf.impressions}
            spendData={perf.spend}
            ordersData={perf.orders}
            acosData={perf.acos}
            width={chartWidth}
            currency={currency ?? undefined}
          />
        </SectionCard>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  parentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  parentLink: {
    minHeight: layout.minTap,
    maxWidth: "100%",
    justifyContent: "center",
  },
  bidRow: {
    minHeight: layout.minTap,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  metricsCard: {
    borderRadius: radii.md,
    padding: spacing.card,
    marginBottom: spacing.lg,
  },
  metricsSplit: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md },
});
