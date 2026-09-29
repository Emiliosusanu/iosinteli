import React from "react";
import { ScrollView, Linking } from "react-native";
import { type Href, useRouter } from "expo-router";
import Constants from "expo-constants";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme, useThemePreference } from "@/src/lib/theme";
import {
  accountSubscriptionPresentation,
  amazonProfileViewSummary,
} from "@/src/lib/accountContract";
import { useCurrentUserPlan } from "@/src/hooks/useCurrentUserPlan";
import { anyNotificationPrefEnabled } from "@/src/lib/notificationContract";
import {
  ACCOUNT_SECTION_TITLE,
  ADS_SECTION_FOOTER,
  ADS_SECTION_TITLE,
  ABOUT_SECTION_TITLE,
  AMAZON_ACCOUNTS_ROW_LABEL,
  APPEARANCE_LABEL,
  APP_SECTION_TITLE,
  appearancePreferenceLabel,
  BID_BOT_ROW_LABEL,
  BID_BOT_ROW_SUBTITLE,
  DATA_COVERAGE_ROW_LABEL,
  DATA_SECTION_TITLE,
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
  KDP_SECTION_TITLE,
  MANAGE_BILLING_ROW_LABEL,
  MY_ACCOUNT_ROW_LABEL,
  NOTIFICATIONS_ROW_LABEL,
  PLAN_ROW_LABEL,
  SUBSCRIPTION_ROW_LABEL,
  SYNC_ROW_LABEL,
  VERSION_ROW_LABEL,
  VIEWING_CUSTOMER_SETTINGS_NOTE,
  notificationFooter,
} from "@/src/lib/settingsContract";
import {
  SettingsNavigationRow,
  SettingsNote,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import { isIosHelperEnabled, kdpRoyaltySourceValueLabel } from "@/src/lib/kdp/source";

function appVersionLabel(): string {
  const version =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    "1.0.1";
  const build =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.nativeBuildVersion ??
    undefined;
  return build ? `${version} (${build})` : String(version);
}

export default function SettingsScreenRoute() {
  const t = useTheme();
  const { preference: appearancePreference } = useThemePreference();
  const router = useRouter();
  const { guestMode, user } = useAuth();
  const {
    notifications,
    notificationRuntime,
    adminFilterUserId,
    kdpRoyaltySource,
    profiles,
    profilesLoading,
    selectedProfileIds,
  } = useApp();
  const kdpSourceValue = kdpRoyaltySourceValueLabel(kdpRoyaltySource);
  const appearanceValue = appearancePreferenceLabel(appearancePreference);
  const helperOn = isIosHelperEnabled(kdpRoyaltySource);
  const currentPlanQ = useCurrentUserPlan();
  const subscription = accountSubscriptionPresentation({
    nestPlan: currentPlanQ.nestPlan,
    nestStatus: currentPlanQ.nestStatus,
    userMetadata: user?.user_metadata,
    appMetadata: user?.app_metadata,
  });
  const viewingCustomer = !!adminFilterUserId;
  const anyAlertOn = anyNotificationPrefEnabled(notifications);
  const permissionDenied = notificationRuntime.permission === "denied";
  const subscriptionFooter = subscription.footer;
  const profileValue =
    profilesLoading && profiles.length === 0
      ? "Checking…"
      : amazonProfileViewSummary(selectedProfileIds.length, profiles.length);
  const accountValue = guestMode ? "Preview" : (user?.email ?? "Signed in");
  const notifValue = guestMode
    ? GUEST_SETTINGS_NOTE
    : anyAlertOn
      ? "On"
      : "Off";

  return (
    <SettingsScreen title="Settings">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {guestMode ? <SettingsNote testID="settings-guest">{GUEST_SETTINGS_NOTE}</SettingsNote> : null}
        {viewingCustomer ? (
          <SettingsNote testID="settings-viewing-customer">{VIEWING_CUSTOMER_SETTINGS_NOTE}</SettingsNote>
        ) : null}

        <SettingsSection
          testID="notification-settings-card"
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
          <SettingsNavigationRow
            testID="settings-notifications"
            label={NOTIFICATIONS_ROW_LABEL}
            value={notifValue}
            symbol="bell.badge.fill"
            symbolColor={t.colors.tone_danger}
            last
            onPress={() => router.push("/more/notifications" as Href)}
            accessibilityLabel={`${NOTIFICATIONS_ROW_LABEL}. ${notifValue}`}
          />
        </SettingsSection>

        {!guestMode ? (
          <SettingsSection
            title={ACCOUNT_SECTION_TITLE}
            footer={
              subscription.truth === "NEST" || subscription.truth === "LOADING"
                ? undefined
                : subscriptionFooter || undefined
            }
          >
            <SettingsNavigationRow
              testID="settings-my-account"
              label={MY_ACCOUNT_ROW_LABEL}
              value={accountValue}
              symbol="person.crop.circle.fill"
              symbolColor={t.colors.tone_primary}
              onPress={() => router.push("/more/account" as Href)}
              accessibilityLabel={`${MY_ACCOUNT_ROW_LABEL}. ${accountValue}`}
            />
            <SettingsNavigationRow
              testID="settings-plan"
              label={PLAN_ROW_LABEL}
              subtitle={subscription.planSubtitle}
              value={subscription.planLabel}
              symbol="creditcard.fill"
              symbolColor={t.colors.tone_primary}
              onPress={() => router.push("/more/billing" as Href)}
              accessibilityLabel={`${PLAN_ROW_LABEL}. ${subscription.planLabel}`}
            />
            <SettingsNavigationRow
              testID="settings-subscription-status"
              label={SUBSCRIPTION_ROW_LABEL}
              value={subscription.statusLabel}
              symbol="checkmark.seal.fill"
              symbolColor={t.colors.tone_primary}
              onPress={() => router.push("/more/billing" as Href)}
              accessibilityLabel={`${SUBSCRIPTION_ROW_LABEL}. ${subscription.statusLabel}`}
            />
            <SettingsNavigationRow
              testID="settings-manage-billing"
              label={MANAGE_BILLING_ROW_LABEL}
              symbol="creditcard.fill"
              symbolColor={t.colors.tone_primary}
              last
              onPress={() => router.push("/more/billing" as Href)}
              accessibilityHint="Opens in-app plans and Stripe checkout."
            />
          </SettingsSection>
        ) : null}

        <SettingsSection title={ADS_SECTION_TITLE} footer={ADS_SECTION_FOOTER || undefined}>
          <SettingsNavigationRow
            testID="settings-amazon-accounts"
            label={AMAZON_ACCOUNTS_ROW_LABEL}
            value={guestMode ? undefined : profileValue}
            symbol="building.2.fill"
            symbolColor={t.colors.tone_primary}
            onPress={() => router.push("/more/accounts" as Href)}
            accessibilityLabel={
              guestMode ? AMAZON_ACCOUNTS_ROW_LABEL : `${AMAZON_ACCOUNTS_ROW_LABEL}. ${profileValue}`
            }
          />
          <SettingsNavigationRow
            testID="settings-open-bid-bot"
            label={BID_BOT_ROW_LABEL}
            subtitle={BID_BOT_ROW_SUBTITLE || undefined}
            symbol="slider.horizontal.3"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/bid-bot")}
            accessibilityLabel={BID_BOT_ROW_LABEL}
          />
        </SettingsSection>

        <SettingsSection title={KDP_SECTION_TITLE} footer={KDP_SECTION_FOOTER || undefined}>
          <SettingsNavigationRow
            testID="settings-kdp-source"
            label={KDP_PROFIT_LABEL}
            value={kdpSourceValue}
            symbol="book.fill"
            symbolColor={t.colors.tone_primary}
            onPress={() => router.push("/more/kdp-source" as Href)}
            accessibilityLabel={`${KDP_PROFIT_LABEL}. ${kdpSourceValue}`}
          />
          <SettingsNavigationRow
            testID="settings-kdp-accounts"
            label={KDP_ACCOUNTS_ROW_LABEL}
            subtitle={KDP_ACCOUNTS_ROW_SUBTITLE || undefined}
            symbol="link"
            symbolColor={t.colors.tone_primary}
            onPress={() => router.push("/more/accounts" as Href)}
            accessibilityLabel={KDP_ACCOUNTS_ROW_LABEL}
            accessibilityHint="Opens Amazon Accounts to link KDP."
          />
          <SettingsNavigationRow
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
        </SettingsSection>

        <SettingsSection title={DATA_SECTION_TITLE}>
          <SettingsNavigationRow
            testID="settings-sync"
            label={SYNC_ROW_LABEL}
            symbol="arrow.triangle.2.circlepath"
            symbolColor={t.colors.tone_primary}
            onPress={() => router.push("/more/sync" as Href)}
            accessibilityLabel={SYNC_ROW_LABEL}
          />
          <SettingsNavigationRow
            testID="settings-data-coverage"
            label={DATA_COVERAGE_ROW_LABEL}
            symbol="chart.bar.fill"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/data-map" as Href)}
            accessibilityLabel={DATA_COVERAGE_ROW_LABEL}
          />
        </SettingsSection>

        <SettingsSection title={APP_SECTION_TITLE}>
          <SettingsNavigationRow
            testID="settings-appearance"
            label={APPEARANCE_LABEL}
            value={appearanceValue}
            symbol="circle.lefthalf.filled"
            symbolColor={t.colors.text_secondary}
            last
            onPress={() => router.push("/more/appearance" as Href)}
            accessibilityLabel={`${APPEARANCE_LABEL}. ${appearanceValue}`}
          />
        </SettingsSection>

        <SettingsSection title={ABOUT_SECTION_TITLE}>
          <SettingsRow
            testID="settings-version"
            label={VERSION_ROW_LABEL}
            value={appVersionLabel()}
            symbol="info.circle.fill"
            symbolColor={t.colors.tone_inactive}
            last
            accessibilityLabel={`${VERSION_ROW_LABEL}. ${appVersionLabel()}`}
          />
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
