import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import {
  countryFlagEmoji,
  formatMarketPillLabel,
  sortMarketCountryCodes,
} from "@/src/lib/accountsUi";
import { useTheme } from "@/src/lib/theme";

const MARKET_FLAG_SIZE = 24;
const MARKET_FLAG_GAP = 3;
const MAX_VISIBLE_MARKET_FLAGS = 4;

export function marketFlagCapacity(width: number | null, compact: boolean, showLabel: boolean) {
  if (width == null) return MAX_VISIBLE_MARKET_FLAGS;
  const reserved = (compact ? 16 : 20) + 16 + (showLabel ? 58 : 0);
  const slot = (compact ? 20 : MARKET_FLAG_SIZE) + MARKET_FLAG_GAP;
  return Math.max(2, Math.min(MAX_VISIBLE_MARKET_FLAGS, Math.floor((width - reserved + MARKET_FLAG_GAP) / slot)));
}

/** Separate flag tiles preserve the full glyph; overflow always remains visible. */
export function MarketFlagStack({
  countries,
  rimColor,
  fillColor,
  textColor,
  compact = false,
  maxVisible = MAX_VISIBLE_MARKET_FLAGS,
}: {
  countries: string[];
  rimColor: string;
  fillColor: string;
  textColor: string;
  compact?: boolean;
  maxVisible?: number;
}) {
  const resolvedCountries = sortMarketCountryCodes(countries);
  const visibleLimit = resolvedCountries.length > maxVisible ? maxVisible - 1 : maxVisible;
  const visibleCountries = resolvedCountries.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, resolvedCountries.length - visibleCountries.length);

  return (
    <View
      testID="multi-country-flags"
      style={styles.marketFlagStack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visibleCountries.map((code, index) => (
        <View
          key={code}
          style={[
            styles.marketFlagDisc,
            compact && styles.compactFlagDisc,
            {
              marginLeft: index > 0 ? MARKET_FLAG_GAP : 0,
              zIndex: index + 1,
              borderColor: rimColor,
              backgroundColor: fillColor,
            },
          ]}
        >
          <Text style={[styles.marketFlagDiscText, compact && styles.compactFlagText]} allowFontScaling={false} numberOfLines={1}>
            {countryFlagEmoji(code)}
          </Text>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <View
          testID="multi-country-overflow"
          style={[
            styles.marketOverflowBadge,
            compact && styles.compactOverflowBadge,
            {
              marginLeft: MARKET_FLAG_GAP,
              borderColor: rimColor,
              backgroundColor: fillColor,
            },
          ]}
        >
          <Text style={[styles.marketOverflowText, { color: textColor }]} allowFontScaling={false} numberOfLines={1}>
            +{hiddenCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

type MarketPillProps = {
  countries: string[];
  currency: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  /** Grow/shrink like Overview header trailing (default true). */
  flex?: boolean;
  compact?: boolean;
  flagsOnly?: boolean;
};

/**
 * Shared market selector: separate flags, optional currency, full spoken context.
 * Shared by OverviewHeaderV3 and TopBar (Campaigns / Targets / Books).
 * Wash / tint / label colors follow the active light/dark scheme.
 */
export function MarketPill({
  countries,
  currency,
  onPress,
  testID,
  accessibilityLabel,
  flex = true,
  compact = false,
  flagsOnly = false,
}: MarketPillProps) {
  const t = useTheme();
  const resolvedCountries = sortMarketCountryCodes(countries);
  const fullLabel = formatMarketPillLabel(resolvedCountries, currency);
  const compactMulti = compact && resolvedCountries.length > 1;
  const label = resolvedCountries.length > 1 ? currency : fullLabel;
  const showLabel = !flagsOnly && !compactMulti && Boolean(label);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const a11y = accessibilityLabel ?? `Profiles, ${fullLabel}`;
  const chrome = useMemo(
    () => ({
      scheme: t.scheme,
      wash: t.colors.market_pill_wash,
      stroke: t.colors.market_pill_stroke,
      label: t.colors.text_primary,
      chevron: t.colors.text_secondary,
      flagRim: t.colors.market_pill_flag_rim,
      flagFill: t.colors.market_pill_flag_fill,
      blurTint:
        t.scheme === "dark"
          ? ("dark" as const)
          : ("systemChromeMaterialLight" as const),
      blurIntensity: t.scheme === "dark" ? 48 : 64,
    }),
    [t.colors, t.scheme],
  );

  return (
    <View
      style={flex ? styles.marketPillHit : undefined}
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
    >
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={4}
      containerStyle={{ minHeight: 44, justifyContent: "center" }}
      style={flex ? { width: "100%" } : undefined}
    >
      <View
        style={[
          styles.marketPill,
          {
            borderColor: chrome.stroke,
          },
        ]}
      >
        {Platform.OS === "ios" ? (
          <BlurView
            key={`market-pill-blur-${chrome.scheme}`}
            intensity={chrome.blurIntensity}
            tint={chrome.blurTint}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: chrome.wash }]}
        />
        <View style={[styles.marketPillInner, compact && styles.compactPillInner]}>
          <MarketFlagStack
            countries={resolvedCountries}
            compact={compactMulti}
            maxVisible={marketFlagCapacity(measuredWidth, compactMulti, showLabel)}
            rimColor={chrome.flagRim}
            fillColor={chrome.flagFill}
            textColor={chrome.chevron}
          />
          {showLabel ? <Text
            style={[t.typography.footnote, styles.marketPillText, { color: chrome.label }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {label}
          </Text> : null}
          <SFSymbol name="chevron.down" size={10} color={chrome.chevron} />
        </View>
      </View>
    </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  marketPillHit: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 80,
    maxWidth: "100%",
  },
  marketPill: {
    minHeight: 40,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    justifyContent: "center",
    width: "100%",
  },
  marketPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: "relative",
    minWidth: 0,
  },
  compactPillInner: {
    paddingHorizontal: 8,
    gap: 6,
  },
  marketPillText: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "600",
    letterSpacing: 0,
  },
  marketFlagStack: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  marketFlagDisc: {
    width: MARKET_FLAG_SIZE,
    height: MARKET_FLAG_SIZE,
    borderRadius: 6,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "visible",
    alignItems: "center",
    justifyContent: "center",
  },
  marketFlagDiscText: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: "center",
    includeFontPadding: false,
  },
  compactFlagDisc: {
    width: 20,
    height: 22,
    borderRadius: 5,
  },
  compactFlagText: {
    fontSize: 16,
    lineHeight: 20,
  },
  marketOverflowBadge: {
    minWidth: 24,
    height: MARKET_FLAG_SIZE,
    borderRadius: MARKET_FLAG_SIZE / 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  compactOverflowBadge: {
    minWidth: 20,
    height: 22,
    paddingHorizontal: 2,
  },
  marketOverflowText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
  },
});
