import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Switch } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { SectionCard } from "@/src/components/Primitives";

export default function SettingsScreen() {
  const t = useTheme();
  const { royaltyRate, setRoyaltyRate, primaryCurrency, notifications, setNotifications } = useApp();
  const [minBid, setMinBid] = useState("0.10");
  const [maxBid, setMaxBid] = useState("5.00");
  const [cooldown, setCooldown] = useState("24");
  const [dailyBudget, setDailyBudget] = useState("");

  return (
    <SubScreen title="Settings">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <SectionCard title="Royalty / Break-even ACOS">
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginBottom: 8 }]}>
            Royalty rate drives Net Profit and is your Break-even ACOS. Any ACOS below this value is
            profitable.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={[t.typography.title2, { color: t.colors.tone_primary, width: 70 }]}>
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

        <SectionCard title="Notifications" testID="notification-settings-card">
          <NotifRow
            icon="cart-outline"
            iconColor={t.colors.tone_good}
            label="New orders"
            description="When a new ad-attributed order comes in"
            value={notifications.newOrder}
            onChange={(v) => setNotifications({ ...notifications, newOrder: v })}
            testID="notif-new-order"
            t={t}
          />
          <NotifRow
            icon="book-outline"
            iconColor={t.colors.tone_warning}
            label="Book needs attention"
            description="ACOS exceeds break-even or sales drop sharply"
            value={notifications.bookAttention}
            onChange={(v) => setNotifications({ ...notifications, bookAttention: v })}
            testID="notif-book-attention"
            t={t}
          />
          <NotifRow
            icon="trending-up-outline"
            iconColor={t.colors.tone_danger}
            label="Campaign elevated spending"
            description="Spend exceeds daily budget threshold"
            value={notifications.campaignSpend}
            onChange={(v) => setNotifications({ ...notifications, campaignSpend: v })}
            testID="notif-campaign-spend"
            t={t}
          />
          {notifications.campaignSpend && (
            <View style={{ paddingTop: 4, paddingLeft: 36 }}>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginBottom: 4 }]}>
                Trigger above {notifications.spendThreshold}% of daily budget
              </Text>
              <Slider
                testID="notif-spend-threshold-slider"
                minimumValue={5}
                maximumValue={100}
                step={5}
                value={notifications.spendThreshold}
                onValueChange={(v) => setNotifications({ ...notifications, spendThreshold: v })}
                minimumTrackTintColor={t.colors.tone_danger}
                maximumTrackTintColor={t.colors.background_tertiary}
              />
            </View>
          )}
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

function NotifRow({
  icon,
  iconColor,
  label,
  description,
  value,
  onChange,
  testID,
  t,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
  t: any;
}) {
  return (
    <View style={[styles.notifRow, { borderBottomColor: t.colors.separator }]}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: iconColor + "1F",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{label}</Text>
        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 1 }]}>
          {description}
        </Text>
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
        thumbColor="#fff"
      />
    </View>
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
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
