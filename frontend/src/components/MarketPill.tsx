import React, { useMemo } from "react";
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

const MARKET_FLAG_SIZE = 21;
const MARKET_FLAG_GAP = 4;
const MAX_VISIBLE_MARKET_FLAGS = 2;

/** Separated glossy circular flag discs for a centered, readable market pill. */
export function MarketFlagStack({
  countries,
  rimColor,
  fillColor,
  textColor,
}: {
  countries: string[];
  rimColor: string;
  fillColor: string;
  textColor: string;
}) {
  const visibleCountries = countries.slice(0, MAX_VISIBLE_MARKET_FLAGS);
  const hiddenCount = Math.max(0, countries.length - visibleCountries.length);

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
            {
              marginLeft: index > 0 ? MARKET_FLAG_GAP : 0,
              zIndex: index + 1,
              borderColor: rimColor,
              backgroundColor: fillColor,
            },
          ]}
        >
          <Text style={styles.marketFlagDiscText} allowFontScaling={false} numberOfLines={1}>
            {countryFlagEmoji(code)}
          </Text>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <View
          testID="multi-country-overflow"
          style={[
            styles.marketOverflowBadge,
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
};

/**
 * Frosted glass market pill — overlapping circular flags + `US + CA • USD` + chevron.
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
}: MarketPillProps) {
  const t = useTheme();
  const resolvedCountries = sortMarketCountryCodes(countries);
  const fullLabel = formatMarketPillLabel(resolvedCountries, currency);
  const label = resolvedCountries.length > MAX_VISIBLE_MARKET_FLAGS
    ? `${resolvedCountries.length} markets${currency ? ` • ${currency}` : ""}`
    : fullLabel;
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
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={4}
      style={flex ? styles.marketPillHit : undefined}
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
        <View style={styles.marketPillInner}>
          <MarketFlagStack
            countries={resolvedCountries}
            rimColor={chrome.flagRim}
            fillColor={chrome.flagFill}
            textColor={chrome.chevron}
          />
          <Text
            style={[t.typography.footnote, styles.marketPillText, { color: chrome.label }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {label}
          </Text>
          <SFSymbol name="chevron.down" size={10} color={chrome.chevron} />
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  marketPillHit: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
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
  marketPillText: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "600",
    letterSpacing: -0.1,
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
    borderRadius: MARKET_FLAG_SIZE / 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  marketFlagDiscText: {
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center",
    includeFontPadding: false,
    transform: [{ scale: 1.05 }],
  },
  marketOverflowBadge: {
    minWidth: 28,
    height: MARKET_FLAG_SIZE,
    borderRadius: MARKET_FLAG_SIZE / 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  marketOverflowText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: -0.15,
    fontVariant: ["tabular-nums"],
  },
});
