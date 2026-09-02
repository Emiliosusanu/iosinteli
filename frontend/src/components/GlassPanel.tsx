import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "@/src/lib/theme";

type GlassStrength = "chrome" | "card" | "chip";

const INTENSITY: Record<GlassStrength, number> = {
  chrome: 64,
  card: 48,
  chip: 36,
};

/**
 * Frosted glass panel for Overview chrome / hero / chips.
 * iOS uses BlurView; Android falls back to translucent fill (no fake blur).
 */
export function GlassPanel({
  children,
  strength = "card",
  style,
  contentStyle,
  testID,
}: {
  children?: React.ReactNode;
  strength?: GlassStrength;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const dark = t.scheme === "dark";
  const border = dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.55)";
  const fill = dark ? t.colors.glass_background : "rgba(255,255,255,0.55)";

  if (Platform.OS !== "ios") {
    return (
      <View
        testID={testID}
        style={[
          styles.base,
          { backgroundColor: fill, borderColor: t.colors.border },
          style,
        ]}
      >
        <View style={contentStyle}>{children}</View>
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.base, { borderColor: border, overflow: "hidden" }, style]}
    >
      <BlurView
        intensity={INTENSITY[strength]}
        tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: dark ? "rgba(18,18,20,0.28)" : "rgba(255,255,255,0.22)" },
        ]}
      />
      <View style={[{ position: "relative" }, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: "continuous",
  },
});
