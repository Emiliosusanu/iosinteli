import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { type Edge } from "react-native-safe-area-context";
import { dashboard, useTheme, type Theme } from "@/src/lib/theme";

/**
 * Soft top wash used on Overview. Same Dribbble finance-dashboard
 * atmosphere on every other screen — not a new palette per page.
 * Drawn edge-to-edge (including under the status bar / Dynamic Island).
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

/**
 * Full-bleed screen shell. No top safe-area pad — chrome/headers apply
 * insets only where interactive controls need clearance under the island.
 * `edges` kept for call-site compatibility; top is intentionally ignored.
 */
export function AppScreen({
  children,
  edges: _edges = [],
  testID,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={{ flex: 1, backgroundColor: t.colors.background_primary }}
    >
      <ScreenAmbient />
      {children}
    </View>
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
