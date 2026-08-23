import React, { useState } from "react";
import { View, Text, ScrollView, Linking, type TextStyle } from "react-native";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { sendTestNotification } from "@/src/lib/notifications";
import {
  ADS_SECTION_FOOTER,
  APPEARANCE_LABEL,
  APPEARANCE_VALUE,
  BID_BOT_ROW_LABEL,
  BID_BOT_ROW_SUBTITLE,
  GUEST_SETTINGS_NOTE,
  IPHONE_ALERTS_LABEL,
  IPHONE_ALERTS_OFF,
  IPHONE_ALERTS_SUBTITLE,
  KDP_PROFIT_LABEL,
  KDP_PROFIT_VALUE,
  KDP_SECTION_FOOTER,
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

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { guestMode, user } = useAuth();
  const { notifications, setNotifications, notificationRuntime, adminFilterUserId } = useApp();
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "blocked">("idle");

  const viewingCustomer = !!adminFilterUserId;
  const alertsLocked = guestMode;
  const anyAlertOn = notifications.newOrder || notifications.bookAttention || notifications.campaignSpend;
  const permissionDenied = notificationRuntime.permission === "denied";
  const testRowStatus = guestMode ? "guest" : testStatus;

  const handleTestNotification = async () => {
    if (guestMode) return;
    if (testStatus === "blocked" || permissionDenied) {
      void Linking.openSettings();
      return;
    }
    setTestStatus("sending");
    const ok = await sendTestNotification(user?.id);
    setTestStatus(ok ? "sent" : "blocked");
    setTimeout(() => setTestStatus("idle"), 4000);
  };

  return (
    <SubScreen title="Settings">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {guestMode ? (
          <Text
            testID="settings-guest"
            style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginHorizontal: 32, marginTop: 16 }]}
          >
            {GUEST_SETTINGS_NOTE}
          </Text>
        ) : null}
        {viewingCustomer ? (
          <Text
            testID="settings-viewing-customer"
            style={[growType(t.typography.footnote), { color: t.colors.text_secondary, marginHorizontal: 32, marginTop: guestMode ? 8 : 16 }]}
          >
            {VIEWING_CUSTOMER_SETTINGS_NOTE}
          </Text>
        ) : null}

        <View testID="notification-settings-card">
          <IOSGroupedSection
            title="Notifications"
            footer={notificationFooter({
              guestMode,
              permission: notificationRuntime.permission,
              backgroundRegistered: notificationRuntime.backgroundRegistered,
              anyEnabled: anyAlertOn,
            })}
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
                <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary }]}>
                  {SPEND_THRESHOLD_CAPTION}
                </Text>
              </View>
            ) : null}
            <IOSSettingsRow
              testID="notif-send-test"
              label={testNotificationLabel(testRowStatus)}
              symbol={testStatus === "sent" ? "checkmark.circle.fill" : testStatus === "blocked" || permissionDenied ? "exclamationmark.triangle.fill" : "bell"}
              symbolColor={
                testStatus === "sent"
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

        <IOSGroupedSection title="Ads" footer={ADS_SECTION_FOOTER}>
          <IOSSettingsRow
            testID="settings-open-bid-bot"
            label={BID_BOT_ROW_LABEL}
            subtitle={BID_BOT_ROW_SUBTITLE}
            symbol="cpu"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/bid-bot")}
            accessibilityLabel={`${BID_BOT_ROW_LABEL}. ${BID_BOT_ROW_SUBTITLE}`}
          />
        </IOSGroupedSection>

        <IOSGroupedSection title="Profit data" footer={KDP_SECTION_FOOTER}>
          <IOSSettingsRow
            testID="settings-kdp-source"
            label={KDP_PROFIT_LABEL}
            value={KDP_PROFIT_VALUE}
            symbol="book"
            symbolColor={t.colors.tone_primary}
            last
            accessibilityLabel={`${KDP_PROFIT_LABEL}. ${KDP_PROFIT_VALUE}`}
          />
        </IOSGroupedSection>

        <IOSGroupedSection title="App">
          <IOSSettingsRow
            testID="settings-appearance"
            label={APPEARANCE_LABEL}
            value={APPEARANCE_VALUE}
            symbol="circle.lefthalf.filled"
            symbolColor={t.colors.text_secondary}
            last
            accessibilityLabel={`${APPEARANCE_LABEL}. ${APPEARANCE_VALUE}`}
          />
        </IOSGroupedSection>
      </ScrollView>
    </SubScreen>
  );
}
