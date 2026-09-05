import React from "react";
import { Alert, Linking, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { DashboardSurface } from "@/src/components/DashboardSurface";
import { PrimaryButton, SecondaryButton } from "@/src/components/Primitives";
import { KDP_CHROME_HELPER_URL } from "@/src/lib/accountContract";
import type { RoyaltySetupActionId, RoyaltySetupAsk } from "@/src/lib/kdpRoyaltySetup";
import { dashboard, useTheme } from "@/src/lib/theme";

export async function openChromeRoyaltyHelper(): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(KDP_CHROME_HELPER_URL);
  } catch {
    try {
      await Linking.openURL(KDP_CHROME_HELPER_URL);
    } catch {
      Alert.alert("Couldn't open Chrome setup", "Open dashboard.inteliads.io on a computer and install the InteliAds Chrome extension.");
    }
  }
}

export function presentRoyaltySetupAsk(
  plan: RoyaltySetupAsk,
  handlers: { onAction: (id: RoyaltySetupActionId) => void },
): void {
  Alert.alert(plan.title, plan.body, [
    {
      text: plan.secondary.label,
      style: plan.secondary.id === "later" ? "cancel" : "default",
      onPress: () => handlers.onAction(plan.secondary.id),
    },
    {
      text: plan.primary.label,
      onPress: () => handlers.onAction(plan.primary.id),
    },
  ]);
}

export function KdpRoyaltySetupCard({
  plan,
  onAction,
}: {
  plan: RoyaltySetupAsk;
  onAction: (id: RoyaltySetupActionId) => void;
}) {
  const t = useTheme();
  return (
    <DashboardSurface
      testID="home-kdp-royalty-setup"
      tone="attention"
      style={{ marginBottom: dashboard.sectionGap }}
    >
      <Text
        style={[t.typography.headline, { color: t.colors.text_primary }]}
        accessibilityRole="header"
      >
        {plan.title}
      </Text>
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 6, lineHeight: 18 }]}>
        {plan.body}
      </Text>
      <View style={{ marginTop: 12, gap: 8 }}>
        <PrimaryButton
          testID={`kdp-royalty-setup-${plan.primary.id}`}
          label={plan.primary.label}
          onPress={() => onAction(plan.primary.id)}
        />
        <SecondaryButton
          testID={`kdp-royalty-setup-${plan.secondary.id}`}
          label={plan.secondary.label}
          onPress={() => onAction(plan.secondary.id)}
        />
      </View>
    </DashboardSurface>
  );
}

export function useRoyaltySetupNavigation() {
  const { push } = useRouter();
  return {
    openHelper: () => push("/more/kdp-helper" as Href),
    openSource: () => push("/more/kdp-source" as Href),
    openAccounts: () => push("/more/accounts" as Href),
    openChrome: () => {
      void openChromeRoyaltyHelper();
    },
  };
}
