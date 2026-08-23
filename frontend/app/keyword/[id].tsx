import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, RetryState, ScreenSpinner, SectionCard, ToneDot } from "@/src/components/Primitives";
import { BidBudgetEditor, EntityStateSwitch } from "@/src/components/Mutations";
import { EntityBidControl, EntityPerformance, ParentLinks, targetingPerfStatus } from "@/src/components/EntityDetail";
import { useApp } from "@/src/contexts/AppContext";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { updateKeywordManual } from "@/src/lib/mutations";
import { fetchEntityDailyMetrics, fetchKeywordById } from "@/src/lib/queries";
import { formatCurrency } from "@/src/lib/format";
import { layout, spacing, toneColor, useTheme } from "@/src/lib/theme";
import { enabledSpoken, matchTypeSpoken, targetingSpeech } from "@/src/lib/targetingA11y";

function paramId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function KeywordDetailScreen() {
  const t = useTheme();
  const invalidateAds = useInvalidateAds();
  const { width } = useWindowDimensions();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const id = paramId(useLocalSearchParams<{ id: string }>().id);
  const [bidOpen, setBidOpen] = useState(false);
  const chartWidth = Math.max(240, width - 64);

  const keywordQ = useQuery({
    queryKey: ["keyword-detail", id, selectedProfileIds, dateRange.start, dateRange.end, adminFilterUserId ?? "self"],
    queryFn: () => fetchKeywordById(id, selectedProfileIds, dateRange, adminFilterUserId),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const dailyQ = useQuery({
    queryKey: ["keyword-daily", id, dateRange.start, dateRange.end],
    queryFn: () => fetchEntityDailyMetrics("keyword_metrics", "keyword_id", id, dateRange.start, dateRange.end),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const item = keywordQ.data;
  const status = item ? targetingPerfStatus(item) : null;

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Keyword" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see this keyword." />
      </SubScreen>
    );
  }

  if (keywordQ.isLoading) {
    return (
      <SubScreen title="Keyword" showDateRange>
        <ScreenSpinner />
      </SubScreen>
    );
  }

  if (keywordQ.isError) {
    return (
      <SubScreen title="Keyword" showDateRange>
        <RetryState
          title="Keyword failed to load"
          subtitle="Check your connection and try again."
          onRetry={() => void keywordQ.refetch()}
          retrying={keywordQ.isRefetching}
        />
      </SubScreen>
    );
  }

  if (!item) {
    return (
      <SubScreen title="Keyword" showDateRange>
        <EmptyState icon="search-outline" title="Keyword not found" subtitle="It may belong to another profile." />
      </SubScreen>
    );
  }

  const bidLabel = item.bid_amount ? formatCurrency(Number(item.bid_amount), primaryCurrency) : "—";

  return (
    <SubScreen title={item.keyword_text ?? "Keyword"} showDateRange>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard>
          <View style={styles.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={targetingSpeech([
                  item.keyword_text ?? "Keyword",
                  matchTypeSpoken(item.match_type),
                  status?.label,
                  enabledSpoken(item.status === "enabled"),
                ])}
              >
                <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
                  {item.keyword_text ?? "—"}
                </Text>
                <View style={styles.metaRow}>
                  <ToneDot value={Number(item.total_acos)} />
                  {status ? (
                    <Text style={[t.typography.caption1, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
                      {status.label}
                    </Text>
                  ) : null}
                  {item.match_type ? (
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{item.match_type}</Text>
                  ) : null}
                </View>
              </View>
              <ParentLinks
                campaignId={item.campaign_id}
                campaignName={item.campaign_name}
                adGroupId={item.ad_group_id}
                adGroupName={item.ad_group_name}
              />
            </View>
            <EntityStateSwitch
              testID={`targeting-state-${item.id}`}
              enabled={item.status === "enabled"}
              noun="keyword"
              onChange={async (next) => {
                await updateKeywordManual(item.id, { status: next ? "enabled" : "paused" });
                await invalidateAds(["keyword-detail"]);
              }}
            />
          </View>

          <EntityBidControl
            testID={`targeting-bid-${item.id}`}
            value={bidLabel}
            onPress={() => setBidOpen(true)}
          />
        </SectionCard>

        <EntityPerformance
          spend={Number(item.total_spend) || 0}
          sales={Number(item.total_sales) || 0}
          orders={Number(item.total_orders) || 0}
          impressions={Number(item.total_impressions) || 0}
          clicks={Number(item.total_clicks) || 0}
          currency={primaryCurrency}
          daily={dailyQ.data ?? []}
          chartWidth={chartWidth}
          dailyLoading={dailyQ.isLoading}
          dailyError={dailyQ.isError}
          onRetryDaily={() => void dailyQ.refetch()}
        />
      </ScrollView>

      <BidBudgetEditor
        visible={bidOpen}
        title={item.keyword_text ?? "Keyword bid"}
        value={Number(item.bid_amount) || 0}
        currency={primaryCurrency}
        testID={`targeting-bid-editor-${item.id}`}
        onClose={() => setBidOpen(false)}
        onSave={async (next) => {
          await updateKeywordManual(item.id, { bid: next });
          await invalidateAds(["keyword-detail"]);
        }}
      />
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: layout.pagePad, paddingBottom: 80 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.tight,
    marginTop: spacing.xs,
  },
});
