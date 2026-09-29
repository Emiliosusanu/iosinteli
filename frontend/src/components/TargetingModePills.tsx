import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import { PressableScale } from "@/src/components/Motion";
import { SFSymbol } from "@/src/components/ios/Native";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { useReduceMotion, useTheme } from "@/src/lib/theme";

export type TargetingModeKey =
  | "keywords"
  | "asins"
  | "auto"
  | "category"
  | "placement";

/**
 * Targeting mode control — Amazon-style capsules:
 * selected = solid brand-blue pill with white icon+label;
 * inactive = gray pill, icon only. Five equal slots fill the row.
 */
export const TARGETING_MODE_OPTIONS: {
  key: TargetingModeKey;
  label: string;
  shortLabel: string;
  testID: string;
  symbol: SFSymbolName;
}[] = [
  { key: "keywords", label: "Keywords", shortLabel: "Keys", testID: "segment-keywords", symbol: "key.fill" },
  { key: "asins", label: "ASINs", shortLabel: "ASINs", testID: "segment-asins", symbol: "cube.fill" },
  { key: "auto", label: "Auto", shortLabel: "Auto", testID: "segment-auto", symbol: "wand.and.stars" },
  { key: "category", label: "Category", shortLabel: "Cat", testID: "segment-category", symbol: "tag.fill" },
  { key: "placement", label: "Placement", shortLabel: "Place", testID: "segment-placement", symbol: "square.grid.2x2.fill" },
];

type Props = {
  value: TargetingModeKey;
  onChange: (next: TargetingModeKey) => void;
};

export function TargetingModePills({ value, onChange }: Props) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const blue = t.colors.tone_primary;
  const idleBg = t.colors.background_tertiary;
  const idleFg = t.colors.text_secondary;

  return (
    <View
      testID="targeting-segments"
      accessibilityRole="tablist"
      accessibilityLabel="Targeting mode"
      style={styles.track}
    >
      {TARGETING_MODE_OPTIONS.map((option) => {
        const active = option.key === value;
        return (
          // flex must live outside PressableScale — layout styles sit on an inner Animated.View.
          <View key={option.key} style={styles.slot}>
            <PressableScale
              testID={option.testID}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              hitSlop={4}
              onPress={() => {
                if (active) return;
                void playHaptic("select", reduceMotion);
                onChange(option.key);
              }}
              style={[
                styles.segment,
                {
                  backgroundColor: active ? blue : idleBg,
                },
              ]}
            >
              <SFSymbol
                name={option.symbol}
                size={active ? 15 : 16}
                color={active ? "#FFFFFF" : idleFg}
                weight={active ? "semibold" : "regular"}
              />
              {active ? (
                <Text
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  style={styles.label}
                >
                  {option.shortLabel}
                </Text>
              ) : null}
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "100%",
    gap: 6,
    backgroundColor: "transparent",
    minHeight: 40,
  },
  slot: {
    flex: 1,
    minWidth: 0,
  },
  segment: {
    width: "100%",
    minHeight: 40,
    borderRadius: 999,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  label: {
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: -0.2,
    fontWeight: "700",
    color: "#FFFFFF",
    flexShrink: 1,
    minWidth: 0,
  },
});
