import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Alert } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { SFSymbol } from "@/src/components/ios/Native";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, toneColor } from "@/src/lib/theme";
import { useInvalidateAds } from "@/src/lib/invalidateAds";
import { reapplyRuleExecution, revertRuleExecution } from "@/src/lib/mutations";
import { fetchRuleExecutionEntities, fetchRuleExecutions } from "@/src/lib/queries";
import { SIGN_IN_TO_MUTATE_MESSAGE, userMessageForNestError } from "@/src/lib/rulesApi";
import { formatCurrency, formatInt, formatPercent } from "@/src/lib/format";
import { EmptyState, PrimaryButton, RetryState, SecondaryButton } from "@/src/components/Primitives";
import type { RuleExecutionEntity } from "@/src/lib/types";
import {
  describeEntityAction,
  entityResultLabel,
  formatAuditWhen,
  formatBeforeAfter,
  friendlyEntityType,
  presentExecutionOutcome,
  safeExecutionError,
} from "@/src/lib/ruleExecutionPresentation";

function paramId(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function RuleDetailScreen() {
  const t = useTheme();
  const { guestMode, user } = useAuth();
  const { selectedProfileIds, primaryCurrency } = useApp();
  const invalidateAds = useInvalidateAds();
  const [busy, setBusy] = useState<"revert" | "reapply" | null>(null);
  const params = useLocalSearchParams<{
    id: string;
    ruleName?: string;
    executedAt?: string;
    status?: string;
    entities?: string;
  }>();
  const id = paramId(params.id);
  const paramName = paramId(params.ruleName);
  const paramWhen = paramId(params.executedAt);
  const paramStatus = paramId(params.status);
  const paramEntities = paramId(params.entities);

  const execsQ = useQuery({
    queryKey: ["rule-executions", user?.id, selectedProfileIds],
    queryFn: () => fetchRuleExecutions({ userId: user!.id, profileIds: selectedProfileIds }),
    enabled: !!user?.id && selectedProfileIds.length > 0,
  });
  const cachedRun = (execsQ.data ?? []).find((row) => row.id === id);

  const ruleName = paramName || cachedRun?.optimization_rules?.name || "";
  const executedAt = paramWhen || cachedRun?.executed_at || "";
  const status = paramStatus || cachedRun?.status || "";
  const reportedChanged = Number(paramEntities || cachedRun?.entities || 0);
  const reportedErrors = Number(cachedRun?.errors_count || 0);
  const evaluated =
    cachedRun?.entities_checked != null && Number.isFinite(Number(cachedRun.entities_checked))
      ? Number(cachedRun.entities_checked)
      : null;

  const entitiesQ = useQuery({
    queryKey: ["rule-execution-entities", id],
    queryFn: () => fetchRuleExecutionEntities([id]),
    enabled: !!id,
  });

  const entityRows = entitiesQ.data ?? [];
  const changedFromRows = entityRows.filter((e) => e.success && entityResultLabel(e.success, e.old_value, e.new_value) === "Changed").length;
  const failedFromRows = entityRows.filter((e) => !e.success).length;
  const changed = entityRows.length ? changedFromRows : reportedChanged;
  const failed = entityRows.length ? failedFromRows : reportedErrors;
  const outcome = presentExecutionOutcome({ status, changed, failed });
  const when = formatAuditWhen(executedAt || null);

  const runExecutionAction = (kind: "revert" | "reapply") => {
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return;
    }
    const title = kind === "revert" ? "Revert" : "Reapply";
    Alert.alert(title, "This writes bids or state on Amazon. It is not part of this historical record.", [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        style: kind === "revert" ? "destructive" : "default",
        onPress: () => {
          void (async () => {
            setBusy(kind);
            try {
              const result = kind === "revert" ? await revertRuleExecution(id) : await reapplyRuleExecution(id);
              Alert.alert(title, result?.message ?? (kind === "revert" ? "Reverted that rule run." : "Reapplied that rule run."));
              await invalidateAds();
            } catch (error) {
              Alert.alert(
                kind === "revert" ? "Couldn't revert" : "Couldn't reapply",
                userMessageForNestError(error, kind === "revert" ? "Couldn't revert that rule run." : "Couldn't reapply that rule run."),
              );
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const header = useMemo(
    () => (
      <View>
        <Text
          style={[t.typography.title3, { color: t.colors.text_primary, fontWeight: "600" }]}
          accessibilityRole="header"
        >
          {ruleName || "This run"}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
          <View
            style={[styles.statusPill, { backgroundColor: toneColor(outcome.tone, t.colors) + "1F" }]}
            accessibilityRole="text"
            accessibilityLabel={`Status ${outcome.statusLabel}`}
          >
            <Text style={[t.typography.footnote, { color: toneColor(outcome.tone, t.colors), fontWeight: "700" }]}>
              {outcome.statusLabel}
            </Text>
          </View>
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, flexShrink: 1 }]}>
            {outcome.outcome}
          </Text>
        </View>
        {when.absolute ? (
          <Text
            style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}
            accessibilityLabel={`Ran ${when.absolute}${when.relative ? `, ${when.relative}` : ""}`}
          >
            {when.absolute}
            {when.relative ? ` · ${when.relative}` : ""}
          </Text>
        ) : (
          <Text style={[t.typography.footnote, { color: t.colors.text_tertiary, marginTop: 8 }]}>Run time unavailable</Text>
        )}

        <View style={[styles.counts, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}>
          <Count label="Changed" value={formatInt(changed)} t={t} />
          <Count label="Failed" value={formatInt(failed)} emphasize={failed > 0} t={t} />
          {evaluated != null ? <Count label="Evaluated" value={formatInt(evaluated)} t={t} /> : null}
        </View>
        {evaluated == null ? (
          <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 8 }]}>
            Evaluated count is not stored on this run.
          </Text>
        ) : null}

        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, fontWeight: "700", marginTop: 22, marginBottom: 8 }]}>
          ENTITIES
        </Text>
      </View>
    ),
    [changed, evaluated, failed, outcome.outcome, outcome.statusLabel, outcome.tone, ruleName, t, when.absolute, when.relative],
  );

  if (!id) {
    return (
      <SubScreen title="This run">
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't open this run"
          subtitle="Go back to Rules and open the run again."
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title={ruleName || "This run"}>
      <FlatList
        data={entityRows}
        keyExtractor={(item) => item.id}
        initialNumToRender={12}
        windowSize={7}
        contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          entitiesQ.isLoading ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, paddingVertical: 16 }]}>Loading entities…</Text>
          ) : entitiesQ.isError ? (
            <RetryState
              title="Couldn't load entities"
              subtitle="The run summary above is still from this execution."
              onRetry={() => void entitiesQ.refetch()}
              retrying={entitiesQ.isRefetching}
            />
          ) : String(status).toLowerCase() === "failed" ? (
            <EmptyState icon="alert-circle-outline" title="No entity records" subtitle="This run failed. Individual entity rows were not stored." />
          ) : reportedChanged === 0 && failed === 0 ? (
            <EmptyState icon="checkmark-circle-outline" title="No changes needed" subtitle="This run did not change any entities." />
          ) : (
            <EmptyState icon="albums-outline" title="No entity records" subtitle="This run has no stored entity rows." />
          )
        }
        renderItem={({ item }) => <EntityRow entity={item} currency={primaryCurrency} t={t} />}
        ListFooterComponent={
          <View style={{ marginTop: 28 }}>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              Revert and Reapply write to Amazon. They are not part of this historical record.
            </Text>
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  testID="rule-revert"
                  label={busy === "revert" ? "Reverting…" : "Revert"}
                  full
                  disabled={!id || busy != null}
                  onPress={() => runExecutionAction("revert")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  testID="rule-reapply"
                  label="Reapply"
                  full
                  disabled={!id || busy != null}
                  loading={busy === "reapply"}
                  onPress={() => runExecutionAction("reapply")}
                />
              </View>
            </View>
          </View>
        }
      />
    </SubScreen>
  );
}

const EntityRow = React.memo(function EntityRow({
  entity,
  currency,
  t,
}: {
  entity: RuleExecutionEntity;
  currency: string;
  t: ReturnType<typeof useTheme>;
}) {
  const result = entityResultLabel(entity.success, entity.old_value, entity.new_value);
  const action = describeEntityAction(entity.action_type);
  const change = formatBeforeAfter(entity.action_type, entity.old_value, entity.new_value, currency);
  const name = entity.entity_name?.trim() || null;
  const type = friendlyEntityType(entity.entity_type);
  const error = safeExecutionError(entity.error);
  const snapshot = entity.metric_snapshot && typeof entity.metric_snapshot === "object" ? entity.metric_snapshot : null;
  const context = [entity.ad_group_name, entity.campaign_name].filter(Boolean).join(" · ");
  const harvestPath =
    entity.origin_label || entity.destination_label
      ? `${entity.origin_label ?? entity.campaign_name ?? "Origin"} → ${entity.destination_label ?? entity.to_campaign_name ?? "Destination"}`
      : null;
  const resultTone = result === "Failed" ? "danger" : result === "Changed" ? "good" : "inactive";
  const spoken = [
    name ?? type,
    type,
    result,
    change ? `${action} ${change}` : action,
    error,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <View
      style={[styles.row, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}
      accessibilityRole="text"
      accessibilityLabel={spoken}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "600" }]}>
            {name ?? type}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
            {type}
            {context ? ` · ${context}` : ""}
          </Text>
        </View>
        <Text style={[t.typography.caption1, { color: toneColor(resultTone, t.colors), fontWeight: "700" }]}>{result}</Text>
      </View>
      <Text style={[t.typography.subhead, { color: t.colors.text_primary, marginTop: 8, fontWeight: "600" }]}>
        {action}
        {change ? `  ${change}` : ""}
      </Text>
      {harvestPath ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 4 }]}>{harvestPath}</Text>
      ) : null}
      {snapshot && (snapshot.acos != null || snapshot.spend != null || snapshot.orders != null) ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 6 }]}>
          At evaluation
          {snapshot.acos != null ? ` · ${formatPercent(Number(snapshot.acos))} ACoS` : ""}
          {snapshot.spend != null ? ` · ${formatCurrency(Number(snapshot.spend), currency, { compact: true })} spend` : ""}
          {snapshot.orders != null ? ` · ${Number(snapshot.orders)} orders` : ""}
        </Text>
      ) : null}
      {result === "Failed" && error ? (
        <Text style={[t.typography.caption1, { color: t.colors.tone_danger, marginTop: 6 }]}>{error}</Text>
      ) : null}
    </View>
  );
});

function Count({
  label,
  value,
  emphasize,
  t,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ flex: 1, minWidth: 72 }} accessibilityRole="text" accessibilityLabel={`${label} ${value}`}>
      <Text style={[t.typography.title3, { color: emphasize ? t.colors.tone_danger : t.colors.text_primary, fontWeight: "600" }]}>
        {value}
      </Text>
      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, minHeight: 28, justifyContent: "center" },
  counts: { flexDirection: "row", gap: 12, marginTop: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  row: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 12 },
});
