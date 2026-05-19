import React from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Switch } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { fetchOptimizationRules, fetchRuleExecutions } from "@/src/lib/queries";
import { Pill, EmptyState, SectionCard } from "@/src/components/Primitives";

export default function AutomationScreen() {
  const t = useTheme();
  const { user } = useAuth();

  const rulesQ = useQuery({
    queryKey: ["optimization-rules", user?.id],
    queryFn: () => fetchOptimizationRules(user!.id),
    enabled: !!user?.id,
  });

  const execsQ = useQuery({
    queryKey: ["rule-executions"],
    queryFn: () => fetchRuleExecutions(),
    enabled: !!user?.id,
  });

  return (
    <SubScreen title="Automation">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <SectionCard title="Active rules" testID="automation-rules-card">
          {rulesQ.isLoading ? (
            <ActivityIndicator color={t.colors.tone_primary} />
          ) : !rulesQ.data || rulesQ.data.length === 0 ? (
            <EmptyState icon="flash-outline" title="No rules yet" subtitle="Create rules to automate bid and budget changes." />
          ) : (
            rulesQ.data.map((rule, idx) => (
              <View
                key={rule.id}
                style={[
                  styles.ruleRow,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === rulesQ.data!.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
                testID={`rule-row-${rule.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
                    {rule.name}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 4 }}>
                    {rule.target_entity && <Pill label={rule.target_entity} tone="primary" />}
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                      Every {rule.check_frequency_hours}h
                    </Text>
                  </View>
                  <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 4 }]}>
                    Affected: {rule.entities_affected} · Runs: {rule.execution_count}
                  </Text>
                </View>
                <Switch
                  value={rule.enabled}
                  trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                  thumbColor="#fff"
                  disabled
                />
              </View>
            ))
          )}
        </SectionCard>

        <SectionCard title="Recent runs" testID="automation-executions-card">
          {execsQ.isLoading ? (
            <ActivityIndicator color={t.colors.tone_primary} />
          ) : !execsQ.data || execsQ.data.length === 0 ? (
            <EmptyState icon="time-outline" title="No executions yet" />
          ) : (
            execsQ.data.slice(0, 12).map((ex, idx) => (
              <View
                key={ex.id}
                style={[
                  styles.execRow,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: idx === Math.min(12, execsQ.data!.length) - 1 ? 0 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Ionicons
                  name={
                    ex.status === "completed"
                      ? "checkmark-circle"
                      : ex.status === "failed" || ex.status === "partial_fail"
                      ? "alert-circle"
                      : "ellipse"
                  }
                  size={18}
                  color={
                    ex.status === "completed"
                      ? t.colors.tone_good
                      : ex.status === "failed"
                      ? t.colors.tone_danger
                      : ex.status === "partial_fail"
                      ? t.colors.tone_warning
                      : t.colors.tone_inactive
                  }
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[t.typography.callout, { color: t.colors.text_primary }]}>
                    {ex.status || "—"}
                  </Text>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                    {ex.executed_at ? new Date(ex.executed_at).toLocaleString() : "—"} · {ex.entities} entities
                    {ex.errors_count > 0 ? ` · ${ex.errors_count} errors` : ""}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>
      </ScrollView>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  execRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
