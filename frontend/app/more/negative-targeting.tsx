import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { fetchNegativeKeywords } from "@/src/lib/queries";
import { Pill, EmptyState } from "@/src/components/Primitives";

export default function NegativeTargetingScreen() {
  const t = useTheme();
  const { selectedProfileIds } = useApp();

  const { data = [], isLoading } = useQuery({
    queryKey: ["negative-keywords", selectedProfileIds],
    queryFn: () => fetchNegativeKeywords(selectedProfileIds),
    enabled: selectedProfileIds.length > 0,
  });

  return (
    <SubScreen title="Negative Targeting">
      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
          ListHeaderComponent={
            <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginBottom: 8 }]}>
              {data.length} negative {data.length === 1 ? "keyword" : "keywords"}
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="ban-outline"
              title="No negative keywords"
              subtitle="Negative keywords prevent ads from showing for unwanted search terms."
            />
          }
          renderItem={({ item }) => (
            <View
              testID={`neg-kw-row-${item.id}`}
              style={[styles.row, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
            >
              <Ionicons name="ban-outline" size={16} color={t.colors.tone_danger} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary }]} numberOfLines={1}>
                  {item.keyword_text}
                </Text>
                {item.match_type && (
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    {item.match_type}
                  </Text>
                )}
              </View>
              <Pill
                label={item.state || "—"}
                tone={item.state === "enabled" ? "danger" : "inactive"}
              />
            </View>
          )}
        />
      )}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
  },
});
