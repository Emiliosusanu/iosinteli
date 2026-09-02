import React, { useState } from "react";
import { View, Text, ScrollView, Linking, Alert, type TextStyle } from "react-native";
import Slider from "@react-native-community/slider";
import { type Href, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { sendTestNotification } from "@/src/lib/notifications";
import {
  ACCOUNT_BILLING_FOOTER,
  ACCOUNT_BILLING_URL,
  ACCOUNT_STATUS_UNAVAILABLE,
  accountPlanPresentation,
} from "@/src/lib/accountContract";
import {
  ACCOUNT_SECTION_TITLE,
  ADS_SECTION_FOOTER,
  APPEARANCE_LABEL,
  APPEARANCE_VALUE,
  BID_BOT_ROW_LABEL,
  BID_BOT_ROW_SUBTITLE,
  GUEST_SETTINGS_NOTE,
  IPHONE_ALERTS_LABEL,
  IPHONE_ALERTS_OFF,
  IPHONE_ALERTS_SUBTITLE,
  KDP_ACCOUNTS_ROW_LABEL,
  KDP_ACCOUNTS_ROW_SUBTITLE,
  KDP_HELPER_ROW_LABEL,
  KDP_HELPER_ROW_SUBTITLE,
  KDP_PROFIT_LABEL,
  KDP_SECTION_FOOTER,
  MANAGE_BILLING_ROW_LABEL,
  PLAN_ROW_LABEL,
  SPEND_THRESHOLD_CAPTION,
  SUBSCRIPTION_ROW_LABEL,
  TEST_NOTIFICATION_HINT,
  VIEWING_CUSTOMER_SETTINGS_NOTE,
  notificationFooter,
  notificationSwitchAccessibilityLabel,
  spendThresholdAccessibilityLabel,
  spendThresholdLabel,
  testNotificationLabel,
} from "@/src/lib/settingsContract";
import { IOSGroupedSection, IOSSettingsRow, IOSSwitchRow } from "@/src/components/ios/Native";
import { isIosHelperEnabled, kdpRoyaltySourceValueLabel } from "@/src/lib/kdp/source";

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
  const { notifications, setNotifications, notificationRuntime, adminFilterUserId, kdpRoyaltySource } = useApp();
  const kdpSourceValue = kdpRoyaltySourceValueLabel(kdpRoyaltySource);
  const helperOn = isIosHelperEnabled(kdpRoyaltySource);
  const plan = accountPlanPresentation({
    userMetadata: user?.user_metadata,
    appMetadata: user?.app_metadata,
  });
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "server" | "blocked">("idle");
  const [billingBusy, setBillingBusy] = useState(false);

  const viewingCustomer = !!adminFilterUserId;
  const alertsLocked = guestMode;
  const anyAlertOn =
    notifications.newOrder ||
    notifications.bookAttention ||
    notifications.campaignSpend ||
    notifications.dailyDigest;
  const permissionDenied = notificationRuntime.permission === "denied";
  const testRowStatus = guestMode ? "guest" : testStatus;
  const subscriptionFooter = plan.source
    ? `Plan is shown from account metadata only. ${ACCOUNT_BILLING_FOOTER}`
    : ACCOUNT_BILLING_FOOTER;

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

  const openBilling = async () => {
    if (guestMode || billingBusy) return;
    setBillingBusy(true);
    try {
      await WebBrowser.openBrowserAsync(ACCOUNT_BILLING_URL);
    } catch {
      Alert.alert("Couldn't open billing", "Open dashboard.inteliads.io/billing in your browser.");
    } finally {
      setBillingBusy(false);
    }
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
              label="Daily performance updates"
              symbol="chart.bar"
              symbolColor={t.colors.tone_primary}
              value={notifications.dailyDigest}
              disabled={alertsLocked}
              onChange={(v) => setNotifications({ ...notifications, dailyDigest: v })}
              testID="notif-daily-digest"
              accessibilityLabel={notificationSwitchAccessibilityLabel("Daily performance updates", notifications.dailyDigest)}
            />
            <IOSSwitchRow
              label="Include KDP net in alerts"
              symbol="dollarsign.circle"
              symbolColor={t.colors.tone_good}
              value={notifications.includeKdpNet}
              disabled={alertsLocked || !notifications.dailyDigest && !notifications.newOrder && !notifications.bookAttention && !notifications.campaignSpend}
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
                <Text style={[growType(t.typography.caption1), { color: t.colors.text_tertiary }]}>
                  {SPEND_THRESHOLD_CAPTION}
                </Text>
              </View>
            ) : null}
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

        {!guestMode ? (
          <IOSGroupedSection title={ACCOUNT_SECTION_TITLE} footer={subscriptionFooter}>
            <IOSSettingsRow
              testID="settings-plan"
              label={PLAN_ROW_LABEL}
              subtitle={plan.source ? "Account metadata only" : undefined}
              value={plan.label}
              symbol="person.crop.circle"
              symbolColor={t.colors.tone_primary}
              onPress={() => router.push("/more/account" as Href)}
              accessibilityLabel={`${PLAN_ROW_LABEL}. ${plan.label}`}
              accessibilityHint="Opens My Account."
            />
            <IOSSettingsRow
              testID="settings-subscription-status"
              label={SUBSCRIPTION_ROW_LABEL}
              value={ACCOUNT_STATUS_UNAVAILABLE}
              symbol="creditcard"
              symbolColor={t.colors.text_secondary}
              onPress={() => router.push("/more/account" as Href)}
              accessibilityLabel={`${SUBSCRIPTION_ROW_LABEL}. ${ACCOUNT_STATUS_UNAVAILABLE}`}
            />
            <IOSSettingsRow
              testID="settings-manage-billing"
              label={billingBusy ? "Opening billing…" : MANAGE_BILLING_ROW_LABEL}
              symbol="arrow.up.right.square"
              symbolColor={t.colors.tone_primary}
              last
              onPress={() => void openBilling()}
              accessibilityHint="Opens InteliAds billing in the browser."
            />
          </IOSGroupedSection>
        ) : null}

        <IOSGroupedSection title="Ads" footer={ADS_SECTION_FOOTER}>
          <IOSSettingsRow
            testID="settings-open-bid-bot"
            label={BID_BOT_ROW_LABEL}
            subtitle={BID_BOT_ROW_SUBTITLE}
            symbol="slider.horizontal.3"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/bid-bot")}
            accessibilityLabel={`${BID_BOT_ROW_LABEL}. ${BID_BOT_ROW_SUBTITLE}`}
          />
        </IOSGroupedSection>

        <IOSGroupedSection title="KDP data" footer={KDP_SECTION_FOOTER}>
          <IOSSettingsRow
            testID="settings-kdp-source"
            label={KDP_PROFIT_LABEL}
            value={kdpSourceValue}
            symbol="book"
            symbolColor={t.colors.tone_primary}
            onPress={() => router.push("/more/kdp-source" as Href)}
            accessibilityLabel={`${KDP_PROFIT_LABEL}. ${kdpSourceValue}`}
          />
          <IOSSettingsRow
            testID="settings-kdp-accounts"
            label={KDP_ACCOUNTS_ROW_LABEL}
            subtitle={KDP_ACCOUNTS_ROW_SUBTITLE}
            symbol="link"
            symbolColor={t.colors.tone_product}
            onPress={() => router.push("/more/accounts" as Href)}
            accessibilityLabel={`${KDP_ACCOUNTS_ROW_LABEL}. ${KDP_ACCOUNTS_ROW_SUBTITLE}`}
            accessibilityHint="Opens Amazon Accounts to link KDP."
          />
          <IOSSettingsRow
            testID="settings-kdp-helper"
            label={KDP_HELPER_ROW_LABEL}
            subtitle={KDP_HELPER_ROW_SUBTITLE}
            value={helperOn ? "On" : "Off"}
            symbol="iphone"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/kdp-helper" as Href)}
            accessibilityLabel={`${KDP_HELPER_ROW_LABEL}. ${helperOn ? "On" : "Off"}. ${KDP_HELPER_ROW_SUBTITLE}`}
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
