import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { SFSymbol } from "@/src/components/ios/Native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, RetryState, ScreenSpinner, SectionCard, ToneDot } from "@/src/components/Primitives";
import { BidBudgetEditor, EntityStateSwitch } from "@/src/components/Mutations";
import { EntityBidControl, EntityPerformance, ParentLinks, targetingPerfStatus } from "@/src/components/EntityDetail";
import { useApp } from "@/src/contexts/AppContext";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { updateProductTargetManual } from "@/src/lib/mutations";
import { fetchEntityDailyMetrics, fetchProductTargetById } from "@/src/lib/queries";
import { describeProductTarget, fallbackAsinCoverUrl } from "@/src/lib/targeting";
import { formatCurrency } from "@/src/lib/format";
import { layout, radii, spacing, toneColor, useTheme } from "@/src/lib/theme";
import { enabledSpoken, targetingSpeech } from "@/src/lib/targetingA11y";

function paramId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function TargetDetailScreen() {
  const t = useTheme();
  const router = useRouter();
  const invalidateAds = useInvalidateAds();
  const { width } = useWindowDimensions();
  const { selectedProfileIds, primaryCurrency, dateRange, adminFilterUserId } = useApp();
  const id = paramId(useLocalSearchParams<{ id: string }>().id);
  const [bidOpen, setBidOpen] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const chartWidth = Math.max(240, width - 64);

  const targetQ = useQuery({
    queryKey: ["target-detail", id, selectedProfileIds, dateRange.start, dateRange.end, adminFilterUserId ?? "self"],
    queryFn: () => fetchProductTargetById(id, selectedProfileIds, dateRange, adminFilterUserId),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const dailyQ = useQuery({
    queryKey: ["target-daily", id, dateRange.start, dateRange.end],
    queryFn: () => fetchEntityDailyMetrics("product_target_metrics", "product_target_id", id, dateRange.start, dateRange.end),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const item = targetQ.data;
  const target = item ? describeProductTarget(item.expression, item.expression_type) : null;
  const coverUrl = item && target && !coverFailed ? item.image_url || fallbackAsinCoverUrl(target.asin) : null;
  const displayTitle = item
    ? item.title || (target?.isAuto ? target.label : target?.asin || target?.label) || "Target"
    : "Target";
  const status = item ? targetingPerfStatus(item) : null;
  const typeLabel = target
    ? target.isAuto && target.label !== "Auto"
      ? `Auto · ${target.label}`
      : target.label
    : null;

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Target" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see this target." />
      </SubScreen>
    );
  }

  if (targetQ.isLoading) {
    return (
      <SubScreen title="Target" showDateRange>
        <ScreenSpinner />
      </SubScreen>
    );
  }

  if (targetQ.isError) {
    return (
      <SubScreen title="Target" showDateRange>
        <RetryState
          title="Target failed to load"
          subtitle="Check your connection and try again."
          onRetry={() => void targetQ.refetch()}
          retrying={targetQ.isRefetching}
        />
      </SubScreen>
    );
  }

  if (!item || !target) {
    return (
      <SubScreen title="Target" showDateRange>
        <EmptyState icon="locate-outline" title="Target not found" subtitle="It may belong to another profile." />
      </SubScreen>
    );
  }

  const bidLabel = item.bid ? formatCurrency(Number(item.bid), primaryCurrency) : "—";

  return (
    <SubScreen title={displayTitle} showDateRange>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard>
          <View style={styles.headerRow}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.cover, { backgroundColor: t.colors.background_tertiary, borderColor: t.colors.border }]}
            >
              {coverUrl ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={styles.coverImg}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                  recyclingKey={target.asin || item.id}
                  onError={() => setCoverFailed(true)}
                />
              ) : (
                <SFSymbol
                  name={target.isAuto ? "sparkles" : target.asin ? "book" : "cube"}
                  size={22}
                  color={t.colors.text_secondary}
                />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={targetingSpeech([
                  displayTitle,
                  typeLabel,
                  status?.label,
                  enabledSpoken(item.state === "enabled"),
                ])}
              >
                <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{displayTitle}</Text>
                <View style={styles.metaRow}>
                  <ToneDot value={Number(item.total_acos)} />
                  {status ? (
                    <Text style={[t.typography.caption1, { color: toneColor(status.tone, t.colors), fontWeight: "600" }]}>
                      {status.label}
                    </Text>
                  ) : null}
                  {typeLabel ? (
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>{typeLabel}</Text>
                  ) : null}
                </View>
                {target.asin ? (
                  <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: spacing.xxs }]}>
                    {target.asin}
                  </Text>
                ) : null}
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
              enabled={item.state === "enabled"}
              noun="target"
              onChange={async (next) => {
                await updateProductTargetManual(item.id, { state: next ? "enabled" : "paused" });
                await invalidateAds(["target-detail"]);
              }}
            />
          </View>

          <EntityBidControl
            testID={`targeting-bid-${item.id}`}
            value={bidLabel}
            onPress={() => setBidOpen(true)}
          />

          {target.asin ? (
            <TouchableOpacity
              testID={`target-open-book-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open book for ${displayTitle}`}
              accessibilityHint="Opens the book detail for this ASIN"
              onPress={() =>
                router.push({
                  pathname: "/product/[asin]",
                  params: { asin: target.asin, title: displayTitle, imageUrl: coverUrl ?? "" },
                })
              }
              style={styles.bookLink}
            >
              <SFSymbol name="book" size={14} color={t.colors.tone_primary} />
              <Text style={[t.typography.footnote, { color: t.colors.tone_primary }]}>Open book</Text>
            </TouchableOpacity>
          ) : null}
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
        title={displayTitle}
        value={Number(item.bid) || 0}
        currency={primaryCurrency}
        testID={`targeting-bid-editor-${item.id}`}
        onClose={() => setBidOpen(false)}
        onSave={async (next) => {
          await updateProductTargetManual(item.id, { bid: next });
          await invalidateAds(["target-detail"]);
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
  cover: {
    width: layout.coverWidth,
    height: layout.coverHeight,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  coverImg: { width: layout.coverWidth, height: layout.coverHeight },
  bookLink: {
    minHeight: layout.minTap,
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.tight,
  },
});
