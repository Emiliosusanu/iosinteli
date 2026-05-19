import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { SectionCard, Pill } from "@/src/components/Primitives";

export default function AccountScreen() {
  const t = useTheme();
  const { user, signOut } = useAuth();
  const { profiles, selectedProfileIds, primaryCurrency, royaltyRate } = useApp();

  const onSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  return (
    <SubScreen title="Account">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View style={[styles.heroCard, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: t.colors.tone_primary + "1F" },
            ]}
          >
            <Ionicons name="person" size={28} color={t.colors.tone_primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[t.typography.title3, { color: t.colors.text_primary }]} numberOfLines={1}>
              {user?.email ?? "Guest"}
            </Text>
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
              User ID: {user?.id?.slice(0, 8) ?? "—"}
            </Text>
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <Pill label="FREE PLAN" tone="primary" />
            </View>
          </View>
        </View>

        <SectionCard title="Workspace">
          <Row label="Active profiles" value={`${selectedProfileIds.length} / ${profiles.length}`} t={t} />
          <Row label="Primary currency" value={primaryCurrency} t={t} />
          <Row label="Royalty rate" value={`${royaltyRate}%`} t={t} />
        </SectionCard>

        <SectionCard title="Plan & billing">
          <Row label="Plan" value="Free" t={t} />
          <Row label="Status" value="Active" t={t} valueColor={t.colors.tone_good} />
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>
            Upgrade to Pro for advanced automation, multi-profile pacing, and AI bid recommendations.
          </Text>
        </SectionCard>

        <TouchableOpacity
          testID="sign-out-btn"
          onPress={onSignOut}
          style={[styles.signOutBtn, { backgroundColor: t.colors.tone_danger + "1F" }]}
        >
          <Ionicons name="log-out-outline" size={18} color={t.colors.tone_danger} />
          <Text style={[t.typography.headline, { color: t.colors.tone_danger, marginLeft: 8 }]}>
            Sign out
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SubScreen>
  );
}

function Row({ label, value, valueColor, t }: { label: string; value: string; valueColor?: string; t: any }) {
  return (
    <View style={[styles.row, { borderBottomColor: t.colors.separator }]}>
      <Text style={[t.typography.body, { color: t.colors.text_secondary, flex: 1 }]}>{label}</Text>
      <Text style={[t.typography.body, { color: valueColor ?? t.colors.text_primary, fontWeight: "600" }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
});
