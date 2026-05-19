import React from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { fetchSearchTerms } from "@/src/lib/queries";
import { formatCurrency, formatInt, formatPercent } from "@/src/lib/format";
import { Pill, EmptyState } from "@/src/components/Primitives";

export default function SearchTermsScreen() {
  const t = useTheme();
  const { selectedProfileIds, primaryCurrency } = useApp();

  const { data = [], isLoading } = useQuery({
    queryKey: ["search-terms", selectedProfileIds],
    queryFn: () => fetchSearchTerms(selectedProfileIds, { limit: 200 }),
    enabled: selectedProfileIds.length > 0,
  });

  const onAdd = (term: string) => Alert.alert("Add Keyword", `Coming soon: add "${term}" as a keyword.`);
  const onNegate = (term: string) => Alert.alert("Negate", `Coming soon: negate "${term}".`);

  return (
    <SubScreen title="Search Terms">
      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No search terms yet"
              subtitle="Search terms are the actual queries that triggered your ads."
            />
          }
          renderItem={({ item }) => (
            <View
              testID={`search-term-row-${item.id}`}
              style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={[t.typography.callout, { color: t.colors.text_primary, flex: 1, fontWeight: "600" }]} numberOfLines={2}>
                  {item.search_term}
                </Text>
                <Pill
                  label={item.term_type || item.match_type || "—"}
                  tone={item.total_sales > 0 ? "good" : "inactive"}
                />
              </View>
              <View style={{ flexDirection: "row", marginTop: 10, gap: 8 }}>
                <MiniMetric label="Spend" value={formatCurrency(item.total_spend, primaryCurrency, { compact: true })} t={t} />
                <MiniMetric label="Sales" value={formatCurrency(item.total_sales, primaryCurrency, { compact: true })} t={t} />
                <MiniMetric label="Orders" value={formatInt(item.total_orders)} t={t} />
                <MiniMetric
                  label="ACOS"
                  value={item.total_sales > 0 ? formatPercent(Number(item.total_acos)) : "—"}
                  color={toneColor(acosTone(Number(item.total_acos)), t.colors)}
                  t={t}
                />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  testID={`search-term-add-${item.id}`}
                  onPress={() => onAdd(item.search_term)}
                  style={[styles.actionBtn, { backgroundColor: t.colors.tone_good + "1F" }]}
                >
                  <Ionicons name="add" size={14} color={t.colors.tone_good} />
                  <Text style={[t.typography.caption1, { color: t.colors.tone_good, fontWeight: "600", marginLeft: 4 }]}>
                    Add as keyword
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`search-term-negate-${item.id}`}
                  onPress={() => onNegate(item.search_term)}
                  style={[styles.actionBtn, { backgroundColor: t.colors.tone_danger + "1F" }]}
                >
                  <Ionicons name="ban" size={14} color={t.colors.tone_danger} />
                  <Text style={[t.typography.caption1, { color: t.colors.tone_danger, fontWeight: "600", marginLeft: 4 }]}>
                    Negate
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </SubScreen>
  );
}

function MiniMetric({ label, value, color, t }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label.toUpperCase()}</Text>
      <Text style={[t.typography.footnote, { color: color || t.colors.text_primary, fontWeight: "600", marginTop: 2 }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
  },
});
