import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { EmptyState, Pill, PrimaryButton, RetryState, SecondaryButton, SectionCard } from "@/src/components/Primitives";
import { alertMutationError } from "@/src/components/Mutations";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { cancelSync, fetchSyncStatus, triggerSync } from "@/src/lib/mutations";
import { fetchSyncOverview } from "@/src/lib/queries";
import { formatInt } from "@/src/lib/format";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { PLAN_MANAGE_MESSAGE, SIGN_IN_TO_MUTATE_MESSAGE } from "@/src/lib/rulesApi";
import { supabase } from "@/src/lib/supabase";
import {
  AMS_SECTION_SUBTITLE,
  AMS_SECTION_TITLE,
  CANCEL_CONFIRM_MESSAGE,
  CANCEL_CONFIRM_TITLE,
  CANCEL_SYNC_HINT,
  NO_AMS_TITLE,
  NO_PROFILE_LOGS_TITLE,
  NO_SELECTED_SUBTITLE,
  NO_SELECTED_TITLE,
  RECONNECT_COPY,
  RECORDS_FOOTNOTE,
  REFRESH_A11Y_HINT,
  REFRESH_A11Y_LABEL,
  SCOPE_HELPER,
  SYNC_NOW_HINT,
  SYNC_VIEWING_CUSTOMER_MESSAGE,
  VIEWING_CUSTOMER_BANNER,
  amsEventLabel,
  amsIntradayQueryKey,
  canMutateSync,
  canReadSync,
  formatSyncWhen,
  latestLogPerProfile,
  logWindowCaption,
  needsReviewNote,
  profileRunAccessibilityLabel,
  profileRunDisplayName,
  profileRunWhenLabel,
  reconnectRequiredFromLatest,
  resolvePresentedHero,
  sessionRowAccessibilityLabel,
  syncHeroAccessibilityLabel,
  syncHeroDetail,
  syncOverviewQueryKey,
  syncStatusLabel,
  syncStatusQueryKey,
  syncStatusTone,
  syncTypeLabel,
} from "@/src/lib/syncContract";
import { useTheme } from "@/src/lib/theme";
import { SFSymbol } from "@/src/components/ios/Native";

type IntradayRow = {
  id: string;
  at: string | null;
  kind: string | null;
};

async function fetchIntradayMessages(profileIds: string[]): Promise<IntradayRow[] | null> {
  if (!profileIds.length) return null;
  try {
    const primary = await supabase
      .from("ams_messages")
      .select("id,event_time,message_type,campaign_id")
      .in("amazon_profile_id", profileIds)
      .order("event_time", { ascending: false })
      .limit(20);
    if (!primary.error) {
      return (primary.data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        at: typeof row.event_time === "string" ? row.event_time : null,
        kind: typeof row.message_type === "string" ? row.message_type : null,
      }));
    }

    const fallback = await supabase
      .from("ams_messages")
      .select("id,created_at,type,campaign_id")
      .in("amazon_profile_id", profileIds)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!fallback.error) {
      return (fallback.data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        at: typeof row.created_at === "string" ? row.created_at : null,
        kind: typeof row.type === "string" ? row.type : null,
      }));
    }
  } catch {
    return null;
  }
  return null;
}

export default function SyncScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const { selectedProfileIds, adminFilterUserId } = useApp();
  const invalidateAds = useInvalidateAds();
  const [refreshing, setRefreshing] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const wasInProgress = useRef(false);

  const viewingCustomer = !!adminFilterUserId;
  const canRead = canReadSync({ userId: user?.id, guestMode });
  const canMutate = canMutateSync({ userId: user?.id, guestMode, adminFilterUserId });
  const hasSelectedProfiles = selectedProfileIds.length > 0;

  const syncQ = useQuery({
    queryKey: syncOverviewQueryKey(user?.id, selectedProfileIds, adminFilterUserId),
    queryFn: () =>
      fetchSyncOverview(user!.id, selectedProfileIds, { includeSessions: !viewingCustomer }),
    enabled: !!user?.id && hasSelectedProfiles,
    staleTime: 0,
    placeholderData: undefined,
  });

  const statusQ = useQuery({
    queryKey: syncStatusQueryKey(user?.id, adminFilterUserId),
    queryFn: () => fetchSyncStatus({ filterUserId: adminFilterUserId }),
    enabled: canRead,
    staleTime: 0,
    placeholderData: undefined,
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.data?.isSyncInProgress ? 4000 : false),
  });

  const intraQ = useQuery({
    queryKey: amsIntradayQueryKey(user?.id, selectedProfileIds, adminFilterUserId),
    queryFn: () => fetchIntradayMessages(selectedProfileIds),
    enabled: !!user?.id && hasSelectedProfiles,
    staleTime: 0,
    placeholderData: undefined,
    retry: false,
  });

  const inProgress = !!statusQ.data?.isSyncInProgress;
  const hasSyncAccess = statusQ.data?.hasSyncAccess !== false;
  const statusKnown = statusQ.isSuccess || !!statusQ.data;
  const logsKnown = syncQ.isSuccess || !!syncQ.data;
  const showIntraday = intraQ.isSuccess && intraQ.data !== null;
  const profiles = syncQ.data?.profiles ?? [];
  const sessions = syncQ.data?.sessions ?? [];

  useEffect(() => {
    if (wasInProgress.current && !inProgress) {
      void syncQ.refetch();
      void invalidateAds();
    }
    wasInProgress.current = inProgress;
  }, [inProgress, invalidateAds, syncQ]);

  const latestProfiles = useMemo(() => latestLogPerProfile(profiles), [profiles]);

  const summary = useMemo(() => {
    return {
      completed: profiles.filter((row) => row.status === "completed").length,
      failed: profiles.filter((row) => row.status === "failed" || row.status === "partial_failed").length,
      records: profiles.reduce(
        (sum, row) =>
          sum +
          Number(row.campaigns_synced || 0) +
          Number(row.ad_groups_synced || 0) +
          Number(row.keywords_synced || 0) +
          Number(row.product_ads_synced || 0) +
          Number(row.product_targets_synced || 0),
        0,
      ),
    };
  }, [profiles]);

  const presented = resolvePresentedHero({
    inProgress,
    statusKnown,
    statusFailed: statusQ.isError && !statusKnown,
    logsKnown,
    hasSelectedProfiles,
    profiles,
  });
  const detail = syncHeroDetail({
    inProgress,
    freshness: presented.freshness,
    profiles,
  });
  const spokenDetail = syncHeroDetail({
    inProgress,
    freshness: presented.freshness,
    profiles,
    spoken: true,
  });
  const reviewNote = presented.provisional
    ? undefined
    : needsReviewNote({ heroLabel: presented.label, latest: latestProfiles, logs: profiles });
  const statusSpeech = syncHeroAccessibilityLabel({
    label: presented.label,
    detail: spokenDetail ?? detail,
    reviewNote,
  });
  const showReconnect = !presented.provisional && reconnectRequiredFromLatest(latestProfiles);

  const requireSignIn = useCallback(() => {
    Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
  }, []);

  const onSyncNow = useCallback(async () => {
    if (viewingCustomer) {
      Alert.alert("Viewing a customer", SYNC_VIEWING_CUSTOMER_MESSAGE);
      return;
    }
    if (!canMutate) {
      requireSignIn();
      return;
    }
    setSyncBusy(true);
    try {
      await triggerSync();
      await statusQ.refetch();
    } catch (error) {
      alertMutationError(error, "Couldn't start sync.");
    } finally {
      setSyncBusy(false);
    }
  }, [canMutate, requireSignIn, statusQ, viewingCustomer]);

  const runCancel = useCallback(async () => {
    if (viewingCustomer) {
      Alert.alert("Viewing a customer", SYNC_VIEWING_CUSTOMER_MESSAGE);
      return;
    }
    if (!canMutate) {
      requireSignIn();
      return;
    }
    setCancelBusy(true);
    try {
      await cancelSync();
      await statusQ.refetch();
    } catch (error) {
      alertMutationError(error, "Couldn't cancel sync.");
    } finally {
      setCancelBusy(false);
    }
  }, [canMutate, requireSignIn, statusQ, viewingCustomer]);

  const onCancel = useCallback(() => {
    Alert.alert(CANCEL_CONFIRM_TITLE, CANCEL_CONFIRM_MESSAGE, [
      { text: "Keep syncing", style: "cancel" },
      { text: "Cancel sync", style: "destructive", onPress: () => void runCancel() },
    ]);
  }, [runCancel]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([syncQ.refetch(), statusQ.refetch(), intraQ.refetch()]);
    setRefreshing(false);
  }, [intraQ, statusQ, syncQ]);

  const statusLoading = !statusKnown && statusQ.isLoading;
  const syncNowDisabled =
    !canMutate || inProgress || syncBusy || !hasSyncAccess || (statusLoading && !statusQ.isError);

  return (
    <SubScreen
      title="Sync"
      rightAction={{
        icon: "refresh",
        onPress: () => void Promise.all([syncQ.refetch(), statusQ.refetch(), intraQ.refetch()]),
        testID: "sync-refresh",
        accessibilityLabel: REFRESH_A11Y_LABEL,
        accessibilityHint: REFRESH_A11Y_HINT,
      }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.tone_primary}
            title="Refresh status"
            accessibilityLabel={REFRESH_A11Y_LABEL}
          />
        }
      >
        {viewingCustomer ? (
          <View
            testID="sync-viewing-customer"
            accessibilityRole="text"
            accessibilityLabel={VIEWING_CUSTOMER_BANNER}
            style={[styles.banner, { backgroundColor: t.colors.tone_warning + "12", borderColor: t.colors.tone_warning + "30" }]}
          >
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>{VIEWING_CUSTOMER_BANNER}</Text>
          </View>
        ) : null}

        <View
          testID="sync-status"
          accessibilityRole="header"
          accessibilityLabel={statusSpeech}
          style={[styles.statusCard, { backgroundColor: t.colors.background_secondary }]}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <View accessible={false} importantForAccessibility="no">
              {inProgress || presented.state === "syncing" ? (
                <ActivityIndicator color={t.colors.tone_primary} />
              ) : (
                <StatusIcon status={presented.state === "warning" ? "partial_failed" : presented.state === "connected" ? "completed" : "idle"} t={t} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{presented.label}</Text>
              {detail ? (
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>{detail}</Text>
              ) : null}
              {reviewNote ? (
                <Text style={[t.typography.footnote, { color: t.colors.tone_warning, marginTop: 4 }]}>{reviewNote}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {hasSelectedProfiles ? (
          <Text
            testID="sync-scope-helper"
            style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: 12, lineHeight: 16 }]}
          >
            {SCOPE_HELPER}
          </Text>
        ) : null}

        {viewingCustomer ? null : inProgress && canMutate ? (
          <SecondaryButton
            testID="sync-cancel-btn"
            label={cancelBusy ? "Canceling…" : "Cancel"}
            onPress={onCancel}
            disabled={cancelBusy}
            accessibilityLabel="Cancel Amazon Ads sync"
            accessibilityHint={CANCEL_SYNC_HINT}
            full
          />
        ) : !inProgress ? (
          <PrimaryButton
            testID="sync-now-btn"
            label="Sync now"
            icon="sync-outline"
            onPress={() => void onSyncNow()}
            loading={syncBusy}
            disabled={syncNowDisabled}
            accessibilityLabel="Sync now"
            accessibilityHint={SYNC_NOW_HINT}
            full
          />
        ) : null}

        {statusQ.isError && !statusKnown ? (
          <View style={{ marginTop: 12 }}>
            <RetryState
              title="Couldn't check Amazon Ads status"
              subtitle="Refresh does not start a new sync."
              onRetry={() => void statusQ.refetch()}
              retrying={statusQ.isFetching}
            />
          </View>
        ) : null}

        {!canMutate && !viewingCustomer ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, textAlign: "center", marginTop: 8 }]}>
            Sign in to sync.
          </Text>
        ) : null}
        {canMutate && !hasSyncAccess ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, textAlign: "center", marginTop: 8 }]}>
            {statusQ.data?.noSyncAccessMessage || PLAN_MANAGE_MESSAGE}
          </Text>
        ) : null}

        {showReconnect ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={[t.typography.footnote, { color: t.colors.tone_warning }]}>{RECONNECT_COPY}</Text>
            <SecondaryButton
              testID="sync-reconnect"
              label="Open Accounts"
              onPress={() => router.push("/more/accounts")}
              accessibilityLabel="Open Accounts"
              accessibilityHint="Opens Amazon accounts to reconnect."
              full
            />
          </View>
        ) : null}

        {!hasSelectedProfiles ? (
          <View style={{ marginTop: 8 }}>
            <EmptyState icon="business-outline" title={NO_SELECTED_TITLE} subtitle={NO_SELECTED_SUBTITLE} />
          </View>
        ) : syncQ.isError && !logsKnown ? (
          <RetryState
            title="Couldn't load Amazon Ads logs"
            subtitle="Status above may still be current. Retry does not start a new sync."
            onRetry={() => void syncQ.refetch()}
            retrying={syncQ.isFetching}
          />
        ) : !logsKnown ? (
          <View
            style={{ paddingVertical: 20, alignItems: "center" }}
            accessibilityRole="text"
            accessibilityLabel="Loading Amazon Ads logs"
          >
            <ActivityIndicator color={t.colors.tone_primary} />
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>
              Loading Amazon Ads logs…
            </Text>
          </View>
        ) : (
          <>
            <SectionCard title="Selected profiles">
              {latestProfiles.length === 0 ? (
                <Text style={[t.typography.subhead, { color: t.colors.text_secondary }]}>{NO_PROFILE_LOGS_TITLE}</Text>
              ) : (
                latestProfiles.map((row, index, rows) => {
                  const name = profileRunDisplayName(row);
                  const when = profileRunWhenLabel(row);
                  return (
                    <View
                      key={row.id}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={profileRunAccessibilityLabel({
                        name,
                        status: row.status,
                        when,
                        error: row.error_message,
                      })}
                      style={[
                        styles.row,
                        {
                          borderBottomColor: t.colors.separator,
                          borderBottomWidth: index === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View accessible={false} importantForAccessibility="no">
                        <StatusIcon status={row.status} t={t} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
                          {name}
                        </Text>
                        {when ? (
                          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                            {when}
                          </Text>
                        ) : null}
                        {!!row.error_message && (row.status === "failed" || row.status === "partial_failed") ? (
                          <Text style={[t.typography.caption2, { color: t.colors.tone_danger, marginTop: 3 }]}>
                            {row.error_message}
                          </Text>
                        ) : null}
                      </View>
                      <Pill label={syncStatusLabel(row.status)} tone={syncStatusTone(row.status)} />
                    </View>
                  );
                })
              )}
              {profiles.length > 0 ? (
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 10, lineHeight: 16 }]}>
                  {logWindowCaption({
                    completed: summary.completed,
                    failed: summary.failed,
                    records: formatInt(summary.records),
                  })}
                </Text>
              ) : null}
              {profiles.length > 0 ? (
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4, lineHeight: 15 }]}>
                  {RECORDS_FOOTNOTE}
                </Text>
              ) : null}
            </SectionCard>

            <SectionCard title="Recent activity">
              {sessions.length === 0 ? (
                <Text style={[t.typography.subhead, { color: t.colors.text_secondary }]}>
                  {viewingCustomer ? "Customer sessions not loaded here" : "No sync sessions"}
                </Text>
              ) : (
                sessions.slice(0, 12).map((row, index, rows) => {
                  const when = row.completed_at
                    ? `Updated ${formatSyncWhen(row.completed_at)}`
                    : row.started_at || row.created_at
                      ? `Started ${formatSyncWhen(row.started_at || row.created_at)}`
                      : undefined;
                  return (
                    <View
                      key={row.id}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={sessionRowAccessibilityLabel({
                        type: row.sync_type,
                        status: row.status,
                        when,
                      })}
                      style={[
                        styles.row,
                        {
                          borderBottomColor: t.colors.separator,
                          borderBottomWidth: index === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View accessible={false} importantForAccessibility="no">
                        <StatusIcon status={row.status || ""} t={t} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
                          {syncTypeLabel(row.sync_type)}
                        </Text>
                        {when ? (
                          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                            {when}
                          </Text>
                        ) : null}
                        {row.sync_type === "hourly" || row.sync_type === "full" ? (
                          <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
                            Scheduled
                          </Text>
                        ) : null}
                      </View>
                      <Pill label={syncStatusLabel(row.status)} tone={syncStatusTone(row.status || "")} />
                    </View>
                  );
                })
              )}
              {viewingCustomer ? (
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 8, lineHeight: 16 }]}>
                  Session rows belong to the signed-in admin. Use web Sync with the customer filter.
                </Text>
              ) : null}
            </SectionCard>

            {showIntraday ? (
              <SectionCard title={AMS_SECTION_TITLE}>
                <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: 8, lineHeight: 16 }]}>
                  {AMS_SECTION_SUBTITLE}
                </Text>
                {(intraQ.data ?? []).length === 0 ? (
                  <Text style={[t.typography.subhead, { color: t.colors.text_secondary }]}>{NO_AMS_TITLE}</Text>
                ) : (
                  (intraQ.data ?? []).map((row, index, rows) => (
                    <View
                      key={row.id}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={`${amsEventLabel(row.kind)}. ${row.at ? formatSyncWhen(row.at, Date.now(), { spoken: true }) : ""}`}
                      style={[
                        styles.row,
                        {
                          borderBottomColor: t.colors.separator,
                          borderBottomWidth: index === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View accessible={false} importantForAccessibility="no">
                        <SFSymbol name="bolt" size={16} color={t.colors.tone_primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
                          {amsEventLabel(row.kind)}
                        </Text>
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                          {row.at ? formatSyncWhen(row.at) : "—"}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </SectionCard>
            ) : null}
          </>
        )}
      </ScrollView>
    </SubScreen>
  );
}

function StatusIcon({ status, t }: { status: string; t: any }) {
  if (status === "completed" || status === "connected") {
    return <SFSymbol name="checkmark.circle.fill" size={18} color={t.colors.tone_good} />;
  }
  if (status === "partial_failed" || status === "warning") {
    return <SFSymbol name="exclamationmark.triangle.fill" size={18} color={t.colors.tone_warning} />;
  }
  if (status === "pending" || status === "running" || status === "processing" || status === "in_progress" || status === "syncing") {
    return <SFSymbol name="clock.fill" size={18} color={t.colors.tone_primary} />;
  }
  if (status === "cancelled") {
    return <SFSymbol name="minus.circle.fill" size={18} color={t.colors.tone_inactive} />;
  }
  if (status === "idle") {
    return <SFSymbol name="circle" size={18} color={t.colors.tone_inactive} />;
  }
  return <SFSymbol name="xmark.circle.fill" size={18} color={t.colors.tone_danger} />;
}

const styles = StyleSheet.create({
  statusCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 11,
    minHeight: 44,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
});
