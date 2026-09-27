import React, { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, RetryState } from "@/src/components/Primitives";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { loadScopedKdpFreshness } from "@/src/lib/kdpIngestMonitor";
import { formatIngestAge, kdpIngestStatusLabel } from "@/src/lib/kdpIngestFreshness";
import {
  KDP_INGEST_EMPTY,
  KDP_INGEST_SECTION_TITLE,
  KDP_INGEST_UNAVAILABLE,
  KDP_STALE_FOOTER,
  KDP_STALE_LABEL,
} from "@/src/lib/settingsContract";
import { IOSGroupedSection, IOSSettingsRow } from "@/src/components/ios/Native";

/** Destination from Overview sync chip when linked KDP accounts stop delivering. */
export default function KdpStatusScreen() {
  const t = useTheme();
  const router = useRouter();
  const { guestMode } = useAuth();
  const { selectedProfileIds, adminFilterUserId } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const profileKey = useMemo(
    () => [...selectedProfileIds].map(String).sort().join("|"),
    [selectedProfileIds],
  );
  const nowMs = Date.now();

  const ingestQ = useQuery({
    queryKey: ["kdp-status-ingest", profileKey],
    queryFn: () => loadScopedKdpFreshness(selectedProfileIds, Date.now()),
    enabled: !guestMode && !viewingCustomer && selectedProfileIds.length > 0,
    refetchInterval: 60_000,
  });

  const rows = ingestQ.data ?? [];
  const staleRows = rows.filter((row) => row.stale);
  const title = staleRows.length ? KDP_STALE_LABEL : KDP_INGEST_SECTION_TITLE;

  return (
    <SubScreen title={title}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={ingestQ.isRefetching}
            onRefresh={() => void ingestQ.refetch()}
            tintColor={t.colors.tone_primary}
          />
        }
      >
        {guestMode || viewingCustomer ? (
          <EmptyState
            icon="book-outline"
            title={KDP_INGEST_EMPTY}
            subtitle="Sign in with your seller account to see KDP delivery."
          />
        ) : ingestQ.isError ? (
          <RetryState
            title={KDP_INGEST_UNAVAILABLE}
            subtitle="Pull to retry."
            onRetry={() => void ingestQ.refetch()}
          />
        ) : !selectedProfileIds.length ? (
          <EmptyState
            icon="business-outline"
            title="Select an Amazon profile"
            subtitle="KDP delivery is scoped to the profiles on Overview."
          />
        ) : ingestQ.isPending && !rows.length ? (
          <View style={{ padding: 24 }}>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>Checking KDP…</Text>
          </View>
        ) : !rows.length ? (
          <EmptyState
            icon="link-outline"
            title={KDP_INGEST_EMPTY}
            subtitle="Link a KDP account to the selected Amazon profiles."
          />
        ) : (
          <>
            {staleRows.length ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <Text style={[t.typography.footnote, { color: t.colors.tone_danger, lineHeight: 18 }]}>
                  {staleRows.length === 1
                    ? `${staleRows[0].name} is not delivering royalties.`
                    : `${staleRows.length} KDP accounts are not delivering royalties.`}
                </Text>
              </View>
            ) : null}
            <IOSGroupedSection
              title={KDP_INGEST_SECTION_TITLE}
              footer={staleRows.length ? KDP_STALE_FOOTER : "Linked accounts for the selected Amazon profiles."}
            >
              {rows.map((row, index) => (
                <IOSSettingsRow
                  key={row.accountId}
                  testID={`kdp-status-${row.accountId}`}
                  label={row.name}
                  subtitle={kdpIngestStatusLabel(row, nowMs)}
                  value={formatIngestAge(row.lastIngestAtMs, nowMs)}
                  symbol={row.stale ? "exclamationmark.icloud" : "checkmark.icloud"}
                  symbolColor={row.stale ? t.colors.tone_danger : t.colors.tone_good}
                  last={index === rows.length - 1}
                  onPress={() => router.push("/more/kdp-source" as Href)}
                  accessibilityLabel={`${row.name}. ${kdpIngestStatusLabel(row, nowMs)}. ${formatIngestAge(row.lastIngestAtMs, nowMs)}`}
                />
              ))}
            </IOSGroupedSection>
            <IOSGroupedSection>
              <IOSSettingsRow
                testID="kdp-status-open-source"
                label="KDP royalty source"
                subtitle="Chrome extension or iPhone helper"
                symbol="book"
                symbolColor={t.colors.tone_primary}
                last
                onPress={() => router.push("/more/kdp-source" as Href)}
              />
            </IOSGroupedSection>
          </>
        )}
      </ScrollView>
    </SubScreen>
  );
}
