import React from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { dashboard, useTheme, type Theme } from "@/src/lib/theme";

/**
 * Soft top wash used on Overview. Same Dribbble finance-dashboard
 * atmosphere on every other screen — not a new palette per page.
 */
export function ScreenAmbient() {
  const t = useTheme();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[t.colors.ambient_top, t.colors.ambient_mid, t.colors.background_primary]}
      locations={[0, 0.28, 0.55]}
      style={StyleSheet.absoluteFill}
    />
  );
}

export function AppScreen({
  children,
  edges = ["top"],
  testID,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
  testID?: string;
}) {
  const t = useTheme();
  return (
    <SafeAreaView
      testID={testID}
      style={{ flex: 1, backgroundColor: t.colors.background_primary }}
      edges={edges}
    >
      <ScreenAmbient />
      {children}
    </SafeAreaView>
  );
}

/** Shared card chrome: continuous corners, hairline glass stroke, soft lift. */
export function elevatedCardStyle(t: Theme): ViewStyle {
  return {
    backgroundColor: t.colors.background_secondary,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.glass_stroke,
    ...t.shadow.card,
    // Subtle lift so dense list rows still read as glass cards.
    shadowOpacity: Math.min(0.14, (t.shadow.card as { shadowOpacity?: number }).shadowOpacity ?? 0.1),
  };
}

/** Overview header chips / filter buttons / secondary actions. */
export function glassControlStyle(t: Theme, active = false): ViewStyle {
  return {
    backgroundColor: active ? t.colors.tone_primary + "18" : t.colors.glass_background,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: active ? t.colors.tone_primary + "55" : t.colors.glass_stroke,
  };
}
