import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Linking, type TextStyle } from "react-native";
import Slider from "@react-native-community/slider";
import { type Href, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { sendTestNotification } from "@/src/lib/notifications";
import { anyNotificationPrefEnabled } from "@/src/lib/notificationContract";
import { loadScopedKdpFreshness } from "@/src/lib/kdpIngestMonitor";
import { formatIngestAge, kdpIngestStatusLabel } from "@/src/lib/kdpIngestFreshness";
import {
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
import {
  SettingsNavigationRow,
  SettingsNote,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsToggleRow,
} from "@/src/components/settings/SettingsPrimitives";

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
    <SettingsScreen title="Notifications">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {guestMode ? <SettingsNote testID="notifications-guest">{GUEST_SETTINGS_NOTE}</SettingsNote> : null}
        {viewingCustomer ? (
          <SettingsNote testID="notifications-viewing-customer">{VIEWING_CUSTOMER_SETTINGS_NOTE}</SettingsNote>
        ) : null}

        <SettingsSection
          testID="notification-settings-card"
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
            <SettingsNavigationRow
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
          <SettingsToggleRow
            label={DAILY_DIGEST_LABEL}
            value={notifications.dailyDigest}
            disabled={alertsLocked}
            onChange={(v) => setNotifications({ ...notifications, dailyDigest: v })}
            testID="notif-daily-digest"
            accessibilityLabel={notificationSwitchAccessibilityLabel(
              DAILY_DIGEST_LABEL,
              notifications.dailyDigest,
            )}
          />
          <SettingsToggleRow
            label="Include KDP net"
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
          <SettingsToggleRow
            label="New orders"
            value={notifications.newOrder}
            disabled={alertsLocked}
            onChange={(v) => setNotifications({ ...notifications, newOrder: v })}
            testID="notif-new-order"
            accessibilityLabel={notificationSwitchAccessibilityLabel("New orders", notifications.newOrder)}
          />
          <SettingsToggleRow
            label="Book needs attention"
            value={notifications.bookAttention}
            disabled={alertsLocked}
            onChange={(v) => setNotifications({ ...notifications, bookAttention: v })}
            testID="notif-book-attention"
            accessibilityLabel={notificationSwitchAccessibilityLabel("Book needs attention", notifications.bookAttention)}
          />
          <SettingsToggleRow
            label="Campaign overspending"
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
                {spendThresholdLabel(notifications.spendThreshold)} · {notifications.spendThreshold}%
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
          <SettingsToggleRow
            label={KDP_STALE_LABEL}
            value={notifications.kdpDataStale}
            disabled={alertsLocked}
            onChange={(v) => setNotifications({ ...notifications, kdpDataStale: v })}
            testID="notif-kdp-data-stale"
            accessibilityLabel={notificationSwitchAccessibilityLabel(KDP_STALE_LABEL, notifications.kdpDataStale)}
            accessibilityHint={KDP_STALE_FOOTER}
          />
          <SettingsRow
            testID="notif-send-test"
            label={testNotificationLabel(testRowStatus)}
            symbol={
              testStatus === "sent" || testStatus === "server"
                ? "checkmark.circle.fill"
                : testStatus === "blocked" || permissionDenied
                  ? "exclamationmark.triangle.fill"
                  : "bell"
            }
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
        </SettingsSection>

        {!guestMode && !viewingCustomer ? (
          <SettingsSection title={KDP_INGEST_SECTION_TITLE} footer={ingestFooter || KDP_STALE_FOOTER}>
            {ingestRows.map((row, index) => (
              <SettingsNavigationRow
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
          </SettingsSection>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}
