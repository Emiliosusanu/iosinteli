import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { TopBar } from "@/src/components/TopBar";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";

const MENU: { key: string; icon: keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap; label: string; href: string; description: string }[] = [
  { key: "ad-groups", icon: "layers-outline", label: "Ad Groups", href: "/more/ad-groups", description: "Manage ad groups across campaigns" },
  { key: "negative-targeting", icon: "ban-outline", label: "Negative Targeting", href: "/more/negative-targeting", description: "Keywords & products to exclude" },
  { key: "search-terms", icon: "search-outline", label: "Search Terms", href: "/more/search-terms", description: "What customers searched for" },
  { key: "automation", icon: "flash-outline", label: "Automation", href: "/more/automation", description: "Rules and recent runs" },
  { key: "accounts", icon: "business-outline", label: "Amazon Accounts", href: "/more/accounts", description: "Connected profiles & countries" },
  { key: "settings", icon: "settings-outline", label: "Settings", href: "/more/settings", description: "Guardrails, budgets & preferences" },
  { key: "account", icon: "person-outline", label: "Account", href: "/more/account", description: "Profile, plan & sign out" },
];

export default function MoreScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { selectedProfiles } = useApp();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="More" showProfileSelector={false} showDateRange={false} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Account banner */}
        <View
          style={[
            styles.banner,
            { backgroundColor: t.colors.background_secondary, ...t.shadow.card },
          ]}
        >
          <View
            style={[
              styles.avatar,
              { backgroundColor: t.colors.tone_primary + "1F" },
            ]}
          >
            <Ionicons name="person" size={22} color={t.colors.tone_primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>
              {user?.email ?? "Guest"}
            </Text>
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
              {selectedProfiles.length} active profile{selectedProfiles.length === 1 ? "" : "s"}
            </Text>
          </View>
        </View>

        {/* Menu items */}
        <View style={{ marginTop: 12 }}>
          {MENU.map((item, idx) => (
            <TouchableOpacity
              key={item.key}
              testID={`menu-${item.key}`}
              onPress={() => router.push(item.href as any)}
              activeOpacity={0.7}
              style={[
                styles.menuRow,
                {
                  backgroundColor: t.colors.background_secondary,
                  borderTopLeftRadius: idx === 0 ? 14 : 0,
                  borderTopRightRadius: idx === 0 ? 14 : 0,
                  borderBottomLeftRadius: idx === MENU.length - 1 ? 14 : 0,
                  borderBottomRightRadius: idx === MENU.length - 1 ? 14 : 0,
                  borderBottomColor: t.colors.separator,
                  borderBottomWidth: idx === MENU.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View
                style={[
                  styles.iconBubble,
                  { backgroundColor: t.colors.tone_primary + "1F" },
                ]}
              >
                <Ionicons name={item.icon} size={18} color={t.colors.tone_primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{item.label}</Text>
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 1 }]} numberOfLines={1}>
                  {item.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.colors.text_tertiary} />
            </TouchableOpacity>
          ))}
        </View>

        <Text
          style={[
            t.typography.caption2,
            { color: t.colors.text_tertiary, textAlign: "center", marginTop: 18 },
          ]}
        >
          inteliads · v1.0 · Smart Clarity for Amazon Ads
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
