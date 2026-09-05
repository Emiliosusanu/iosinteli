import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { dashboard, useTheme } from "@/src/lib/theme";

type GlassStrength = "chrome" | "card" | "chip";

const INTENSITY: Record<"chrome", number> = {
  chrome: 48,
};

/**
 * Frosted glass panel for Overview chrome / hero / chips.
 * BlurView only for chrome (header / floating chrome) — card/chip use translucent
 * fill to avoid stacking live blurs behind scroll content.
 */
export function GlassPanel({
  children,
  strength = "card",
  style,
  testID,
  contentStyle,
}: {
  children?: React.ReactNode;
  strength?: GlassStrength;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const dark = t.scheme === "dark";
  const border = dark ? t.colors.glass_stroke : t.colors.glass_highlight;
  const fill = t.colors.glass_background;
  const wash = dark ? "rgba(18,18,20,0.28)" : "rgba(255,255,255,0.22)";
  const useLiveBlur = Platform.OS === "ios" && strength === "chrome";

  if (!useLiveBlur) {
    return (
      <View
        testID={testID}
        style={[
          styles.base,
          {
            backgroundColor: fill,
            borderColor: Platform.OS === "ios" ? border : t.colors.border,
            borderRadius: dashboard.chipRadius,
          },
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
        intensity={INTENSITY.chrome}
        tint={dark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: wash }]}
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
