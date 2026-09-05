import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Linking, type TextStyle } from "react-native";
import Slider from "@react-native-community/slider";
import { type Href, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { sendTestNotification } from "@/src/lib/notifications";
import { anyNotificationPrefEnabled } from "@/src/lib/notificationContract";
import { loadScopedKdpFreshness } from "@/src/lib/kdpIngestMonitor";
import { formatIngestAge, kdpIngestStatusLabel } from "@/src/lib/kdpIngestFreshness";
import {
  DAILY_DIGEST_FOOTER,
  DAILY_DIGEST_LABEL,
  GUEST_SETTINGS_NOTE,
  IPHONE_ALERTS_LABEL,
  IPHONE_ALERTS_OFF,
  IPHONE_ALERTS_SUBTITLE,
  KDP_INGEST_EMPTY,
  KDP_INGEST_SECTION_TITLE,
  KDP_INGEST_UNAVAILABLE,
  KDP_STALE_FOOTER,
  KDP_STALE_LABEL,
  SPEND_THRESHOLD_CAPTION,
  TEST_NOTIFICATION_HINT,
  VIEWING_CUSTOMER_SETTINGS_NOTE,
  notificationFooter,
  notificationSwitchAccessibilityLabel,
  spendThresholdAccessibilityLabel,
  spendThresholdLabel,
  testNotificationLabel,
} from "@/src/lib/settingsContract";
import { IOSGroupedSection, IOSSettingsRow, IOSSwitchRow } from "@/src/components/ios/Native";

function growType(style: TextStyle): TextStyle {
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
  };
}

export default function NotificationsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { guestMode, user } = useAuth();
  const { notifications, setNotifications, notificationRuntime, adminFilterUserId, selectedProfileIds } = useApp();
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "server" | "blocked">("idle");

  const viewingCustomer = !!adminFilterUserId;
  const alertsLocked = guestMode;
  const anyAlertOn = anyNotificationPrefEnabled(notifications);
  const permissionDenied = notificationRuntime.permission === "denied";
  const testRowStatus = guestMode ? "guest" : testStatus;
  const nowMs = Date.now();

  const ingestQ = useQuery({
    queryKey: ["kdp-ingest-freshness", selectedProfileIds],
    queryFn: () => loadScopedKdpFreshness(selectedProfileIds),
    enabled: !guestMode && !viewingCustomer && selectedProfileIds.length > 0,
    staleTime: 60_000,
  });

  const ingestRows = ingestQ.data ?? [];
  const ingestFooter = useMemo(() => {
    if (guestMode || viewingCustomer) return undefined;
    if (ingestQ.isError) return KDP_INGEST_UNAVAILABLE;
    if (ingestQ.isSuccess && ingestRows.length === 0) return KDP_INGEST_EMPTY;
    return undefined;
  }, [guestMode, viewingCustomer, ingestQ.isError, ingestQ.isSuccess, ingestRows.length]);

  const handleTestNotification = async () => {
    if (guestMode) return;
    if (testStatus === "blocked" || permissionDenied) {
      void Linking.openSettings();
      return;
    }
    setTestStatus("sending");
    const result = await sendTestNotification(user?.id);
    setTestStatus(result === "server" ? "server" : result === "local" ? "sent" : "blocked");
    setTimeout(() => setTestStatus("idle"), 4000);
  };

  return (
    <SubScreen title="Notifications">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {guestMode ? (
          <Text
            testID="notifications-guest"
            style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginHorizontal: 32, marginTop: 16 }]}
          >
            {GUEST_SETTINGS_NOTE}
          </Text>
        ) : null}
        {viewingCustomer ? (
          <Text
            testID="notifications-viewing-customer"
            style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginHorizontal: 32, marginTop: guestMode ? 8 : 16 }]}
          >
            {VIEWING_CUSTOMER_SETTINGS_NOTE}
          </Text>
        ) : null}

        <View testID="notification-settings-card">
          <IOSGroupedSection
            title="Alerts"
            footer={
              notificationFooter({
                guestMode,
                permission: notificationRuntime.permission,
                backgroundRegistered: notificationRuntime.backgroundRegistered,
                anyEnabled: anyAlertOn,
              }) || undefined
            }
          >
            {permissionDenied && !guestMode ? (
              <IOSSettingsRow
                testID="settings-open-ios-notifications"
                label={IPHONE_ALERTS_LABEL}
                value={IPHONE_ALERTS_OFF}
                subtitle={IPHONE_ALERTS_SUBTITLE}
                symbol="bell.slash"
                symbolColor={t.colors.tone_danger}
                onPress={() => void Linking.openSettings()}
                accessibilityLabel={`${IPHONE_ALERTS_LABEL}. ${IPHONE_ALERTS_OFF}. ${IPHONE_ALERTS_SUBTITLE}`}
              />
            ) : null}
            <IOSSwitchRow
              label="Daily performance updates"
              symbol="chart.bar"
              symbolColor={t.colors.tone_primary}
              value={notifications.dailyDigest}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, dailyDigest: v })}
              testID="notif-daily-digest"
              accessibilityLabel={notificationSwitchAccessibilityLabel(
                DAILY_DIGEST_LABEL,
                notifications.dailyDigest,
              )}
              accessibilityHint={DAILY_DIGEST_FOOTER}
            />
            <IOSSwitchRow
              label="Include KDP net in alerts"
              symbol="dollarsign.circle"
              symbolColor={t.colors.tone_good}
              value={notifications.includeKdpNet}
              disabled={
                alertsLocked ||
                (!notifications.dailyDigest &&
                  !notifications.newOrder &&
                  !notifications.bookAttention &&
                  !notifications.campaignSpend)
              }
              onChange={(v) => setNotifications({ ...notifications, includeKdpNet: v })}
              testID="notif-include-kdp-net"
              accessibilityLabel={notificationSwitchAccessibilityLabel("Include KDP net in alerts", notifications.includeKdpNet)}
            />
            <IOSSwitchRow
              label="New orders"
              symbol="cart"
              symbolColor={t.colors.tone_good}
              value={notifications.newOrder}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, newOrder: v })}
              testID="notif-new-order"
              accessibilityLabel={notificationSwitchAccessibilityLabel("New orders", notifications.newOrder)}
            />
            <IOSSwitchRow
              label="Book needs attention"
              symbol="book"
              symbolColor={t.colors.tone_warning}
              value={notifications.bookAttention}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, bookAttention: v })}
              testID="notif-book-attention"
              accessibilityLabel={notificationSwitchAccessibilityLabel("Book needs attention", notifications.bookAttention)}
            />
            <IOSSwitchRow
              label="Campaign overspending"
              symbol="chart.line.uptrend.xyaxis"
              symbolColor={t.colors.tone_danger}
              value={notifications.campaignSpend}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, campaignSpend: v })}
              testID="notif-campaign-spend"
              accessibilityLabel={notificationSwitchAccessibilityLabel("Campaign overspending", notifications.campaignSpend)}
            />
            {notifications.campaignSpend ? (
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={spendThresholdAccessibilityLabel(notifications.spendThreshold)}
                accessibilityValue={{ text: `${notifications.spendThreshold} percent` }}
                style={{ paddingHorizontal: 16, paddingBottom: 12 }}
              >
                <Text style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginTop: 8 }]}>
                  {spendThresholdLabel(notifications.spendThreshold)}
                </Text>
                <Slider
                  testID="notif-spend-threshold-slider"
                  minimumValue={5}
                  maximumValue={100}
                  step={5}
                  value={notifications.spendThreshold}
                  disabled={alertsLocked}
                  onValueChange={(v) => setNotifications({ ...notifications, spendThreshold: v })}
                  minimumTrackTintColor={t.colors.tone_danger}
                  maximumTrackTintColor={t.colors.background_tertiary}
                />
                {SPEND_THRESHOLD_CAPTION ? (
                  <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary }]}>
                    {SPEND_THRESHOLD_CAPTION}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <IOSSwitchRow
              label={KDP_STALE_LABEL}
              symbol="exclamationmark.icloud"
              symbolColor={t.colors.tone_warning}
              value={notifications.kdpDataStale}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, kdpDataStale: v })}
              testID="notif-kdp-data-stale"
              accessibilityLabel={notificationSwitchAccessibilityLabel(KDP_STALE_LABEL, notifications.kdpDataStale)}
              accessibilityHint={KDP_STALE_FOOTER}
            />
            <IOSSettingsRow
              testID="notif-send-test"
              label={testNotificationLabel(testRowStatus)}
              symbol={testStatus === "sent" || testStatus === "server" ? "checkmark.circle.fill" : testStatus === "blocked" || permissionDenied ? "exclamationmark.triangle.fill" : "bell"}
              symbolColor={
                testStatus === "sent" || testStatus === "server"
                  ? t.colors.tone_good
                  : testStatus === "blocked" || permissionDenied
                    ? t.colors.tone_danger
                    : t.colors.tone_primary
              }
              last
              accessibilityLabel={testNotificationLabel(testRowStatus)}
              accessibilityHint={guestMode ? undefined : TEST_NOTIFICATION_HINT}
              onPress={
                guestMode || testStatus === "sending"
                  ? undefined
                  : handleTestNotification
              }
            />
          </IOSGroupedSection>
        </View>

        {!guestMode && !viewingCustomer ? (
          <IOSGroupedSection title={KDP_INGEST_SECTION_TITLE} footer={ingestFooter || KDP_STALE_FOOTER}>
            {ingestRows.map((row, index) => (
              <IOSSettingsRow
                key={row.accountId}
                testID={`kdp-ingest-${row.accountId}`}
                label={row.name}
                subtitle={kdpIngestStatusLabel(row, nowMs)}
                value={formatIngestAge(row.lastIngestAtMs, nowMs)}
                symbol={row.stale ? "exclamationmark.icloud" : "checkmark.icloud"}
                symbolColor={row.stale ? t.colors.tone_warning : t.colors.tone_good}
                last={index === ingestRows.length - 1}
                onPress={() => router.push("/more/kdp-source" as Href)}
                accessibilityLabel={`${row.name}. ${kdpIngestStatusLabel(row, nowMs)}. ${formatIngestAge(row.lastIngestAtMs, nowMs)}`}
              />
            ))}
          </IOSGroupedSection>
        ) : null}
      </ScrollView>
    </SubScreen>
  );
}
