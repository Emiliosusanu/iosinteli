import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { IOSButton } from "@/src/components/ios/Native";
import {
  SettingsNavigationRow,
  SettingsNote,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import {
  ACCOUNT_BILLING_URL,
  ACCOUNT_GUEST_NOTE,
  ACCOUNT_VIEW_AS_NOTE,
  accountSubscriptionPresentation,
  amazonProfileViewSummary,
  signOutConfirmMessage,
} from "@/src/lib/accountContract";
import { useCurrentUserPlan } from "@/src/hooks/useCurrentUserPlan";

export default function AccountScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, signOut, guestMode } = useAuth();
  const {
    profiles,
    profilesLoading,
    profilesError,
    selectedProfileIds,
    adminFilterUserId,
  } = useApp();
  const currentPlanQ = useCurrentUserPlan();
  const [signingOut, setSigningOut] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);

  const doSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/auth/login");
    } catch {
      setSigningOut(false);
      Alert.alert("Couldn't sign out", "Your session is still active. Try again.");
    }
  };

  const onSignOut = () => {
    if (Platform.OS === "web") {
      // window.confirm works synchronously on web; Alert.alert with buttons isn't reliable.
      // eslint-disable-next-line no-alert
      const ok =
        typeof window !== "undefined" &&
        window.confirm(`Sign out of InteliAds?\n\n${signOutConfirmMessage(user?.email)}`);
      if (ok) void doSignOut();
      return;
    }
    Alert.alert("Sign out of InteliAds?", signOutConfirmMessage(user?.email), [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void doSignOut() },
    ]);
  };

  const leaveDemo = async (target: "/auth/login" | "/auth/signup") => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace(target);
    } catch {
      setSigningOut(false);
      Alert.alert("Couldn't leave preview", "Try again.");
    }
  };

  const openBilling = async () => {
    if (billingBusy) return;
    setBillingBusy(true);
    try {
      await WebBrowser.openBrowserAsync(ACCOUNT_BILLING_URL);
    } catch {
      Alert.alert(
        "Couldn't open billing",
        "Open dashboard.inteliads.io/billing in your browser.",
      );
    } finally {
      setBillingBusy(false);
    }
  };

  const subscription = accountSubscriptionPresentation({
    nestPlan: currentPlanQ.nestPlan,
    nestStatus: currentPlanQ.nestStatus,
    userMetadata: user?.user_metadata,
    appMetadata: user?.app_metadata,
  });
  const viewingCustomer = !!adminFilterUserId;
  const profileSummary =
    profilesLoading && profiles.length === 0
      ? "Checking…"
      : profilesError && profiles.length === 0
        ? "Unavailable"
        : amazonProfileViewSummary(selectedProfileIds.length, profiles.length);
  const identityTitle = guestMode ? "Preview demo" : (user?.email ?? "Account unavailable");
  const identitySubtitle = guestMode ? "No InteliAds account is signed in" : "Signed-in InteliAds account";
  const subscriptionFooter = subscription.footer;

  return (
    <SettingsScreen title="My Account">
      <ScrollView
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
      >
        {viewingCustomer && !guestMode ? (
          <SettingsNote testID="my-account-viewing-customer">{ACCOUNT_VIEW_AS_NOTE}</SettingsNote>
        ) : null}

        <SettingsSection title="Account">
          <SettingsRow
            testID="my-account-identity"
            label={identityTitle}
            subtitle={identitySubtitle}
            symbol="person.crop.circle.fill"
            symbolColor={t.colors.tone_primary}
            last
            accessibilityLabel={`${identityTitle}. ${identitySubtitle}`}
          />
        </SettingsSection>

        {guestMode ? (
          <>
            <SettingsSection title="Access" footer={ACCOUNT_GUEST_NOTE}>
              <SettingsRow
                testID="my-account-guest-access"
                label="Access"
                value="Preview demo"
                last
              />
            </SettingsSection>
            <SettingsSection title="Continue">
              <View style={styles.buttonStack}>
                <IOSButton
                  testID="my-account-sign-in"
                  label={signingOut ? "Opening…" : "Sign in"}
                  onPress={() => void leaveDemo("/auth/login")}
                  disabled={signingOut}
                  accessibilityHint="Leaves preview demo and opens InteliAds sign in."
                  full
                />
                <IOSButton
                  testID="my-account-create-account"
                  label="Create account"
                  onPress={() => void leaveDemo("/auth/signup")}
                  disabled={signingOut}
                  prominent={false}
                  accessibilityHint="Leaves preview demo and opens account creation."
                  full
                />
              </View>
            </SettingsSection>
          </>
        ) : (
          <>
            <SettingsSection title="Subscription" footer={subscriptionFooter}>
              <SettingsRow
                testID="my-account-plan"
                label="Plan"
                subtitle={subscription.planSubtitle}
                value={subscription.planLabel}
              />
              <SettingsRow
                testID="my-account-subscription-status"
                label="Subscription status"
                value={subscription.statusLabel}
              />
              <SettingsNavigationRow
                testID="my-account-billing"
                label={billingBusy ? "Opening billing…" : "Manage subscription on the web"}
                symbol="arrow.up.right.square"
                symbolColor={t.colors.tone_primary}
                onPress={() => void openBilling()}
                accessibilityHint="Opens InteliAds billing in the browser."
                last
              />
            </SettingsSection>

            <SettingsSection
              title={viewingCustomer ? "Viewed customer data" : "Amazon data"}
              footer={viewingCustomer ? "Customer view" : undefined}
            >
              <SettingsNavigationRow
                testID="my-account-amazon-profiles"
                label="Amazon profiles"
                subtitle={viewingCustomer ? "Customer view" : undefined}
                value={profileSummary}
                symbol="building.2.fill"
                symbolColor={t.colors.tone_product}
                onPress={() => router.push("/more/accounts")}
                accessibilityHint="Opens Amazon Accounts."
                last
              />
            </SettingsSection>

            <SettingsSection title="Session" footer="Clears this session">
              <View style={styles.sessionAction}>
                <IOSButton
                  testID="sign-out-btn"
                  label={signingOut ? "Signing out…" : "Sign out"}
                  role="destructive"
                  prominent={false}
                  disabled={signingOut}
                  tintColor={t.colors.tone_danger}
                  systemImage="rectangle.portrait.and.arrow.right"
                  onPress={onSignOut}
                  accessibilityHint="Clears this iPhone's InteliAds session and returns to Sign in."
                  full
                />
              </View>
            </SettingsSection>
          </>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 48,
  },
  buttonStack: {
    gap: 10,
    padding: 10,
  },
  sessionAction: {
    padding: 10,
  },
});
