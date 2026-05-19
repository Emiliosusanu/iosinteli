import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchCampaignById,
  fetchAdGroups,
  fetchKeywords,
  fetchProductAds,
  aggregateDailyMetrics,
} from "@/src/lib/queries";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import {
  formatCurrency,
  formatPercent,
  formatInt,
  formatDateShort,
} from "@/src/lib/format";
import { Pill, EmptyState, ToneDot, SectionCard } from "@/src/components/Primitives";
import { PerformanceChart, Funnel } from "@/src/components/Charts";

const screenWidth = Dimensions.get("window").width;

export default function CampaignDetail() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { primaryCurrency, royaltyRate, dateRange } = useApp();

  const campaignQ = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => fetchCampaignById(id!),
    enabled: !!id,
  });

  const adGroupsQ = useQuery({
    queryKey: ["campaign-adgroups", id],
    queryFn: () => fetchAdGroups([campaignQ.data!.amazon_profile_id], id!),
    enabled: !!campaignQ.data,
  });

  const keywordsQ = useQuery({
    queryKey: ["campaign-keywords", id],
    queryFn: () =>
      fetchKeywords([campaignQ.data!.amazon_profile_id], { campaignId: id!, limit: 5 }),
    enabled: !!campaignQ.data,
  });

  const productAdsQ = useQuery({
    queryKey: ["campaign-products", id],
    queryFn: () =>
      fetchProductAds([campaignQ.data!.amazon_profile_id], { campaignId: id!, limit: 10 }),
    enabled: !!campaignQ.data,
  });

  const dailyMetricsQ = useQuery({
    queryKey: ["campaign-daily", id, dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_metrics")
        .select("*")
        .eq("campaign_id", id)
        .gte("date", dateRange.start)
        .lte("date", dateRange.end)
        .order("date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!id,
  });

  const daily = aggregateDailyMetrics((dailyMetricsQ.data as any) ?? []);

  const perf = useMemo(() => {
    const slice = daily.slice(-14);
    return {
      spend: slice.map((m) => ({ value: m.spend, label: formatDateShort(m.date) })),
      sales: slice.map((m) => ({ value: m.sales })),
    };
  }, [daily]);

  if (campaignQ.isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.colors.tone_primary} />
      </SafeAreaView>
    );
  }
  const c = campaignQ.data;
  if (!c) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <EmptyState icon="alert-circle-outline" title="Campaign not found" />
      </SafeAreaView>
    );
  }

  const net = c.total_sales * (royaltyRate / 100) - c.total_spend;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <View style={[styles.navBar, { borderBottomColor: t.colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          testID="back-btn"
        >
          <Ionicons name="chevron-back" size={26} color={t.colors.tone_primary} />
        </TouchableOpacity>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
          Campaign
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* Title + Pills */}
        <View>
          <Text style={[t.typography.title2, { color: t.colors.text_primary }]} numberOfLines={2}>
            {c.name}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <Pill
              label={c.state || "—"}
              tone={c.state === "enabled" ? "good" : c.state === "paused" ? "warning" : "inactive"}
            />
            {c.type && <Pill label={c.type} tone="primary" />}
            {c.targeting_type && <Pill label={c.targeting_type} tone="product" />}
            {c.budget != null && (
              <Pill
                label={`${formatCurrency(Number(c.budget), primaryCurrency, { compact: true })}/day`}
                tone="inactive"
              />
            )}
          </View>
        </View>

        {/* Hero metrics */}
        <View style={[styles.heroCard, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
          testID="campaign-hero">
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>NET PROFIT</Text>
              <Text
                style={[
                  t.typography.title1,
                  {
                    color: net >= 0 ? t.colors.tone_good : t.colors.tone_danger,
                    marginTop: 4,
                  },
                ]}
              >
                {formatCurrency(net, primaryCurrency, { compact: true })}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[t.typography.caption2, { color: t.colors.text_secondary }]}>ACOS</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                <ToneDot value={Number(c.total_acos)} />
                <Text
                  style={[
                    t.typography.title1,
                    {
                      color: toneColor(acosTone(Number(c.total_acos)), t.colors),
                      marginLeft: 8,
                    },
                  ]}
                >
                  {c.total_sales > 0 ? formatPercent(Number(c.total_acos)) : "—"}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.metricsRow, { borderTopColor: t.colors.separator, marginTop: 14, paddingTop: 12 }]}>
            <MetricCol label="Spend" value={formatCurrency(c.total_spend, primaryCurrency, { compact: true })} t={t} />
            <MetricCol label="Sales" value={formatCurrency(c.total_sales, primaryCurrency, { compact: true })} t={t} />
            <MetricCol label="Orders" value={formatInt(c.total_orders)} t={t} />
            <MetricCol label="ROAS" value={c.total_spend > 0 ? `${Number(c.total_roas).toFixed(1)}x` : "—"} t={t} />
          </View>
        </View>

        {/* Performance chart */}
        {daily.length > 0 && (
          <SectionCard title="Performance">
            <PerformanceChart
              spendData={perf.spend}
              salesData={perf.sales}
              width={screenWidth - 32}
            />
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_primary }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Spend</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: t.colors.tone_good }]} />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Sales</Text>
              </View>
            </View>
          </SectionCard>
        )}

        {/* Funnel */}
        <SectionCard title="Funnel">
          <Funnel
            impressions={c.total_impressions}
            clicks={c.total_clicks}
            orders={c.total_orders}
          />
        </SectionCard>

        {/* Ad Groups */}
        <SectionCard title={`Ad Groups (${adGroupsQ.data?.length ?? 0})`}>
          {adGroupsQ.data && adGroupsQ.data.length > 0 ? (
            adGroupsQ.data.map((ag, idx) => (
              <View
                key={ag.id}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === (adGroupsQ.data?.length ?? 0) - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ToneDot value={Number(ag.total_acos)} />
                    <Text style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: 8, flex: 1 }]} numberOfLines={1}>
                      {ag.name || ag.id}
                    </Text>
                    <Pill
                      label={ag.state || "—"}
                      tone={ag.state === "enabled" ? "good" : ag.state === "paused" ? "warning" : "inactive"}
                    />
                  </View>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginLeft: 16, marginTop: 2 }]}>
                    Default bid: {ag.default_bid ? formatCurrency(Number(ag.default_bid), primaryCurrency) : "—"} ·
                    {" "}Spend {formatCurrency(ag.total_spend, primaryCurrency, { compact: true })} ·
                    {" "}Sales {formatCurrency(ag.total_sales, primaryCurrency, { compact: true })}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <EmptyState icon="layers-outline" title="No ad groups" />
          )}
        </SectionCard>

        {/* Top Keywords */}
        <SectionCard title="Top keywords">
          {keywordsQ.data && keywordsQ.data.length > 0 ? (
            keywordsQ.data.map((kw, idx) => (
              <View
                key={kw.id}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === keywordsQ.data!.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={1}>
                    {kw.keyword_text}
                  </Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    Bid {kw.bid_amount ? formatCurrency(Number(kw.bid_amount), primaryCurrency) : "—"} · Spend{" "}
                    {formatCurrency(kw.total_spend, primaryCurrency, { compact: true })}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {kw.match_type && <Pill label={kw.match_type} tone="primary" />}
                  <Text style={[t.typography.caption1, { color: toneColor(acosTone(Number(kw.total_acos)), t.colors), marginTop: 2 }]}>
                    ACOS {formatPercent(Number(kw.total_acos))}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <EmptyState icon="search-outline" title="No keywords" />
          )}
        </SectionCard>

        {/* Products */}
        <SectionCard title="Advertised products">
          {productAdsQ.data && productAdsQ.data.length > 0 ? (
            productAdsQ.data.slice(0, 8).map((pa, idx) => (
              <View
                key={pa.id}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === Math.min(8, productAdsQ.data!.length) - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={1}>
                    {pa.title || pa.asin || pa.sku}
                  </Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    {pa.asin || pa.sku} · Spend {formatCurrency(pa.total_spend, primaryCurrency, { compact: true })}
                  </Text>
                </View>
                <Pill
                  label={pa.status || "—"}
                  tone={pa.status === "enabled" ? "good" : pa.status === "paused" ? "warning" : "inactive"}
                />
              </View>
            ))
          ) : (
            <EmptyState icon="cube-outline" title="No products" />
          )}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCol({ label, value, t }: { label: string; value: string; t: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label.toUpperCase()}</Text>
      <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 2 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heroCard: { borderRadius: 14, padding: 16, marginTop: 14 },
  metricsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  legend: { flexDirection: "row", gap: 16, justifyContent: "center", marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
