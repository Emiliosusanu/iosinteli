import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import { PressableScale } from "@/src/components/Motion";
import { SFSymbol } from "@/src/components/ios/Native";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { layout, useReduceMotion, useTheme } from "@/src/lib/theme";

export type TargetingModeKey =
  | "keywords"
  | "asins"
  | "auto"
  | "category"
  | "placement";

/**
 * Targets mode pills — 1:1 light sample:
 * single horizontal row; active = wide blue stadium with SF Symbol + white label;
 * idle = compact soft-gray icon-only pills (no text tray wrap).
 */
export const TARGETING_MODE_OPTIONS: {
  key: TargetingModeKey;
  label: string;
  testID: string;
  symbol: SFSymbolName;
}[] = [
  { key: "keywords", label: "Keywords", testID: "segment-keywords", symbol: "key.fill" },
  { key: "asins", label: "ASINs", testID: "segment-asins", symbol: "cube" },
  { key: "auto", label: "Auto", testID: "segment-auto", symbol: "wand.and.stars" },
  { key: "category", label: "Category", testID: "segment-category", symbol: "tag" },
  { key: "placement", label: "Placement", testID: "segment-placement", symbol: "square.grid.2x2" },
];

type Props = {
  value: TargetingModeKey;
  onChange: (next: TargetingModeKey) => void;
};

export function TargetingModePills({ value, onChange }: Props) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const dark = t.scheme === "dark";
  const blue = t.colors.tone_primary;

  // Light: soft gray idle; dark: elevated soft idle. Active always solid primary blue.
  const idleBg = dark ? t.colors.background_elevated : "rgba(120,120,128,0.12)";
  const idleFg = dark ? "rgba(235,235,245,0.55)" : "rgba(60,60,67,0.55)";
  const activeBg = blue;
  const activeFg = "#FFFFFF";

  const pillH = Math.max(36, layout.minTap - 8);

  return (
    <ScrollView
      testID="targeting-segments"
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Targeting mode"
      contentContainerStyle={styles.row}
    >
      {TARGETING_MODE_OPTIONS.map((option) => {
        const active = option.key === value;
        return (
          <PressableScale
            key={option.key}
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
              styles.pill,
              active ? styles.pillActive : styles.pillIdle,
              {
                minHeight: pillH,
                backgroundColor: active ? activeBg : idleBg,
              },
            ]}
          >
            <SFSymbol
              name={option.symbol}
              size={active ? 15 : 16}
              color={active ? activeFg : idleFg}
              weight={active ? "semibold" : "regular"}
            />
            {active ? (
              <Text
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                numberOfLines={1}
                style={[
                  t.typography.footnote,
                  styles.label,
                  { color: activeFg },
                ]}
              >
                {option.label}
              </Text>
            ) : null}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
  pill: {
    borderRadius: 999,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: 6,
  },
  pillActive: {
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillIdle: {
    width: 40,
    paddingHorizontal: 0,
    paddingVertical: 9,
  },
  label: {
    fontWeight: "600",
    letterSpacing: -0.2,
  },
});
