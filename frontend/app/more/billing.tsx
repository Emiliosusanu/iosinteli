import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SFSymbol } from "@/src/components/ios/Native";
import {
  SettingsNote,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import { useAuth } from "@/src/contexts/AuthContext";
import { useCurrentUserPlan } from "@/src/hooks/useCurrentUserPlan";
import {
  BILLING_CURRENT_PLAN_BADGE,
  BILLING_MANAGE_PORTAL_LABEL,
  BILLING_SCREEN_FOOTER,
  BILLING_SCREEN_TITLE,
  ACCOUNT_GUEST_NOTE,
  formatNestPricingPlanPrice,
  groupNestPricingPlans,
  isNestPricingPlanCurrent,
  nestPricingPlanCycle,
  pickNestPricingPlanForCycle,
  type BillingCyclePreference,
  type NestPricingPlan,
  type NestPricingPlanGroup,
} from "@/src/lib/accountContract";
import {
  createStripeBillingPortalSession,
  fetchPricingPlans,
  verifyAppleTransaction,
} from "@/src/lib/mutations";
import { NestApiError } from "@/src/lib/rulesApi";
import { appleProductIdForPlanSlug } from "@/src/lib/storeBilling";
import { useTheme } from "@/src/lib/theme";
import {
  finishStoreTransaction,
  getStoreProducts,
  isStoreKitAvailable,
  purchaseStoreProduct,
  restoreStorePurchases,
  showManageStoreSubscriptions,
  type StoreProduct,
} from "inteliads-native-sync";

async function openSafari(url: string) {
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    controlsColor: "#007AFF",
  });
}

export default function BillingScreen() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { user, guestMode, state: authState } = useAuth();
  const currentPlanQ = useCurrentUserPlan();
  const [cycle, setCycle] = useState<BillingCyclePreference>("month");
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const enabled = authState === "authenticated" && !!user?.id && !guestMode;

  const plansQ = useQuery({
    queryKey: ["pricing-plans", "catalog", user?.id ?? "none"],
    queryFn: fetchPricingPlans,
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  const storeProductsQ = useQuery({
    queryKey: ["app-store-products"],
    queryFn: getStoreProducts,
    enabled: enabled && isStoreKitAvailable(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const refetchBilling = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pricing-plans"] });
  }, [queryClient]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      refetchBilling();
    }, [enabled, refetchBilling]),
  );

  useEffect(() => {
    let appState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.match(/inactive|background/) && next === "active" && enabled) {
        refetchBilling();
      }
      appState = next;
    });
    return () => sub.remove();
  }, [enabled, refetchBilling]);

  const groups = useMemo(
    () => groupNestPricingPlans(plansQ.data ?? []),
    [plansQ.data],
  );

  const openPortal = async () => {
    if (busySlug) return;
    setBusySlug("portal");
    try {
      const { url } = await createStripeBillingPortalSession();
      await openSafari(url);
    } catch (error) {
      const message =
        error instanceof NestApiError
          ? error.message
          : "Couldn't open Stripe billing portal.";
      Alert.alert("Couldn't open portal", message);
    } finally {
      setBusySlug(null);
      refetchBilling();
    }
  };

  const startCheckout = async (plan: NestPricingPlan) => {
    const productId = appleProductIdForPlanSlug(plan.slug);
    const product = storeProductsQ.data?.find((item) => item.id === productId);
    if (!user?.id || !productId || !product) {
      Alert.alert("Plan unavailable", "This subscription is not available from the App Store yet.");
      return;
    }
    if (busySlug) return;
    setBusySlug(plan.slug);
    try {
      if (currentPlanQ.nestPlan?.stripeSubscriptionId) {
        Alert.alert(
          "Web subscription active",
          "Manage the existing subscription first to avoid being charged twice.",
          [
            { text: "Cancel", style: "cancel" },
            { text: BILLING_MANAGE_PORTAL_LABEL, onPress: () => void openPortal() },
          ],
        );
        return;
      }
      const purchase = await purchaseStoreProduct(productId, user.id);
      if (purchase.status === "cancelled") return;
      if (purchase.status === "pending") {
        Alert.alert("Purchase pending", "Apple will activate the plan when the purchase is approved.");
        return;
      }
      if (!purchase.signedTransaction || !purchase.transactionId) {
        throw new Error("The App Store receipt is incomplete.");
      }
      await verifyAppleTransaction(purchase.signedTransaction);
      await finishStoreTransaction(purchase.transactionId);
      await queryClient.invalidateQueries({ queryKey: ["pricing-plans"] });
      Alert.alert("Subscription active", `${product.displayName} is now active.`);
    } catch (error) {
      Alert.alert(
        "Purchase not completed",
        error instanceof Error ? error.message : "The App Store purchase could not be completed.",
      );
    } finally {
      setBusySlug(null);
      refetchBilling();
    }
  };

  const restorePurchases = async () => {
    if (busySlug) return;
    setBusySlug("restore");
    try {
      const purchases = await restoreStorePurchases();
      const verified = purchases.filter(
        (purchase) => purchase.status === "verified" && purchase.signedTransaction,
      );
      if (verified.length === 0) {
        Alert.alert("No subscription found", "No active InteliAds subscription was found for this Apple ID.");
        return;
      }
      for (const purchase of verified) {
        await verifyAppleTransaction(purchase.signedTransaction!);
        if (purchase.transactionId) await finishStoreTransaction(purchase.transactionId);
      }
      await queryClient.invalidateQueries({ queryKey: ["pricing-plans"] });
      Alert.alert("Purchases restored", "Your App Store subscription is active.");
    } catch (error) {
      Alert.alert(
        "Restore failed",
        error instanceof Error ? error.message : "The App Store purchase could not be restored.",
      );
    } finally {
      setBusySlug(null);
    }
  };

  const manageAppleSubscription = async () => {
    if (busySlug) return;
    setBusySlug("manage-apple");
    try {
      await showManageStoreSubscriptions();
    } catch (error) {
      Alert.alert(
        "Couldn't open subscriptions",
        error instanceof Error ? error.message : "Try again in a moment.",
      );
    } finally {
      setBusySlug(null);
      refetchBilling();
    }
  };

  if (guestMode) {
    return (
      <SettingsScreen title={BILLING_SCREEN_TITLE}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
        >
          <SettingsNote testID="billing-guest">{ACCOUNT_GUEST_NOTE}</SettingsNote>
        </ScrollView>
      </SettingsScreen>
    );
  }

  const subscriptionLabel =
    currentPlanQ.nestStatus === "loading" || currentPlanQ.nestStatus === "idle"
      ? "Checking…"
      : currentPlanQ.nestPlan
        ? currentPlanQ.nestPlan.effectivePlanName || currentPlanQ.nestPlan.planName
        : "No plan";

  return (
    <SettingsScreen title={BILLING_SCREEN_TITLE}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection
          title="Current"
          footer={
            currentPlanQ.nestPlan
              ? undefined
              : "Pick a plan below to subscribe with your Apple ID."
          }
        >
          <View
            testID="billing-current-plan"
            style={[
              styles.currentRow,
              {
                borderBottomColor: t.colors.separator,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={[t.typography.body, { color: t.colors.text_primary }]}>
              {subscriptionLabel}
            </Text>
            {currentPlanQ.nestPlan?.isTrial ? (
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                Trial
              </Text>
            ) : null}
          </View>
          {currentPlanQ.nestPlan?.billingProvider === "apple" ? (
            <Pressable
              testID="billing-manage-apple"
              onPress={() => void manageAppleSubscription()}
              disabled={busySlug === "manage-apple"}
              accessibilityRole="button"
              style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Manage App Store subscription</Text>
              <SFSymbol name="chevron.right" size={14} color={t.colors.tone_primary} />
            </Pressable>
          ) : currentPlanQ.nestPlan?.stripeCustomerId ||
          currentPlanQ.nestPlan?.stripeSubscriptionId ? (
            <Pressable
              testID="billing-manage-portal"
              onPress={() => void openPortal()}
              disabled={busySlug === "portal"}
              accessibilityRole="button"
              accessibilityLabel={BILLING_MANAGE_PORTAL_LABEL}
              style={({ pressed }) => [
                styles.actionRow,
                { opacity: pressed || busySlug === "portal" ? 0.55 : 1 },
              ]}
            >
              <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>
                {busySlug === "portal" ? "Opening…" : BILLING_MANAGE_PORTAL_LABEL}
              </Text>
              <SFSymbol name="arrow.up.right.square" size={14} color={t.colors.tone_primary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="billing-restore-purchases"
            onPress={() => void restorePurchases()}
            disabled={busySlug === "restore"}
            accessibilityRole="button"
            style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.55 : 1 }]}
          >
            <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Restore purchases</Text>
            {busySlug === "restore" ? (
              <ActivityIndicator size="small" />
            ) : (
              <SFSymbol name="arrow.clockwise" size={14} color={t.colors.tone_primary} />
            )}
          </Pressable>
        </SettingsSection>

        <View style={styles.cycleWrap} testID="billing-cycle-toggle">
          {(["month", "year"] as const).map((option) => {
            const selected = cycle === option;
            return (
              <Pressable
                key={option}
                testID={`billing-cycle-${option}`}
                onPress={() => setCycle(option)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[
                  styles.cycleChip,
                  {
                    backgroundColor: selected
                      ? t.colors.text_primary
                      : t.colors.background_secondary,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.footnote,
                    {
                      fontWeight: "600",
                      color: selected ? t.colors.background_primary : t.colors.text_primary,
                    },
                  ]}
                >
                  {option === "month" ? "Monthly" : "Yearly"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SettingsSection title="Plans" footer={BILLING_SCREEN_FOOTER}>
          {plansQ.isPending ? (
            <View style={styles.loading} testID="billing-plans-loading">
              <ActivityIndicator />
            </View>
          ) : plansQ.isError ? (
            <View style={styles.loading} testID="billing-plans-error">
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                Could not load plans.
              </Text>
              <Pressable onPress={() => void plansQ.refetch()}>
                <Text style={[t.typography.body, { color: t.colors.tone_primary, marginTop: 8 }]}>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : groups.length === 0 ? (
            <View style={styles.loading} testID="billing-plans-empty">
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
                No plans available.
              </Text>
            </View>
          ) : (
            groups.map((group, index) => (
              <PlanRow
                key={group.baseSlug}
                group={group}
                cycle={cycle}
                current={currentPlanQ.nestPlan}
                busySlug={busySlug}
                storeProduct={storeProductsQ.data?.find(
                  (item) =>
                    item.id ===
                    appleProductIdForPlanSlug(
                      pickNestPricingPlanForCycle(group, cycle)?.slug || "",
                    ),
                )}
                last={index === groups.length - 1}
                onSelect={(plan) => void startCheckout(plan)}
              />
            ))
          )}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}

function PlanRow({
  group,
  cycle,
  current,
  busySlug,
  storeProduct,
  last,
  onSelect,
}: {
  group: NestPricingPlanGroup;
  cycle: BillingCyclePreference;
  current: ReturnType<typeof useCurrentUserPlan>["nestPlan"];
  busySlug: string | null;
  storeProduct?: StoreProduct;
  last: boolean;
  onSelect: (plan: NestPricingPlan) => void;
}) {
  const t = useTheme();
  const plan = pickNestPricingPlanForCycle(group, cycle);
  if (!plan) return null;
  const isCurrent = isNestPricingPlanCurrent(plan, current);
  const price =
    storeProduct?.displayPrice ??
    formatNestPricingPlanPrice(plan, nestPricingPlanCycle(plan) ?? cycle);
  const busy = busySlug === plan.slug;
  const cta = isCurrent
    ? BILLING_CURRENT_PLAN_BADGE
    : busy
      ? "Opening…"
      : storeProduct
        ? "Continue"
        : "Unavailable";

  return (
    <Pressable
      testID={`billing-plan-${plan.slug}`}
      onPress={() => {
        if (isCurrent || !storeProduct || busy) return;
        onSelect(plan);
      }}
      disabled={isCurrent || !storeProduct || !!busySlug}
      accessibilityRole="button"
      accessibilityState={{ disabled: isCurrent || !storeProduct }}
      accessibilityLabel={`${group.name}. ${price}. ${cta}`}
      style={({ pressed }) => [
        styles.planRow,
        {
          borderBottomColor: t.colors.separator,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          opacity: pressed && !isCurrent ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.planCopy}>
        <View style={styles.planTitleRow}>
          <Text style={[t.typography.body, { color: t.colors.text_primary, fontWeight: "600" }]}>
            {group.name}
          </Text>
          {group.isPopular ? (
            <Text style={[t.typography.footnote, { color: t.colors.tone_primary }]}>Popular</Text>
          ) : null}
        </View>
        {group.description ? (
          <Text
            style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}
            numberOfLines={2}
          >
            {group.description}
          </Text>
        ) : null}
        {group.trialDays > 0 && !isCurrent ? (
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
            {group.trialDays}-day trial when eligible
          </Text>
        ) : null}
      </View>
      <View style={styles.planMeta}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{price}</Text>
        <Text
          style={[
            t.typography.footnote,
            {
              color: isCurrent ? t.colors.text_secondary : t.colors.tone_primary,
              marginTop: 2,
              fontWeight: "600",
            },
          ]}
        >
          {cta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 48,
  },
  currentRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  cycleWrap: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  cycleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  loading: {
    padding: 24,
    alignItems: "center",
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
  },
  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planMeta: {
    alignItems: "flex-end",
  },
});
