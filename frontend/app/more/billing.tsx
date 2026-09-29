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
  BILLING_OPEN_WEB_LABEL,
  BILLING_SCREEN_FOOTER,
  BILLING_SCREEN_TITLE,
  ACCOUNT_GUEST_NOTE,
  buildAccountBillingUrl,
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
  createStripeCheckoutSession,
  fetchPricingPlans,
  updateStripeSubscription,
} from "@/src/lib/mutations";
import { NestApiError } from "@/src/lib/rulesApi";
import { useTheme } from "@/src/lib/theme";

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

  const openWebBilling = async (planSlug?: string | null) => {
    try {
      await openSafari(buildAccountBillingUrl({ planSlug, source: "ios" }));
    } catch {
      Alert.alert(
        "Couldn't open billing",
        "Open dashboard.inteliads.io/billing in Safari.",
      );
    } finally {
      refetchBilling();
    }
  };

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
      Alert.alert("Couldn't open portal", message, [
        { text: "Cancel", style: "cancel" },
        { text: "Open web billing", onPress: () => void openWebBilling() },
      ]);
    } finally {
      setBusySlug(null);
      refetchBilling();
    }
  };

  const startCheckout = async (plan: NestPricingPlan) => {
    if (!plan.stripePriceId) {
      Alert.alert("Plan unavailable", "This plan has no Stripe price yet.");
      return;
    }
    if (busySlug) return;
    setBusySlug(plan.slug);
    const current = currentPlanQ.nestPlan;
    try {
      // Existing paid subscription → Nest update path (may return a Checkout URL).
      if (current?.stripeSubscriptionId && current.isActive && !current.paymentFailed) {
        const updated = await updateStripeSubscription(plan.stripePriceId);
        if (updated.requiresCheckout && updated.url) {
          await openSafari(updated.url);
          return;
        }
        if (updated.success) {
          Alert.alert("Plan updated", updated.message || "Your plan change is scheduled.");
          refetchBilling();
          return;
        }
      }

      const { url } = await createStripeCheckoutSession(plan.stripePriceId, {
        source: "ios",
      });
      await openSafari(url);
    } catch (error) {
      const status = error instanceof NestApiError ? error.status : 0;
      if (status === 409) {
        Alert.alert(
          "Subscription already active",
          "Manage or change your plan in Stripe billing.",
          [
            { text: "Cancel", style: "cancel" },
            { text: BILLING_MANAGE_PORTAL_LABEL, onPress: () => void openPortal() },
          ],
        );
        return;
      }
      // Nest checkout failed — fall back to dashboard billing with plan + source=ios.
      Alert.alert(
        "Couldn't start checkout",
        "Open web billing in Safari to continue with Apple Pay.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: BILLING_OPEN_WEB_LABEL,
            onPress: () => void openWebBilling(plan.slug),
          },
        ],
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
              : "Pick a plan below. Checkout opens in Safari (Apple Pay)."
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
          {currentPlanQ.nestPlan?.stripeCustomerId ||
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
          ) : (
            <Pressable
              testID="billing-open-web"
              onPress={() => void openWebBilling()}
              accessibilityRole="button"
              accessibilityLabel={BILLING_OPEN_WEB_LABEL}
              style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>
                {BILLING_OPEN_WEB_LABEL}
              </Text>
              <SFSymbol name="arrow.up.right.square" size={14} color={t.colors.tone_primary} />
            </Pressable>
          )}
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
                Couldn't load plans.
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
  last,
  onSelect,
}: {
  group: NestPricingPlanGroup;
  cycle: BillingCyclePreference;
  current: ReturnType<typeof useCurrentUserPlan>["nestPlan"];
  busySlug: string | null;
  last: boolean;
  onSelect: (plan: NestPricingPlan) => void;
}) {
  const t = useTheme();
  const plan = pickNestPricingPlanForCycle(group, cycle);
  if (!plan) return null;
  const isCurrent = isNestPricingPlanCurrent(plan, current);
  const price = formatNestPricingPlanPrice(plan, nestPricingPlanCycle(plan) ?? cycle);
  const busy = busySlug === plan.slug;
  const cta = isCurrent
    ? BILLING_CURRENT_PLAN_BADGE
    : busy
      ? "Opening…"
      : plan.stripePriceId
        ? "Continue"
        : "Unavailable";

  return (
    <Pressable
      testID={`billing-plan-${plan.slug}`}
      onPress={() => {
        if (isCurrent || !plan.stripePriceId || busy) return;
        onSelect(plan);
      }}
      disabled={isCurrent || !plan.stripePriceId || !!busySlug}
      accessibilityRole="button"
      accessibilityState={{ disabled: isCurrent || !plan.stripePriceId }}
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
