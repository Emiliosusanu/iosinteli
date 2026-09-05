import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { OverviewCardHeader } from "@/src/components/DashboardSurface";
import { GlassPanel } from "@/src/components/GlassPanel";
import { InteliAdsIcon } from "@/src/components/InteliAdsIcon";
import { SFSymbol } from "@/src/components/ios/Native";
import { PressableScale, StaggerReveal, VerifiedValue } from "@/src/components/Motion";
import { autoModeLabel, bidBotOperationalCopy } from "@/src/lib/bidBotContract";
import { formatCurrency, formatDateShort, formatInt, formatPercent } from "@/src/lib/format";
import { motion } from "@/src/lib/motion";
import { dashboard, useReduceMotion, useTheme, type Theme } from "@/src/lib/theme";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function OpsCardShell({
  children,
  staggerIndex,
  toneWash,
  testID,
}: {
  children: React.ReactNode;
  staggerIndex: number;
  toneWash: string;
  testID?: string;
}) {
  const t = useTheme();
  // Below-fold: card glass (lighter blur) — chrome stacks caused Overview scroll jank.
  return (
    <StaggerReveal index={staggerIndex}>
      <GlassPanel
        testID={testID}
        strength="card"
        style={[
          {
            marginTop: dashboard.sectionGap,
            borderRadius: dashboard.cardRadius,
            borderCurve: "continuous",
            borderColor: t.colors.glass_stroke,
            overflow: "hidden",
          },
          t.shadow.card,
        ]}
        contentStyle={{ padding: 0 }}
      >
        <LinearGradient
          pointerEvents="none"
          colors={[toneWash, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ padding: dashboard.cardPadding }}>{children}</View>
      </GlassPanel>
    </StaggerReveal>
  );
}

function StatusChip({
  label,
  tone = "neutral",
  t,
}: {
  label: string;
  tone?: "neutral" | "primary" | "good" | "warning" | "danger" | "inactive";
  t: Theme;
}) {
  const color =
    tone === "primary"
      ? t.colors.tone_primary
      : tone === "good"
        ? t.colors.tone_good
        : tone === "warning"
          ? t.colors.tone_warning
          : tone === "danger"
            ? t.colors.tone_danger
            : tone === "inactive"
              ? t.colors.tone_inactive
              : t.colors.text_secondary;
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: color + "18",
          borderColor: color + "33",
        },
      ]}
    >
      <Text style={[t.typography.caption2, { color, fontWeight: "600" }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Swipe left opens the target; vertical scroll keeps priority. */
function SwipeOpen({
  onOpen,
  children,
  accessibilityLabel,
  accessibilityHint,
}: {
  onOpen: () => void;
  children: React.ReactNode;
  accessibilityLabel: string;
  accessibilityHint?: string;
}) {
  const reduceMotion = useReduceMotion();
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }],
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-18, 18])
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          if (reduceMotion) return;
          x.set(Math.max(-56, Math.min(0, event.translationX)));
        })
        .onEnd((event) => {
          const open = event.translationX < -42 || event.velocityX < -650;
          if (open) runOnJS(onOpen)();
          x.set(
            reduceMotion
              ? 0
              : withSpring(0, { damping: 22, stiffness: 320, mass: 0.4 }),
          );
        }),
    [onOpen, reduceMotion, x],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        <PressableScale onPress={onOpen} accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint}>
          {children}
        </PressableScale>
      </Animated.View>
    </GestureDetector>
  );
}

/** Budget gauge — static SVG (no infinite anim / no animated SVG props on scroll). */
export function OverviewBudgetArc({
  spent,
  budget,
  currency,
  size = 128,
}: {
  spent: number;
  budget: number;
  currency?: string;
  size?: number;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const pct = budget > 0 ? Math.min(1, Math.max(0, spent / budget)) : 0;
  const pctDisplay = budget > 0 ? Math.round(pct * 100) : null;
  const reveal = useSharedValue(reduceMotion ? 1 : 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 18;
  const sw = 14;
  const SVG_START = 135;
  const SVG_SWEEP = 270;

  useEffect(() => {
    cancelAnimation(reveal);
    reveal.set(
      reduceMotion ? 1 : withTiming(1, { duration: motion.updateEmphasis, easing: EASE_OUT }),
    );
    return () => cancelAnimation(reveal);
  }, [pct, reduceMotion, reveal]);

  function pt(deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(fromDeg: number, toDeg: number) {
    if (toDeg <= fromDeg) return "";
    const s = pt(fromDeg);
    const e = pt(toDeg);
    const span = toDeg - fromDeg;
    const la = span > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${la} 1 ${e.x} ${e.y}`;
  }

  const trackEndDeg = SVG_START + SVG_SWEEP;
  const fillEndDeg = SVG_START + SVG_SWEEP * pct;
  const fullArc = arcPath(SVG_START, trackEndDeg);
  const fillArc = pct > 0.001 ? arcPath(SVG_START, fillEndDeg) : "";
  const color =
    pct >= 1 ? t.colors.tone_danger : pct >= 0.8 ? t.colors.tone_warning : t.colors.tone_primary;
  const gradId = useMemo(() => `budgetArc-${Math.round(size)}`, [size]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + reveal.get() * 0.45,
  }));

  return (
    <Animated.View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, fadeStyle]}>
      <View
        pointerEvents="none"
        style={[
          styles.arcGlow,
          {
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: size,
            backgroundColor: color + "1A",
          },
        ]}
      />
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={color} stopOpacity="1" />
            <Stop offset="100%" stopColor={t.colors.tone_primary} stopOpacity="0.75" />
          </SvgGradient>
        </Defs>
        <Path d={fullArc} stroke={t.colors.background_tertiary} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={r - sw * 0.85} fill={t.scheme === "dark" ? "#FFFFFF08" : "#FFFFFFAA"} />
        {fillArc ? (
          <Path d={fillArc} stroke={`url(#${gradId})`} strokeWidth={sw} fill="none" strokeLinecap="round" />
        ) : null}
      </Svg>
      <View style={styles.arcCenter} pointerEvents="none">
        <VerifiedValue
          value={formatCurrency(spent, currency, { compact: true })}
          style={[t.typography.title3, { color: t.colors.text_primary, fontWeight: "700", fontVariant: ["tabular-nums"] }]}
        />
        <Text style={{ fontSize: 15, color, fontWeight: "700", marginTop: 2, fontVariant: ["tabular-nums"] }}>
          {pctDisplay == null ? "—" : `${pctDisplay}%`}
        </Text>
      </View>
    </Animated.View>
  );
}

export function OverviewBudgetTodayCard({
  spent,
  budget,
  currency,
  usedPct,
  danger,
  todaySynced = true,
  staggerIndex = 0,
}: {
  spent: number;
  budget: number;
  currency?: string;
  usedPct: number;
  danger: boolean;
  /** False when today's Ads metrics are not imported yet — do not imply $0 spend. */
  todaySynced?: boolean;
  staggerIndex?: number;
}) {
  const t = useTheme();
  const remaining = Math.max(0, budget - spent);
  const barPct = budget > 0 && todaySynced ? Math.min(1, Math.max(0, spent / budget)) : 0;
  const barColor = danger
    ? t.colors.tone_danger
    : usedPct >= 80
      ? t.colors.tone_warning
      : t.colors.tone_primary;

  return (
    <OpsCardShell staggerIndex={staggerIndex} toneWash={barColor + "24"} testID="overview-budget-today">
      <OverviewCardHeader title="Budget today" icon="adSpend" />
      <View style={styles.budgetBody}>
        <OverviewBudgetArc
          spent={todaySynced ? spent : 0}
          budget={budget}
          currency={currency}
          size={124}
        />
        <View style={styles.budgetCopy}>
          <Text style={[t.typography.title3, { color: t.colors.text_primary, fontWeight: "700" }]}>
            {!todaySynced
              ? "Today not synced yet"
              : budget > 0
                ? `${Math.round(usedPct)}% used`
                : "Spend so far"}
          </Text>
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]}>
            {todaySynced
              ? `${formatCurrency(spent, currency, { compact: true })}${
                  budget > 0 ? ` of ${formatCurrency(budget, currency, { compact: true })}` : ""
                }`
              : budget > 0
                ? `Daily budget ${formatCurrency(budget, currency, { compact: true })}`
                : "Waiting for today’s Ads sync"}
          </Text>
          {budget > 0 && todaySynced ? (
            <View style={styles.meterTrack}>
              <View
                style={[
                  styles.meterFill,
                  {
                    width: barPct > 0 ? `${barPct * 100}%` : 0,
                    backgroundColor: barColor,
                  },
                ]}
              />
            </View>
          ) : null}
          {budget > 0 && todaySynced ? (
            <View style={styles.chipRow}>
              <StatusChip
                label={`${formatCurrency(remaining, currency, { compact: true })} left`}
                tone={danger ? "danger" : "primary"}
                t={t}
              />
            </View>
          ) : null}
          {danger && todaySynced ? (
            <Text style={[t.typography.caption1, { color: t.colors.tone_warning, marginTop: 8 }]}>
              Daily budget is almost gone.
            </Text>
          ) : null}
        </View>
      </View>
    </OpsCardShell>
  );
}

export function OverviewBidBotCard({
  autoMode,
  pendingCount,
  lastRunAt,
  targetAcos,
  recommendations,
  statusError,
  onPress,
  staggerIndex = 1,
}: {
  autoMode?: string | null;
  pendingCount?: number | null;
  lastRunAt?: string | null;
  targetAcos?: number | null;
  recommendations?: number | null;
  statusError?: boolean;
  onPress: () => void;
  staggerIndex?: number;
}) {
  const t = useTheme();
  const mode = String(autoMode || "off");
  const live = mode !== "off";
  const ready = (pendingCount ?? 0) > 0;
  const accent = ready
    ? t.colors.tone_warning
    : live
      ? t.colors.tone_good
      : t.colors.tone_inactive;
  const copy = bidBotOperationalCopy({ autoMode, pendingCount, lastRunAt });

  return (
    <StaggerReveal index={staggerIndex}>
      <View style={{ marginTop: dashboard.sectionGap }}>
        <SwipeOpen
          onOpen={onPress}
          accessibilityLabel="Open BidBot"
          accessibilityHint="Opens BidBot. Swipe left also opens."
        >
          <GlassPanel
            testID="overview-bidbot"
            strength="card"
            style={[
              {
                borderRadius: dashboard.cardRadius,
                borderCurve: "continuous",
                borderColor: t.colors.glass_stroke,
                overflow: "hidden",
              },
              t.shadow.card,
            ]}
            contentStyle={{ padding: 0 }}
          >
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: accent, opacity: live ? 0.08 : 0.04 }]}
            />
            <View style={[styles.accentEdge, { backgroundColor: accent }]} />
            <View style={{ padding: dashboard.cardPadding, paddingLeft: dashboard.cardPadding + 4 }}>
              <OverviewCardHeader title="BidBot" icon="bidBot" />
              {statusError ? (
                <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 10 }]}>
                  Status unavailable. Open BidBot to retry.
                </Text>
              ) : (
                <View style={styles.bidBody}>
                  <View style={styles.bidTitleRow}>
                    <View style={styles.liveWrap}>
                      {live ? (
                        <View style={[styles.liveHalo, { backgroundColor: accent, opacity: 0.35 }]} />
                      ) : null}
                      <View style={[styles.liveDot, { backgroundColor: accent }]} />
                    </View>
                    <Text
                      style={[t.typography.title3, { color: t.colors.text_primary, fontWeight: "700", flex: 1 }]}
                      numberOfLines={2}
                    >
                      {copy.title.replace(/^BidBot\s+/, "")}
                    </Text>
                    <SFSymbol name="chevron.right" size={14} color={t.colors.text_tertiary} />
                  </View>
                  <View style={styles.chipRow}>
                    <StatusChip label={autoModeLabel(autoMode)} tone={live ? "good" : "inactive"} t={t} />
                    <StatusChip
                      label={`Target ${targetAcos != null ? formatPercent(targetAcos, 0) : "—"}`}
                      tone="primary"
                      t={t}
                    />
                    {recommendations != null ? (
                      <StatusChip
                        label={`${formatInt(recommendations)} recs`}
                        tone={ready ? "warning" : "neutral"}
                        t={t}
                      />
                    ) : null}
                  </View>
                  <Text style={[t.typography.caption1, { color: t.colors.text_tertiary, marginTop: 10 }]}>
                    {lastRunAt
                      ? `Last run ${formatDateShort(String(lastRunAt).slice(0, 10))}`
                      : "No run recorded yet"}
                    {" · Swipe left to open"}
                  </Text>
                </View>
              )}
            </View>
          </GlassPanel>
        </SwipeOpen>
      </View>
    </StaggerReveal>
  );
}

export function OverviewAutomationCard({
  rulesRun,
  edits,
  batches,
  onOpenRules,
  staggerIndex = 2,
}: {
  rulesRun: number;
  edits: number;
  batches: number;
  onOpenRules: () => void;
  staggerIndex?: number;
}) {
  const t = useTheme();
  const stats = [
    { label: "Rules run", value: rulesRun, icon: "automation" as const, tone: t.colors.tone_primary },
    { label: "Edits", value: edits, icon: "targeting" as const, tone: t.colors.tone_warning },
    { label: "Batches", value: batches, icon: "sync" as const, tone: t.colors.tone_good },
  ];

  return (
    <StaggerReveal index={staggerIndex}>
      <View style={{ marginTop: dashboard.sectionGap }}>
        <SwipeOpen
          onOpen={onOpenRules}
          accessibilityLabel="Open Automation rules"
          accessibilityHint="Opens rules. Swipe left also opens."
        >
          <GlassPanel
            testID="overview-automation"
            strength="card"
            style={[
              {
                borderRadius: dashboard.cardRadius,
                borderCurve: "continuous",
                borderColor: t.colors.glass_stroke,
                overflow: "hidden",
              },
              t.shadow.card,
            ]}
            contentStyle={{ padding: 0 }}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[t.colors.tone_primary + "1A", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={{ padding: dashboard.cardPadding }}>
              <OverviewCardHeader
                title="Automation"
                icon="automation"
                actionLabel="Rules"
                onAction={onOpenRules}
              />
              <View style={styles.autoGrid}>
                {stats.map((stat) => (
                  <View
                    key={stat.label}
                    style={[
                      styles.autoTile,
                      {
                        backgroundColor: t.scheme === "dark" ? "#FFFFFF0A" : "#FFFFFFCC",
                        borderColor: t.colors.border,
                      },
                    ]}
                  >
                    <View style={[styles.autoIconWell, { backgroundColor: stat.tone + "1A" }]}>
                      <InteliAdsIcon name={stat.icon} size={14} color={stat.tone} />
                    </View>
                    <Text style={[t.typography.caption2, { color: t.colors.text_secondary, marginTop: 8 }]}>
                      {stat.label}
                    </Text>
                    <VerifiedValue
                      value={formatInt(stat.value)}
                      style={[
                        t.typography.title2,
                        {
                          color: t.colors.text_primary,
                          fontWeight: "700",
                          marginTop: 2,
                          fontVariant: ["tabular-nums"],
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
            </View>
          </GlassPanel>
        </SwipeOpen>
      </View>
    </StaggerReveal>
  );
}

const styles = StyleSheet.create({
  budgetBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 12,
  },
  budgetCopy: {
    flex: 1,
    minWidth: 0,
  },
  arcGlow: {
    position: "absolute",
  },
  arcCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  meterTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(120,120,128,0.18)",
    marginTop: 12,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 999,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  accentEdge: {
    position: "absolute",
    left: 0,
    top: 12,
    bottom: 12,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  bidBody: {
    marginTop: 10,
    gap: 2,
  },
  bidTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 28,
  },
  liveWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  liveHalo: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  autoGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  autoTile: {
    flex: 1,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 12,
    minHeight: 96,
  },
  autoIconWell: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
});
