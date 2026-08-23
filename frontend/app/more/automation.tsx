import React, { useCallback, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, RefreshControl, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { SFSymbol } from "@/src/components/ios/Native";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { fetchOptimizationRules, fetchRuleExecutionEntities, fetchRuleExecutions, toggleOptimizationRule } from "@/src/lib/queries";
import { SIGN_IN_TO_MUTATE_MESSAGE, userMessageForNestError } from "@/src/lib/rulesApi";
import { EmptyState, ListCard, RetryState, ScreenSpinner, SectionHeader } from "@/src/components/Primitives";
import type { OptimizationRule } from "@/src/lib/types";
import { presentRule, relativeTime } from "@/src/lib/rulePresentation";

type Theme = ReturnType<typeof useTheme>;

const headerAction = {
  icon: "add" as const,
  testID: "new-rule",
  accessibilityLabel: "New rule",
  accessibilityHint: "Creates a rule. New rules start disabled.",
};

export default function AutomationScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const { selectedProfileIds, primaryCurrency } = useApp();
  const queryClient = useQueryClient();

  const rulesQ = useQuery({
    queryKey: ["optimization-rules", user?.id, selectedProfileIds],
    queryFn: () => fetchOptimizationRules(user!.id, selectedProfileIds),
    enabled: !!user?.id && selectedProfileIds.length > 0,
  });

  const execsQ = useQuery({
    queryKey: ["rule-executions", user?.id, selectedProfileIds],
    queryFn: () => fetchRuleExecutions({ userId: user!.id, profileIds: selectedProfileIds }),
    enabled: !!user?.id && selectedProfileIds.length > 0,
  });

  const execRows = execsQ.data ?? [];
  const entityHintsQ = useQuery({
    queryKey: ["automation-entity-hints", execRows.map((row) => row.id).join(",")],
    queryFn: () => fetchRuleExecutionEntities(execRows.map((row) => row.id)),
    enabled: execRows.length > 0,
  });

  const entityHintByExecution = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of entityHintsQ.data ?? []) {
      if (map.has(entity.execution_id)) continue;
      const action = String(entity.action_type ?? "").toLowerCase();
      if (!action.includes("positive") && !action.includes("negative") && !action.includes("negat")) continue;
      const origin = entity.origin_label ?? entity.campaign_name ?? null;
      const destination = entity.destination_label ?? entity.to_campaign_name ?? null;
      if (origin || destination) map.set(entity.execution_id, `${origin ?? "Origin"} -> ${destination ?? "Destination"}`);
    }
    return map;
  }, [entityHintsQ.data]);

  const rules = rulesQ.data ?? [];
  const activeRules = rules.filter((r) => r.enabled).length;

  const onNewRule = useCallback(() => router.push("/more/rule-create" as any), [router]);

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleOptimizationRule(id, enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["optimization-rules"] }),
    onError: (e: unknown) => Alert.alert("Couldn't update rule", userMessageForNestError(e, "Please try again.")),
  });

  const handleToggle = useCallback(
    (rule: OptimizationRule, next: boolean) => {
      if (guestMode) {
        Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
        return;
      }
      if (next) {
        Alert.alert("Enable rule?", "This rule will start changing bids or budgets on its schedule.", [
          { text: "Cancel", style: "cancel" },
          { text: "Enable", onPress: () => toggleMutation.mutate({ id: rule.id, enabled: true }) },
        ]);
        return;
      }
      toggleMutation.mutate({ id: rule.id, enabled: false });
    },
    [guestMode, toggleMutation],
  );

  const handleEditRule = useCallback(
    (rule: OptimizationRule) =>
      router.push({ pathname: "/more/rule-create", params: { id: rule.id, rule: JSON.stringify(rule) } } as any),
    [router],
  );

  const onRefresh = useCallback(async () => {
    await Promise.all([rulesQ.refetch(), execsQ.refetch()]);
  }, [execsQ, rulesQ]);

  const refreshing = (rulesQ.isRefetching || execsQ.isRefetching) && !rulesQ.isLoading;
  const rightAction = { ...headerAction, onPress: onNewRule };

  if (selectedProfileIds.length === 0) {
    return (
      <SubScreen title="Rules" rightAction={rightAction}>
        <EmptyState icon="business-outline" title="No account connected" subtitle="Connect an Amazon account to set up rules." />
      </SubScreen>
    );
  }

  const showRetry = rulesQ.isError && rules.length === 0 && !rulesQ.isLoading;
  const showSpinner = rulesQ.isLoading && rules.length === 0;

  return (
    <SubScreen title="Rules" rightAction={rightAction}>
      <ScrollView
        contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance, gap: t.layout.listGap }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.colors.tone_primary} />}
      >
        {showRetry ? (
          <RetryState
            title="Couldn't load rules"
            subtitle="Pull to refresh or try again."
            onRetry={() => void rulesQ.refetch()}
            retrying={rulesQ.isRefetching}
          />
        ) : showSpinner ? (
          <ScreenSpinner />
        ) : rules.length === 0 ? (
          <EmptyState
            icon="options-outline"
            title="No rules yet"
            subtitle="Create a rule to change bids or budgets automatically. New rules start disabled."
            action={{ label: "New rule", onPress: onNewRule }}
          />
        ) : (
          <View style={{ gap: t.layout.listGap }}>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              {activeRules} of {rules.length} enabled
            </Text>
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                currency={primaryCurrency}
                t={t}
                toggling={toggleMutation.isPending && toggleMutation.variables?.id === rule.id}
                onPress={() => handleEditRule(rule)}
                onToggle={(next) => handleToggle(rule, next)}
              />
            ))}
          </View>
        )}

        <View style={{ marginTop: t.spacing.md }}>
          <SectionHeader
            title="Recent runs"
            icon="time-outline"
            action={{ label: "All activity", onPress: () => router.push("/more/rule-history") }}
          />
          {execsQ.isError && execRows.length === 0 ? (
            <RetryState
              title="Couldn't load recent runs"
              subtitle="Rules above are unchanged."
              onRetry={() => void execsQ.refetch()}
              retrying={execsQ.isRefetching}
            />
          ) : execsQ.isLoading && execRows.length === 0 ? (
            <ScreenSpinner />
          ) : execRows.length === 0 ? (
            <ListCard>
              <EmptyState icon="time-outline" title="No runs yet" subtitle="Executions appear here after a rule runs." />
            </ListCard>
          ) : (
            <ListCard style={{ padding: 0 }}>
              {execRows.slice(0, 8).map((ex, idx, arr) => {
                const ok = ex.status === "completed";
                const warn = ex.status === "partial_fail" || ex.status === "partial_failed";
                const failed = ex.status === "failed";
                const col = ok
                  ? t.colors.tone_good
                  : failed
                    ? t.colors.tone_danger
                    : warn
                      ? t.colors.tone_warning
                      : t.colors.tone_inactive;
                const name = ex.optimization_rules?.name ?? "Rule";
                return (
                  <TouchableOpacity
                    key={ex.id}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${name}. ${ex.entities} ${ex.entities === 1 ? "change" : "changes"}${ex.errors_count > 0 ? `, ${ex.errors_count} errors` : ""}. ${relativeTime(ex.executed_at)}.`}
                    accessibilityHint="Opens this run."
                    onPress={() =>
                      router.push({
                        pathname: "/more/rule-detail/[id]",
                        params: {
                          id: ex.id,
                          ruleName: name,
                          executedAt: ex.executed_at ?? "",
                          status: ex.status ?? "",
                          entities: String(ex.entities),
                        },
                      })
                    }
                    style={[
                      styles.runRow,
                      {
                        minHeight: t.layout.minTap,
                        borderBottomColor: t.colors.separator,
                        borderBottomWidth: idx === Math.min(8, arr.length) - 1 ? 0 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={[styles.runIcon, { backgroundColor: col + "1A" }]}>
                      <SFSymbol name={ok ? "checkmark" : warn ? "exclamationmark.triangle" : failed ? "xmark" : "circle"} size={15} color={col} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 11, minWidth: 0 }}>
                      <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={2}>
                        {name}
                      </Text>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 1 }]} numberOfLines={2}>
                        {ex.entities} {ex.entities === 1 ? "change" : "changes"}
                        {ex.errors_count > 0 ? ` · ${ex.errors_count} errors` : ""} · {relativeTime(ex.executed_at)}
                      </Text>
                      {entityHintByExecution.get(ex.id) ? (
                        <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={1}>
                          {entityHintByExecution.get(ex.id)}
                        </Text>
                      ) : null}
                    </View>
                    <SFSymbol name="chevron.right" size={16} color={t.colors.text_tertiary} />
                  </TouchableOpacity>
                );
              })}
            </ListCard>
          )}
        </View>
      </ScrollView>
    </SubScreen>
  );
}

const RuleCard = React.memo(function RuleCard({
  rule,
  currency,
  t,
  onPress,
  onToggle,
  toggling,
}: {
  rule: OptimizationRule;
  currency: string;
  t: Theme;
  onPress: () => void;
  onToggle: (next: boolean) => void;
  toggling: boolean;
}) {
  const presented = presentRule(rule, currency);
  const accessibilityLabel = [
    presented.name,
    presented.stateLabel,
    presented.scope ? `${presented.scope} rule` : null,
    presented.whenSpoken ? `When ${presented.whenSpoken}` : null,
    presented.then ? `Then ${presented.then}` : null,
    presented.lastRun,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <ListCard testID={`rule-row-${rule.id}`}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: t.spacing.sm }}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Opens the rule editor."
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text
            style={[t.typography.headline, { color: presented.enabled ? t.colors.text_primary : t.colors.text_secondary }]}
            numberOfLines={3}
          >
            {presented.name}
          </Text>
          {presented.scope || presented.cadence ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]} numberOfLines={2}>
              {[presented.scope, presented.cadence].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {presented.when ? (
            <Text style={[t.typography.subhead, { color: t.colors.text_primary, marginTop: t.spacing.sm }]}>
              When {presented.when}
            </Text>
          ) : null}
          {presented.then ? (
            <Text style={[t.typography.subhead, { color: t.colors.text_primary, marginTop: presented.when ? 2 : t.spacing.sm, fontWeight: "600" }]}>
              Then {presented.then}
            </Text>
          ) : null}
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: t.spacing.sm }]}>{presented.lastRun}</Text>
        </TouchableOpacity>
        <Pressable
          onPress={() => onToggle(!presented.enabled)}
          disabled={toggling}
          accessibilityRole="switch"
          accessibilityLabel={`${presented.name}, ${presented.stateLabel}`}
          accessibilityHint={presented.enabled ? "Disables this rule." : "Asks to enable this rule."}
          accessibilityState={{ checked: presented.enabled, disabled: toggling }}
          style={styles.switchWrap}
        >
          <Text
            style={[
              t.typography.caption1,
              {
                color: presented.enabled ? t.colors.tone_good : t.colors.text_secondary,
                fontWeight: "600",
                marginBottom: 4,
              },
            ]}
          >
            {presented.stateLabel}
          </Text>
          <Switch
            value={presented.enabled}
            disabled={toggling}
            trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_good }}
            ios_backgroundColor={t.colors.background_tertiary}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>
      </View>
    </ListCard>
  );
});

const styles = StyleSheet.create({
  switchWrap: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  runRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14 },
  runIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
