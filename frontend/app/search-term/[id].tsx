import React from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, PrimaryButton, RetryState, ScreenSpinner, SecondaryButton, SectionCard } from "@/src/components/Primitives";
import { EntityPerformance, ParentLinks } from "@/src/components/EntityDetail";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { fetchEntityDailyMetrics, fetchSearchTermById } from "@/src/lib/queries";
import { layout, spacing, toneColor, useTheme } from "@/src/lib/theme";
import {
  promptAddSearchTerm,
  promptNegateSearchTerm,
  searchTermLooksNegated,
  searchTermLooksTargeted,
} from "@/app/more/search-terms";

function paramId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function SearchTermDetailScreen() {
  const t = useTheme();
  const { guestMode } = useAuth();
  const invalidateAds = useInvalidateAds();
  const { width } = useWindowDimensions();
  const { selectedProfileIds, primaryCurrency, dateRange } = useApp();
  const params = useLocalSearchParams<{ id: string; term?: string; campaign?: string; adGroup?: string }>();
  const id = paramId(params.id);
  const chartWidth = Math.max(240, width - 64);

  const termQ = useQuery({
    queryKey: ["search-term-detail", id, selectedProfileIds, dateRange.start, dateRange.end],
    queryFn: () => fetchSearchTermById(id, selectedProfileIds, dateRange),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const dailyQ = useQuery({
    queryKey: ["search-term-daily", id, dateRange.start, dateRange.end],
    queryFn: () => fetchEntityDailyMetrics("search_term_metrics", "search_term_id", id, dateRange.start, dateRange.end),
    enabled: !!id && selectedProfileIds.length > 0,
  });

  const item = termQ.data;
  const term = item?.search_term ?? (paramId(params.term) || "Search term");
  const campaign = item?.campaign_name ?? (paramId(params.campaign) || "Campaign");
  const adGroup = item?.ad_group_name ?? paramId(params.adGroup);
  const alreadyTargeted = item ? searchTermLooksTargeted(item) : false;
  const alreadyNegated = item ? searchTermLooksNegated(item) : false;
  const spend = Number(item?.total_spend) || 0;
  const orders = Number(item?.total_orders) || 0;
  const verdict =
    alreadyNegated
      ? { label: "Negated", tone: "danger" as const }
      : alreadyTargeted
        ? { label: "Already a keyword", tone: "good" as const }
        : spend > 0 && orders === 0
          ? { label: "Spending without sales", tone: "danger" as const }
          : orders > 0
            ? { label: "Worth adding", tone: "good" as const }
            : { label: "No spend yet", tone: "inactive" as const };
  const contextBits = [item?.match_type, item?.term_type].filter(Boolean).join(" · ");
  const addPrimary = !alreadyTargeted && orders > 0;
  const negatePrimary = !alreadyNegated && spend > 0 && orders === 0;

  const refreshTerms = () => invalidateAds(["search-term-detail", "search-terms"]);

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Search term" showDateRange>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to see this search term." />
      </SubScreen>
    );
  }

  if (termQ.isLoading) {
    return (
      <SubScreen title="Search term" showDateRange>
        <ScreenSpinner />
      </SubScreen>
    );
  }

  const addAction = () =>
    promptAddSearchTerm({
      guestMode,
      id,
      term,
      onSuccess: refreshTerms,
    });
  const negateAction = () =>
    promptNegateSearchTerm({
      guestMode,
      id,
      term,
      onSuccess: refreshTerms,
    });

  return (
    <SubScreen title={term} showDateRange>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionCard>
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={[term, verdict.label, contextBits].filter(Boolean).join(". ")}
          >
          <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{term}</Text>
          <Text style={[t.typography.caption1, { color: toneColor(verdict.tone, t.colors), fontWeight: "600", marginTop: spacing.xs }]}>
            {verdict.label}
          </Text>
          {contextBits ? (
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: spacing.xxs }]}>
              {contextBits}
            </Text>
          ) : null}
          </View>
          <ParentLinks
            campaignId={item?.campaign_id}
            campaignName={campaign}
            adGroupId={item?.ad_group_id}
            adGroupName={adGroup}
          />

          <View style={styles.actions}>
            {negatePrimary ? (
              <>
                <PrimaryButton
                  testID={`search-term-negate-${id}`}
                  label={alreadyNegated ? "Already negated" : "Negate"}
                  accessibilityLabel={alreadyNegated ? `${term} is already negated` : `Negate ${term}`}
                  accessibilityHint="Adds a negative on Amazon Ads"
                  icon="remove-circle"
                  onPress={negateAction}
                  disabled={alreadyNegated}
                  tone="danger"
                  full
                />
                <SecondaryButton
                  testID={`search-term-add-${id}`}
                  label={alreadyTargeted ? "Already added" : "Add as keyword"}
                  accessibilityLabel={alreadyTargeted ? `${term} is already a keyword` : `Add ${term} as a keyword`}
                  accessibilityHint="Writes a keyword on Amazon Ads"
                  icon="add-circle-outline"
                  onPress={addAction}
                  disabled={alreadyTargeted}
                  full
                />
              </>
            ) : (
              <>
                {addPrimary ? (
                  <PrimaryButton
                    testID={`search-term-add-${id}`}
                    label={alreadyTargeted ? "Already added" : "Add as keyword"}
                    accessibilityLabel={alreadyTargeted ? `${term} is already a keyword` : `Add ${term} as a keyword`}
                    accessibilityHint="Writes a keyword on Amazon Ads"
                    icon="add-circle-outline"
                    onPress={addAction}
                    disabled={alreadyTargeted}
                    tone="good"
                    full
                  />
                ) : (
                  <SecondaryButton
                    testID={`search-term-add-${id}`}
                    label={alreadyTargeted ? "Already added" : "Add as keyword"}
                    accessibilityLabel={alreadyTargeted ? `${term} is already a keyword` : `Add ${term} as a keyword`}
                    accessibilityHint="Writes a keyword on Amazon Ads"
                    icon="add-circle-outline"
                    onPress={addAction}
                    disabled={alreadyTargeted}
                    full
                  />
                )}
                <SecondaryButton
                  testID={`search-term-negate-${id}`}
                  label={alreadyNegated ? "Already negated" : "Negate"}
                  accessibilityLabel={alreadyNegated ? `${term} is already negated` : `Negate ${term}`}
                  accessibilityHint="Adds a negative on Amazon Ads"
                  icon="remove-circle"
                  onPress={negateAction}
                  disabled={alreadyNegated}
                  full
                />
              </>
            )}
          </View>
        </SectionCard>

        {termQ.isError && !item ? (
          <RetryState
            title="Search term metrics failed to load"
            subtitle="You can still add or negate this term."
            onRetry={() => void termQ.refetch()}
            retrying={termQ.isRefetching}
          />
        ) : item ? (
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
        ) : (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
            Metrics aren’t in this date range. You can still add or negate this term.
          </Text>
        )}
      </ScrollView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: layout.pagePad, paddingBottom: 80 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
