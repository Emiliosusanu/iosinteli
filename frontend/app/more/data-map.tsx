import React, { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { IOSButton, SFSymbol } from "@/src/components/ios/Native";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, RetryState, ScreenSpinner, SectionCard } from "@/src/components/Primitives";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  fetchDataCoverageOverview,
  type DataCoverageOverview,
  type DataCoverageRow,
} from "@/src/lib/queries";
import {
  formatDateRangeLabel,
  formatDateShort,
} from "@/src/lib/format";
import { formatSyncWhen } from "@/src/lib/syncContract";
import { dashboard, toneColor, useTheme } from "@/src/lib/theme";
import {
  KDP_IPHONE_BOUNDARY,
  adsMetricFacts,
  adsSourcePresentation,
  coverageCountLabel,
  coverageStatusLabel,
  hasMixedCurrencies,
  kdpMetricFacts,
  kdpSourcePresentation,
  rowsForScope,
  sourceAccessibilityLabel,
  type DiagnosticTone,
} from "@/src/lib/dataMap";

export default function DataMapScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const {
    selectedProfileIds,
    selectedProfiles,
    adminFilterUserId,
    dateRange,
    primaryCurrency,
  } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const canRead =
    !!user?.id &&
    !guestMode &&
    !viewingCustomer &&
    selectedProfileIds.length > 0;

  const coverageQ = useQuery({
    queryKey: [
      "data-map",
      user?.id ?? "guest",
      adminFilterUserId ?? "self",
      selectedProfileIds,
      dateRange.start,
      dateRange.end,
    ],
    queryFn: () => fetchDataCoverageOverview(selectedProfileIds, dateRange.start, dateRange.end),
    enabled: canRead,
    placeholderData: undefined,
  });

  const currentRows = useMemo(
    () => rowsForScope(coverageQ.data?.rows ?? [], "current"),
    [coverageQ.data?.rows],
  );
  const periodRows = useMemo(
    () => rowsForScope(coverageQ.data?.rows ?? [], "period"),
    [coverageQ.data?.rows],
  );
  const mixedCurrencies = hasMixedCurrencies(
    selectedProfiles.map((profile) => profile.currency_code),
  );
  const periodLabel = formatDateRangeLabel(dateRange);

  if (guestMode || !user?.id) {
    return (
      <SubScreen title="Data coverage">
        <EmptyState
          icon="person-outline"
          title="Sign in to check data coverage"
          subtitle="Preview demo does not include account diagnostics."
        />
      </SubScreen>
    );
  }

  if (viewingCustomer) {
    return (
      <SubScreen title="Data coverage">
        <EmptyState
          icon="eye-off-outline"
          title="Customer coverage unavailable"
          subtitle="This screen combines sources that are not safely customer-scoped on iPhone. Switch back to your account from Campaigns, Targets, or Books."
        />
      </SubScreen>
    );
  }

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Data coverage">
        <EmptyState
          icon="business-outline"
          title="No profiles in the current view"
          subtitle="Choose profiles in Amazon Accounts or from a screen with the profile selector."
        />
      </SubScreen>
    );
  }

  const rightAction = {
    icon: "refresh" as const,
    onPress: () => void coverageQ.refetch(),
    testID: "data-map-refresh",
    accessibilityLabel: "Refresh data coverage",
    accessibilityHint: "Checks the selected profiles again. Does not start a sync.",
  };

  return (
    <SubScreen title="Data coverage" showDateRange rightAction={rightAction}>
      {coverageQ.isLoading && !coverageQ.data ? (
        <ScreenSpinner />
      ) : coverageQ.isError && !coverageQ.data ? (
        <RetryState
          title="Couldn't check data coverage"
          subtitle="Your account and data were not changed."
          onRetry={() => void coverageQ.refetch()}
          retrying={coverageQ.isRefetching}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={coverageQ.isRefetching}
              onRefresh={() => void coverageQ.refetch()}
              tintColor={t.colors.tone_primary}
            />
          }
        >
          <View
            testID="data-map-context"
            accessible
            accessibilityRole="header"
            accessibilityLabel={`Coverage for ${selectedProfileIds.length} selected ${selectedProfileIds.length === 1 ? "profile" : "profiles"}. ${periodLabel} for activity data. Setup counts are current.`}
            style={[styles.contextCard, { backgroundColor: t.colors.background_secondary }]}
          >
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
              What InteliAds can use
            </Text>
            <Text
              style={[
                t.typography.footnote,
                { color: t.colors.text_secondary, marginTop: 4, lineHeight: undefined },
              ]}
            >
              {selectedProfileIds.length} selected {selectedProfileIds.length === 1 ? "profile" : "profiles"} · {periodLabel} for activity data
            </Text>
            <Text
              style={[
                t.typography.footnote,
                { color: t.colors.text_secondary, marginTop: 3, lineHeight: undefined },
              ]}
            >
              Setup counts are current. Ads activity and KDP royalties use the selected period.
            </Text>
            {mixedCurrencies ? (
              <Text
                accessibilityRole="alert"
                style={[
                  t.typography.footnote,
                  { color: t.colors.tone_warning, marginTop: 6, lineHeight: undefined },
                ]}
              >
                Multiple currencies are selected. This diagnostic does not combine them.
              </Text>
            ) : null}
          </View>

          {coverageQ.data ? (
            <>
              <SourceCard
                title="Amazon Ads"
                source="Amazon Advertising"
                presentation={adsSourcePresentation(coverageQ.data.ads)}
                details={adsDetails(coverageQ.data, primaryCurrency, mixedCurrencies)}
                actionLabel="View Amazon Ads sync"
                actionTestID="data-map-open-sync"
                actionHint="Opens Sync. Does not start a new sync."
                onAction={() => router.push("/more/sync")}
              />

              <SourceCard
                title="KDP royalties"
                source="Imported KDP data"
                presentation={kdpSourcePresentation(coverageQ.data.kdp)}
                details={kdpDetails(coverageQ.data, primaryCurrency, mixedCurrencies)}
                note={KDP_IPHONE_BOUNDARY}
                actionLabel="Open Amazon Accounts"
                actionTestID="data-map-open-accounts"
                actionHint="Opens Amazon Accounts to review KDP links."
                onAction={() => router.push("/more/accounts")}
              />

              <CoverageSection title="Current setup" rows={currentRows} />
              <CoverageSection title="Selected period" rows={periodRows} />
            </>
          ) : null}

          <SectionCard title="Selected profile scope">
            {selectedProfiles.length > 0 ? selectedProfiles.map((profile, index, rows) => (
              <View
                key={profile.id}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`${profile.nickname || profile.account_name || "Amazon profile"}. ${profile.country_code || "Marketplace unavailable"}. ${profile.currency_code || "Currency unavailable"}.`}
                style={[
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: index === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", lineHeight: undefined }]}>
                    {profile.nickname || profile.account_name || "Amazon profile"}
                  </Text>
                  <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    {[profile.country_code, profile.currency_code].filter(Boolean).join(" · ") || "Marketplace details unavailable"}
                  </Text>
                </View>
              </View>
            )) : (
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, lineHeight: undefined }]}>
                {selectedProfileIds.length} selected profile {selectedProfileIds.length === 1 ? "name is" : "names are"} unavailable.
              </Text>
            )}
          </SectionCard>
        </ScrollView>
      )}
    </SubScreen>
  );
}

function SourceCard({
  title,
  source,
  presentation,
  details,
  note,
  actionLabel,
  actionTestID,
  actionHint,
  onAction,
}: {
  title: string;
  source: string;
  presentation: ReturnType<typeof adsSourcePresentation>;
  details: string[];
  note?: string;
  actionLabel: string;
  actionTestID: string;
  actionHint: string;
  onAction: () => void;
}) {
  const t = useTheme();
  const color = toneColor(presentation.tone, t.colors);
  return (
    <View style={[styles.sourceCard, { backgroundColor: t.colors.background_secondary }]}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={sourceAccessibilityLabel({
          title,
          status: presentation.statusLabel,
          summary: presentation.summary,
          details: note ? [...details, note] : details,
        })}
      >
        <View style={styles.sourceHeader}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.sourceIcon, { backgroundColor: color + "18" }]}
          >
            <SFSymbol
              name={presentation.tone === "good" ? "checkmark.circle.fill" : presentation.tone === "danger" ? "exclamationmark.triangle.fill" : "minus.circle.fill"}
              size={18}
              color={color}
            />
          </View>
          <View style={styles.sourceTitle}>
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{title}</Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
              {source}
            </Text>
          </View>
          <Text style={[t.typography.footnote, { color, fontWeight: "600", textAlign: "right" }]}>
            {presentation.statusLabel}
          </Text>
        </View>
        <Text style={[t.typography.subhead, { color: t.colors.text_secondary, marginTop: 10, lineHeight: undefined }]}>
          {presentation.summary}
        </Text>
        {details.map((detail) => (
          <Text
            key={detail}
            style={[t.typography.footnote, { color: t.colors.text_primary, marginTop: 5, lineHeight: undefined, fontVariant: ["tabular-nums"] }]}
          >
            {detail}
          </Text>
        ))}
        {note ? (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8, lineHeight: undefined }]}>
            {note}
          </Text>
        ) : null}
      </View>
      <View style={styles.sourceAction}>
        <IOSButton
          testID={actionTestID}
          label={actionLabel}
          prominent={false}
          onPress={onAction}
          accessibilityHint={actionHint}
          full
        />
      </View>
    </View>
  );
}

function CoverageSection({ title, rows }: { title: string; rows: DataCoverageRow[] }) {
  return (
    <SectionCard title={title}>
      {rows.map((row, index) => (
        <CoverageRow key={row.key} row={row} last={index === rows.length - 1} />
      ))}
    </SectionCard>
  );
}

function CoverageRow({ row, last }: { row: DataCoverageRow; last: boolean }) {
  const t = useTheme();
  const status = coverageStatusLabel(row);
  const count = coverageCountLabel(row);
  const tone: DiagnosticTone =
    row.status === "available" ? "good" : row.status === "error" ? "danger" : "inactive";
  const color = toneColor(tone, t.colors);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${row.label}. ${status}. Count ${count}.`}
      style={[
        styles.row,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SFSymbol
          name={row.status === "available" ? "checkmark.circle.fill" : row.status === "error" ? "exclamationmark.triangle.fill" : "minus.circle.fill"}
          size={17}
          color={color}
        />
      </View>
      <View style={styles.coverageCopy}>
        <Text style={[t.typography.callout, { color: t.colors.text_primary, lineHeight: undefined }]}>
          {row.label}
        </Text>
        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
          {status}
        </Text>
      </View>
      <Text style={[t.typography.callout, { color: t.colors.text_secondary, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>
        {count}
      </Text>
    </View>
  );
}

function adsDetails(
  data: DataCoverageOverview,
  currency: string,
  mixedCurrencies: boolean,
): string[] {
  const details = adsMetricFacts({ ads: data.ads, currency, mixedCurrencies });
  if (data.ads.syncStatus === "needs_review") details.push("Amazon Ads sync needs review.");
  else if (data.ads.lastCompletedAt) {
    details.push(`Last successful Ads sync ${formatSyncWhen(data.ads.lastCompletedAt, Date.now(), { spoken: true })}`);
  } else if (data.ads.syncStatus === "error") details.push("Ads sync freshness could not be checked.");
  else details.push("Ads sync freshness is unavailable.");
  return details;
}

function kdpDetails(
  data: DataCoverageOverview,
  currency: string,
  mixedCurrencies: boolean,
): string[] {
  const details = kdpMetricFacts({ kdp: data.kdp, currency, mixedCurrencies });
  if (data.kdp.latestDataDate) {
    details.push(`Royalty data present through ${formatDateShort(data.kdp.latestDataDate)}`);
  }
  return details;
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 120,
  },
  contextCard: {
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    padding: 14,
    marginBottom: 12,
  },
  sourceCard: {
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    padding: 14,
    marginBottom: 12,
  },
  sourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceTitle: {
    flex: 1,
    minWidth: 0,
  },
  sourceAction: {
    marginTop: 12,
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  coverageCopy: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 10,
  },
});
