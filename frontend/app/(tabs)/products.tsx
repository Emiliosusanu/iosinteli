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
import { fetchProductAds } from "@/src/lib/queries";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme, acosTone, toneColor } from "@/src/lib/theme";
import { formatCurrency, formatPercent, formatInt, safeDivide } from "@/src/lib/format";
import { TopBar } from "@/src/components/TopBar";
import { Pill, EmptyState } from "@/src/components/Primitives";

type Sort = "net" | "spend" | "sales" | "acos";

export default function ProductsScreen() {
  const t = useTheme();
  const { selectedProfileIds, primaryCurrency, royaltyRate } = useApp();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("net");
  const [refreshing, setRefreshing] = useState(false);

  const { data: ads = [], isLoading, refetch } = useQuery({
    queryKey: ["products-list", selectedProfileIds],
    queryFn: () => fetchProductAds(selectedProfileIds, { limit: 300 }),
    enabled: selectedProfileIds.length > 0,
  });

  // Group product ads by ASIN, summing metrics
  const grouped = useMemo(() => {
    const map = new Map<string, any>();
    for (const ad of ads) {
      const key = ad.asin || ad.sku || ad.id;
      const existing = map.get(key) ?? {
        asin: ad.asin,
        sku: ad.sku,
        title: ad.title,
        image_url: ad.image_url,
        total_spend: 0,
        total_sales: 0,
        total_orders: 0,
        total_impressions: 0,
        total_clicks: 0,
        ad_count: 0,
        status_enabled: 0,
      };
      existing.total_spend += Number(ad.total_spend) || 0;
      existing.total_sales += Number(ad.total_sales) || 0;
      existing.total_orders += Number(ad.total_orders) || 0;
      existing.total_impressions += Number(ad.total_impressions) || 0;
      existing.total_clicks += Number(ad.total_clicks) || 0;
      existing.ad_count += 1;
      if (ad.status === "enabled") existing.status_enabled += 1;
      if (!existing.title && ad.title) existing.title = ad.title;
      if (!existing.image_url && ad.image_url) existing.image_url = ad.image_url;
      map.set(key, existing);
    }
    return Array.from(map.values()).map((p) => ({
      ...p,
      acos: safeDivide(p.total_spend, p.total_sales) * 100,
      net: p.total_sales * (royaltyRate / 100) - p.total_spend,
    }));
  }, [ads, royaltyRate]);

  const filtered = useMemo(() => {
    let arr = grouped;
    if (search) {
      arr = arr.filter(
        (p) =>
          (p.asin || "").toLowerCase().includes(search.toLowerCase()) ||
          (p.sku || "").toLowerCase().includes(search.toLowerCase()) ||
          (p.title || "").toLowerCase().includes(search.toLowerCase()),
      );
    }
    return arr.sort((a, b) => {
      switch (sort) {
        case "spend":
          return b.total_spend - a.total_spend;
        case "sales":
          return b.total_sales - a.total_sales;
        case "acos":
          return (a.acos || Infinity) - (b.acos || Infinity);
        case "net":
        default:
          return b.net - a.net;
      }
    });
  }, [grouped, search, sort]);

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
          keyExtractor={(item) => item.asin || item.sku}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.tone_primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={<EmptyState icon="cube-outline" title="No products" />}
          renderItem={({ item }) => (
            <View
              testID={`product-row-${item.asin || item.sku}`}
              style={[styles.card, { backgroundColor: t.colors.background_secondary, ...t.shadow.card }]}
            >
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    backgroundColor: t.colors.background_tertiary,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={{ width: 56, height: 56 }}
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
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" }}>
                    {item.asin && (
                      <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>
                        {item.asin}
                      </Text>
                    )}
                    <Pill
                      label={`${item.ad_count} ad${item.ad_count > 1 ? "s" : ""}`}
                      tone={item.status_enabled > 0 ? "good" : "inactive"}
                    />
                  </View>
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
                <Metric label="Spend" value={formatCurrency(item.total_spend, primaryCurrency, { compact: true })} t={t} />
                <Metric label="Sales" value={formatCurrency(item.total_sales, primaryCurrency, { compact: true })} t={t} />
                <Metric label="Orders" value={formatInt(item.total_orders)} t={t} />
                <Metric
                  label="ACOS"
                  value={item.total_sales > 0 ? formatPercent(item.acos) : "—"}
                  color={toneColor(acosTone(item.acos), t.colors)}
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
