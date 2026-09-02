import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SubScreen } from "@/src/components/SubScreen";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { dashboard, useTheme } from "@/src/lib/theme";
import { BrandIcon } from "@/src/components/Primitives";
import { IOSButton, IOSGroupedSection, IOSSettingsRow } from "@/src/components/ios/Native";
import {
  ACCOUNT_BILLING_FOOTER,
  ACCOUNT_BILLING_URL,
  ACCOUNT_GUEST_NOTE,
  ACCOUNT_STATUS_UNAVAILABLE,
  ACCOUNT_VIEW_AS_NOTE,
  accountPlanPresentation,
  amazonProfileViewSummary,
  signOutConfirmMessage,
} from "@/src/lib/accountContract";

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

  const plan = accountPlanPresentation({
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
  const subscriptionFooter = plan.source
    ? `Plan is shown from account metadata only. ${ACCOUNT_BILLING_FOOTER}`
    : ACCOUNT_BILLING_FOOTER;

  return (
    <SubScreen title="My Account">
      <ScrollView
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
      >
        {viewingCustomer && !guestMode ? (
          <View
            testID="my-account-viewing-customer"
            accessible
            accessibilityRole="text"
            accessibilityLabel={ACCOUNT_VIEW_AS_NOTE}
            style={[
              styles.scopeNote,
              {
                backgroundColor: t.colors.tone_warning + "12",
                borderColor: t.colors.tone_warning + "30",
              },
            ]}
          >
            <Text style={[t.typography.footnote, { color: t.colors.text_primary, lineHeight: undefined }]}>
              {ACCOUNT_VIEW_AS_NOTE}
            </Text>
          </View>
        ) : null}

        <View
          testID="my-account-identity"
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${identityTitle}. ${identitySubtitle}`}
          style={[styles.identityCard, { backgroundColor: t.colors.background_secondary }]}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.avatar, { backgroundColor: t.colors.tone_primary + "1F" }]}
          >
            <BrandIcon size={38} radius={11} />
          </View>
          <View style={styles.identityCopy}>
            <Text selectable style={[t.typography.headline, { color: t.colors.text_primary, lineHeight: undefined }]}>
              {identityTitle}
            </Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 3, lineHeight: undefined }]}>
              {identitySubtitle}
            </Text>
          </View>
        </View>

        {guestMode ? (
          <>
            <IOSGroupedSection title="Account" footer={ACCOUNT_GUEST_NOTE}>
              <IOSSettingsRow
                testID="my-account-guest-access"
                label="Access"
                value="Preview demo"
                last
              />
            </IOSGroupedSection>
            <IOSGroupedSection title="Continue">
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
            </IOSGroupedSection>
          </>
        ) : (
          <>
            <IOSGroupedSection title="Subscription" footer={subscriptionFooter}>
              <IOSSettingsRow
                testID="my-account-plan"
                label="Plan"
                subtitle={plan.source ? "Account metadata only" : undefined}
                value={plan.label}
              />
              <IOSSettingsRow
                testID="my-account-subscription-status"
                label="Subscription status"
                value={ACCOUNT_STATUS_UNAVAILABLE}
              />
              <IOSSettingsRow
                testID="my-account-billing"
                label={billingBusy ? "Opening billing…" : "Manage subscription on the web"}
                symbol="arrow.up.right.square"
                symbolColor={t.colors.tone_primary}
                onPress={() => void openBilling()}
                accessibilityHint="Opens InteliAds billing in the browser."
                last
              />
            </IOSGroupedSection>

            <IOSGroupedSection
              title={viewingCustomer ? "Viewed customer data" : "Amazon data"}
              footer={
                viewingCustomer
                  ? "These profile counts belong to the customer currently in view, not your signed-in InteliAds account."
                  : "Manage profile connections and the current data view in Amazon Accounts."
              }
            >
              <IOSSettingsRow
                testID="my-account-amazon-profiles"
                label="Amazon profiles in current view"
                subtitle={viewingCustomer ? "Customer data" : "Signed-in account data"}
                value={profileSummary}
                symbol="building.2"
                symbolColor={t.colors.tone_product}
                onPress={() => router.push("/more/accounts")}
                accessibilityHint="Opens Amazon Accounts."
                last
              />
            </IOSGroupedSection>

            <IOSGroupedSection
              title="Session"
              footer="Signing out clears this iPhone's InteliAds session. It does not disconnect Amazon Ads or delete your account."
            >
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
            </IOSGroupedSection>
          </>
        )}
      </ScrollView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 120,
  },
  scopeNote: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    marginHorizontal: 16,
    marginTop: 12,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonStack: {
    gap: 10,
    padding: 10,
  },
  sessionAction: {
    padding: 10,
  },
});
