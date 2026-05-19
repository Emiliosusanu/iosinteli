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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { fetchTopBooksRange } from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { EmptyState } from "@/src/components/Primitives";

type Sort = "net" | "spend" | "sales" | "acos";

export default function ProductsScreen() {
  const t = useTheme();
  const { selectedProfileIds, primaryCurrency, royaltyRate, dateRange } = useApp();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("net");
  const [refreshing, setRefreshing] = useState(false);

  const { data: books = [], isLoading, refetch } = useQuery({
    queryKey: ["products-range", selectedProfileIds, dateRange.start, dateRange.end, royaltyRate],
    queryFn: () =>
      fetchTopBooksRange({
        profileIds: selectedProfileIds,
        start: dateRange.start,
        end: dateRange.end,
        royaltyRate,
        limit: 300,
      }),
    enabled: selectedProfileIds.length > 0,
  });

  const filtered = useMemo(() => {
    let arr = books;
    if (search) {
      arr = arr.filter(
        (p) =>
          (p.asin || "").toLowerCase().includes(search.toLowerCase()) ||
          (p.sku || "").toLowerCase().includes(search.toLowerCase()) ||
          (p.title || "").toLowerCase().includes(search.toLowerCase()),
      );
    }
    return [...arr].sort((a, b) => {
      switch (sort) {
        case "spend":
          return b.spend - a.spend;
        case "sales":
          return b.sales - a.sales;
        case "acos":
          return (a.acos || Infinity) - (b.acos || Infinity);
        case "net":
        default:
          return b.net - a.net;
      }
    });
  }, [books, search, sort]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (selectedProfileIds.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
        <TopBar title="Products" />
        <EmptyState icon="cube-outline" title="No profile selected" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <TopBar title="Products" />

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.searchBar, { backgroundColor: t.colors.background_secondary }]}>
          <Ionicons name="search" size={16} color={t.colors.text_secondary} />
          <TextInput
            testID="products-search"
            placeholder="Search ASIN, SKU, title"
            placeholderTextColor={t.colors.text_tertiary}
            style={[styles.searchInput, { color: t.colors.text_primary }]}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
          {(["net", "spend", "sales", "acos"] as Sort[]).map((s) => {
            const active = sort === s;
            return (
              <TouchableOpacity
                key={s}
                testID={`product-sort-${s}`}
                onPress={() => setSort(s)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 12,
                  backgroundColor: active ? t.colors.tone_primary : t.colors.background_secondary,
                }}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    { color: active ? "#fff" : t.colors.text_primary, fontWeight: "600" },
                  ]}
                >
                  {s.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={t.colors.tone_primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.asin || item.sku || "x"}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="No book performance in range"
              subtitle="Try a longer date range or different profile filter."
            />
          }
          renderItem={({ item }) => {
            const tone = acosTone(item.acos, item.breakeven_acos);
            return (
              <View
                testID={`product-row-${item.asin || item.sku}`}
                style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
              >
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View
                    style={{
                      width: 56,
                      height: 72,
                      borderRadius: 8,
                      backgroundColor: t.colors.background_tertiary,
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {item.image_url ? (
                      <Image
                        source={{ uri: item.image_url }}
                        style={{ width: 56, height: 72 }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons name="book-outline" size={24} color={t.colors.text_tertiary} />
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[t.typography.callout, { color: t.colors.text_primary, fontWeight: "700" }]}
                      numberOfLines={2}
                    >
                      {item.title || item.asin || item.sku}
                    </Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                      No. {item.asin || item.sku || "—"}
                    </Text>
                    <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
                      Break-even ACOS {item.breakeven_acos.toFixed(0)}%
                    </Text>
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[
                        t.typography.headline,
                        { color: item.net >= 0 ? t.colors.tone_good : t.colors.tone_danger },
                      ]}
                    >
                      {formatCurrency(item.net, primaryCurrency, { compact: true })}
                    </Text>
                    <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>NET</Text>
                  </View>
                </View>

                <View style={[styles.metricsRow, { borderTopColor: t.colors.separator, marginTop: 12, paddingTop: 12 }]}>
                  <Metric label="Spend" value={formatCurrency(item.spend, primaryCurrency, { compact: true })} t={t} />
                  <Metric label="Sales" value={formatCurrency(item.sales, primaryCurrency, { compact: true })} t={t} />
                  <Metric label="Orders" value={formatInt(item.orders)} t={t} />
                  <Metric
                    label="ACOS"
                    value={item.sales > 0 ? formatPercent(item.acos) : "—"}
                    color={toneColor(tone, t.colors)}
                    t={t}
                  />
                </View>
              </View>
            );
          }}
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
  metricsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
});
