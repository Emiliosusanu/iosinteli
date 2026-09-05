import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { InteliAdsIcon, type InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { GlassPanel } from "@/src/components/GlassPanel";
import { SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import { dashboard, useTheme, type Theme } from "@/src/lib/theme";

type SurfaceTone = "standard" | "attention" | "success" | "hero";

export function dashboardSurfaceStyle(t: Theme, tone: SurfaceTone = "standard"): ViewStyle {
  const elevated = tone === "hero";
  return {
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    // Shadow only on hero — stacking card shadows behind scroll is compositor-heavy.
    ...(elevated ? t.shadow.hero : null),
  };
}

export function DashboardSurface({
  children,
  tone = "standard",
  style,
  testID,
}: {
  children: React.ReactNode;
  tone?: SurfaceTone;
  style?: ViewStyle;
  testID?: string;
}) {
  const t = useTheme();
  const elevated = tone === "hero";
  return (
    <GlassPanel
      testID={testID}
      strength="card"
      style={[
        dashboardSurfaceStyle(t, tone),
        {
          borderColor: elevated ? t.colors.glass_highlight : t.colors.glass_stroke,
        },
        style,
      ]}
      contentStyle={{
        padding: elevated ? dashboard.cardPadding : dashboard.denseCardPadding + 4,
      }}
    >
      {children}
    </GlassPanel>
  );
}

/** Overview V2 card title — icon alone, no tinted well. */
export function OverviewCardHeader({
  title,
  icon,
  actionLabel,
  onAction,
  action,
  actionTestID,
}: {
  title: string;
  icon?: InteliAdsIconName;
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
  actionTestID?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      {icon ? <InteliAdsIcon name={icon} size={dashboard.iconMd} color={t.colors.text_secondary} /> : null}
      <Text
        style={[t.typography.sectionTitle, { color: t.colors.text_primary, flex: 1 }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {action
        ? action
        : actionLabel && onAction
          ? (
            <PressableScale
              testID={actionTestID}
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              style={styles.action}
            >
              <Text style={[t.typography.meta, { color: t.colors.tone_primary }]}>{actionLabel}</Text>
              <SFSymbol name="chevron.right" size={11} color={t.colors.tone_primary} />
            </PressableScale>
          )
          : null}
    </View>
  );
}

/** Compact operating chrome: profile · currency · freshness. */
export function OverviewTopRow({
  profileLabel,
  currency,
  onProfilePress,
  onCurrencyPress,
  syncColor,
  syncCompact,
  syncA11y,
  onSyncPress,
}: {
  profileLabel: string;
  currency: string;
  onProfilePress: () => void;
  onCurrencyPress?: () => void;
  syncColor: string;
  syncCompact: string;
  syncA11y: string;
  onSyncPress: () => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.topRow}>
      <PressableScale
        onPress={onProfilePress}
        accessibilityRole="button"
        accessibilityLabel={`Profiles, ${profileLabel}`}
        style={[styles.profileChip, { borderColor: t.colors.border, backgroundColor: t.colors.background_tertiary }]}
      >
        <SFSymbol name="building.2" size={12} color={t.colors.tone_primary} />
        <Text style={[styles.profileText, { color: t.colors.text_primary }]} numberOfLines={1}>
          {profileLabel}
        </Text>
        <SFSymbol name="chevron.down" size={8} color={t.colors.text_tertiary} />
      </PressableScale>
      <PressableScale
        onPress={onCurrencyPress ?? onProfilePress}
        accessibilityRole="button"
        accessibilityLabel={`Currency, ${currency}`}
        style={[styles.currencyChip, { borderColor: t.colors.border, backgroundColor: t.colors.background_tertiary }]}
      >
        <Text style={[styles.currencyText, { color: t.colors.text_primary }]}>{currency}</Text>
      </PressableScale>
      <PressableScale
        onPress={onSyncPress}
        accessibilityRole="button"
        accessibilityLabel={syncA11y}
        style={[styles.syncChip, { borderColor: syncColor + "44", backgroundColor: syncColor + "14" }]}
      >
        <View style={[styles.dot, { backgroundColor: syncColor }]} />
        <Text style={[t.typography.caption2, { color: syncColor, flexShrink: 1 }]} numberOfLines={1}>
          {syncCompact}
        </Text>
      </PressableScale>
    </View>
  );
}

export function OverviewDateNav({
  periodLabel,
  canGoNext,
  onPrev,
  onNext,
}: {
  periodLabel: string;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.dateNav}>
      <PressableScale onPress={onPrev} accessibilityRole="button" accessibilityLabel="Previous period" style={styles.dateArrow}>
        <SFSymbol name="chevron.left" size={16} color={t.colors.text_primary} />
      </PressableScale>
      <View style={styles.dateCenter}>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
          {periodLabel}
        </Text>
      </View>
      <PressableScale
        onPress={onNext}
        disabled={!canGoNext}
        accessibilityRole="button"
        accessibilityLabel="Next period"
        accessibilityState={{ disabled: !canGoNext }}
        style={styles.dateArrow}
      >
        <SFSymbol name="chevron.right" size={16} color={canGoNext ? t.colors.text_primary : t.colors.text_tertiary} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: dashboard.compactGap,
    minHeight: 28,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: dashboard.headerRow,
    paddingHorizontal: 4,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileChip: {
    flex: 1,
    minHeight: dashboard.headerRow,
    paddingHorizontal: 10,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  profileText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  currencyChip: {
    minHeight: dashboard.headerRow,
    paddingHorizontal: 10,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  currencyText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  syncChip: {
    minHeight: dashboard.headerRow,
    minWidth: dashboard.headerRow,
    paddingHorizontal: 10,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 132,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: dashboard.headerRow,
    gap: 4,
  },
  dateArrow: {
    width: dashboard.headerRow,
    height: dashboard.headerRow,
    alignItems: "center",
    justifyContent: "center",
  },
  dateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
