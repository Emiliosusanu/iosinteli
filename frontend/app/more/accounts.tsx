import React from "react";
import { View, Text, StyleSheet, FlatList, Switch, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { Pill, EmptyState } from "@/src/components/Primitives";

export default function AmazonAccountsScreen() {
  const t = useTheme();
  const { profiles, profilesLoading, selectedProfileIds, toggleProfile } = useApp();

  return (
    <SubScreen title="Amazon Accounts">
      {profilesLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListHeaderComponent={
            <View
              style={[
                styles.banner,
                { backgroundColor: t.colors.tone_primary + "1A", borderColor: t.colors.tone_primary + "33" },
              ]}
            >
              <Ionicons name="information-circle" size={16} color={t.colors.tone_primary} />
              <Text style={[t.typography.footnote, { color: t.colors.text_primary, marginLeft: 8, flex: 1 }]}>
                Toggle profiles to include them in dashboards & lists.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="business-outline"
              title="No accounts connected"
              subtitle="Connect an Amazon account from your inteliads web dashboard."
            />
          }
          renderItem={({ item }) => {
            const active = selectedProfileIds.includes(item.id);
            return (
              <View
                testID={`account-row-${item.profile_id}`}
                style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={[
                      styles.flagBubble,
                      { backgroundColor: t.colors.tone_primary + "1F" },
                    ]}
                  >
                    <Text style={[t.typography.caption2, { color: t.colors.tone_primary, fontWeight: "800" }]}>
                      {item.country_code || "??"}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]} numberOfLines={1}>
                      {item.nickname || item.account_name || "Amazon Profile"}
                    </Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                      {item.currency_code || "—"} · {item.account_type || "seller"} · {item.profile_id}
                    </Text>
                  </View>
                  <Switch
                    value={active}
                    onValueChange={() => toggleProfile(item.id)}
                    trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                    thumbColor="#fff"
                    testID={`account-toggle-${item.profile_id}`}
                  />
                </View>
                {item.marketplace_id && (
                  <View style={{ marginTop: 10 }}>
                    <Pill label={`Marketplace ${item.marketplace_id}`} tone="inactive" />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14 },
  flagBubble: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
});
