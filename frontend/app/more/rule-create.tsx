import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SFSymbol, sfFromIonicon } from "@/src/components/ios/Native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { createOptimizationRule, updateOptimizationRule, deleteOptimizationRule } from "@/src/lib/queries";
import { SIGN_IN_TO_MUTATE_MESSAGE, userMessageForNestError } from "@/src/lib/rulesApi";
import { EmptyState, PrimaryButton } from "@/src/components/Primitives";
import {
  RULE_ENTITIES,
  RuleEntity,
  RuleConditionInput,
  Comparison,
  COMPARISONS,
  METRIC_LABELS,
  ACTION_LABELS,
  metricsForEntity,
  actionsForEntity,
  defaultConditionFor,
  FREQUENCY_PRESETS,
  PLACEMENT_KEYS,
  PLACEMENT_MODES,
  PLACEMENT_KEY_LABELS,
  PLACEMENT_MODE_LABELS,
  MATCH_TYPE_LABELS,
  HARVEST_ACTIONS,
  isPlacementMetric,
} from "@/src/lib/ruleOptions";
import {
  formatAction,
  formatCondition,
  frequencyLabel,
  metricUnit,
  metricUnitLabel,
  metricUnitSuffix,
} from "@/src/lib/rulePresentation";
import {
  actionNeedsNumericValue,
  actionUsesValueType,
  buildRuleAction,
  buildRuleConditions,
  hydrateRuleParam,
  matchTypesForAction,
  parseLocaleNumber,
  resolveMatchType,
  resolveNegateInSource,
  resolveValueType,
} from "@/src/lib/ruleBuilderPayload";
import { getCurrencySymbol } from "@/src/lib/format";

function resolvePlacement(value: unknown): string {
  return typeof value === "string" && (PLACEMENT_KEYS as readonly string[]).includes(value)
    ? value
    : PLACEMENT_KEYS[0];
}

function resolvePlacementMode(value: unknown): string {
  return typeof value === "string" && (PLACEMENT_MODES as readonly string[]).includes(value)
    ? value
    : "set";
}

function conditionsFromRule(row: { conditions?: unknown; target_entity?: string } | null, entity: RuleEntity): RuleConditionInput[] {
  const cs = Array.isArray(row?.conditions) ? row.conditions : [];
  if (!cs.length) return [defaultConditionFor(entity)];
  return cs.map((c: any) => {
    const metric = String(c.metric ?? metricsForEntity(entity)[0]);
    return {
      metric,
      comparison: (c.comparison ?? ">") as Comparison,
      value: String(c.value ?? ""),
      days: String(c.days ?? 14),
      placement: isPlacementMetric(metric)
        ? resolvePlacement(c.placement)
        : typeof c.placement === "string"
          ? c.placement
          : undefined,
    };
  });
}

function actionValueFromRule(action: any, actionType: string): string {
  if (!actionNeedsNumericValue(actionType)) return "";
  if (HARVEST_ACTIONS.has(actionType)) return "";
  const raw = action?.value;
  return raw != null && Number.isFinite(Number(raw)) ? String(raw) : "";
}

export default function RuleCreateScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const { selectedProfileIds, selectedProfiles, primaryCurrency } = useApp();
  const queryClient = useQueryClient();
  const currencySymbol = getCurrencySymbol(primaryCurrency);

  const params = useLocalSearchParams<{ id?: string; rule?: string }>();
  const editId = typeof params.id === "string" && params.id ? params.id : undefined;
  const editing = !!editId;
  const initial = useMemo(() => {
    if (!editing || typeof params.rule !== "string") return null;
    return hydrateRuleParam(params.rule) as {
      name?: string;
      target_entity?: string;
      conditions?: unknown;
      action?: any;
      enabled?: boolean;
      check_frequency_hours?: number;
      amazon_profile_ids?: string[] | null;
    } | null;
  }, [editing, params.rule]);

  const initEntity: RuleEntity =
    initial && RULE_ENTITIES.some((e) => e.key === initial.target_entity) ? (initial.target_entity as RuleEntity) : "keyword";
  const initActionType: string = (() => {
    const a = initial?.action?.type;
    return a && actionsForEntity(initEntity).includes(a) ? a : actionsForEntity(initEntity)[0];
  })();

  const [name, setName] = useState<string>(initial?.name ?? "");
  const [entity, setEntity] = useState<RuleEntity>(initEntity);
  const [conditions, setConditions] = useState<RuleConditionInput[]>(() => conditionsFromRule(initial, initEntity));
  const [actionType, setActionType] = useState<string>(initActionType);
  const [actionValue, setActionValue] = useState<string>(() => actionValueFromRule(initial?.action, initActionType));
  const [valueType, setValueType] = useState<"percent" | "fixed">(() => resolveValueType(initial?.action));
  const [matchType, setMatchType] = useState<string>(() => resolveMatchType(initial?.action, initActionType));
  const [negateInSource, setNegateInSource] = useState<boolean>(() => resolveNegateInSource(initial?.action));
  const [placementKey, setPlacementKey] = useState<string>(() => resolvePlacement(initial?.action?.placement));
  const [placementMode, setPlacementMode] = useState<string>(() => resolvePlacementMode(initial?.action?.mode));
  const [frequency, setFrequency] = useState<number>(Number(initial?.check_frequency_hours) || 24);
  const [fieldError, setFieldError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!editing || !initial) return;
    const nextEntity: RuleEntity = RULE_ENTITIES.some((e) => e.key === initial.target_entity)
      ? (initial.target_entity as RuleEntity)
      : "keyword";
    const nextAction =
      typeof initial.action?.type === "string" && actionsForEntity(nextEntity).includes(initial.action.type)
        ? initial.action.type
        : actionsForEntity(nextEntity)[0];
    setName(typeof initial.name === "string" ? initial.name : "");
    setEntity(nextEntity);
    setConditions(conditionsFromRule(initial, nextEntity));
    setActionType(nextAction);
    setActionValue(actionValueFromRule(initial.action, nextAction));
    setValueType(resolveValueType(initial.action));
    setMatchType(resolveMatchType(initial.action, nextAction));
    setNegateInSource(resolveNegateInSource(initial.action));
    setPlacementKey(resolvePlacement(initial.action?.placement));
    setPlacementMode(resolvePlacementMode(initial.action?.mode));
    setFrequency(Number(initial.check_frequency_hours) || 24);
    setFieldError(null);
    const entityOk = RULE_ENTITIES.some((e) => e.key === initial.target_entity);
    const actionOk =
      typeof initial.action?.type === "string" && entityOk && actionsForEntity(initial.target_entity as RuleEntity).includes(initial.action.type);
    if (!entityOk || !actionOk) {
      Alert.alert("Edit on web", "This rule uses options not yet available in the app. Edit it on the web dashboard.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [editing, editId, params.rule]);

  function selectEntity(next: RuleEntity) {
    if (editing) return;
    setEntity(next);
    setConditions([defaultConditionFor(next)]);
    const nextAction = actionsForEntity(next)[0];
    setActionType(nextAction);
    setActionValue("");
    setMatchType(matchTypesForAction(nextAction)[0]);
    setNegateInSource(false);
    setPlacementKey(PLACEMENT_KEYS[0]);
    setPlacementMode("set");
    setFieldError(null);
  }

  function updateCondition(index: number, patch: Partial<RuleConditionInput>) {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function addCondition() {
    setConditions((prev) => [...prev, defaultConditionFor(entity)]);
  }
  function removeCondition(index: number) {
    setConditions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const isHarvest = HARVEST_ACTIONS.has(actionType);
  const isPlacementAdjust = actionType === "set_placement_adjustment";
  const needsValue = actionNeedsNumericValue(actionType);
  const usesValueType = actionUsesValueType(actionType);
  const harvestMatches = matchTypesForAction(actionType);
  const scopeLabel = RULE_ENTITIES.find((e) => e.key === entity)?.label ?? entity;
  const alreadyEnabled = editing && !!initial?.enabled;

  function onActionTypeChange(next: string) {
    setActionType(next);
    setActionValue("");
    setMatchType(matchTypesForAction(next)[0]);
    setNegateInSource(false);
    if (next !== "set_placement_adjustment") {
      setPlacementKey(PLACEMENT_KEYS[0]);
      setPlacementMode("set");
    }
    setFieldError(null);
  }

  const previewAction = buildRuleAction({
    actionType,
    actionValue,
    valueType,
    matchType,
    negateInSource,
    placementKey,
    placementMode,
  });
  const whenPreview = conditions.map((c) => formatCondition(c, primaryCurrency)).join(" and ");
  const thenPreview = formatAction(previewAction, primaryCurrency);
  const cadencePreview = frequencyLabel(frequency);

  const mutation = useMutation({
    mutationFn: () => {
      const builtConditions = buildRuleConditions(conditions);
      const action = buildRuleAction({
        actionType,
        actionValue,
        valueType,
        matchType,
        negateInSource,
        placementKey,
        placementMode,
      });
      if (editing && editId) {
        return updateOptimizationRule(editId, {
          name: name.trim(),
          conditions: builtConditions,
          action,
          checkFrequencyHours: frequency,
        });
      }
      return createOptimizationRule({
        name: name.trim(),
        targetEntity: entity,
        conditions: builtConditions,
        action,
        checkFrequencyHours: frequency,
        amazonProfileIds: selectedProfileIds.length ? selectedProfileIds : null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["optimization-rules"] });
      Alert.alert(
        editing ? "Rule saved" : "Rule created",
        editing
          ? alreadyEnabled
            ? "Your changes were saved. This rule stays on and can run on its next check."
            : "Your changes were saved. This rule is still off."
          : "Your rule was created and is turned OFF. Turn it on from the Rules screen when you're ready.",
        [{ text: "Done", onPress: () => router.back() }],
      );
    },
    onError: (e: unknown) =>
      Alert.alert(
        editing ? "Couldn't save rule" : "Couldn't create rule",
        userMessageForNestError(e, "Please try again."),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteOptimizationRule(editId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["optimization-rules"] });
      router.back();
    },
    onError: (e: unknown) =>
      Alert.alert("Couldn't delete rule", userMessageForNestError(e, "Please try again.")),
  });

  function confirmDelete() {
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return;
    }
    Alert.alert("Delete rule?", `This permanently removes “${name.trim() || "this rule"}”.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  }

  function validateAndSubmit() {
    if (mutation.isPending) return;
    if (guestMode) {
      Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
      return;
    }
    if (!user?.id) return Alert.alert("Not signed in", "Sign in to create rules.");
    if (!editing && selectedProfileIds.length === 0) {
      setFieldError("Connect an Amazon account before creating a rule.");
      return Alert.alert("No account connected", "Connect an Amazon account before creating a rule.");
    }
    if (!name.trim()) {
      setFieldError("Give your rule a short name.");
      return Alert.alert("Name needed", "Give your rule a short name.");
    }
    for (const c of conditions) {
      if (!Number.isFinite(parseLocaleNumber(c.value))) {
        setFieldError("Each condition needs a number value.");
        return Alert.alert("Check conditions", "Each condition needs a number value.");
      }
      const d = parseLocaleNumber(c.days);
      if (!Number.isFinite(d) || d < 1 || d > 90) {
        setFieldError("Lookback must be between 1 and 90 days.");
        return Alert.alert("Check conditions", "Days must be between 1 and 90.");
      }
      if (isPlacementMetric(c.metric) && !c.placement) {
        setFieldError("Pick a placement for each placement condition.");
        return Alert.alert("Placement needed", "Pick a placement for each placement condition.");
      }
    }
    if (isPlacementAdjust) {
      const n = parseLocaleNumber(actionValue);
      if (!Number.isFinite(n) || n < 0 || n > 900) {
        setFieldError("Placement adjustment must be between 0 and 900 percent.");
        return Alert.alert("Action value needed", "Placement adjustment must be between 0 and 900.");
      }
    } else if (needsValue && !(parseLocaleNumber(actionValue) > 0)) {
      setFieldError(
        usesValueType && valueType === "percent"
          ? "Enter a percent greater than 0."
          : `Enter an amount greater than 0 ${currencySymbol}.`,
      );
      return Alert.alert("Action value needed", "Enter a value greater than 0 for this action.");
    }
    setFieldError(null);
    mutation.mutate();
  }

  const entityMetrics = metricsForEntity(entity);
  const entityActions = actionsForEntity(entity);
  const scopeSingular: Record<RuleEntity, string> = {
    campaign: "campaign",
    ad_group: "ad group",
    keyword: "keyword",
    product_target: "product target",
    auto_targeting: "auto target",
    search_term: "search term",
  };
  const scopeEvery = `every ${scopeSingular[entity]}`;
  const notOne = `not one selected ${scopeSingular[entity]}`;
  const savedProfileIds = Array.isArray(initial?.amazon_profile_ids)
    ? initial.amazon_profile_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const captionIds = editing ? savedProfileIds : selectedProfileIds;
  const namedProfiles = captionIds
    .map((id) => selectedProfiles.find((p) => p.id === id || p.profile_id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const accountCaption = (() => {
    if (editing && captionIds.length === 0) {
      return `Applies to the accounts saved on this rule. Matches ${scopeEvery} in those accounts, ${notOne}.`;
    }
    if (captionIds.length === 1) {
      const name =
        namedProfiles[0]?.nickname || namedProfiles[0]?.account_name || (editing ? "1 account saved on this rule" : "1 selected account");
      return `Applies to ${name}. Matches ${scopeEvery} in that account, ${notOne}.`;
    }
    const countLabel = editing
      ? `${captionIds.length} accounts saved on this rule`
      : `${captionIds.length} selected account${captionIds.length === 1 ? "" : "s"}`;
    return `Applies to ${countLabel}. Matches ${scopeEvery} in those accounts, ${notOne}.`;
  })();

  if (editing && !initial) {
    return (
      <SubScreen title="Edit rule">
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't open this rule"
          subtitle="The rule details didn't load. Go back to Rules and open it again."
          action={{ label: "Back to Rules", onPress: () => router.back() }}
        />
      </SubScreen>
    );
  }

  return (
    <SubScreen title={editing ? "Edit rule" : "New rule"}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={88}>
        <ScrollView
          contentContainerStyle={{ padding: t.layout.pagePad, paddingBottom: t.layout.tabClearance + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Field label="Rule name" hint="Required. This is how the rule appears on the list." t={t}>
            <TextInput
              testID="rule-name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Pause keywords spending without sales"
              placeholderTextColor={t.colors.text_tertiary}
              accessibilityLabel="Rule name"
              style={[styles.input, { color: t.colors.text_primary, backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}
            />
          </Field>

          <Field
            label="What it watches"
            hint={editing ? "Scope is locked while editing." : "Changing scope clears conditions and the action."}
            t={t}
          >
            {editing ? (
              <View
                style={[
                  styles.entityChip,
                  { alignSelf: "flex-start", minHeight: t.layout.minTap, backgroundColor: t.colors.tone_primary, borderColor: t.colors.tone_primary },
                ]}
                accessibilityRole="text"
                accessibilityLabel={`Scope ${scopeLabel}. Locked while editing.`}
              >
                <SFSymbol name={sfFromIonicon(RULE_ENTITIES.find((e) => e.key === entity)?.icon ?? "options-outline")} size={15} color={t.colors.text_inverse} />
                <Text style={[t.typography.subhead, { fontWeight: "600", color: t.colors.text_inverse }]}>{scopeLabel}</Text>
              </View>
            ) : (
              <View style={styles.entityGrid}>
                {RULE_ENTITIES.map((e) => {
                  const active = entity === e.key;
                  return (
                    <TouchableOpacity
                      key={e.key}
                      testID={`rule-entity-${e.key}`}
                      onPress={() => selectEntity(e.key)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={e.label}
                      style={[
                        styles.entityChip,
                        { minHeight: t.layout.minTap },
                        active
                          ? { backgroundColor: t.colors.tone_primary, borderColor: t.colors.tone_primary }
                          : { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border },
                      ]}
                    >
                      <SFSymbol name={sfFromIonicon(e.icon)} size={15} color={active ? t.colors.text_inverse : t.colors.text_secondary} />
                      <Text style={[t.typography.subhead, { fontWeight: "600", color: active ? t.colors.text_inverse : t.colors.text_primary }]}>
                        {e.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>{accountCaption}</Text>
          </Field>

          <Field label="When all of these are true" hint="Every condition must match (AND)." t={t}>
            <View style={{ gap: 10 }}>
              {conditions.map((c, i) => {
                const unit = metricUnit(c.metric);
                const suffix = metricUnitSuffix(c.metric, primaryCurrency);
                return (
                  <View key={i} style={[styles.card, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>
                        Condition {i + 1}
                      </Text>
                      {conditions.length > 1 ? (
                        <TouchableOpacity
                          onPress={() => removeCondition(i)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove condition ${i + 1}`}
                          style={{ minWidth: t.layout.minTap, minHeight: t.layout.minTap, alignItems: "center", justifyContent: "center" }}
                        >
                          <SFSymbol name="xmark.circle.fill" size={22} color={t.colors.text_secondary} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Chips
                      options={entityMetrics}
                      value={c.metric}
                      onChange={(v) =>
                        updateCondition(i, {
                          metric: v,
                          placement: isPlacementMetric(v) ? c.placement || PLACEMENT_KEYS[0] : undefined,
                        })
                      }
                      labelFn={(m) => METRIC_LABELS[m] ?? m}
                      t={t}
                    />
                    {isPlacementMetric(c.metric) ? (
                      <View style={{ marginTop: 10 }}>
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700", marginBottom: 6 }]}>
                          PLACEMENT
                        </Text>
                        <Chips
                          options={[...PLACEMENT_KEYS]}
                          value={c.placement || PLACEMENT_KEYS[0]}
                          onChange={(v) => updateCondition(i, { placement: v })}
                          labelFn={(p) => PLACEMENT_KEY_LABELS[p] ?? p}
                          testIDPrefix={`rule-condition-${i}-placement`}
                          wrap
                          t={t}
                        />
                      </View>
                    ) : null}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
                      <View style={{ flex: 1.3 }}>
                        <Chips
                          options={COMPARISONS as unknown as string[]}
                          value={c.comparison}
                          onChange={(v) => updateCondition(i, { comparison: v as Comparison })}
                          wrap
                          t={t}
                        />
                      </View>
                      <TextInput
                        value={c.value}
                        onChangeText={(v) => updateCondition(i, { value: v })}
                        keyboardType="decimal-pad"
                        placeholder={unit === "percent" ? "35" : unit === "money" ? "12.00" : "10"}
                        placeholderTextColor={t.colors.text_tertiary}
                        accessibilityLabel={`${METRIC_LABELS[c.metric] ?? c.metric} threshold, ${metricUnitLabel(c.metric, primaryCurrency)}`}
                        style={[styles.miniInput, { color: t.colors.text_primary, backgroundColor: t.colors.background_tertiary }]}
                      />
                      {suffix ? (
                        <Text style={[t.typography.subhead, { color: t.colors.text_secondary, fontWeight: "700", minWidth: 18 }]}>{suffix}</Text>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                      <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>over the last</Text>
                      <TextInput
                        value={c.days}
                        onChangeText={(v) => updateCondition(i, { days: v })}
                        keyboardType="number-pad"
                        accessibilityLabel="Lookback days"
                        style={[styles.miniInput, { width: 72, color: t.colors.text_primary, backgroundColor: t.colors.background_tertiary }]}
                      />
                      <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>days</Text>
                    </View>
                    <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>
                      When {formatCondition(c, primaryCurrency)}
                    </Text>
                  </View>
                );
              })}
              <TouchableOpacity
                onPress={addCondition}
                style={[styles.addRow, { minHeight: t.layout.minTap }]}
                accessibilityRole="button"
                accessibilityLabel="Add condition"
              >
                <SFSymbol name="plus.circle" size={18} color={t.colors.tone_primary} />
                <Text style={[t.typography.callout, { color: t.colors.tone_primary, fontWeight: "600" }]}>Add condition</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label="Then" hint="The action that runs when every condition matches." t={t}>
            <Chips
              options={entityActions}
              value={actionType}
              onChange={onActionTypeChange}
              labelFn={(a) => ACTION_LABELS[a] ?? a}
              wrap
              t={t}
            />
            {isHarvest ? (
              <View style={{ marginTop: 10, gap: 10 }}>
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>MATCH TYPE</Text>
                <Chips
                  options={[...harvestMatches]}
                  value={harvestMatches.includes(matchType) ? matchType : harvestMatches[0]}
                  onChange={setMatchType}
                  labelFn={(m) => MATCH_TYPE_LABELS[m] ?? m}
                  testIDPrefix="rule-match-type"
                  wrap
                  t={t}
                />
                <View style={[styles.switchRow, { minHeight: t.layout.minTap }]}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]}>Also negate source</Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                      After adding, also negate it in the source ad group.
                    </Text>
                  </View>
                  <Switch
                    testID="rule-negate-source"
                    value={negateInSource}
                    onValueChange={setNegateInSource}
                    accessibilityLabel="Also negate source"
                    trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                    ios_backgroundColor={t.colors.background_tertiary}
                  />
                </View>
              </View>
            ) : null}
            {isPlacementAdjust ? (
              <View style={{ marginTop: 10, gap: 10 }}>
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>PLACEMENT</Text>
                <Chips
                  options={[...PLACEMENT_KEYS]}
                  value={placementKey}
                  onChange={setPlacementKey}
                  labelFn={(p) => PLACEMENT_KEY_LABELS[p] ?? p}
                  testIDPrefix="rule-placement"
                  wrap
                  t={t}
                />
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>MODE</Text>
                <Chips
                  options={[...PLACEMENT_MODES]}
                  value={placementMode}
                  onChange={setPlacementMode}
                  labelFn={(m) => PLACEMENT_MODE_LABELS[m] ?? m}
                  testIDPrefix="rule-placement-mode"
                  wrap
                  t={t}
                />
              </View>
            ) : null}
            {needsValue ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <TextInput
                  value={actionValue}
                  onChangeText={setActionValue}
                  keyboardType="decimal-pad"
                  placeholder={
                    isPlacementAdjust
                      ? "0–900"
                      : usesValueType && valueType === "percent"
                        ? "10"
                        : "0.65"
                  }
                  placeholderTextColor={t.colors.text_tertiary}
                  accessibilityLabel={
                    isPlacementAdjust
                      ? "Placement adjustment, percent"
                      : usesValueType && valueType === "percent"
                        ? `${ACTION_LABELS[actionType] ?? actionType}, percent`
                        : `${ACTION_LABELS[actionType] ?? actionType}, ${primaryCurrency}`
                  }
                  style={[styles.miniInput, { flexGrow: 1, minWidth: 88, color: t.colors.text_primary, backgroundColor: t.colors.background_tertiary }]}
                />
                {isPlacementAdjust || (usesValueType && valueType === "percent") ? (
                  <Text style={[t.typography.subhead, { color: t.colors.text_secondary, fontWeight: "700" }]}>%</Text>
                ) : (
                  <Text style={[t.typography.subhead, { color: t.colors.text_secondary, fontWeight: "700" }]}>{currencySymbol}</Text>
                )}
                {usesValueType ? (
                  <View style={{ flexGrow: 1, minWidth: 160 }}>
                    <Chips
                      options={["percent", "fixed"]}
                      value={valueType}
                      onChange={(v) => setValueType(v as "percent" | "fixed")}
                      labelFn={(v) => (v === "percent" ? "% percent" : `${currencySymbol} amount`)}
                      wrap
                      t={t}
                    />
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>
                This action does not use an amount.
              </Text>
            )}
          </Field>

          <Field label="Check every" hint="How often the rule evaluates. Not a cooldown after a change." t={t}>
            <Chips
              options={FREQUENCY_PRESETS.map((f) => String(f.hours))}
              value={String(frequency)}
              onChange={(v) => setFrequency(Number(v))}
              labelFn={(h) => frequencyLabel(Number(h)) ?? `${h}h`}
              wrap
              t={t}
            />
          </Field>

          <View style={[styles.review, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.border }]}>
            <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]}>Review</Text>
            {whenPreview ? (
              <Text style={[t.typography.subhead, { color: t.colors.text_primary, marginTop: 6 }]}>When {whenPreview}</Text>
            ) : null}
            {thenPreview ? (
              <Text style={[t.typography.subhead, { color: t.colors.text_primary, marginTop: 2, fontWeight: "600" }]}>
                Then {thenPreview}
              </Text>
            ) : null}
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 6 }]}>
              {[scopeLabel, cadencePreview].filter(Boolean).join(" · ")}
            </Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]}>{accountCaption}</Text>
          </View>

          {!editing ? (
            <View style={[styles.note, { backgroundColor: t.colors.tone_warning + "14", borderColor: t.colors.tone_warning + "33", marginTop: 10 }]}>
              <SFSymbol name="checkmark.shield" size={16} color={t.colors.tone_warning} />
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, flex: 1, marginLeft: 8, lineHeight: 18 }]}>
                New rules start <Text style={{ fontWeight: "700", color: t.colors.text_primary }}>off</Text>. Review it, then enable it from the Rules screen before it changes any bids or budgets.
              </Text>
            </View>
          ) : (
            <View style={[styles.note, { backgroundColor: alreadyEnabled ? t.colors.tone_warning + "14" : t.colors.background_secondary, borderColor: alreadyEnabled ? t.colors.tone_warning + "33" : t.colors.border, marginTop: 10 }]}>
              <SFSymbol name={alreadyEnabled ? "exclamationmark.triangle" : "pause.circle"} size={16} color={alreadyEnabled ? t.colors.tone_warning : t.colors.text_secondary} />
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, flex: 1, marginLeft: 8, lineHeight: 18 }]}>
                {alreadyEnabled
                  ? "This rule is on. Saving updates the configuration and leaves it on."
                  : "This rule is off. Saving updates the configuration and leaves it off."}
              </Text>
            </View>
          )}

          {fieldError ? (
            <Text style={[t.typography.footnote, { color: t.colors.tone_danger, marginTop: 12 }]} accessibilityLiveRegion="polite">
              {fieldError}
            </Text>
          ) : null}

          <View style={{ marginTop: 18 }}>
            <PrimaryButton
              label={editing ? "Save changes" : "Create rule (off)"}
              icon={editing ? "checkmark" : "add"}
              onPress={validateAndSubmit}
              loading={mutation.isPending}
              full
              testID="create-rule-submit"
            />
          </View>

          {editing ? (
            <TouchableOpacity
              onPress={confirmDelete}
              disabled={deleteMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${name.trim() || "rule"}`}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, minHeight: t.layout.minTap }}
            >
              <SFSymbol name="trash" size={17} color={t.colors.tone_danger} />
              <Text style={[t.typography.headline, { color: t.colors.tone_danger }]}>
                {deleteMutation.isPending ? "Deleting…" : "Delete rule"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SubScreen>
  );
}

function Field({
  label,
  hint,
  children,
  t,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={[t.typography.footnote, { color: t.colors.text_secondary, fontWeight: "700", marginBottom: hint ? 4 : 8, marginLeft: 2 }]}>
        {label.toUpperCase()}
      </Text>
      {hint ? (
        <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginBottom: 8, marginLeft: 2 }]}>{hint}</Text>
      ) : null}
      {children}
    </View>
  );
}

function Chips({
  options,
  value,
  onChange,
  labelFn,
  testIDPrefix,
  wrap,
  t,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  labelFn?: (v: string) => string;
  testIDPrefix?: string;
  wrap?: boolean;
  t: ReturnType<typeof useTheme>;
}) {
  const items = options.map((opt) => {
    const active = opt === value;
    return (
      <TouchableOpacity
        key={opt}
        testID={testIDPrefix ? `${testIDPrefix}-${opt}` : undefined}
        onPress={() => onChange(opt)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={labelFn ? labelFn(opt) : opt}
        style={[
          styles.optChip,
          { minHeight: t.layout.minTap },
          active ? { backgroundColor: t.colors.tone_primary } : { backgroundColor: t.colors.background_tertiary },
        ]}
      >
        <Text style={[t.typography.subhead, { fontWeight: "600", color: active ? t.colors.text_inverse : t.colors.text_primary }]}>
          {labelFn ? labelFn(opt) : opt}
        </Text>
      </TouchableOpacity>
    );
  });

  if (wrap) {
    return <View style={styles.chipWrap}>{items}</View>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 1, alignItems: "center" }}>
      {items}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  miniInput: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    textAlign: "center",
    minWidth: 70,
  },
  entityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  entityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  optChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, justifyContent: "center" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2 },
  note: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 6 },
  review: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 6 },
  switchRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
});
