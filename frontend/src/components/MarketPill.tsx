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
const MARKET_FLAG_OVERLAP = -7;

/** Overlapping glossy circular flag discs for the market pill. */
export function MarketFlagStack({
  countries,
  rimColor,
  fillColor,
}: {
  countries: string[];
  rimColor: string;
  fillColor: string;
}) {
  return (
    <View
      testID="multi-country-flags"
      style={styles.marketFlagStack}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {countries.map((code, index) => (
        <View
          key={code}
          style={[
            styles.marketFlagDisc,
            {
              marginLeft: index > 0 ? MARKET_FLAG_OVERLAP : 0,
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
  const label = formatMarketPillLabel(resolvedCountries, currency);
  const a11y = accessibilityLabel ?? `Profiles, ${label}`;
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
});
