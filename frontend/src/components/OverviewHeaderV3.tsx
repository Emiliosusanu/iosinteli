import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { GlassPanel } from "@/src/components/GlassPanel";
import { IOSDateField, SFSymbol } from "@/src/components/ios/Native";
import { MarketPill } from "@/src/components/MarketPill";
import { PressableScale } from "@/src/components/Motion";
import { countryFlagEmoji, marketPillCountryLabel, sortMarketCountryCodes } from "@/src/lib/accountsUi";
import { formatDateRangeLabel, rangePresets } from "@/src/lib/format";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { motion } from "@/src/lib/motion";
import {
  dashboard,
  layout,
  useOverview209Chrome,
  useReduceMotion,
  useTheme,
} from "@/src/lib/theme";
import type { DateRange } from "@/src/lib/types";

const EASE = Easing.bezier(0.23, 1, 0.32, 1);
/** Softer decelerate for period pill + handoff settle — premium, not springy. */
const EASE_SOFT = Easing.bezier(0.33, 1, 0.68, 1);

/** Scroll choreography — position-based only (no direction triggers). */
const PHASE1_END = 22;
const PHASE2_END = 58;
const HANDOFF_END = 118;
const HANDOFF_MID = (PHASE2_END + HANDOFF_END) / 2;
const COMPACT_ROW = 48;
const COMPACT_TWO_ROW = 88;
/** Soft bottom radius for sticky chrome — continuous, not a flat strip. */
const COMPACT_CORNER = 20;

/**
 * Soft handoff curves — wide overlap so chrome never linear-fades out then in.
 * Same curves reverse cleanly on scroll-to-top (position-tied).
 */
function compactEnterOpacity(y: number) {
  "worklet";
  return interpolate(
    y,
    [PHASE2_END - 6, 68, 82, 96, HANDOFF_END],
    [0, 0.1, 0.38, 0.82, 1],
    Extrapolation.CLAMP,
  );
}
function compactEnterTY(y: number) {
  "worklet";
  return interpolate(y, [PHASE2_END - 4, 76, 96, HANDOFF_END], [7, 3.5, 1, 0], Extrapolation.CLAMP);
}
function expandedExitOpacity(y: number) {
  "worklet";
  return interpolate(
    y,
    [PHASE2_END - 6, 70, 86, 102, HANDOFF_END],
    [1, 0.9, 0.52, 0.16, 0],
    Extrapolation.CLAMP,
  );
}
function expandedExitTY(y: number) {
  "worklet";
  return interpolate(y, [PHASE2_END - 4, 90, HANDOFF_END], [0, -3.5, -6], Extrapolation.CLAMP);
}
function stickySurfaceOpacity(y: number) {
  "worklet";
  return interpolate(y, [PHASE2_END - 4, 78, HANDOFF_END, 148], [0, 0.62, 0.97, 0.985], Extrapolation.CLAMP);
}
function stickyHairline(y: number) {
  "worklet";
  return interpolate(y, [72, HANDOFF_END, 140], [0, 0.78, 1], Extrapolation.CLAMP);
}
/** Subtle compression near pin — transform only, no layout thrash. */
function compactTighten(y: number) {
  "worklet";
  return interpolate(y, [86, HANDOFF_END, 150], [0, 1, 1], Extrapolation.CLAMP);
}
function compactScaleNearPin(y: number) {
  "worklet";
  return interpolate(y, [86, HANDOFF_END, 150], [1, 0.992, 0.992], Extrapolation.CLAMP);
}

export type OverviewPeriodMode = "day" | "week" | "month" | "custom";

export type OverviewHeaderV3Props = {
  profileLabel: string;
  /**
   * Sorted unique marketplace country codes (US, CA, …) — source of truth for
   * the overlapping-flag market pill. Prefer this over `marketFlags`.
   */
  marketCountries?: string[];
  /** null means every enabled marketplace. */
  selectedMarketCountry?: string | null;
  onMarketSelectionChange?: (country: string | null) => void;
  /** @deprecated Prefer `marketCountries`; kept for back-compat emoji-only callers. */
  marketFlags?: string[];
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
  /** Shared scroll position for collapse choreography (UI-thread). */
  scrollY?: SharedValue<number>;
  /** When true, Custom sheet is owned by CompactSticky sibling. */
  customOpen?: boolean;
  onCustomOpenChange?: (open: boolean) => void;
};

export type OverviewNavProps = Pick<
  OverviewHeaderV3Props,
  | "periodLabel"
  | "periodLoading"
  | "periodRefreshing"
  | "canGoNext"
  | "onPrev"
  | "onNext"
  | "periodMode"
  | "onPeriodModeChange"
  | "dateRange"
  | "onCustomRange"
  | "customOpen"
  | "onCustomOpenChange"
> & {
  scrollY: SharedValue<number>;
};

/** Scroll driver — animationScrollY = max(scrollY, 0); no useState. */
export function useOverviewHeaderScroll() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });
  return { scrollY, onScroll, scrollEventThrottle: 16 as const };
}

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

const EASE_GLOW = Easing.inOut(Easing.ease);

function hexWithAlpha(hex: string, alpha01: number): string {
  const mid = hex.length === 7 ? hex : "#0A84FF";
  const a = Math.max(0, Math.min(255, Math.round(alpha01 * 255)));
  return `${mid}${a.toString(16).padStart(2, "0")}`;
}

/**
 * Soft smoke lateral edge — vertical clear → tint → tint → clear (~3pt core),
 * matching SwiftUI `sideGlow` (padding.vertical 32). Wide low-opacity bloom
 * approximates blur radius 5↔10 without harsh neon bands.
 */
function StadiumSideGlow({
  color,
  side,
  bloomStyle,
}: {
  color: string;
  side: "left" | "right";
  bloomStyle: object;
}) {
  const clear = hexWithAlpha(color, 0);
  const peak = hexWithAlpha(color, 0.48);
  const mid = hexWithAlpha(color, 0.24);
  const isLeft = side === "left";
  return (
    <View
      pointerEvents="none"
      style={[styles.lateralGlowSide, isLeft ? styles.lateralGlowLeft : styles.lateralGlowRight]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.lateralGlowBloom,
          isLeft ? styles.lateralGlowBloomLeft : styles.lateralGlowBloomRight,
          bloomStyle,
        ]}
      >
        <LinearGradient
          colors={[clear, peak, mid, clear]}
          locations={[0, 0.3, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <LinearGradient
        colors={[clear, peak, mid, clear]}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.lateralGlowCore, isLeft ? styles.lateralGlowCoreLeft : styles.lateralGlowCoreRight]}
        testID={isLeft ? "home-header-glow-edge-left" : "home-header-glow-edge-right"}
      />
    </View>
  );
}

/**
 * Quiet edge shadow while a refresh is active, followed by a short green
 * confirmation before returning to rest. No warning pulse or neon outline.
 */
function StadiumLateralGlow({
  busy,
  ready,
  failedOrStale,
  color,
  successColor,
}: {
  busy: boolean;
  ready: boolean;
  failedOrStale: boolean;
  color: string;
  successColor: string;
}) {
  const reduceMotion = useReduceMotion();
  const breath = useSharedValue(0);
  const visible = useSharedValue(0);

  useEffect(() => {
    if ((busy || ready) && !failedOrStale) {
      cancelAnimation(breath);
      cancelAnimation(visible);
      visible.set(withTiming(1, { duration: reduceMotion ? 100 : 260, easing: EASE_SOFT }));
      if (reduceMotion) {
        breath.set(0.35);
        return;
      }
      breath.set(0);
      breath.set(ready ? withTiming(0.72, { duration: 220, easing: EASE_SOFT }) : withRepeat(withTiming(1, { duration: 2100, easing: EASE_GLOW }), -1, true));
      return () => cancelAnimation(breath);
    }
    cancelAnimation(breath);
    cancelAnimation(visible);
    visible.set(withTiming(0, { duration: reduceMotion ? 100 : 360, easing: EASE_SOFT }));
    breath.set(withTiming(0, { duration: reduceMotion ? 100 : 360, easing: EASE_SOFT }));
  }, [busy, ready, failedOrStale, breath, visible, reduceMotion]);

  const edgeStyle = useAnimatedStyle(() => ({
    opacity: visible.get() * interpolate(breath.get(), [0, 1], [0.08, 0.22]),
  }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.get(), [0, 1], [0.18, 0.34]),
    transform: [{ scaleX: interpolate(breath.get(), [0, 1], [1.04, 1.22]) }],
  }));

  return (
    <View
      pointerEvents="none"
      testID="home-header-refresh-glow"
      style={styles.lateralGlowRoot}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, edgeStyle]}
        testID={ready ? "home-header-glow-ready" : "home-header-glow-primary"}
      >
        <StadiumSideGlow color={ready ? successColor : color} side="left" bloomStyle={bloomStyle} />
        <StadiumSideGlow color={ready ? successColor : color} side="right" bloomStyle={bloomStyle} />
      </Animated.View>
    </View>
  );
}

const PERIOD_RAIL_PAD = 3;

const PERIOD_OPTIONS: {
  key: OverviewPeriodMode;
  label: string;
  testID: string;
  symbol: "sun.max" | "calendar" | "calendar.badge.clock" | "slider.horizontal.3";
}[] = [
  { key: "day", label: "Day", testID: "home-period-day", symbol: "sun.max" },
  { key: "week", label: "Week", testID: "home-period-week", symbol: "calendar" },
  { key: "month", label: "Month", testID: "home-period-month", symbol: "calendar.badge.clock" },
  { key: "custom", label: "Custom", testID: "home-period-custom", symbol: "slider.horizontal.3" },
];

/**
 * Floating stadium period control — dark sliding capsule + icon;
 * only the selected period shows its text label (reference aesthetic).
 */
function PeriodToggle({
  value,
  onChange,
  onCustomPress,
  compact,
}: {
  value: OverviewPeriodMode;
  onChange: (next: OverviewPeriodMode) => void;
  onCustomPress?: () => void;
  compact?: boolean;
}) {
  const t = useTheme();
  const chrome = useOverview209Chrome();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const activeIndex = Math.max(
    0,
    PERIOD_OPTIONS.findIndex((option) => option.key === value),
  );
  const segmentFrames = useRef<{ x: number; width: number }[]>(
    PERIOD_OPTIONS.map(() => ({ x: PERIOD_RAIL_PAD, width: 0 })),
  );
  const pillX = useSharedValue(PERIOD_RAIL_PAD);
  const pillW = useSharedValue(0);

  const movePillTo = (index: number, animate: boolean) => {
    const frame = segmentFrames.current[index];
    if (!frame || frame.width <= 0) return;
    if (!animate || reduceMotion) {
      pillX.set(frame.x);
      pillW.set(frame.width);
      return;
    }
    const cfg = {
      duration: motion.glassSettle,
      easing: EASE_SOFT,
    };
    pillX.set(withTiming(frame.x, cfg));
    pillW.set(withTiming(frame.width, cfg));
  };

  useEffect(() => {
    movePillTo(activeIndex, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pill tracks period mode + measured frames
  }, [activeIndex, reduceMotion, value]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.get() }],
    width: Math.max(pillW.get(), 0),
  }));

  // Responsive stadium — bigger icons/taps on Pro Max / tablet widths.
  const roomy = windowWidth >= 430;
  const iconSize = compact ? (roomy ? 15 : 14) : roomy ? 17 : 15;
  const stadiumH = compact ? (roomy ? 36 : 34) : roomy ? 40 : 36;
  const labelSize = compact ? (roomy ? 13 : 12) : roomy ? 14 : 13;

  return (
    <View
      testID={compact ? "home-period-compact" : "home-period"}
      accessibilityRole="tablist"
      accessibilityLabel="Calendar period"
      style={[
        styles.periodRail,
        compact && styles.periodRailCompact,
        {
          // Visual height only — PressableScale hitSlop keeps 44pt taps.
          minHeight: stadiumH + PERIOD_RAIL_PAD * 2,
          // Build 209 stadium: scheme rail + black sliding Month pill.
          backgroundColor: chrome.colors.chrome_rail,
          borderColor: chrome.colors.chrome_rail_stroke,
          ...chrome.shadow.stadium,
        },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.periodPill,
          {
            backgroundColor: chrome.colors.chrome_selected,
            borderColor: "transparent",
            borderWidth: 0,
          },
          pillStyle,
        ]}
      />
      {PERIOD_OPTIONS.map((option, index) => {
        const active = option.key === value;
        return (
          <View
            key={option.key}
            style={[styles.periodSegmentSlot, active && styles.periodSegmentSlotActive]}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              const prev = segmentFrames.current[index];
              if (prev && prev.x === x && prev.width === width) return;
              segmentFrames.current[index] = { x, width };
              if (index === activeIndex) {
                movePillTo(index, Math.abs(pillX.get() - x) > 1);
              }
            }}
          >
            <PressableScale
              testID={compact ? `${option.testID}-compact` : option.testID}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (option.key === "custom") {
                  void playHaptic("select", reduceMotion);
                  onCustomPress?.();
                  return;
                }
                if (option.key !== value) {
                  void playHaptic("select", reduceMotion);
                  onChange(option.key);
                }
              }}
              hitSlop={6}
              style={[
                styles.periodSegment,
                compact && styles.periodSegmentCompact,
                active ? styles.periodSegmentActive : styles.periodSegmentIdle,
                { minHeight: stadiumH },
              ]}
            >
              <SFSymbol
                name={option.symbol}
                size={iconSize}
                color={
                  active ? chrome.colors.chrome_selected_fg : chrome.colors.text_secondary
                }
              />
              {active ? (
                <Text
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    t.typography.caption1,
                    styles.periodLabel,
                    compact && styles.periodLabelCompact,
                    {
                      color: chrome.colors.chrome_selected_fg,
                      fontSize: labelSize,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              ) : null}
            </PressableScale>
          </View>
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

function DateRail({
  periodLabel,
  periodLoading,
  periodRefreshing,
  periodMode,
  canGoNext,
  onPrev,
  onNext,
  canCustom,
  onCustomPress,
  compact,
  periodMotion,
  /** When stadium laterals glow for refresh, skip the "Updating…" caption. */
  suppressRefreshingCaption = false,
}: {
  periodLabel: string;
  periodLoading: boolean;
  periodRefreshing: boolean;
  periodMode: OverviewPeriodMode;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  canCustom: boolean;
  onCustomPress: () => void;
  compact?: boolean;
  periodMotion?: object;
  suppressRefreshingCaption?: boolean;
}) {
  const t = useTheme();
  const chrome = useOverview209Chrome();
  const reduceMotion = useReduceMotion();
  const dateCaption = periodLoading
    ? "Loading period"
    : periodRefreshing
      ? "Updating period"
      : periodLabel;

  return (
    <View style={[styles.dateRail, compact && styles.dateRailCompact]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Previous period"
        onPress={onPrev}
        disabled={periodMode === "custom"}
        hitSlop={8}
        style={[styles.navHit, styles.navHitFront, periodMode === "custom" && { opacity: 0.28 }]}
      >
        <SFSymbol name="chevron.left" size={compact ? 13 : 14} color={chrome.colors.text_secondary} />
      </PressableScale>

      <View style={styles.dateCenterSlot} pointerEvents="box-none">
        <Animated.View
          style={[styles.dateCenter, periodMotion]}
          accessible={!canCustom}
          accessibilityRole={!canCustom ? "header" : undefined}
          accessibilityLabel={!canCustom ? `Period, ${dateCaption}` : undefined}
        >
          <PressableScale
            disabled={!canCustom}
            onPress={() => {
              if (!canCustom) return;
              void playHaptic("select", reduceMotion);
              onCustomPress();
            }}
            accessibilityRole={canCustom ? "button" : "none"}
            accessibilityLabel={
              canCustom
                ? `Period ${periodLabel}${periodRefreshing ? ", updating" : periodLoading ? ", loading" : ""}. Choose custom range.`
                : undefined
            }
            style={styles.datePress}
          >
            <Text
              testID={compact ? "home-period-date-compact" : "home-period-date"}
              style={[
                t.typography.headline,
                styles.dateLabel,
                compact && styles.dateLabelCompact,
                {
                  color: chrome.colors.text_primary,
                  fontSize: compact ? 14 : 17,
                  fontWeight: "700",
                },
              ]}
              numberOfLines={1}
            >
              {periodLabel}
            </Text>
            {!compact && periodLoading ? (
              <Text
                testID="home-period-meta"
                style={[t.typography.caption1, styles.dateMeta, { color: chrome.colors.text_tertiary }]}
              >
                Loading…
              </Text>
            ) : !compact && periodRefreshing && !suppressRefreshingCaption ? (
              <Text
                testID="home-period-meta"
                style={[t.typography.caption1, styles.dateMeta, { color: chrome.colors.tone_primary }]}
              >
                Updating…
              </Text>
            ) : null}
          </PressableScale>
        </Animated.View>
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Next period"
        onPress={onNext}
        disabled={!canGoNext || periodMode === "custom"}
        hitSlop={8}
        style={[
          styles.navHit,
          styles.navHitFront,
          { opacity: canGoNext && periodMode !== "custom" ? 1 : 0.28 },
        ]}
      >
        <SFSymbol name="chevron.right" size={compact ? 13 : 14} color={chrome.colors.text_secondary} />
      </PressableScale>
    </View>
  );
}

function useTwoRowCompact() {
  const { width, fontScale } = useWindowDimensions();
  // Prefer stacked (full-width centered date + period) on phones / Pro Max;
  // one-row only when there is clear horizontal room without truncating the date.
  return width < 480 || fontScale > 1.1;
}

/**
 * Compact sticky overlay — pins date + Day/Week/Month/Custom.
 * Opacity/translate driven by scrollY; fixed height (no layout↔scroll loop).
 */
export function OverviewHeaderCompactSticky({
  scrollY,
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
  customOpen: customOpenProp,
  onCustomOpenChange,
}: OverviewNavProps) {
  const chrome = useOverview209Chrome();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const twoRow = useTwoRowCompact();
  const [localCustomOpen, setLocalCustomOpen] = useState(false);
  const customOpen = customOpenProp ?? localCustomOpen;
  const setCustomOpen = onCustomOpenChange ?? setLocalCustomOpen;
  const [interactive, setInteractive] = useState(false);
  const canCustom = !!onCustomRange && !!dateRange;

  useAnimatedReaction(
    () => Math.max(scrollY.get(), 0) >= HANDOFF_MID,
    (next, prev) => {
      if (next !== prev) runOnJS(setInteractive)(next);
    },
    [scrollY],
  );

  const shellStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    if (reduceMotion) {
      return {
        opacity: y >= HANDOFF_MID ? 1 : 0,
        transform: [{ translateY: 0 }],
      };
    }
    return {
      opacity: compactEnterOpacity(y),
      transform: [{ translateY: compactEnterTY(y) }],
    };
  });

  // SharedValues — plain JS closures in useAnimatedStyle stay stuck on the
  // first scheme (often light before AsyncStorage loads "dark"), so scrolled
  // sticky painted white/gray while stadium + date text already followed dark.
  const stickyRgbSV = useSharedValue(chrome.colors.chrome_sticky_rgb);
  const hairlineRgbSV = useSharedValue(chrome.colors.chrome_hairline_rgb);
  const stickyWashOnSV = useSharedValue(chrome.scheme === "dark" ? 0.96 : 0.28);
  const stickyWashScrollSV = useSharedValue(chrome.scheme === "dark" ? 0.98 : 0.26);

  useEffect(() => {
    stickyRgbSV.set(chrome.colors.chrome_sticky_rgb);
    hairlineRgbSV.set(chrome.colors.chrome_hairline_rgb);
    stickyWashOnSV.set(chrome.scheme === "dark" ? 0.96 : 0.28);
    stickyWashScrollSV.set(chrome.scheme === "dark" ? 0.98 : 0.26);
  }, [
    chrome.scheme,
    chrome.colors.chrome_sticky_rgb,
    chrome.colors.chrome_hairline_rgb,
    stickyRgbSV,
    hairlineRgbSV,
    stickyWashOnSV,
    stickyWashScrollSV,
  ]);

  const surfaceStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    const stickyRgb = stickyRgbSV.get();
    const hairlineRgb = hairlineRgbSV.get();
    if (reduceMotion) {
      const on = y >= HANDOFF_MID;
      return {
        backgroundColor: on ? `rgba(${stickyRgb},${stickyWashOnSV.get()})` : "rgba(0,0,0,0)",
        borderBottomColor: on ? `rgba(${hairlineRgb},0.16)` : `rgba(${hairlineRgb},0)`,
        borderBottomLeftRadius: on ? COMPACT_CORNER : 0,
        borderBottomRightRadius: on ? COMPACT_CORNER : 0,
      };
    }
    const bgOpacity = stickySurfaceOpacity(y);
    const hairline = stickyHairline(y);
    const corner = interpolate(y, [PHASE2_END, 88, HANDOFF_END], [0, COMPACT_CORNER * 0.55, COMPACT_CORNER], Extrapolation.CLAMP);
    return {
      backgroundColor: `rgba(${stickyRgb},${bgOpacity * stickyWashScrollSV.get()})`,
      borderBottomColor: `rgba(${hairlineRgb},${0.16 * hairline})`,
      borderBottomLeftRadius: corner,
      borderBottomRightRadius: corner,
    };
  });

  const blurShellStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    const opacity = reduceMotion
      ? y >= HANDOFF_MID
        ? 1
        : 0
      : stickySurfaceOpacity(y);
    return { opacity };
  });

  /** Soft settle + tiny compression near pin — transform only. */
  const tightenStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    if (reduceMotion) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    const t = compactTighten(y);
    return {
      transform: [{ translateY: -1.75 * t }, { scale: compactScaleNearPin(y) }],
    };
  });

  // TOP safe-area only — never the home-indicator inset. This chrome
  // pins under the Dynamic Island, not above the tab bar.
  const topInset = Math.max(insets.top, 4);
  const bodyH = twoRow ? COMPACT_TWO_ROW : COMPACT_ROW;

  return (
    <>
      <Animated.View
        testID="home-header-compact"
        pointerEvents={interactive ? "auto" : "none"}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? "yes" : "no-hide-descendants"}
        collapsable={false}
        style={[
          styles.compactRoot,
          // Explicit top-only frame (height + top). Never pair with bottom.
          { top: 0, height: topInset + bodyH },
          shellStyle,
        ]}
      >
        {/*
          Full-bleed frosted chrome from Dynamic Island / status bar down through
          the compact controls. Native BlurView + soft wash; stadium period stays
          the black sliding pill (builds 206–209).
        */}
        <Animated.View
          style={[
            styles.compactSurface,
            {
              borderCurve: "continuous",
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
            surfaceStyle,
          ]}
        >
          {Platform.OS === "ios" ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, blurShellStyle]}
            >
              <BlurView
                // Remount on scheme so native material cannot stay on light frost
                // after Appearance preference resolves to dark.
                key={`overview-sticky-blur-${chrome.scheme}`}
                intensity={chrome.scheme === "dark" ? 48 : 72}
                tint={chrome.scheme === "dark" ? "dark" : "systemChromeMaterialLight"}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
          <View style={{ height: topInset }} collapsable={false} />
          <Animated.View
            style={[
              styles.compactInner,
              twoRow ? styles.compactInnerTwoRow : styles.compactInnerOneRow,
              { minHeight: bodyH },
              tightenStyle,
            ]}
          >
            <View style={twoRow ? styles.compactDateWrap : styles.compactDateInline}>
              <DateRail
                periodLabel={periodLabel}
                periodLoading={periodLoading}
                periodRefreshing={periodRefreshing}
                periodMode={periodMode}
                canGoNext={canGoNext}
                onPrev={onPrev}
                onNext={onNext}
                canCustom={canCustom}
                onCustomPress={() => setCustomOpen(true)}
                compact
              />
            </View>
            <View style={twoRow ? styles.compactPeriodWrap : styles.compactPeriodInline}>
              <PeriodToggle
                value={periodMode}
                onChange={onPeriodModeChange}
                onCustomPress={canCustom ? () => setCustomOpen(true) : undefined}
                compact
              />
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>

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
    </>
  );
}

/** Compact premium Overview chrome — profile, sync, date window, period mode. */
export function OverviewHeaderV3({
  profileLabel,
  marketCountries,
  marketFlags = [],
  selectedMarketCountry = null,
  onMarketSelectionChange,
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
  scrollY: scrollYProp,
  customOpen: customOpenProp,
  onCustomOpenChange,
}: OverviewHeaderV3Props) {
  const t = useTheme();
  const chrome = useOverview209Chrome();
  const reduceMotion = useReduceMotion();
  const fallbackScrollY = useSharedValue(0);
  const scrollY = scrollYProp ?? fallbackScrollY;
  const [localCustomOpen, setLocalCustomOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const customOpen = customOpenProp ?? localCustomOpen;
  const setCustomOpen = onCustomOpenChange ?? setLocalCustomOpen;
  const [expandedInteractive, setExpandedInteractive] = useState(true);
  const periodOpacity = useSharedValue(1);
  const periodShift = useSharedValue(0);

  const resolvedCountries = sortMarketCountryCodes(marketCountries ?? []);
  const displayedCountries = selectedMarketCountry
    ? resolvedCountries.filter((country) => country === selectedMarketCountry.toUpperCase())
    : resolvedCountries;
  const hasMarketPill = resolvedCountries.length > 0;
  // Back-compat: emoji-only callers still get a flag cue without the glass pill.
  const legacyFlags = !hasMarketPill && marketFlags.length > 0 ? marketFlags : [];

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

  useAnimatedReaction(
    () => Math.max(scrollY.get(), 0) < HANDOFF_MID,
    (next, prev) => {
      if (next !== prev) runOnJS(setExpandedInteractive)(next);
    },
    [scrollY],
  );

  const contextStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    if (reduceMotion) {
      return {
        opacity: y >= PHASE2_END ? 0 : 1,
        transform: [{ translateY: 0 }],
      };
    }
    return {
      opacity: interpolate(y, [PHASE1_END, 38, PHASE2_END], [1, 0.58, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(y, [PHASE1_END, PHASE2_END], [0, -5], Extrapolation.CLAMP),
        },
      ],
    };
  });

  const helperStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    if (reduceMotion) {
      return { opacity: y >= PHASE1_END ? 0 : 1 };
    }
    return {
      opacity: interpolate(y, [0, PHASE1_END, 48, PHASE2_END], [1, 0.88, 0.35, 0], Extrapolation.CLAMP),
    };
  });

  const expandedNavStyle = useAnimatedStyle(() => {
    const y = Math.max(scrollY.get(), 0);
    if (reduceMotion) {
      return {
        opacity: y >= HANDOFF_MID ? 0 : 1,
        transform: [{ translateY: 0 }],
      };
    }
    return {
      opacity: expandedExitOpacity(y),
      transform: [{ translateY: expandedExitTY(y) }],
    };
  });

  const syncBusy = syncCompact === "Refreshing" || syncCompact === "Syncing";
  /** Busy refresh uses lateral stadium glow — not the wide orange "Refreshing" pill. */
  const showRefreshGlow = syncBusy || periodRefreshing;
  const syncFailedOrStale =
    syncCompact === "Failed" || syncCompact.toLocaleLowerCase().includes("stale");
  const [syncReadyVisible, setSyncReadyVisible] = useState(false);
  const wasRefreshBusy = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (readyTimer.current) clearTimeout(readyTimer.current);
    if (showRefreshGlow) {
      wasRefreshBusy.current = true;
      setSyncReadyVisible(false);
      return;
    }
    if (wasRefreshBusy.current && !syncFailedOrStale) {
      wasRefreshBusy.current = false;
      setSyncReadyVisible(true);
      readyTimer.current = setTimeout(() => setSyncReadyVisible(false), reduceMotion ? 700 : 1150);
    } else {
      wasRefreshBusy.current = false;
      setSyncReadyVisible(false);
    }
    return () => {
      if (readyTimer.current) clearTimeout(readyTimer.current);
    };
  }, [showRefreshGlow, syncFailedOrStale, reduceMotion]);
  const syncNeedsLabel =
    !syncBusy &&
    (syncFailedOrStale ||
      syncCompact === "Sync" ||
      syncCompact === "KDP");
  const insets = useSafeAreaInsets();
  const canCustom = !!onCustomRange && !!dateRange;
  // Sheet lives on CompactSticky when open state is shared (avoids duplicate Modals).
  const ownsSheet = onCustomOpenChange == null;

  return (
    <View style={{ paddingTop: Math.max(insets.top - 4, 0) }} testID="home-header-expanded">
      <View style={styles.shellWrap}>
        <GlassPanel
          testID="home-header-v3"
          strength="card"
          style={[
            styles.shell,
            {
              // Scheme-synced elevated shell (white in light, dark card in dark).
              // Stadium period rail + black Month pill stay via chrome_* tokens.
              backgroundColor: chrome.colors.background_secondary,
              borderColor: chrome.colors.separator,
              ...chrome.shadow.card,
            },
          ]}
          contentStyle={styles.shellInner}
        >
        <Animated.View
          style={contextStyle}
          pointerEvents={expandedInteractive ? "auto" : "none"}
          accessibilityElementsHidden={!expandedInteractive}
          importantForAccessibility={expandedInteractive ? "yes" : "no-hide-descendants"}
        >
          <View style={styles.row1}>
            {hasMarketPill ? (
              <MarketPill
                testID="home-market-pill"
                countries={displayedCountries.length ? displayedCountries : resolvedCountries}
                currency={currency}
                onPress={onMarketSelectionChange ? () => setMarketOpen(true) : onProfilePress}
              />
            ) : (
              <>
                <PressableScale
                  onPress={onProfilePress}
                  accessibilityRole="button"
                  accessibilityLabel={
                    legacyFlags.length
                      ? `Profiles, ${profileLabel}, markets ${legacyFlags.join(" ")}`
                      : `Profiles, ${profileLabel}`
                  }
                  hitSlop={4}
                  style={[
                    styles.profileChip,
                    legacyFlags.length > 0 && styles.profileChipWithFlags,
                    {
                      backgroundColor: chrome.colors.background_elevated,
                      borderColor: chrome.colors.separator,
                      ...chrome.shadow.stadium,
                    },
                  ]}
                >
                  <SFSymbol name="building.2" size={14} color={chrome.colors.tone_primary} />
                  {profileLabel.trim() ? (
                    <Text
                      style={[t.typography.footnote, styles.profileText, { color: chrome.colors.text_primary }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {profileLabel}
                    </Text>
                  ) : null}
                  {legacyFlags.length > 0 ? (
                    <View
                      testID="multi-country-flags"
                      style={styles.marketFlagsRow}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {legacyFlags.map((flag) => (
                        <View key={flag} style={styles.flagGlyph}>
                          <Text style={styles.flagGlyphText} allowFontScaling={false} numberOfLines={1}>
                            {flag}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <SFSymbol name="chevron.down" size={9} color={chrome.colors.text_tertiary} />
                </PressableScale>

                <PressableScale
                  onPress={onCurrencyPress ?? onProfilePress}
                  accessibilityRole="button"
                  accessibilityLabel={`Currency, ${currency}`}
                  hitSlop={4}
                  style={[
                    styles.currencyChip,
                    {
                      backgroundColor: chrome.colors.background_elevated,
                      borderColor: chrome.colors.separator,
                      ...chrome.shadow.stadium,
                    },
                  ]}
                >
                  <Text style={[t.typography.caption1, styles.currencyText, { color: chrome.colors.text_primary }]}>
                    {currency}
                  </Text>
                </PressableScale>
              </>
            )}

            {showRefreshGlow || syncReadyVisible ? (
              <PressableScale
                onPress={onSyncPress}
                accessibilityRole="button"
                accessibilityLabel={syncA11y}
                accessibilityValue={{ text: syncReadyVisible ? "Ready" : "Updating" }}
                hitSlop={6}
                style={[
                  styles.syncChip,
                  styles.syncChipDot,
                  {
                    borderColor: (syncReadyVisible ? t.colors.tone_good : t.colors.tone_primary) + "44",
                    backgroundColor: (syncReadyVisible ? t.colors.tone_good : t.colors.tone_primary) + "16",
                    marginLeft: "auto",
                    ...chrome.shadow.stadium,
                  },
                ]}
                testID={syncReadyVisible ? "home-sync-ready" : "home-sync-loading"}
              >
                {syncReadyVisible ? (
                  <SFSymbol name="checkmark" size={15} color={t.colors.tone_good} />
                ) : (
                  <SyncDot color={t.colors.tone_primary} active />
                )}
              </PressableScale>
            ) : syncNeedsLabel ? (
              <PressableScale
                onPress={onSyncPress}
                accessibilityRole="button"
                accessibilityLabel={syncA11y}
                hitSlop={6}
                style={[
                  styles.syncChip,
                  styles.syncChipWide,
                  {
                    borderColor: syncColor + "33",
                    backgroundColor: syncColor + "18",
                    marginLeft: "auto",
                    ...chrome.shadow.stadium,
                  },
                ]}
              >
                <SyncDot color={syncColor} active={false} />
                <Text style={[t.typography.caption2, styles.syncText, { color: syncColor }]} numberOfLines={1}>
                  {syncCompact}
                </Text>
              </PressableScale>
            ) : null}
          </View>

        </Animated.View>

        <Animated.View
          style={[styles.row2, expandedNavStyle]}
          pointerEvents={expandedInteractive ? "auto" : "none"}
          accessibilityElementsHidden={!expandedInteractive}
          importantForAccessibility={expandedInteractive ? "yes" : "no-hide-descendants"}
        >
          <DateRail
            periodLabel={periodLabel}
            periodLoading={periodLoading}
            periodRefreshing={periodRefreshing}
            periodMode={periodMode}
            canGoNext={canGoNext}
            onPrev={onPrev}
            onNext={onNext}
            canCustom={canCustom}
            onCustomPress={() => setCustomOpen(true)}
            periodMotion={periodMotion}
            suppressRefreshingCaption={showRefreshGlow}
          />

          <PeriodToggle
            value={periodMode}
            onChange={onPeriodModeChange}
            onCustomPress={canCustom ? () => setCustomOpen(true) : undefined}
          />
        </Animated.View>
        </GlassPanel>
        <StadiumLateralGlow
          busy={showRefreshGlow}
          ready={syncReadyVisible}
          failedOrStale={syncFailedOrStale}
          color={t.colors.tone_primary}
          successColor={t.colors.tone_good}
        />
      </View>

      {onMarketSelectionChange ? (
        <Modal visible={marketOpen} transparent animationType="fade" onRequestClose={() => setMarketOpen(false)}>
          <Pressable style={styles.marketSheetBackdrop} onPress={() => setMarketOpen(false)}>
            <Pressable style={[styles.marketSheet, { backgroundColor: chrome.colors.background_secondary, borderColor: chrome.colors.separator }]}>
              <Text style={[t.typography.headline, { color: chrome.colors.text_primary }]}>Ads marketplace</Text>
              {[null, ...resolvedCountries].map((country) => {
                const selected = (country ?? null) === selectedMarketCountry;
                const label = country
                  ? `${countryFlagEmoji(country)}  ${marketPillCountryLabel(country)}`
                  : "🌐  All markets";
                return (
                  <TouchableOpacity
                    key={country ?? "all"}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onMarketSelectionChange(country);
                      setMarketOpen(false);
                    }}
                    style={[styles.marketSheetRow, { borderColor: chrome.colors.separator }]}
                  >
                    <Text style={[t.typography.body, { color: chrome.colors.text_primary, flex: 1 }]}>{label}</Text>
                    {selected ? <SFSymbol name="checkmark" size={15} color={chrome.colors.tone_primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {ownsSheet && canCustom && dateRange && onCustomRange ? (
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
  shellWrap: {
    position: "relative",
    overflow: "visible",
  },
  shell: {
    // Soft continuous card — matches build 209 Overview chrome shell.
    borderRadius: 22,
    borderCurve: "continuous",
    // Visible so market-flag emoji aren’t cropped by the shell clip.
    overflow: "visible",
  },
  lateralGlowRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    overflow: "visible",
  },
  marketSheetBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "#00000066",
  },
  marketSheet: {
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  marketSheetRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 10,
  },
  /** Thin side slot — SwiftUI sideGlow frame(width: 3) + padding.vertical 32. */
  lateralGlowSide: {
    position: "absolute",
    top: 32,
    bottom: 32,
    width: 14,
    overflow: "visible",
  },
  lateralGlowLeft: {
    left: 0,
  },
  lateralGlowRight: {
    right: 0,
  },
  /** Soft bloom twin ≈ blur(5…10) — wide smoke, not a hard band. */
  lateralGlowBloom: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 14,
  },
  lateralGlowBloomLeft: {
    left: -4,
  },
  lateralGlowBloomRight: {
    right: -4,
  },
  /** Exact ~3pt vertical light-leak core. */
  lateralGlowCore: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
  },
  lateralGlowCoreLeft: {
    left: 0,
  },
  lateralGlowCoreRight: {
    right: 0,
  },
  shellInner: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  row1: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    minHeight: 36,
    width: "100%",
  },
  row2: {
    flexDirection: "column",
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "100%",
    gap: 8,
  },
  profileChip: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 112,
    maxWidth: "70%",
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    // Visible so flag emoji aren’t cropped by the pill clip.
    overflow: "visible",
  },
  profileChipWithFlags: {
    maxWidth: "84%",
    minWidth: 136,
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 12,
  },
  profileText: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "600",
  },
  profileTextBesideFlags: {
    // Keep the count readable but never steal width from market flags.
    flexGrow: 0,
    flexShrink: 0,
    maxWidth: 28,
  },
  currencyChip: {
    flexShrink: 0,
    minHeight: 46,
    minWidth: 48,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  currencyText: {
    fontWeight: "700",
    letterSpacing: 0.35,
    fontVariant: ["tabular-nums"],
  },
  syncChip: {
    flexShrink: 0,
    minHeight: 46,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  syncChipDot: {
    width: 46,
    paddingHorizontal: 0,
  },
  syncChipWide: {
    maxWidth: 120,
    paddingHorizontal: 12,
  },
  syncDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  syncText: {
    fontWeight: "600",
  },
  marketFlagsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
    gap: 6,
    overflow: "visible",
  },
  flagGlyph: {
    width: 28,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  flagGlyphText: {
    // Render large then scale down — avoids iOS emoji ink clipping in tight pills.
    fontSize: 28,
    lineHeight: 32,
    textAlign: "center",
    includeFontPadding: false,
    transform: [{ scale: 0.72 }],
  },
  dateRail: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
    width: "100%",
    alignSelf: "stretch",
  },
  dateRailCompact: {
    minHeight: 34,
  },
  navHit: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navHitFront: {
    zIndex: 2,
  },
  dateCenterSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  dateCenter: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    maxWidth: "100%",
  },
  datePress: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    maxWidth: "100%",
  },
  dateLabel: {
    fontWeight: "700",
    lineHeight: 22,
    letterSpacing: -0.3,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  dateLabelCompact: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  dateMeta: {
    marginTop: 2,
    fontWeight: "600",
    textAlign: "center",
  },
  periodRail: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    width: "100%",
    maxWidth: "100%",
    padding: PERIOD_RAIL_PAD,
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
    overflow: "visible",
    gap: 2,
  },
  periodRailCompact: {
    minWidth: 0,
    maxWidth: "100%",
  },
  periodPill: {
    position: "absolute",
    top: PERIOD_RAIL_PAD,
    bottom: PERIOD_RAIL_PAD,
    left: 0,
    borderRadius: 999,
    borderCurve: "continuous",
  },
  periodSegmentSlot: {
    zIndex: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  periodSegmentSlotActive: {
    flexGrow: 1.55,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 96,
  },
  periodSegment: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
  },
  periodSegmentCompact: {
    minHeight: 34,
    paddingHorizontal: 6,
  },
  periodSegmentActive: {
    paddingHorizontal: 12,
    alignSelf: "stretch",
    width: "100%",
  },
  periodSegmentIdle: {
    width: "100%",
    maxWidth: 44,
    paddingHorizontal: 0,
  },
  periodLabel: {
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: -0.2,
    fontSize: 13,
  },
  periodLabelCompact: {
    fontSize: 12,
    fontWeight: "700",
  },
  compactRoot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Do NOT set bottom — period/date sticky is TOP chrome only.
    zIndex: 30,
    elevation: 30,
    // Allow soft bottom corners to paint; clip children inside the surface.
    overflow: "visible",
  },
  compactSurface: {
    flex: 1,
    width: "100%",
    overflow: "hidden",
  },
  compactInner: {
    paddingHorizontal: dashboard.pageInset,
    paddingBottom: 8,
    justifyContent: "flex-start",
    width: "100%",
  },
  /** Equal halves — date and period each own a centered column. */
  compactInnerOneRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  compactInnerTwoRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    paddingTop: 0,
  },
  compactDateWrap: {
    alignSelf: "stretch",
    width: "100%",
  },
  compactDateInline: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: "stretch",
  },
  compactPeriodWrap: {
    alignSelf: "stretch",
    width: "100%",
  },
  compactPeriodInline: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: "stretch",
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
