// Design tokens for inteliads - "Smart Clarity" theme
// Based on iOS 17/18 system colors

import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, useColorScheme, type TextStyle } from "react-native";
import { motion } from "./motion";
export { motion };

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
    tone_placement: "#D12B6F",
    tone_inactive: "#8E8E93",
    chart_grid: "#E5E5EA",
    glass_background: "rgba(255, 255, 255, 0.62)",
    glass_stroke: "rgba(255, 255, 255, 0.55)",
    glass_highlight: "rgba(255, 255, 255, 0.72)",
    tabbar_background: "rgba(249, 249, 249, 0.72)",
    overlay: "rgba(0,0,0,0.4)",
    ambient_top: "#E8F1FF",
    ambient_mid: "#F2F2F7",
  },
  dark: {
    background_primary: "#000000",
    background_secondary: "#121214",
    background_tertiary: "#1C1C1F",
    background_elevated: "#1A1A1D",
    text_primary: "#F5F5F7",
    text_secondary: "#A1A1A6",
    text_tertiary: "#6C6C70",
    text_inverse: "#000000",
    border: "#2A2A2E",
    separator: "#2A2A2E",
    tone_good: "#3DDC84",
    tone_warning: "#FF9F0A",
    tone_danger: "#FF453A",
    tone_primary: "#2F7CFF",
    tone_product: "#8B7CFF",
    tone_placement: "#FF375F",
    tone_inactive: "#8E8E93",
    chart_grid: "#1C1C1F",
    glass_background: "rgba(22, 22, 26, 0.72)",
    glass_stroke: "rgba(255, 255, 255, 0.10)",
    glass_highlight: "rgba(255, 255, 255, 0.14)",
    tabbar_background: "rgba(10, 10, 12, 0.72)",
    overlay: "rgba(0,0,0,0.6)",
    ambient_top: "#0A1220",
    ambient_mid: "#000000",
  },
} as const;

export type Palette = (typeof palette)[ColorScheme];

const appFontFamily = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: undefined,
});

const fontBase = appFontFamily ? { fontFamily: appFontFamily } : {};
const tabularNums: TextStyle["fontVariant"] = ["tabular-nums"];
const metricFontBase = appFontFamily
  ? { fontFamily: appFontFamily, fontVariant: tabularNums }
  : { fontVariant: tabularNums };

export const typography = {
  largeTitle: { ...fontBase, fontSize: 34, fontWeight: "600" as const, letterSpacing: 0.4, lineHeight: 41 },
  title1: { ...fontBase, fontSize: 28, fontWeight: "600" as const, letterSpacing: 0, lineHeight: 34 },
  title2: { ...fontBase, fontSize: 22, fontWeight: "600" as const, letterSpacing: 0, lineHeight: 28 },
  title3: { ...fontBase, fontSize: 20, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 25 },
  headline: { ...fontBase, fontSize: 17, fontWeight: "600" as const, letterSpacing: 0, lineHeight: 22 },
  body: { ...fontBase, fontSize: 17, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 22 },
  callout: { ...fontBase, fontSize: 16, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 21 },
  subhead: { ...fontBase, fontSize: 15, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 20 },
  footnote: { ...fontBase, fontSize: 13, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 18 },
  caption1: { ...fontBase, fontSize: 12, fontWeight: "400" as const, letterSpacing: 0, lineHeight: 16 },
  caption2: { ...fontBase, fontSize: 11, fontWeight: "500" as const, letterSpacing: 0.4, lineHeight: 13 },
  /** Hero money figure — Dribbble fintech dashboards lead with a large tabular numeral. */
  metric_massive: { ...metricFontBase, fontSize: 34, fontWeight: "700" as const, letterSpacing: -0.9, lineHeight: 40 },
  metric: { ...metricFontBase, fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.2, lineHeight: 25 },
  metric_compact: { ...metricFontBase, fontSize: 15, fontWeight: "600" as const, letterSpacing: -0.1, lineHeight: 20 },
  sectionTitle: { ...fontBase, fontSize: 16, fontWeight: "600" as const, letterSpacing: -0.2, lineHeight: 21 },
  meta: { ...fontBase, fontSize: 12, fontWeight: "500" as const, letterSpacing: 0, lineHeight: 16 },
};

export const spacing = {
  xxs: 2,
  xs: 4,
  tight: 6,
  sm: 8,
  md: 12,
  lg: 16,
  section: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  screen: 16,
  card: 16,
};

export const radii = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 16,
  xl: 16,
  sheet: 16,
  pill: 9999,
};

export const layout = {
  pagePad: 16,
  filterPadTop: 8,
  filterGap: 8,
  listGap: 5,
  tabClearance: 108,
  minTap: 44,
  headerTitleSize: 17,
  rowAccent: 4,
  chartHero: 160,
  coverWidth: 52,
  coverHeight: 70,
};

/** One Home/Dashboard grid. Screens must not invent 16/18/20/22 independently.
 *  Radii / padding tuned toward Dribbble finance-dashboard iOS cards (soft
 *  continuous corners, airy padding) while staying SF System + HIG-native. */
export const dashboard = {
  pageInset: 16,
  sectionGap: 14,
  cardPadding: 16,
  /** Dense list rows (Targets / Campaigns) — aim ~8–9 visible on iPhone. */
  denseCardPadding: 10,
  compactGap: 8,
  metricGap: 12,
  cardRadius: 20,
  chipRadius: 12,
  metricChipRadius: 14,
  controlHeight: 32,
  headerRow: 44,
  iconSm: 16,
  iconMd: 18,
  iconLg: 22,
  iconEmpty: 28,
  iconStroke: 1.75,
  /** Overview V2 chrome denser than legacy sticky stack. */
  chromeGap: 8,
  accentEdge: 2,
  /** Overview header V3 — two-row compact control bar. */
  headerShellRadius: 18,
  headerShellInset: 10,
  headerShellPadV: 8,
  headerRowGap: 6,
  headerControl: 36,
} as const;

export const shadows = {
  light: {
    card: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 12,
      elevation: 2,
    },
    hero: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
      elevation: 4,
    },
    floating: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 14,
      elevation: 6,
    },
  },
  dark: {
    card: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 3,
    },
    hero: {
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.45,
      shadowRadius: 22,
      elevation: 5,
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
    layout,
    dashboard,
    motion,
  };
}

export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduce(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
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

export function placementColor(key: "top_of_search" | "product_pages" | "rest_of_search" | string, colors: Palette) {
  if (key === "product_pages") return colors.tone_placement;
  if (key === "top_of_search") return colors.tone_warning;
  return colors.tone_good;
}
