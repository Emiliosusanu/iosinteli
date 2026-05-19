import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { fetchKeywords, fetchProductTargets } from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { Pill, EmptyState, ToneDot } from "@/src/components/Primitives";

type Segment = "keywords" | "products";

export default function TargetingScreen() {
  const t = useTheme();
  const { selectedProfileIds, primaryCurrency } = useApp();
  const [segment, setSegment] = useState<Segment>("keywords");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const keywordsQ = useQuery({
    queryKey: ["targeting-keywords", selectedProfileIds],
    queryFn: () => fetchKeywords(selectedProfileIds, { limit: 200 }),
    enabled: selectedProfileIds.length > 0 && segment === "keywords",
  });

  const productsQ = useQuery({
    queryKey: ["targeting-products", selectedProfileIds],
    queryFn: () => fetchProductTargets(selectedProfileIds, { limit: 200 }),
    enabled: selectedProfileIds.length > 0 && segment === "products",
  });

  const data =
    segment === "keywords"
      ? (keywordsQ.data ?? []).filter((k) =>
          search ? (k.keyword_text ?? "").toLowerCase().includes(search.toLowerCase()) : true,
        )
      : (productsQ.data ?? []).filter((p) =>
          search ? (p.title ?? "").toLowerCase().includes(search.toLowerCase()) : true,
        );
  const isLoading = segment === "keywords" ? keywordsQ.isLoading : productsQ.isLoading;

  const onRefresh = async () => {
    setRefreshing(true);
    if (segment === "keywords") await keywordsQ.refetch();
    else await productsQ.refetch();
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Targeting" />
        <EmptyState icon="locate-outline" title="No profile selected" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Targeting" />

      {/* Segmented Control */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.segmented, { backgroundColor: t.colors.background_tertiary }]}>
          {(["keywords", "products"] as Segment[]).map((s) => {
            const active = segment === s;
            return (
              <TouchableOpacity
                testID={`segment-${s}`}
                key={s}
                onPress={() => setSegment(s)}
                style={[
                  styles.segmentBtn,
                  active && {
                    backgroundColor: t.colors.background_secondary,
                    ...t.shadow.card,
                  },
                ]}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    t.typography.callout,
                    {
                      color: active ? t.colors.text_primary : t.colors.text_secondary,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {s === "keywords" ? "Keywords" : "Products"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.searchBar, { backgroundColor: t.colors.background_secondary, marginTop: 12 }]}>
          <Ionicons name="search" size={16} color={t.colors.text_secondary} />
          <TextInput
            testID="targeting-search"
            placeholder={segment === "keywords" ? "Search keywords" : "Search ASINs"}
            placeholderTextColor={t.colors.text_tertiary}
            style={[styles.searchInput, { color: t.colors.text_primary }]}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <EmptyState
              icon={segment === "keywords" ? "search-outline" : "cube-outline"}
              title={`No ${segment} found`}
            />
          }
          renderItem={({ item }: any) => (
            <View style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
              testID={`${segment}-row-${item.id}`}
            >
              <View style={styles.cardHeader}>
                <ToneDot value={Number(item.total_acos)} />
                <Text
                  style={[t.typography.callout, { color: t.colors.text_primary, marginLeft: 8, flex: 1, fontWeight: "600" }]}
                  numberOfLines={1}
                >
                  {segment === "keywords" ? item.keyword_text : item.title || "Product target"}
                </Text>
                {segment === "keywords" && item.match_type && (
                  <Pill label={item.match_type} tone="primary" />
                )}
                {segment === "products" && (
                  <Pill label={item.expression_type || "asin"} tone="product" />
                )}
              </View>

              <View style={[styles.metricsRow, { borderTopColor: t.colors.separator, marginTop: 10, paddingTop: 10 }]}>
                <Metric label="Bid" value={item.bid_amount || item.bid ? formatCurrency(Number(item.bid_amount || item.bid), primaryCurrency) : "—"} t={t} />
                <Metric label="Spend" value={formatCurrency(Number(item.total_spend), primaryCurrency, { compact: true })} t={t} />
                <Metric label="Sales" value={formatCurrency(Number(item.total_sales), primaryCurrency, { compact: true })} t={t} />
                <Metric label="Orders" value={formatInt(Number(item.total_orders))} t={t} />
                <Metric
                  label="ACOS"
                  value={Number(item.total_sales) > 0 ? formatPercent(Number(item.total_acos)) : "—"}
                  color={toneColor(acosTone(Number(item.total_acos)), t.colors)}
                  t={t}
                />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value, color, t }: { label: string; value: string; color?: string; t: any }) {
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
  segmented: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 10,
  },
  segmentBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 8 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  card: { borderRadius: 12, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  metricsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
});
