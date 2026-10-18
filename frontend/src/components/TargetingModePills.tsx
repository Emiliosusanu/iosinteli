import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
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
 * inactive = gray icon-only pill. The selected slot expands for its label.
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
  const { width } = useWindowDimensions();
  const compact = width < 400;
  const reduceMotion = useReduceMotion();
  const blue = t.colors.control_selected;
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
          <View key={option.key} style={[styles.slot, active && styles.activeSlot]}>
            <PressableScale
              testID={option.testID}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              hitSlop={4}
              containerStyle={styles.touchTarget}
              onPress={() => {
                if (active) return;
                void playHaptic("select", reduceMotion);
                onChange(option.key);
              }}
              style={[
                styles.segment,
                compact && { minHeight: 40, paddingVertical: 6, paddingHorizontal: 4 },
                {
                  backgroundColor: active ? blue : idleBg,
                  borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                  borderColor: active ? "transparent" : t.colors.separator,
                  ...(active
                    ? {
                        shadowColor: blue,
                        shadowOpacity: t.scheme === "dark" ? 0.34 : 0.22,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 4 },
                        elevation: 3,
                      }
                    : null),
                },
              ]}
            >
              <SFSymbol
                name={option.symbol}
                size={compact ? 14 : active ? 15 : 16}
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
                  {option.label}
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
  touchTarget: {
    minHeight: 44,
    justifyContent: "center",
  },
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
  activeSlot: {
    flex: 2.3,
  },
  segment: {
    width: "100%",
    minHeight: 44,
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
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: "700",
    color: "#FFFFFF",
    flexShrink: 1,
    minWidth: 0,
  },
});
