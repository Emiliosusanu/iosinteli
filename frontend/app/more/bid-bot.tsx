import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import {
  EmptyState,
  Pill,
  PrimaryButton,
  RetryState,
  SecondaryButton,
  SectionCard,
} from "@/src/components/Primitives";
import { alertMutationError } from "@/src/components/Mutations";
import { IOSSegmentedControl, SFSymbol } from "@/src/components/ios/Native";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, type Theme } from "@/src/lib/theme";
import { formatPercent } from "@/src/lib/format";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { SIGN_IN_TO_MUTATE_MESSAGE } from "@/src/lib/rulesApi";
import {
  ABOUT_BIDBOT_COPY,
  AGGRESSIVE_CONFIRM_MESSAGE,
  AGGRESSIVE_CONFIRM_TITLE,
  BIDBOT_SCOPE_HELPER,
  BIDBOT_VIEWING_CUSTOMER_MESSAGE,
  CURRENCY_GAP_CAPTION,
  MIN_MAX_DISPLAY_CAPTION,
  SNAPSHOT_BID_LABEL,
  TARGET_ACOS_CAPTION,
  VIEWING_CUSTOMER_BANNER,
  applyBidConfirmMessage,
  applyBidConfirmTitle,
  applyBidsA11yLabel,
  applyBidsButtonLabel,
  applyPlacementConfirmMessage,
  applyPlacementConfirmTitle,
  asAutoMode,
  assertBidApplicationSucceeded,
  assertRevertSucceeded,
  autoModeDescription,
  autoModeLabel,
  bidBotApplyLogQueryKey,
  bidBotPlacementsQueryKey,
  bidBotReadFilterUserId,
  bidBotRecsQueryKey,
  bidBotSettingsQueryKey,
  bidBotStatusQueryKey,
  bidDeltaLabel,
  canMutateBidBot,
  confidenceCategoryLabel,
  emptyBidRecsSubtitle,
  emptyBidRecsTitle,
  formatBidAmount,
  humanizeBidApplyError,
  isExpiredRecommendation,
  needsRunAutoConfirm,
  persistableBidBotSettings,
  placementIdentity,
  recRowAccessibilityLabel,
  recommendationContext,
  recommendationTitle,
  revertConfirmMessage,
  runEngineA11yLabel,
  runEngineConfirmMessage,
  runEngineConfirmTitle,
  type BidBotAutoMode,
} from "@/src/lib/bidBotContract";
import {
  applyBidRecommendations,
  applyPlacementRecommendations,
  fetchBidEngineApplyLog,
  fetchBidEngineSettings,
  fetchBidEngineStatus,
  fetchBidRecommendations,
  fetchPendingBidRecommendations,
  fetchPlacementRecommendations,
  revertBidApplyLog,
  runBidEngine,
  updateBidEngineSettings,
  type BidEngineApplyLogEntry,
  type BidRecommendation,
  type PlacementAdjustments,
  type PlacementRecommendation,
} from "@/src/lib/mutations";

type Tab = "working" | "settings" | "how";

const TABS: { key: Tab; label: string; testID: string }[] = [
  { key: "working", label: "Working", testID: "bid-bot-tab-working" },
  { key: "settings", label: "Settings", testID: "bid-bot-tab-settings" },
  { key: "how", label: "About", testID: "bid-bot-tab-how" },
];

async function loadPendingBidRecommendations(filterUserId?: string | null): Promise<BidRecommendation[]> {
  try {
    const pending = await fetchPendingBidRecommendations(filterUserId);
    if (pending.length > 0) return pending;
  } catch {
    // Dedicated pending endpoint can be missing or empty; use the status filter.
  }
  return fetchBidRecommendations({ status: "pending", filterUserId });
}

function relativeTime(value?: string | null): string {
  if (!value) return "Never";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "Never";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "Just now";
}

function autoModeTone(mode?: string | null): "inactive" | "good" | "warning" {
  if (mode === "high_confidence") return "good";
  if (mode === "aggressive") return "warning";
  return "inactive";
}

function formatPlacements(value?: PlacementAdjustments): string {
  if (!value) return "—";
  const parts: string[] = [];
  if (value.top_of_search != null) parts.push(`ToS ${value.top_of_search}%`);
  if (value.product_pages != null) parts.push(`PP ${value.product_pages}%`);
  if (value.rest_of_search != null) parts.push(`RoS ${value.rest_of_search}%`);
  return parts.join(" · ") || "—";
}

function placementKey(row: PlacementRecommendation, index: number): string {
  return row.campaignId || row.recommendationId || row.currentVersionId || `placement-${index}`;
}

function reportMutationError(error: unknown, fallback: string) {
  const human = humanizeBidApplyError(error);
  alertMutationError(human !== "Amazon didn't apply those changes." ? new Error(human) : error, fallback);
}

/** Drop fixed lineHeight so Dynamic Type can wrap instead of clipping. */
function growType(style: TextStyle): TextStyle {
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
  };
}

export default function BidBotScreen() {
  const t = useTheme();
  const { user, guestMode } = useAuth();
  const { adminFilterUserId } = useApp();
  const invalidateAds = useInvalidateAds();
  const viewingCustomer = !!adminFilterUserId;
  const canMutate = canMutateBidBot({ userId: user?.id, guestMode, adminFilterUserId });
  const readFilterUserId = bidBotReadFilterUserId(user?.id, adminFilterUserId);

  const [tab, setTab] = useState<Tab>("working");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRecIds, setSelectedRecIds] = useState<string[]>([]);
  const [selectedPlacementKeys, setSelectedPlacementKeys] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [applyingBids, setApplyingBids] = useState(false);
  const [applyingPlacements, setApplyingPlacements] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [targetAcos, setTargetAcos] = useState("");
  const [autoMode, setAutoMode] = useState<BidBotAutoMode>("off");
  const [settingsReady, setSettingsReady] = useState(false);

  const statusQ = useQuery({
    queryKey: bidBotStatusQueryKey(user?.id, adminFilterUserId),
    queryFn: () => fetchBidEngineStatus(readFilterUserId),
    enabled: !!user?.id,
    staleTime: 0,
    placeholderData: undefined,
  });
  const settingsQ = useQuery({
    queryKey: bidBotSettingsQueryKey(user?.id, adminFilterUserId),
    queryFn: () => fetchBidEngineSettings(readFilterUserId),
    enabled: !!user?.id,
    staleTime: 0,
    placeholderData: undefined,
  });
  const recsQ = useQuery({
    queryKey: bidBotRecsQueryKey(user?.id, adminFilterUserId),
    queryFn: () => loadPendingBidRecommendations(readFilterUserId),
    enabled: !!user?.id,
    staleTime: 0,
    placeholderData: undefined,
  });
  const placementsQ = useQuery({
    queryKey: bidBotPlacementsQueryKey(user?.id, adminFilterUserId),
    queryFn: () => fetchPlacementRecommendations(readFilterUserId),
    enabled: !!user?.id,
    staleTime: 0,
    placeholderData: undefined,
  });
  const logQ = useQuery({
    queryKey: bidBotApplyLogQueryKey(user?.id, adminFilterUserId),
    queryFn: () => fetchBidEngineApplyLog({ filterUserId: readFilterUserId }),
    enabled: !!user?.id,
    staleTime: 0,
    placeholderData: undefined,
  });

  useEffect(() => {
    if (settingsReady || !settingsQ.data) return;
    const s = settingsQ.data;
    if (s.targetAcos != null && Number.isFinite(s.targetAcos)) setTargetAcos(String(s.targetAcos));
    setAutoMode(asAutoMode(s.autoMode));
    setSettingsReady(true);
  }, [settingsQ.data, settingsReady]);

  const recs = recsQ.data ?? [];
  const placements = placementsQ.data ?? [];
  const activity = logQ.data ?? [];
  const status = statusQ.data;
  const confirmedMode = asAutoMode(status?.autoMode ?? settingsQ.data?.autoMode);
  const hasRun = !!status?.lastRunAt;

  const selectedRecs = useMemo(
    () =>
      recs.filter(
        (row) => row.id && selectedRecIds.includes(row.id) && !isExpiredRecommendation(row.status),
      ),
    [recs, selectedRecIds],
  );
  const selectedPlacements = useMemo(
    () =>
      placements.filter(
        (row, index) => selectedPlacementKeys.includes(placementKey(row, index)) && !row.inCooldown,
      ),
    [placements, selectedPlacementKeys],
  );

  const guardWrite = useCallback(() => {
    if (viewingCustomer) {
      Alert.alert("Viewing a customer", BIDBOT_VIEWING_CUSTOMER_MESSAGE);
      return false;
    }
    if (guestMode || !user?.id) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return false;
    }
    return true;
  }, [guestMode, user?.id, viewingCustomer]);

  const refetchWorking = useCallback(async () => {
    await Promise.all([statusQ.refetch(), recsQ.refetch(), placementsQ.refetch(), logQ.refetch()]);
  }, [logQ, placementsQ, recsQ, statusQ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tab === "settings") await settingsQ.refetch();
      else if (tab === "how") return;
      else await refetchWorking();
    } finally {
      setRefreshing(false);
    }
  }, [refetchWorking, settingsQ, tab]);

  const runEngineNow = useCallback(async () => {
    if (!guardWrite()) return;
    setRunning(true);
    try {
      await runBidEngine();
      await invalidateAds();
      await refetchWorking();
    } catch (error) {
      alertMutationError(error, "Couldn't run Bid Bot.");
    } finally {
      setRunning(false);
    }
  }, [guardWrite, invalidateAds, refetchWorking]);

  const onRun = useCallback(() => {
    if (!guardWrite()) return;
    if (needsRunAutoConfirm(confirmedMode)) {
      Alert.alert(runEngineConfirmTitle(), runEngineConfirmMessage(confirmedMode), [
        { text: "Cancel", style: "cancel" },
        { text: "Run", style: "destructive", onPress: () => void runEngineNow() },
      ]);
      return;
    }
    void runEngineNow();
  }, [confirmedMode, guardWrite, runEngineNow]);

  const applyBidsNow = useCallback(async () => {
    if (!guardWrite()) return;
    if (selectedRecs.length === 0) return;
    setApplyingBids(true);
    try {
      const result = await applyBidRecommendations(selectedRecs);
      assertBidApplicationSucceeded(result);
      setSelectedRecIds([]);
      await invalidateAds();
      await refetchWorking();
    } catch (error) {
      reportMutationError(error, "Couldn't apply recommendations.");
    } finally {
      setApplyingBids(false);
    }
  }, [guardWrite, invalidateAds, refetchWorking, selectedRecs]);

  const onApplyBids = useCallback(() => {
    if (!guardWrite()) return;
    if (selectedRecs.length === 0) return;
    Alert.alert(applyBidConfirmTitle(selectedRecs.length), applyBidConfirmMessage(selectedRecs), [
      { text: "Cancel", style: "cancel" },
      { text: "Apply", style: "destructive", onPress: () => void applyBidsNow() },
    ]);
  }, [applyBidsNow, guardWrite, selectedRecs]);

  const applyPlacementsNow = useCallback(async () => {
    if (!guardWrite()) return;
    if (selectedPlacements.length === 0) return;
    setApplyingPlacements(true);
    try {
      const result = await applyPlacementRecommendations(selectedPlacements);
      assertBidApplicationSucceeded(result);
      setSelectedPlacementKeys([]);
      await invalidateAds();
      await refetchWorking();
    } catch (error) {
      reportMutationError(error, "Couldn't apply placement recommendations.");
    } finally {
      setApplyingPlacements(false);
    }
  }, [guardWrite, invalidateAds, refetchWorking, selectedPlacements]);

  const onApplyPlacements = useCallback(() => {
    if (!guardWrite()) return;
    if (selectedPlacements.length === 0) return;
    Alert.alert(
      applyPlacementConfirmTitle(selectedPlacements.length),
      applyPlacementConfirmMessage(
        selectedPlacements.map((row) => ({
          campaignName: row.campaignName,
          campaignId: row.campaignId,
          currentText: formatPlacements(row.currentPlacements),
          recommendedText: formatPlacements(row.recommendedPlacements),
        })),
      ),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Apply", style: "destructive", onPress: () => void applyPlacementsNow() },
      ],
    );
  }, [applyPlacementsNow, guardWrite, selectedPlacements]);

  const onRevert = useCallback(
    (entry: BidEngineApplyLogEntry) => {
      if (!guardWrite()) return;
      Alert.alert("Revert this change?", revertConfirmMessage(entry.entityType), [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setRevertingId(entry.id);
              try {
                const result = await revertBidApplyLog(entry.id);
                assertRevertSucceeded(result);
                await invalidateAds();
                await refetchWorking();
              } catch (error) {
                reportMutationError(error, "Couldn't revert that bid change.");
              } finally {
                setRevertingId(null);
              }
            })();
          },
        },
      ]);
    },
    [guardWrite, invalidateAds, refetchWorking],
  );

  const restoreConfirmedSettings = useCallback(() => {
    const s = settingsQ.data;
    setAutoMode(asAutoMode(s?.autoMode));
    if (s?.targetAcos != null && Number.isFinite(s.targetAcos)) setTargetAcos(String(s.targetAcos));
  }, [settingsQ.data]);

  const onSaveSettings = useCallback(async () => {
    if (!guardWrite()) return;
    const acos = Number(String(targetAcos).replace(",", "."));
    if (!Number.isFinite(acos) || acos <= 0 || acos > 900) {
      Alert.alert("Check target ACoS", "Enter a target ACoS between 1 and 900.");
      return;
    }
    setSaving(true);
    try {
      await updateBidEngineSettings(persistableBidBotSettings({ targetAcos: acos, autoMode }));
      setSettingsReady(true);
      await invalidateAds();
      await Promise.all([settingsQ.refetch(), statusQ.refetch()]);
    } catch (error) {
      restoreConfirmedSettings();
      alertMutationError(error, "Couldn't save Bid Bot settings.");
    } finally {
      setSaving(false);
    }
  }, [autoMode, guardWrite, invalidateAds, restoreConfirmedSettings, settingsQ, statusQ, targetAcos]);

  const onSelectAutoMode = useCallback(
    (next: BidBotAutoMode) => {
      if (!canMutate) {
        if (viewingCustomer) Alert.alert("Viewing a customer", BIDBOT_VIEWING_CUSTOMER_MESSAGE);
        return;
      }
      if (next === "aggressive" && autoMode !== "aggressive") {
        Alert.alert(AGGRESSIVE_CONFIRM_TITLE, AGGRESSIVE_CONFIRM_MESSAGE, [
          { text: "Keep current mode", style: "cancel" },
          { text: "Use Aggressive", style: "destructive", onPress: () => setAutoMode("aggressive") },
        ]);
        return;
      }
      setAutoMode(next);
    },
    [autoMode, canMutate, viewingCustomer],
  );

  const toggleRec = useCallback((id: string) => {
    setSelectedRecIds((prev) => (prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]));
  }, []);

  const togglePlacement = useCallback((key: string) => {
    setSelectedPlacementKeys((prev) => (prev.includes(key) ? prev.filter((row) => row !== key) : [...prev, key]));
  }, []);

  const proposedA11y = selectedRecs.length === 1 ? formatBidAmount(selectedRecs[0]?.recommendedBid) : undefined;

  return (
    <SubScreen title="Bid bot">
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <IOSSegmentedControl
          value={tab}
          onChange={setTab}
          options={TABS.map((item) => ({ key: item.key, label: item.label, testID: item.testID }))}
        />
      </View>

      {tab === "working" ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.colors.tone_primary} />}
        >
          {viewingCustomer ? (
            <View
              testID="bid-bot-viewing-customer"
              accessibilityRole="text"
              accessibilityLabel={VIEWING_CUSTOMER_BANNER}
              style={[styles.banner, { backgroundColor: t.colors.tone_warning + "12", borderColor: t.colors.tone_warning + "30" }]}
            >
              <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary }]}>{VIEWING_CUSTOMER_BANNER}</Text>
            </View>
          ) : null}

          <View
            testID="bid-bot-status"
            accessibilityRole="header"
            accessibilityLabel={`${autoModeLabel(confirmedMode)}. ${autoModeDescription(confirmedMode)} Last run ${relativeTime(status?.lastRunAt)}`}
            style={[styles.statusCard, { backgroundColor: t.colors.background_secondary }]}
          >
            {statusQ.isLoading && !status ? (
              <ActivityIndicator color={t.colors.tone_primary} accessibilityLabel="Loading BidBot status" />
            ) : statusQ.isError && !status ? (
              <Text style={[t.typography.footnote, { color: t.colors.tone_danger }]}>Couldn't load BidBot status.</Text>
            ) : (
              <>
                <View style={{ gap: 8 }}>
                  <Pill label={autoModeLabel(confirmedMode)} tone={autoModeTone(confirmedMode)} />
                  <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary }]}>
                    Last run {relativeTime(status?.lastRunAt)}
                    {status?.targetAcos != null ? ` · Target ACoS ${formatPercent(status.targetAcos, 0)}` : ""}
                  </Text>
                </View>
                <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginTop: 6 }]}>
                  {autoModeDescription(confirmedMode)}
                </Text>
              </>
            )}
          </View>

          <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginBottom: 10 }]}>
            {BIDBOT_SCOPE_HELPER}
          </Text>

          <PrimaryButton
            label="Run engine"
            icon="play-outline"
            testID="bid-bot-run"
            onPress={onRun}
            loading={running}
            disabled={!canMutate || running}
            accessibilityLabel={runEngineA11yLabel(confirmedMode)}
            accessibilityHint={runEngineConfirmMessage(confirmedMode)}
            full
          />
          {!canMutate && !viewingCustomer ? (
            <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, textAlign: "center", marginTop: 8 }]}>
              Sign in to run BidBot.
            </Text>
          ) : null}

          <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 20, marginBottom: 8 }]}>
            Bid changes
          </Text>
          <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginBottom: 10 }]}>
            {CURRENCY_GAP_CAPTION}
          </Text>
          {recsQ.isError && recs.length === 0 ? (
            <RetryState
              title="Couldn't load bid recommendations"
              subtitle="Retry does not apply bids."
              onRetry={() => void recsQ.refetch()}
              retrying={recsQ.isFetching}
            />
          ) : recsQ.isLoading && recs.length === 0 ? (
            <ActivityIndicator color={t.colors.tone_primary} style={{ marginVertical: 20 }} accessibilityLabel="Loading bid recommendations" />
          ) : recs.length === 0 ? (
            <SectionCard testID="bid-bot-empty-recs">
              <EmptyState icon="pricetag-outline" title={emptyBidRecsTitle(hasRun)} subtitle={emptyBidRecsSubtitle(hasRun)} />
            </SectionCard>
          ) : (
            <View style={{ gap: 10, marginBottom: 16 }}>
              {recs.map((row) => (
                <BidRecRow
                  key={row.id || `${row.keywordId}-${row.campaignId}`}
                  row={row}
                  selected={!!row.id && selectedRecIds.includes(row.id)}
                  t={t}
                  onToggle={toggleRec}
                />
              ))}
              <PrimaryButton
                label={applyBidsButtonLabel(selectedRecs.length)}
                testID="bid-bot-apply"
                onPress={onApplyBids}
                loading={applyingBids}
                disabled={!canMutate || selectedRecs.length === 0 || applyingBids}
                accessibilityLabel={applyBidsA11yLabel(selectedRecs.length, proposedA11y)}
                accessibilityHint="Confirms, then writes the recommended bid to Amazon Ads."
                full
              />
            </View>
          )}

          <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 8, marginBottom: 8 }]}>
            Placements
          </Text>
          {placementsQ.isError && placements.length === 0 ? (
            <RetryState
              title="Couldn't load placement recommendations"
              subtitle="Retry does not apply placements."
              onRetry={() => void placementsQ.refetch()}
              retrying={placementsQ.isFetching}
            />
          ) : placementsQ.isLoading && placements.length === 0 ? (
            <ActivityIndicator color={t.colors.tone_primary} style={{ marginVertical: 20 }} accessibilityLabel="Loading placement recommendations" />
          ) : placements.length === 0 ? (
            <SectionCard testID="bid-bot-empty-placements">
              <EmptyState icon="layers-outline" title="No placement recommendations" subtitle="Run the engine to evaluate placement adjustments." />
            </SectionCard>
          ) : (
            <View style={{ gap: 10, marginBottom: 16 }}>
              {placements.map((row, index) => {
                const key = placementKey(row, index);
                return (
                  <PlacementRow
                    key={key}
                    row={row}
                    rowKey={key}
                    selected={selectedPlacementKeys.includes(key)}
                    t={t}
                    onToggle={togglePlacement}
                  />
                );
              })}
              <PrimaryButton
                label={selectedPlacements.length > 1 ? `Apply ${selectedPlacements.length} placement changes` : "Apply placement change"}
                testID="bid-bot-apply-placements"
                onPress={onApplyPlacements}
                loading={applyingPlacements}
                disabled={!canMutate || selectedPlacements.length === 0 || applyingPlacements}
                accessibilityLabel={
                  selectedPlacements.length > 1
                    ? `Apply ${selectedPlacements.length} placement changes`
                    : "Apply recommended placement percentages"
                }
                accessibilityHint="Confirms, then writes placement percentages to Amazon Ads. Not a bid."
                full
              />
            </View>
          )}

          <Text style={[t.typography.headline, { color: t.colors.text_primary, marginTop: 8, marginBottom: 8 }]}>
            Activity
          </Text>
          {logQ.isError && activity.length === 0 ? (
            <RetryState
              title="Couldn't load BidBot activity"
              subtitle="Retry does not revert changes."
              onRetry={() => void logQ.refetch()}
              retrying={logQ.isFetching}
            />
          ) : logQ.isLoading && activity.length === 0 ? (
            <ActivityIndicator color={t.colors.tone_primary} style={{ marginVertical: 20 }} accessibilityLabel="Loading BidBot activity" />
          ) : activity.length === 0 ? (
            <SectionCard testID="bid-bot-empty-activity">
              <EmptyState icon="time-outline" title="No applied changes yet" subtitle="Applied bids and placements show up here." />
            </SectionCard>
          ) : (
            <View testID="bid-bot-activity" style={{ gap: 10 }}>
              {activity.map((entry) => (
                <View key={entry.id} style={[styles.rowCard, { backgroundColor: t.colors.background_secondary }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
                      {entry.keywordText || entry.entityType || "Applied change"}
                    </Text>
                    <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", marginTop: 4 }]}>
                      {formatBidAmount(entry.bidBefore)} → {formatBidAmount(entry.bidAfter)}
                    </Text>
                    <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginTop: 2 }]}>
                      {relativeTime(entry.appliedAt)}
                      {entry.applySource ? ` · ${entry.applySource.replace(/_/g, " ")}` : ""}
                      {entry.entityType ? ` · ${entry.entityType.replace(/_/g, " ")}` : ""}
                    </Text>
                  </View>
                  <SecondaryButton
                    label="Revert"
                    testID={`bid-bot-revert-${entry.id}`}
                    onPress={() => onRevert(entry)}
                    disabled={!canMutate || revertingId === entry.id}
                    accessibilityLabel="Revert this Amazon Ads change"
                    accessibilityHint={revertConfirmMessage(entry.entityType)}
                  />
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : null}

      {tab === "settings" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.colors.tone_primary} />}
          >
            {viewingCustomer ? (
              <View
                testID="bid-bot-viewing-customer-settings"
                accessibilityRole="text"
                accessibilityLabel={VIEWING_CUSTOMER_BANNER}
                style={[styles.banner, { backgroundColor: t.colors.tone_warning + "12", borderColor: t.colors.tone_warning + "30", marginBottom: 12 }]}
              >
                <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary }]}>{VIEWING_CUSTOMER_BANNER}</Text>
              </View>
            ) : null}
            <SectionCard title="Engine">
              <Field label="Target ACoS (%)" t={t}>
                <TextInput
                  testID="bid-bot-target-acos"
                  value={targetAcos}
                  onChangeText={setTargetAcos}
                  keyboardType="decimal-pad"
                  editable={canMutate}
                  accessibilityLabel="Target ACoS percent"
                  style={[styles.input, t.typography.body, { color: t.colors.text_primary, borderColor: t.colors.border }]}
                />
              </Field>
              <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginBottom: 10 }]}>
                {TARGET_ACOS_CAPTION}
              </Text>
              <View style={styles.readRow}>
                <Text style={[growType(t.typography.body), { color: t.colors.text_primary }]}>Account min bid</Text>
                <Text testID="bid-bot-min-bid" style={[growType(t.typography.body), { color: t.colors.text_secondary }]}>
                  {settingsReady && settingsQ.data?.minBid != null ? formatBidAmount(settingsQ.data.minBid) : "—"}
                </Text>
              </View>
              <View style={styles.readRow}>
                <Text style={[growType(t.typography.body), { color: t.colors.text_primary }]}>Account max bid</Text>
                <Text testID="bid-bot-max-bid" style={[growType(t.typography.body), { color: t.colors.text_secondary }]}>
                  {settingsReady && settingsQ.data?.maxBid != null ? formatBidAmount(settingsQ.data.maxBid) : "—"}
                </Text>
              </View>
              <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginTop: 4 }]}>
                {MIN_MAX_DISPLAY_CAPTION}
              </Text>
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 12, marginBottom: 8 }]}>
                Auto mode
              </Text>
              <IOSSegmentedControl
                value={autoMode}
                onChange={onSelectAutoMode}
                options={[
                  { key: "off", label: "Off", testID: "bid-bot-auto-off" },
                  { key: "high_confidence", label: "Careful", testID: "bid-bot-auto-high_confidence" },
                  { key: "aggressive", label: "Aggressive", testID: "bid-bot-auto-aggressive" },
                ]}
              />
              <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginTop: 8 }]}>
                {autoModeDescription(autoMode)} Turning Off stops future automatic apply. It does not revert bids already written.
              </Text>
            </SectionCard>
            <PrimaryButton
              label="Save"
              testID="bid-bot-save"
              onPress={() => void onSaveSettings()}
              loading={saving}
              disabled={!canMutate || saving}
              accessibilityLabel="Save BidBot settings"
              accessibilityHint="Saves target ACoS and auto mode only."
              full
            />
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      {tab === "how" ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <SectionCard>
            <Text style={[growType(t.typography.body), { color: t.colors.text_primary }]}>{ABOUT_BIDBOT_COPY}</Text>
          </SectionCard>
        </ScrollView>
      ) : null}
    </SubScreen>
  );
}

const BidRecRow = React.memo(function BidRecRow({
  row,
  selected,
  t,
  onToggle,
}: {
  row: BidRecommendation;
  selected: boolean;
  t: Theme;
  onToggle: (id: string) => void;
}) {
  const title = recommendationTitle(row);
  const campaign = recommendationContext(row);
  const analyzed = formatBidAmount(row.currentBid);
  const proposed = formatBidAmount(row.recommendedBid);
  const delta = bidDeltaLabel(row.currentBid, row.recommendedBid);
  const expired = isExpiredRecommendation(row.status);
  return (
    <TouchableOpacity
      testID={row.id ? `bid-bot-rec-${row.id}` : undefined}
      activeOpacity={expired ? 1 : 0.75}
      onPress={() => !expired && row.id && onToggle(row.id)}
      disabled={expired}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: expired }}
      accessibilityLabel={[
        recRowAccessibilityLabel({ title, campaign, analyzed, proposed, delta }),
        expired ? "Expired. Not actionable now" : undefined,
      ]
        .filter(Boolean)
        .join(". ")}
      style={[styles.rowCard, { backgroundColor: t.colors.background_secondary, minHeight: 44, opacity: expired ? 0.6 : 1 }]}
    >
      <View accessible={false} importantForAccessibility="no">
        <SFSymbol
          testID={row.id ? `bid-bot-rec-check-${row.id}` : undefined}
          name={selected ? "checkmark.square.fill" : "square"}
          size={22}
          color={selected ? t.colors.tone_primary : t.colors.text_tertiary}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{title}</Text>
        {campaign ? (
          <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginTop: 2 }]}>{campaign}</Text>
        ) : null}
        <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", marginTop: 6 }]}>
          {analyzed} → {proposed}
        </Text>
        <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary, marginTop: 2 }]}>
          {SNAPSHOT_BID_LABEL} {analyzed}
          {delta ? ` · ${delta}` : ""}
          {` · Set to ${proposed}`}
        </Text>
        {row.reason ? (
          <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginTop: 4 }]}>{row.reason}</Text>
        ) : null}
        {expired ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Pill label="Expired" tone="inactive" />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

const PlacementRow = React.memo(function PlacementRow({
  row,
  rowKey,
  selected,
  t,
  onToggle,
}: {
  row: PlacementRecommendation;
  rowKey: string;
  selected: boolean;
  t: Theme;
  onToggle: (key: string) => void;
}) {
  const current = formatPlacements(row.currentPlacements);
  const recommended = formatPlacements(row.recommendedPlacements);
  const identity = placementIdentity(row.recommendedPlacements) || placementIdentity(row.currentPlacements);
  const campaign = row.campaignName?.trim() || row.campaignId || undefined;
  const confidence = confidenceCategoryLabel(row.confidence);
  const locked = !!row.inCooldown;
  return (
    <TouchableOpacity
      testID={`bid-bot-placement-${rowKey}`}
      activeOpacity={locked ? 1 : 0.75}
      onPress={() => !locked && onToggle(rowKey)}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: locked }}
      accessibilityLabel={[
        identity,
        "Placement recommendation",
        campaign,
        `${current} to ${recommended}`,
        confidence ? `${confidence} confidence` : undefined,
        locked ? "Cooldown. Not actionable now" : undefined,
      ]
        .filter(Boolean)
        .join(". ")}
      style={[styles.rowCard, { backgroundColor: t.colors.background_secondary, minHeight: 44, opacity: locked ? 0.6 : 1 }]}
    >
      <View accessible={false} importantForAccessibility="no">
        <SFSymbol
          name={selected ? "checkmark.square.fill" : "square"}
          size={22}
          color={selected ? t.colors.tone_primary : t.colors.text_tertiary}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{identity}</Text>
        {campaign ? (
          <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginTop: 2 }]}>{campaign}</Text>
        ) : null}
        <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600", marginTop: 6 }]}>
          {current} → {recommended}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {locked ? <Pill label="Cooldown" tone="inactive" /> : null}
          {confidence ? <Pill label={confidence} tone="primary" /> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

function Field({ label, children, t }: { label: string; children: React.ReactNode; t: Theme }) {
  return (
    <View style={styles.field}>
      <Text style={[growType(t.typography.body), { color: t.colors.text_primary }]}>{label}</Text>
      <View style={styles.fieldInput}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 120,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  statusCard: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 10,
    padding: 14,
    minHeight: 56,
  },
  field: {
    gap: 8,
    paddingVertical: 8,
  },
  fieldInput: {
    minWidth: 120,
    alignSelf: "stretch",
  },
  readRow: {
    gap: 4,
    minHeight: 44,
    paddingVertical: 8,
  },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    textAlign: "right",
  },
});
