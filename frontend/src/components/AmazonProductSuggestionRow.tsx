import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BookCover } from "@/src/components/BookCover";
import { Pill } from "@/src/components/Primitives";
import {
  displaySuggestionTitle,
  formatSuggestionBidDisplay,
  humanizeAmazonTheme,
  normalizeProductMatchType,
  primaryThemeLabel,
  productMatchSelectLabel,
  type BidMode,
} from "@/src/lib/amazonCampaignSuggestions";
import { formatCurrency } from "@/src/lib/format";
import { isExactMatchType } from "@/src/lib/targeting";
import { radii, spacing, useTheme } from "@/src/lib/theme";

function SelectMark({ selected }: { selected: boolean }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.mark,
        {
          borderColor: selected ? t.colors.tone_primary : t.colors.separator,
          backgroundColor: selected
            ? t.colors.tone_primary
            : t.colors.background_secondary,
        },
      ]}
    >
      {selected ? (
        <Text style={[styles.markCheck, { color: t.colors.text_inverse }]}>✓</Text>
      ) : null}
    </View>
  );
}

export function AmazonProductSuggestionRow({
  asin,
  title,
  subtitle,
  coverUrl,
  themes,
  matchType,
  selected,
  suggestedBid,
  defaultBid,
  currency,
  bidMode,
  customBidText,
  useSuggestedBids = true,
  titleLoading = false,
  onToggle,
  onBidModeChange,
  onCustomBidChange,
}: {
  asin: string;
  title: string | null;
  subtitle?: string | null;
  coverUrl: string | null;
  themes: string[];
  matchType?: string | null;
  selected: boolean;
  suggestedBid: number | null;
  defaultBid: number;
  currency?: string | null;
  bidMode: BidMode;
  customBidText: string;
  useSuggestedBids?: boolean;
  titleLoading?: boolean;
  /** @deprecated Suggestion rows no longer show stock — prop ignored. */
  stockStatus?: unknown;
  onToggle: () => void;
  onBidModeChange: (mode: BidMode) => void;
  onCustomBidChange: (text: string) => void;
}) {
  const t = useTheme();
  const primary = primaryThemeLabel(themes);
  const productMatch = normalizeProductMatchType(matchType);
  const exact = isExactMatchType(productMatch);
  const extraThemes = (themes ?? [])
    .slice(1)
    .map((theme) => humanizeAmazonTheme(theme).label)
    .filter(Boolean);
  const customParsed = Number(String(customBidText).replace(",", "."));
  const bidLabel = formatSuggestionBidDisplay({
    mode: bidMode,
    customBid: Number.isFinite(customParsed) ? customParsed : null,
    suggestedBid,
    defaultBid,
    useSuggestedBids,
    currency,
  });
  const amazonSuggestCaption =
    bidMode === "default" &&
    !useSuggestedBids &&
    suggestedBid != null &&
    Number.isFinite(suggestedBid)
      ? `Amazon suggested ${formatCurrency(suggestedBid, currency)}`
      : null;
  const displayTitle =
    titleLoading && !title
      ? "Loading title…"
      : displaySuggestionTitle(title, asin);
  const bookSubtitle = String(subtitle ?? "").trim();
  const titleMuted =
    displayTitle === "Title unavailable" || displayTitle === "Loading title…";

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected
            ? t.colors.background_secondary
            : t.colors.background_tertiary,
          borderColor: selected ? t.colors.tone_primary : t.colors.separator,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <SelectMark selected={selected} />
      <BookCover uri={coverUrl} asin={asin} size="xs" recyclingKey={asin} />
      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[
            t.typography.callout,
            {
              color: titleMuted
                ? t.colors.text_tertiary
                : t.colors.text_primary,
              fontWeight: "700",
              letterSpacing: -0.2,
            },
          ]}
        >
          {displayTitle}
        </Text>
        {bookSubtitle ? (
          <Text
            numberOfLines={1}
            style={[
              t.typography.caption1,
              { color: t.colors.text_secondary, marginTop: 2 },
            ]}
          >
            {bookSubtitle}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text
            style={[
              t.typography.caption2,
              {
                color: t.colors.text_tertiary,
                fontVariant: ["tabular-nums"],
                fontWeight: "500",
              },
            ]}
          >
            {asin}
          </Text>
          <View
            style={[
              styles.matchPill,
              {
                backgroundColor: exact
                  ? `${t.colors.tone_primary}14`
                  : t.colors.background_secondary,
                borderColor: exact
                  ? `${t.colors.tone_primary}40`
                  : t.colors.separator,
              },
            ]}
          >
            <Text
              style={[
                t.typography.caption2,
                {
                  color: exact ? t.colors.tone_primary : t.colors.text_secondary,
                  fontWeight: exact ? "700" : "600",
                },
              ]}
            >
              {productMatchSelectLabel(productMatch)}
            </Text>
          </View>
          <Pill label={primary.label} tone="inactive" size="sm" />
          {extraThemes.slice(0, 1).map((label) => (
            <Pill key={label} label={label} tone="inactive" size="sm" />
          ))}
        </View>
        <View style={styles.bidRow} onStartShouldSetResponder={() => true}>
          <Pressable
            onPress={() => onBidModeChange("default")}
            style={[
              styles.bidMode,
              {
                backgroundColor:
                  bidMode === "default"
                    ? `${t.colors.tone_primary}18`
                    : t.colors.background_secondary,
                borderColor:
                  bidMode === "default" ? t.colors.tone_primary : t.colors.separator,
              },
            ]}
          >
            <Text
              style={[
                t.typography.caption1,
                {
                  color:
                    bidMode === "default"
                      ? t.colors.tone_primary
                      : t.colors.text_secondary,
                  fontWeight: "600",
                },
              ]}
            >
              Default
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onBidModeChange("custom")}
            style={[
              styles.bidMode,
              {
                backgroundColor:
                  bidMode === "custom"
                    ? `${t.colors.tone_primary}18`
                    : t.colors.background_secondary,
                borderColor:
                  bidMode === "custom" ? t.colors.tone_primary : t.colors.separator,
              },
            ]}
          >
            <Text
              style={[
                t.typography.caption1,
                {
                  color:
                    bidMode === "custom"
                      ? t.colors.tone_primary
                      : t.colors.text_secondary,
                  fontWeight: "600",
                },
              ]}
            >
              Custom
            </Text>
          </Pressable>
          {bidMode === "custom" ? (
            <TextInput
              value={customBidText}
              onChangeText={onCustomBidChange}
              keyboardType="decimal-pad"
              placeholder={defaultBid.toFixed(2)}
              placeholderTextColor={t.colors.text_tertiary}
              style={[
                t.typography.caption1,
                styles.bidInput,
                {
                  color: t.colors.text_primary,
                  borderColor: t.colors.separator,
                  backgroundColor: t.colors.background_secondary,
                },
              ]}
            />
          ) : (
            <Text
              style={[
                t.typography.caption1,
                {
                  color: useSuggestedBids
                    ? t.colors.tone_primary
                    : t.colors.text_secondary,
                  fontVariant: ["tabular-nums"],
                  fontWeight: useSuggestedBids ? "600" : "500",
                  flexShrink: 1,
                },
              ]}
              numberOfLines={2}
            >
              {bidLabel}
            </Text>
          )}
        </View>
        {amazonSuggestCaption ? (
          <Text
            style={[
              t.typography.caption2,
              {
                color: t.colors.text_tertiary,
                marginTop: 4,
                fontVariant: ["tabular-nums"],
              },
            ]}
            numberOfLines={1}
          >
            {amazonSuggestCaption} · not applied
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    borderCurve: "continuous",
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  markCheck: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14,
  },
  body: { flex: 1, minWidth: 0 },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  matchPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  bidRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: spacing.sm,
  },
  bidMode: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  bidInput: {
    minWidth: 64,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    fontVariant: ["tabular-nums"],
  },
});
