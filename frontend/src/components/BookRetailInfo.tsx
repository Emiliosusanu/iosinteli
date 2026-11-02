import React from "react";
import { Text, View } from "react-native";
import { SFSymbol } from "./ios/Native";
import { bookRetailStockLabel, bookRetailStockTone, highestBookRetailReviewSnapshot, primaryBookRetailEdition, type BookRetailSnapshot } from "../lib/bookRetailMetadata";
import { useTheme } from "../lib/theme";

/** One compact, exact-market summary in both Books and its detail screen. */
export function BookRetailInfo({ edition, snapshot, compact = false, loading = false, activeMarketplaceCodes = [] }: {
  edition: string;
  snapshot: BookRetailSnapshot;
  compact?: boolean;
  loading?: boolean;
  activeMarketplaceCodes?: readonly string[];
}) {
  const t = useTheme();
  const listing = primaryBookRetailEdition({ asin: snapshot.asin, book_key: snapshot.asin },
    { [snapshot.asin]: snapshot }, activeMarketplaceCodes.length ? activeMarketplaceCodes : snapshot.marketplaceCode ? [snapshot.marketplaceCode] : [])?.snapshot ?? snapshot;
  const pending = listing.retailPending ?? loading;
  const reviews = highestBookRetailReviewSnapshot(listing,
    listing.marketplaceCode ? [listing.marketplaceCode] : activeMarketplaceCodes);
  const market = listing.marketplaceCode;
  const reviewMarket = reviews.marketplaceCode;
  const stockTone = bookRetailStockTone(listing.stockStatus);
  const stockLabel = listing.stockStatus ? bookRetailStockLabel(listing.stockStatus) : null;
  const color = stockTone === "good" ? t.colors.tone_good : stockTone === "danger" ? t.colors.tone_danger : t.colors.text_secondary;
  const stockDate = listing.checkedAt && Number.isFinite(Date.parse(listing.checkedAt)) ? listing.checkedAt.slice(0, 10) : null;
  const reviewsAt = reviews.reviewsCheckedAt ?? reviews.checkedAt;
  const reviewDate = reviewsAt && Number.isFinite(Date.parse(reviewsAt)) ? reviewsAt.slice(0, 10) : null;
  const reviewsKnown = reviews.rating != null || reviews.reviewCount != null;
  const reviewsLabel = reviewsKnown
    ? `${reviews.rating != null ? `${reviews.rating.toFixed(1)} stars, ` : ""}${reviews.reviewCount != null ? `${reviews.reviewCount.toLocaleString()} reviews` : "review count unavailable"}`
    : pending ? "Reviews updating" : "Reviews not listed";
  return (
    <View testID={`book-retail-${snapshot.asin}`} style={{ gap: 5, paddingVertical: compact ? 4 : 8 }} accessibilityRole="text"
      accessibilityLabel={`${edition} ${listing.asin}. ${reviewsLabel}${reviewMarket ? ` in ${reviewMarket}` : ""}${reviewDate ? `, checked ${reviewDate}` : ""}. ${stockLabel ? `Stock ${stockLabel}` : pending ? "Stock updating" : "Stock not listed"}${market ? ` in ${market}` : ""}${stockDate ? `, checked ${stockDate}` : ""}.`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessible={false}>
          {compact && reviews.rating != null ? (
            <SFSymbol name="star.fill" size={12} color="#F5A623" />
          ) : reviews.rating != null ? (
            <View style={{ flexDirection: "row", gap: 1 }}>
              {Array.from({ length: 5 }, (_, index) => <SFSymbol key={index}
                name={reviews.rating! >= index + 0.75 ? "star.fill" : reviews.rating! >= index + 0.25 ? "star.leadinghalf.filled" : "star"}
                size={12} color="#F5A623" />)}
            </View>
          ) : reviews.reviewCount != null ? <SFSymbol name="star" size={12} color="#F5A623" /> : null}
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, fontVariant: ["tabular-nums"] }]}>
            {compact && reviews.rating != null
              ? `${reviews.rating.toFixed(1)}${reviews.reviewCount != null ? ` (${reviews.reviewCount.toLocaleString()})` : ""}`
              : reviews.reviewCount != null ? reviews.reviewCount.toLocaleString() : reviews.rating != null ? reviews.rating.toFixed(1) : "Reviews —"}
            {reviewMarket && reviewMarket !== market ? ` ${reviewMarket}` : ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2,
          backgroundColor: !compact && stockLabel && stockTone !== "neutral" ? `${color}12` : "transparent" }} accessible={false}>
          {stockLabel ? <SFSymbol name={stockTone === "good" ? "checkmark.circle.fill" : stockTone === "danger" ? "exclamationmark.circle.fill" : "clock"} size={10} color={color} /> : null}
          <Text style={[t.typography.caption2, { color }]}>{stockLabel ?? "Stock —"}</Text>
        </View>
      </View>
      {!compact ? <Text style={[t.typography.caption2, { color: t.colors.text_tertiary }]}>
        {[market, `${edition} · ${listing.asin}`, reviewDate ? `Reviews ${reviewDate}` : null, stockDate ? `Stock ${stockDate}` : null].filter(Boolean).join(" · ")}
      </Text> : null}
    </View>
  );
}
