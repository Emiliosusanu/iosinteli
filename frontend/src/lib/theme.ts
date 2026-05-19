// Design tokens for inteliads - "Smart Clarity" theme
// Based on iOS 17/18 system colors

import { useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

export const palette = {
  light: {
    background_primary: "#F2F2F7",
    background_secondary: "#FFFFFF",
    background_tertiary: "#E5E5EA",
    background_elevated: "#FFFFFF",
    text_primary: "#000000",
    text_secondary: "#3C3C4399",
    text_tertiary: "#3C3C434D",
    text_inverse: "#FFFFFF",
    border: "#3C3C432E",
    separator: "#3C3C4329",
    tone_good: "#34C759",
    tone_warning: "#FF9500",
    tone_danger: "#FF3B30",
    tone_primary: "#007AFF",
    tone_product: "#AF52DE",
    tone_inactive: "#8E8E93",
    chart_grid: "#E5E5EA",
    glass_background: "rgba(255, 255, 255, 0.85)",
    tabbar_background: "rgba(249, 249, 249, 0.94)",
    overlay: "rgba(0,0,0,0.4)",
  },
  dark: {
    background_primary: "#000000",
    background_secondary: "#1C1C1E",
    background_tertiary: "#2C2C2E",
    background_elevated: "#2C2C2E",
    text_primary: "#FFFFFF",
    text_secondary: "#EBEBF599",
    text_tertiary: "#EBEBF54D",
    text_inverse: "#000000",
    border: "#38383A",
    separator: "#54545899",
    tone_good: "#30D158",
    tone_warning: "#FF9F0A",
    tone_danger: "#FF453A",
    tone_primary: "#0A84FF",
    tone_product: "#BF5AF2",
    tone_inactive: "#98989D",
    chart_grid: "#2C2C2E",
    glass_background: "rgba(28, 28, 30, 0.85)",
    tabbar_background: "rgba(22, 22, 23, 0.94)",
    overlay: "rgba(0,0,0,0.6)",
  },
} as const;

export type Palette = typeof palette.light;

export const typography = {
  largeTitle: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -0.4, lineHeight: 41 },
  title1: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.3, lineHeight: 34 },
  title2: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.2, lineHeight: 28 },
  title3: { fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.1, lineHeight: 25 },
  headline: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.1, lineHeight: 22 },
  body: { fontSize: 17, fontWeight: "400" as const, letterSpacing: -0.1, lineHeight: 22 },
  callout: { fontSize: 16, fontWeight: "500" as const, letterSpacing: -0.1, lineHeight: 21 },
  subhead: { fontSize: 15, fontWeight: "400" as const, letterSpacing: -0.1, lineHeight: 20 },
  footnote: { fontSize: 13, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 18 },
  caption1: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0, lineHeight: 16 },
  caption2: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
    lineHeight: 13,
  },
  metric_massive: { fontSize: 44, fontWeight: "800" as const, letterSpacing: -1, lineHeight: 50 },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  screen: 16,
  card: 16,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 9999,
};

export const shadows = {
  light: {
    card: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 6,
      elevation: 2,
    },
    floating: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 12,
      elevation: 6,
    },
  },
  dark: {
    card: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 3,
    },
    floating: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.5,
      shadowRadius: 16,
      elevation: 8,
    },
  },
};

export function useTheme() {
  const scheme = (useColorScheme() ?? "light") as ColorScheme;
  return {
    scheme,
    colors: palette[scheme],
    shadow: shadows[scheme],
    typography,
    spacing,
    radii,
  };
}

export type Theme = ReturnType<typeof useTheme>;

// ACOS tone helper: green if below target, orange near target, red above target
export function acosTone(acos: number, target = 30): "good" | "warning" | "danger" | "inactive" {
  if (!isFinite(acos) || acos === 0) return "inactive";
  if (acos < target * 0.8) return "good";
  if (acos < target * 1.1) return "warning";
  return "danger";
}

export function toneColor(tone: "good" | "warning" | "danger" | "primary" | "product" | "inactive", colors: Palette) {
  switch (tone) {
    case "good":
      return colors.tone_good;
    case "warning":
      return colors.tone_warning;
    case "danger":
      return colors.tone_danger;
    case "primary":
      return colors.tone_primary;
    case "product":
      return colors.tone_product;
    case "inactive":
    default:
      return colors.tone_inactive;
  }
}
