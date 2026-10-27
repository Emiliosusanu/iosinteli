import React from "react";
import { Text, View } from "react-native";
import { SFSymbol } from "./ios/Native";
import { bookRetailStockLabel, bookRetailStockTone, type BookRetailSnapshot } from "../lib/bookRetailMetadata";
import { useTheme } from "../lib/theme";

export function BookRetailInfo({
  edition,
  snapshot,
  compact = false,
}: {
  edition: string;
  snapshot: BookRetailSnapshot;
  compact?: boolean;
}) {
  const t = useTheme();
  const reviewLabel = snapshot.rating != null
    ? `${snapshot.rating.toFixed(1)}${snapshot.reviewCount != null ? ` (${snapshot.reviewCount.toLocaleString()} reviews)` : ""}`
    : snapshot.reviewCount != null
      ? `${snapshot.reviewCount.toLocaleString()} reviews`
      : null;
  const stockTone = bookRetailStockTone(snapshot.stockStatus);
  const stockLabel = snapshot.stockStatus ? bookRetailStockLabel(snapshot.stockStatus) : null;
  const stockColor = stockTone === "good"
    ? t.colors.tone_good
    : stockTone === "danger"
      ? t.colors.tone_danger
      : t.colors.text_secondary;
  const checkedDate = snapshot.checkedAt && Number.isFinite(Date.parse(snapshot.checkedAt))
    ? snapshot.checkedAt.slice(0, 10)
    : null;
  const dateSuffix = checkedDate ? `, checked ${checkedDate}` : "";

  return (
    <View
      testID={`book-retail-${snapshot.asin}`}
      style={{ gap: 4, paddingVertical: compact ? 5 : 9 }}
      accessibilityRole="text"
      accessibilityLabel={`${edition} ${snapshot.asin}. ${reviewLabel ? `Amazon rating and reviews snapshot ${reviewLabel}${dateSuffix}.` : "Reviews unavailable."} ${stockLabel ? `Last reported stock ${stockLabel}${dateSuffix}.` : "Stock status unavailable."}`}
    >
      <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontWeight: "700" }]}>
        {edition} · {snapshot.asin}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {reviewLabel ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <SFSymbol name="star.fill" size={12} color="#F5A623" />
            <Text style={[t.typography.caption1, { color: t.colors.text_primary }]}>
              {reviewLabel}{snapshot.marketplaceCode ? ` · ${snapshot.marketplaceCode}` : ""}{checkedDate ? ` · ${checkedDate}` : ""}
            </Text>
          </View>
        ) : (
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Reviews unavailable</Text>
        )}
        {stockLabel ? (
          <Text style={[t.typography.caption1, { color: stockColor }]}>
            Stock snapshot: {stockLabel}{snapshot.marketplaceCode ? ` · ${snapshot.marketplaceCode}` : ""}{checkedDate ? ` · ${checkedDate}` : ""}
          </Text>
        ) : (
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary }]}>Stock unknown</Text>
        )}
      </View>
    </View>
  );
}
