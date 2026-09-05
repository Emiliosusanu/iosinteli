import React, { useState } from "react";
import { View, Text, ScrollView, Linking, Alert, type TextStyle } from "react-native";
import { type Href, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import {
  ACCOUNT_BILLING_URL,
  accountSubscriptionPresentation,
} from "@/src/lib/accountContract";
import { useCurrentUserPlan } from "@/src/hooks/useCurrentUserPlan";
import { anyNotificationPrefEnabled } from "@/src/lib/notificationContract";
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
  NOTIFICATIONS_ROW_LABEL,
  PLAN_ROW_LABEL,
  SUBSCRIPTION_ROW_LABEL,
  VIEWING_CUSTOMER_SETTINGS_NOTE,
  notificationFooter,
} from "@/src/lib/settingsContract";
import { IOSGroupedSection, IOSSettingsRow } from "@/src/components/ios/Native";
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
  const { notifications, notificationRuntime, adminFilterUserId, kdpRoyaltySource } = useApp();
  const kdpSourceValue = kdpRoyaltySourceValueLabel(kdpRoyaltySource);
  const helperOn = isIosHelperEnabled(kdpRoyaltySource);
  const currentPlanQ = useCurrentUserPlan();
  const subscription = accountSubscriptionPresentation({
    nestPlan: currentPlanQ.nestPlan,
    nestStatus: currentPlanQ.nestStatus,
    userMetadata: user?.user_metadata,
    appMetadata: user?.app_metadata,
  });
  const [billingBusy, setBillingBusy] = useState(false);

  const viewingCustomer = !!adminFilterUserId;
  const anyAlertOn = anyNotificationPrefEnabled(notifications);
  const permissionDenied = notificationRuntime.permission === "denied";
  const subscriptionFooter = subscription.footer;

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
            <IOSSettingsRow
              testID="settings-notifications"
              label={NOTIFICATIONS_ROW_LABEL}
              subtitle={guestMode ? GUEST_SETTINGS_NOTE : anyAlertOn ? "Alerts on" : "Turn an alert on"}
              symbol="bell"
              symbolColor={t.colors.tone_primary}
              last
              onPress={() => router.push("/more/notifications" as Href)}
              accessibilityLabel={NOTIFICATIONS_ROW_LABEL}
              accessibilityHint="Opens notification alerts, including KDP ingest stalls."
            />
          </IOSGroupedSection>
        </View>

        {!guestMode ? (
          <IOSGroupedSection title={ACCOUNT_SECTION_TITLE} footer={subscriptionFooter}>
            <IOSSettingsRow
              testID="settings-plan"
              label={PLAN_ROW_LABEL}
              subtitle={subscription.planSubtitle}
              value={subscription.planLabel}
              symbol="person.crop.circle"
              symbolColor={t.colors.tone_primary}
              onPress={() => router.push("/more/account" as Href)}
              accessibilityLabel={`${PLAN_ROW_LABEL}. ${subscription.planLabel}`}
              accessibilityHint="Opens My Account."
            />
            <IOSSettingsRow
              testID="settings-subscription-status"
              label={SUBSCRIPTION_ROW_LABEL}
              value={subscription.statusLabel}
              symbol="creditcard"
              symbolColor={t.colors.text_secondary}
              onPress={() => router.push("/more/account" as Href)}
              accessibilityLabel={`${SUBSCRIPTION_ROW_LABEL}. ${subscription.statusLabel}`}
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

        <IOSGroupedSection title="Ads" footer={ADS_SECTION_FOOTER || undefined}>
          <IOSSettingsRow
            testID="settings-open-bid-bot"
            label={BID_BOT_ROW_LABEL}
            subtitle={BID_BOT_ROW_SUBTITLE || undefined}
            symbol="slider.horizontal.3"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/bid-bot")}
            accessibilityLabel={BID_BOT_ROW_LABEL}
          />
        </IOSGroupedSection>

        <IOSGroupedSection title="KDP data" footer={KDP_SECTION_FOOTER || undefined}>
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
            subtitle={KDP_ACCOUNTS_ROW_SUBTITLE || undefined}
            symbol="link"
            symbolColor={t.colors.tone_product}
            onPress={() => router.push("/more/accounts" as Href)}
            accessibilityLabel={KDP_ACCOUNTS_ROW_LABEL}
            accessibilityHint="Opens Amazon Accounts to link KDP."
          />
          <IOSSettingsRow
            testID="settings-kdp-helper"
            label={KDP_HELPER_ROW_LABEL}
            subtitle={KDP_HELPER_ROW_SUBTITLE || undefined}
            value={helperOn ? "On" : "Off"}
            symbol="iphone"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/kdp-helper" as Href)}
            accessibilityLabel={`${KDP_HELPER_ROW_LABEL}. ${helperOn ? "On" : "Off"}`}
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
