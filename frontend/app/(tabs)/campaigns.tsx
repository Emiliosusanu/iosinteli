import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { fetchTopCampaignsRange } from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { Pill, EmptyState, ToneDot } from "@/src/components/Primitives";
type StateFilter = "all" | "enabled" | "paused";

export default function CampaignsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { selectedProfileIds, primaryCurrency, dateRange, royaltyRate } = useApp();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: campaigns = [], isLoading, refetch } = useQuery({
    queryKey: ["campaigns-list-range", selectedProfileIds, dateRange.start, dateRange.end, royaltyRate],
    queryFn: () =>
      fetchTopCampaignsRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate,
        limit: 500,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (stateFilter !== "all" && c.state !== stateFilter) return false;
      if (typeFilter && c.type !== typeFilter) return false;
      if (search) return c.name.toLowerCase().includes(search.toLowerCase());
      return true;
    });
  }, [campaigns, search, stateFilter, typeFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Campaigns" />
        <EmptyState icon="business-outline" title="No profile selected" subtitle="Pick an Amazon profile to view campaigns" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Campaigns" />

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.searchBar, { backgroundColor: t.colors.background_secondary }]}>
          <Ionicons name="search" size={16} color={t.colors.text_secondary} />
          <TextInput
            testID="campaigns-search"
            placeholder="Search campaigns"
            placeholderTextColor={t.colors.text_tertiary}
            style={[styles.searchInput, { color: t.colors.text_primary }]}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={t.colors.text_tertiary} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 10 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {(["all", "enabled", "paused"] as StateFilter[]).map((s) => (
            <FilterChip
              key={s}
              testID={`filter-state-${s}`}
              label={s.charAt(0).toUpperCase() + s.slice(1)}
              active={stateFilter === s}
              onPress={() => setStateFilter(s)}
            />
          ))}
          <View style={{ width: 1, backgroundColor: t.colors.separator, marginHorizontal: 4 }} />
          {["sponsoredProducts", "sponsoredBrands", "sponsoredDisplay"].map((tp) => (
            <FilterChip
              key={tp}
              testID={`filter-type-${tp}`}
              label={typeLabel(tp)}
              active={typeFilter === tp}
              onPress={() => setTypeFilter(typeFilter === tp ? null : tp)}
            />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <EmptyState icon="megaphone-outline" title="No campaigns" subtitle="Try a different filter or date range." />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`campaign-row-${item.id}`}
              activeOpacity={0.7}
              onPress={() => router.push(`/campaign/${item.id}`)}
              style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
            >
              <View style={styles.cardHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <ToneDot value={item.acos} target={royaltyRate} />
                  <Text
                    style={[t.typography.headline, { color: t.colors.text_primary, marginLeft: 8, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </View>
                <Pill
                  label={item.state || "—"}
                  tone={item.state === "enabled" ? "good" : item.state === "paused" ? "warning" : "inactive"}
                />
              </View>

              <View style={[styles.metaRow, { marginTop: 6, marginLeft: 16 }]}>
                {item.type && <Pill label={typeLabel(item.type)} tone="primary" />}
                {item.budget && (
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                    {formatCurrency(Number(item.budget), primaryCurrency, { compact: true })}/day
                  </Text>
                )}
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                  BE {royaltyRate}%
                </Text>
              </View>

              <View style={[styles.metricsRow, { borderTopColor: t.colors.separator }]}>
                <Metric label="Spend" value={formatCurrency(item.spend, primaryCurrency, { compact: true })} t={t} />
                <Metric label="Sales" value={formatCurrency(item.sales, primaryCurrency, { compact: true })} t={t} />
                <Metric label="Orders" value={formatInt(item.orders)} t={t} />
                <Metric
                  label="ACOS"
                  value={item.sales > 0 ? formatPercent(item.acos) : "—"}
                  color={toneColor(acosTone(item.acos, royaltyRate), t.colors)}
                  t={t}
                />
                <Metric
                  label="NET"
                  value={formatCurrency(item.net, primaryCurrency, { compact: true })}
                  color={item.net >= 0 ? t.colors.tone_good : t.colors.tone_danger}
                  t={t}
                />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function typeLabel(t: string) {
  switch (t) {
    case "sponsoredProducts":
      return "SP";
    case "sponsoredBrands":
      return "SB";
    case "sponsoredDisplay":
      return "SD";
    default:
      return t.toUpperCase();
  }
}

function FilterChip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: active ? t.colors.tone_primary : t.colors.background_secondary,
      }}
    >
      <Text
        style={[
          t.typography.caption1,
          {
            color: active ? "#fff" : t.colors.text_primary,
            fontWeight: "600",
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Metric({ label, value, color, t }: { label: string; value: string; color?: string; t: any }) {
  return (
    <View style={{ flex: 1, alignItems: "flex-start" }}>
      <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>{label.toUpperCase()}</Text>
      <Text style={[t.typography.callout, { color: color || t.colors.text_primary, fontWeight: "600", marginTop: 2 }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  card: { borderRadius: 14, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  metricsRow: {
    flexDirection: "row",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
