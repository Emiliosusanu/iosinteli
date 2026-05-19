import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput } from "react-native";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { SectionCard } from "@/src/components/Primitives";
import Slider from "@react-native-community/slider";

export default function SettingsScreen() {
  const t = useTheme();
  const { royaltyRate, setRoyaltyRate, primaryCurrency } = useApp();
  const [minBid, setMinBid] = useState("0.10");
  const [maxBid, setMaxBid] = useState("5.00");
  const [cooldown, setCooldown] = useState("24");
  const [dailyBudget, setDailyBudget] = useState("");
  const [targetAcos, setTargetAcos] = useState("30");

  return (
    <SubScreen title="Settings">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <SectionCard title="Royalty / Margin">
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: 8 }]}>
            Used to compute Net Profit. Royalty rate is the % of Sales you keep before ad spend.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[t.typography.title2, { color: t.colors.tone_primary, width: 60 }]}>
              {royaltyRate}%
            </Text>
            <View style={{ flex: 1 }}>
              <Slider
                testID="royalty-rate-slider"
                minimumValue={10}
                maximumValue={100}
                step={1}
                value={royaltyRate}
                onValueChange={setRoyaltyRate}
                minimumTrackTintColor={t.colors.tone_primary}
                maximumTrackTintColor={t.colors.background_tertiary}
              />
            </View>
          </View>
        </SectionCard>

        <SectionCard title="Bid guardrails">
          <FormRow t={t} label="Min bid">
            <TextInput
              testID="min-bid-input"
              value={minBid}
              onChangeText={setMinBid}
              keyboardType="decimal-pad"
              style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.border }]}
            />
          </FormRow>
          <FormRow t={t} label="Max bid">
            <TextInput
              testID="max-bid-input"
              value={maxBid}
              onChangeText={setMaxBid}
              keyboardType="decimal-pad"
              style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.border }]}
            />
          </FormRow>
          <FormRow t={t} label="Cooldown (h)">
            <TextInput
              testID="cooldown-input"
              value={cooldown}
              onChangeText={setCooldown}
              keyboardType="number-pad"
              style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.border }]}
            />
          </FormRow>
        </SectionCard>

        <SectionCard title="Budgets">
          <FormRow t={t} label={`Daily budget (${primaryCurrency})`}>
            <TextInput
              testID="daily-budget-input"
              value={dailyBudget}
              onChangeText={setDailyBudget}
              placeholder="Optional"
              placeholderTextColor={t.colors.text_tertiary}
              keyboardType="decimal-pad"
              style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.border }]}
            />
          </FormRow>
          <FormRow t={t} label="Target ACOS (%)">
            <TextInput
              testID="target-acos-input"
              value={targetAcos}
              onChangeText={setTargetAcos}
              keyboardType="decimal-pad"
              style={[styles.input, { color: t.colors.text_primary, borderColor: t.colors.border }]}
            />
          </FormRow>
        </SectionCard>

        <SectionCard title="Preferences">
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
            Theme follows system settings. Currency, timezone and anomaly thresholds will be customizable in future updates.
          </Text>
        </SectionCard>
      </ScrollView>
    </SubScreen>
  );
}

function FormRow({ label, children, t }: { label: string; children: React.ReactNode; t: any }) {
  return (
    <View style={styles.row}>
      <Text style={[t.typography.body, { color: t.colors.text_primary, flex: 1 }]}>{label}</Text>
      <View style={{ width: 110 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  input: {
    height: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    textAlign: "right",
    fontSize: 15,
  },
});
