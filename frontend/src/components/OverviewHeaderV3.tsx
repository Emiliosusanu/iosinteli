import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { GlassPanel } from "@/src/components/GlassPanel";
import { SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import { motion } from "@/src/lib/motion";
import { dashboard, useReduceMotion, useTheme } from "@/src/lib/theme";

const EASE = Easing.bezier(0.23, 1, 0.32, 1);

export type OverviewHeaderV3Props = {
  profileLabel: string;
  currency: string;
  onProfilePress: () => void;
  onCurrencyPress?: () => void;
  syncColor: string;
  syncCompact: string;
  syncA11y: string;
  onSyncPress: () => void;
  periodLabel: string;
  periodLoading?: boolean;
  periodRefreshing?: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  periodMode: "month" | "week";
  onPeriodModeChange: (mode: "month" | "week") => void;
};

function SyncDot({ color, active }: { color: string; active: boolean }) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    opacity: pulse.get(),
    transform: [{ scale: 0.92 + pulse.get() * 0.08 }],
  }));

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.set(1);
      return;
    }
    pulse.set(withTiming(0.55, { duration: motion.fastState, easing: EASE }));
    const id = setInterval(() => {
      pulse.set(withTiming(pulse.get() < 1 ? 1 : 0.55, { duration: motion.fastState, easing: EASE }));
    }, motion.contentChange);
    return () => clearInterval(id);
  }, [active, pulse, reduceMotion]);

  return (
    <Animated.View style={[styles.syncDot, { backgroundColor: color }, style]} />
  );
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: "month" | "week";
  onChange: (next: "month" | "week") => void;
}) {
  const t = useTheme();
  const options = [
    { key: "month" as const, label: "Month", testID: "home-period-month" },
    { key: "week" as const, label: "Week", testID: "home-period-week" },
  ];

  return (
    <View
      testID="home-period"
      accessibilityRole="tablist"
      accessibilityLabel="Calendar period"
      style={[styles.periodRail, { backgroundColor: t.colors.background_tertiary, borderColor: t.colors.border }]}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <PressableScale
            key={option.key}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (option.key !== value) onChange(option.key);
            }}
            style={[
              styles.periodSegment,
              active && {
                backgroundColor: t.colors.background_elevated,
                borderColor: t.colors.tone_primary + "55",
              },
            ]}
          >
            <Text
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.periodLabel,
                { color: active ? t.colors.text_primary : t.colors.text_secondary },
              ]}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Compact premium Overview chrome — profile, sync, date window, period mode. */
export function OverviewHeaderV3({
  profileLabel,
  currency,
  onProfilePress,
  onCurrencyPress,
  syncColor,
  syncCompact,
  syncA11y,
  onSyncPress,
  periodLabel,
  periodLoading = false,
  periodRefreshing = false,
  canGoNext,
  onPrev,
  onNext,
  periodMode,
  onPeriodModeChange,
}: OverviewHeaderV3Props) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const periodOpacity = useSharedValue(1);
  const periodShift = useSharedValue(0);
  const periodMotion = useAnimatedStyle(() => ({
    opacity: periodOpacity.get(),
    transform: [{ translateY: periodShift.get() }],
  }));

  useEffect(() => {
    if (reduceMotion) {
      periodOpacity.set(periodLoading ? 0.72 : 1);
      periodShift.set(0);
      return;
    }
    if (periodLoading) {
      periodOpacity.set(withTiming(0.72, { duration: motion.fastState, easing: EASE }));
      periodShift.set(withTiming(1, { duration: motion.fastState, easing: EASE }));
      return;
    }
    periodOpacity.set(withTiming(1, { duration: motion.segmentTransition, easing: EASE }));
    periodShift.set(withTiming(0, { duration: motion.segmentTransition, easing: EASE }));
  }, [periodLoading, periodOpacity, periodShift, reduceMotion]);

  const dateCaption = periodLoading
    ? "Loading period"
    : periodRefreshing
      ? "Updating period"
      : periodLabel;

  return (
    <GlassPanel
      testID="home-header-v3"
      strength="chrome"
      style={[
        styles.shell,
        {
          borderColor: t.colors.glass_highlight,
        },
        t.shadow.card,
      ]}
      contentStyle={styles.shellInner}
    >
      <View style={styles.row1}>
        <PressableScale
          onPress={onProfilePress}
          accessibilityRole="button"
          accessibilityLabel={`Profiles, ${profileLabel}`}
          style={[
            styles.profileChip,
            { backgroundColor: t.colors.glass_background, borderColor: t.colors.glass_stroke },
          ]}
        >
          <SFSymbol name="building.2" size={12} color={t.colors.tone_primary} />
          <Text
            style={[styles.profileText, { color: t.colors.text_primary }]}
            numberOfLines={1}
          >
            {profileLabel}
          </Text>
          <SFSymbol name="chevron.down" size={8} color={t.colors.text_tertiary} />
        </PressableScale>

        <PressableScale
          onPress={onCurrencyPress ?? onProfilePress}
          accessibilityRole="button"
          accessibilityLabel={`Currency, ${currency}`}
          style={[
            styles.currencyChip,
            { backgroundColor: t.colors.glass_background, borderColor: t.colors.glass_stroke },
          ]}
        >
          <Text style={[styles.currencyText, { color: t.colors.text_primary }]}>{currency}</Text>
        </PressableScale>

        <PressableScale
          onPress={onSyncPress}
          accessibilityRole="button"
          accessibilityLabel={syncA11y}
          style={[
            styles.syncChip,
            { borderColor: syncColor + "44", backgroundColor: syncColor + "18" },
          ]}
        >
          <SyncDot color={syncColor} active={syncCompact === "Refreshing" || syncCompact === "Syncing"} />
          <Text style={[styles.syncText, { color: syncColor }]} numberOfLines={1}>
            {syncCompact}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.row2}>
        <View style={styles.dateRail}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Previous period"
            onPress={onPrev}
            style={styles.navHit}
          >
            <SFSymbol name="chevron.left" size={14} color={t.colors.text_secondary} />
          </PressableScale>

          <Animated.View
            style={[styles.dateCenter, periodMotion]}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`Period, ${dateCaption}`}
          >
            <Text
              style={[styles.dateLabel, { color: t.colors.text_primary }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.86}
            >
              {periodLabel}
            </Text>
            {periodLoading ? (
              <Text style={[styles.dateMeta, { color: t.colors.text_tertiary }]}>Loading…</Text>
            ) : periodRefreshing ? (
              <Text style={[styles.dateMeta, { color: t.colors.tone_primary }]}>Updating…</Text>
            ) : null}
          </Animated.View>

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Next period"
            onPress={onNext}
            disabled={!canGoNext}
            style={[styles.navHit, { opacity: canGoNext ? 1 : 0.28 }]}
          >
            <SFSymbol name="chevron.right" size={14} color={t.colors.text_secondary} />
          </PressableScale>
        </View>

        <PeriodToggle value={periodMode} onChange={onPeriodModeChange} />
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: dashboard.headerShellRadius,
    borderCurve: "continuous",
  },
  shellInner: {
    paddingHorizontal: dashboard.headerShellInset,
    paddingTop: dashboard.headerShellPadV,
    paddingBottom: dashboard.headerShellPadV,
    gap: dashboard.headerRowGap,
  },
  row1: {
    flexDirection: "row",
    alignItems: "center",
    gap: dashboard.chromeGap,
    minHeight: dashboard.headerControl,
  },
  row2: {
    flexDirection: "row",
    alignItems: "center",
    gap: dashboard.chromeGap,
    minHeight: dashboard.headerControl,
  },
  profileChip: {
    flex: 1,
    minHeight: dashboard.headerControl,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  currencyChip: {
    minHeight: dashboard.headerControl,
    minWidth: 44,
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
    letterSpacing: 0.35,
    fontVariant: ["tabular-nums"],
  },
  syncChip: {
    minHeight: dashboard.headerControl,
    maxWidth: 108,
    paddingHorizontal: 9,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  syncText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  dateRail: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  navHit: {
    width: dashboard.headerRow,
    height: dashboard.headerRow,
    alignItems: "center",
    justifyContent: "center",
  },
  dateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: dashboard.headerControl,
    paddingHorizontal: 2,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  dateMeta: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.1,
    textAlign: "center",
  },
  periodRail: {
    flexDirection: "row",
    alignItems: "center",
    padding: 2,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  periodSegment: {
    minWidth: 52,
    minHeight: dashboard.headerControl,
    paddingHorizontal: 8,
    borderRadius: dashboard.chipRadius - 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  periodLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
});
