import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { fetchAdGroups } from "@/src/lib/queries";
import { formatCurrency, formatInt, formatPercent } from "@/src/lib/format";
import { Pill, EmptyState, ToneDot } from "@/src/components/Primitives";

export default function AdGroupsScreen() {
  const t = useTheme();
  const { selectedProfileIds, primaryCurrency } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["ad-groups-list", selectedProfileIds],
    queryFn: () => fetchAdGroups(selectedProfileIds),
    enabled: selectedProfileIds.length > 0,
  });

  return (
    <SubScreen title="Ad Groups">
      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refetch();
                setRefreshing(false);
              }}
              tintColor={t.colors.tone_primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<EmptyState icon="layers-outline" title="No ad groups" />}
          renderItem={({ item }) => (
            <View
              testID={`ad-group-row-${item.id}`}
              style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ToneDot value={Number(item.total_acos)} />
                <Text
                  style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: 8, flex: 1, fontWeight: "600" }]}
                  numberOfLines={1}
                >
                  {item.name || item.id}
                </Text>
                <Pill
                  label={item.state || "—"}
                  tone={item.state === "enabled" ? "good" : item.state === "paused" ? "warning" : "inactive"}
                />
              </View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
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

const styles = StyleSheet.create({ card: { borderRadius: 12, padding: 14 } });
