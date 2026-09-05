import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { GlassPanel } from "@/src/components/GlassPanel";
import { IOSDateField, SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import { formatDateRangeLabel, rangePresets } from "@/src/lib/format";
import { motion } from "@/src/lib/motion";
import { dashboard, density, layout, useReduceMotion, useTheme } from "@/src/lib/theme";
import type { DateRange } from "@/src/lib/types";

const EASE = Easing.bezier(0.23, 1, 0.32, 1);

export type OverviewPeriodMode = "day" | "week" | "month" | "custom";

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
  periodMode: OverviewPeriodMode;
  onPeriodModeChange: (mode: OverviewPeriodMode) => void;
  /** Opens custom range; when omitted, date center is non-interactive for custom. */
  dateRange?: DateRange;
  onCustomRange?: (range: DateRange) => void;
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
      cancelAnimation(pulse);
      pulse.set(1);
      return;
    }
    // Keep the pulse on the UI runtime — setInterval + withTiming crossed the JS bridge each beat.
    pulse.set(1);
    pulse.set(
      withRepeat(withTiming(0.55, { duration: motion.fastState, easing: EASE }), -1, true),
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [active, pulse, reduceMotion]);

  return (
    <Animated.View style={[styles.syncDot, { backgroundColor: color }, style]} />
  );
}

function PeriodToggle({
  value,
  onChange,
  onCustomPress,
}: {
  value: OverviewPeriodMode;
  onChange: (next: OverviewPeriodMode) => void;
  onCustomPress?: () => void;
}) {
  const t = useTheme();
  const options: { key: OverviewPeriodMode; label: string; testID: string }[] = [
    { key: "day", label: "Day", testID: "home-period-day" },
    { key: "week", label: "Week", testID: "home-period-week" },
    { key: "month", label: "Month", testID: "home-period-month" },
    { key: "custom", label: "Custom", testID: "home-period-custom" },
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
              if (option.key === "custom") {
                onCustomPress?.();
                return;
              }
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
                t.typography.caption1,
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

function CustomRangeSheet({
  visible,
  dateRange,
  onClose,
  onPick,
}: {
  visible: boolean;
  dateRange: DateRange;
  onClose: () => void;
  onPick: (range: DateRange) => void;
}) {
  const t = useTheme();
  const presets = rangePresets();
  const presetEntries: { key: string; range: DateRange }[] = [
    { key: "today", range: presets.today },
    { key: "yesterday", range: presets.yesterday },
    { key: "last7", range: presets.last7 },
    { key: "last30", range: presets.last30 },
    { key: "thisMonth", range: presets.thisMonth },
  ];
  const [customStart, setCustomStart] = useState(dateRange.start);
  const [customEnd, setCustomEnd] = useState(dateRange.end);

  useEffect(() => {
    if (visible) {
      setCustomStart(dateRange.start);
      setCustomEnd(dateRange.end);
    }
  }, [visible, dateRange.start, dateRange.end]);

  const body = (
    <>
      <View style={styles.sheetHeader}>
        <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Custom range</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
        {presetEntries.map((preset) => {
          const selected = preset.range.start === dateRange.start && preset.range.end === dateRange.end;
          return (
            <TouchableOpacity
              key={preset.key}
              testID={`home-custom-preset-${preset.key}`}
              style={[styles.presetRow, { borderBottomColor: t.colors.separator }]}
              onPress={() => onPick(preset.range)}
              activeOpacity={0.6}
            >
              <View style={{ flex: 1 }}>
                <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{preset.range.label}</Text>
                <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                  {formatDateRangeLabel(preset.range)}
                </Text>
              </View>
              {selected ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
            </TouchableOpacity>
          );
        })}
        <View style={[styles.presetRow, { borderBottomWidth: 0, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
          <Text style={[t.typography.body, { color: t.colors.text_primary }]}>Dates</Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <IOSDateField testID="home-custom-start" label="From" value={customStart} onChange={setCustomStart} />
            </View>
            <View style={{ flex: 1 }}>
              <IOSDateField testID="home-custom-end" label="To" value={customEnd} onChange={setCustomEnd} />
            </View>
          </View>
          <TouchableOpacity
            testID="home-custom-apply"
            onPress={() => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) return;
              if (customStart > customEnd) return;
              onPick({ start: customStart, end: customEnd, label: "Custom" });
            }}
            style={[styles.applyCustom, { backgroundColor: t.colors.tone_primary }]}
          >
            <Text style={[t.typography.callout, { color: t.colors.text_inverse, fontWeight: "600" }]}>Apply</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
      transparent={Platform.OS !== "ios"}
      onRequestClose={onClose}
    >
      {Platform.OS === "ios" ? (
        <View style={[styles.sheetFill, { backgroundColor: t.colors.background_secondary }]}>{body}</View>
      ) : (
        <Pressable style={[styles.modalOverlay, { backgroundColor: t.colors.overlay }]} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
            onPress={(e) => e.stopPropagation()}
          >
            {body}
          </Pressable>
        </Pressable>
      )}
    </Modal>
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
  dateRange,
  onCustomRange,
}: OverviewHeaderV3Props) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const [customOpen, setCustomOpen] = useState(false);
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

  const syncBusy = syncCompact === "Refreshing" || syncCompact === "Syncing";
  const syncNeedsLabel =
    syncBusy || syncCompact === "Failed" || syncCompact === "Stale" || syncCompact === "Sync";
  const insets = useSafeAreaInsets();
  const canCustom = !!onCustomRange && !!dateRange;

  return (
    <View style={{ paddingTop: Math.max(insets.top, 4) }}>
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
            hitSlop={4}
            style={[
              styles.profileChip,
              { backgroundColor: t.colors.glass_background, borderColor: t.colors.glass_stroke },
            ]}
          >
            <SFSymbol name="building.2" size={12} color={t.colors.tone_primary} />
            <Text
              style={[t.typography.footnote, styles.profileText, { color: t.colors.text_primary }]}
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
            hitSlop={4}
            style={[
              styles.currencyChip,
              { backgroundColor: t.colors.glass_background, borderColor: t.colors.glass_stroke },
            ]}
          >
            <Text style={[t.typography.caption1, styles.currencyText, { color: t.colors.text_primary }]}>
              {currency}
            </Text>
          </PressableScale>

          <PressableScale
            onPress={onSyncPress}
            accessibilityRole="button"
            accessibilityLabel={syncA11y}
            hitSlop={6}
            style={[
              styles.syncChip,
              syncNeedsLabel ? styles.syncChipWide : styles.syncChipDot,
              { borderColor: syncColor + "44", backgroundColor: syncColor + "18" },
            ]}
          >
            <SyncDot color={syncColor} active={syncBusy} />
            {syncNeedsLabel ? (
              <Text style={[t.typography.caption2, styles.syncText, { color: syncColor }]} numberOfLines={1}>
                {syncCompact}
              </Text>
            ) : null}
          </PressableScale>
        </View>

        <View style={styles.row2}>
          <View style={styles.dateRail}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Previous period"
              onPress={onPrev}
              disabled={periodMode === "custom"}
              style={[styles.navHit, periodMode === "custom" && { opacity: 0.28 }]}
            >
              <SFSymbol name="chevron.left" size={14} color={t.colors.text_secondary} />
            </PressableScale>

            <Animated.View
              style={[styles.dateCenter, periodMotion]}
              accessible
              accessibilityRole="header"
              accessibilityLabel={`Period, ${dateCaption}`}
            >
              <PressableScale
                disabled={!canCustom}
                onPress={() => canCustom && setCustomOpen(true)}
                accessibilityRole={canCustom ? "button" : undefined}
                accessibilityLabel={canCustom ? `Period ${periodLabel}. Choose custom range.` : undefined}
                style={styles.datePress}
              >
                <Text
                  style={[t.typography.subhead, styles.dateLabel, { color: t.colors.text_primary }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {periodLabel}
                </Text>
                {periodLoading ? (
                  <Text style={[t.typography.caption2, styles.dateMeta, { color: t.colors.text_tertiary }]}>
                    Loading…
                  </Text>
                ) : periodRefreshing ? (
                  <Text style={[t.typography.caption2, styles.dateMeta, { color: t.colors.tone_primary }]}>
                    Updating…
                  </Text>
                ) : null}
              </PressableScale>
            </Animated.View>

            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Next period"
              onPress={onNext}
              disabled={!canGoNext || periodMode === "custom"}
              style={[
                styles.navHit,
                { opacity: canGoNext && periodMode !== "custom" ? 1 : 0.28 },
              ]}
            >
              <SFSymbol name="chevron.right" size={14} color={t.colors.text_secondary} />
            </PressableScale>
          </View>

          <PeriodToggle
            value={periodMode}
            onChange={onPeriodModeChange}
            onCustomPress={canCustom ? () => setCustomOpen(true) : undefined}
          />
        </View>
      </GlassPanel>

      {canCustom && dateRange && onCustomRange ? (
        <CustomRangeSheet
          visible={customOpen}
          dateRange={dateRange}
          onClose={() => setCustomOpen(false)}
          onPick={(range) => {
            onCustomRange(range);
            setCustomOpen(false);
          }}
        />
      ) : null}
    </View>
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
    minHeight: layout.minTap,
  },
  row2: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: dashboard.headerRowGap,
  },
  profileChip: {
    flex: 1,
    minHeight: layout.minTap,
    flexDirection: "row",
    alignItems: "center",
    gap: density.chromeGap - 2,
    paddingHorizontal: density.chipPadH,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileText: {
    flexShrink: 1,
    fontWeight: "600",
  },
  currencyChip: {
    minHeight: layout.minTap,
    minWidth: layout.minTap,
    paddingHorizontal: density.chipPadH,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  currencyText: {
    fontWeight: "700",
    letterSpacing: 0.35,
    fontVariant: ["tabular-nums"],
  },
  syncChip: {
    minHeight: layout.minTap,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  syncChipDot: {
    width: layout.minTap,
    paddingHorizontal: 0,
  },
  syncChipWide: {
    maxWidth: 108,
    paddingHorizontal: 9,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  syncText: {
    fontWeight: "600",
  },
  dateRail: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: layout.minTap,
  },
  navHit: {
    width: layout.minTap,
    height: layout.minTap,
    alignItems: "center",
    justifyContent: "center",
  },
  dateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: layout.minTap,
    paddingHorizontal: 2,
  },
  datePress: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: layout.minTap,
    maxWidth: "100%",
  },
  dateLabel: {
    fontWeight: "600",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  dateMeta: {
    marginTop: 1,
    fontWeight: "600",
    textAlign: "center",
  },
  periodRail: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    padding: 2,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  periodSegment: {
    flex: 1,
    minHeight: layout.minTap,
    paddingHorizontal: 4,
    borderRadius: dashboard.chipRadius - 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  periodLabel: {
    fontWeight: "600",
  },
  sheetFill: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: dashboard.cardRadius,
    borderTopRightRadius: dashboard.cardRadius,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  presetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: layout.minTap,
  },
  applyCustom: {
    marginTop: 4,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    minHeight: layout.minTap,
    alignItems: "center",
    justifyContent: "center",
  },
});
