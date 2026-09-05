import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { OverviewCardHeader } from "@/src/components/DashboardSurface";
import { GlassPanel } from "@/src/components/GlassPanel";
import type { InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { HorizonPane, PressableScale, StaggerReveal } from "@/src/components/Motion";
import { motion } from "@/src/lib/motion";
import { dashboard, useReduceMotion, useTheme, type Theme } from "@/src/lib/theme";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export type OverviewSwipePage = {
  key: string;
  label: string;
  hint?: string;
  content: React.ReactNode;
  hidden?: boolean;
};

/**
 * Nested horizontal FlatList/ScrollView collapses content height inside the
 * Overview vertical ScrollView. Page via dots instead so all 7 rows keep height.
 */
export function OverviewSwipeWidget({
  title,
  icon,
  pages,
  actionLabel,
  onAction,
  action,
  testID,
  staggerIndex = 0,
}: {
  title: string;
  icon?: InteliAdsIconName;
  pages: OverviewSwipePage[];
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
  testID?: string;
  staggerIndex?: number;
}) {
  const t = useTheme();
  const visiblePages = useMemo(() => pages.filter((page) => !page.hidden), [pages]);
  const visibleKey = visiblePages.map((page) => page.key).join("|");
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [visibleKey]);

  const pageCount = visiblePages.length;
  const safeIndex = pageCount === 0 ? 0 : Math.max(0, Math.min(pageIndex, pageCount - 1));
  const page = visiblePages[safeIndex];

  const goTo = useCallback(
    (next: number) => {
      setPageIndex((current) => {
        const clamped = Math.max(0, Math.min(next, pageCount - 1));
        return clamped === current ? current : clamped;
      });
    },
    [pageCount],
  );

  const swipe = useMemo(() => {
    if (pageCount < 2) return Gesture.Pan().enabled(false);
    return Gesture.Pan()
      .activeOffsetX([-18, 18])
      .failOffsetY([-16, 16])
      .onEnd((event) => {
        if (event.translationX < -36) runOnJS(goTo)(safeIndex + 1);
        else if (event.translationX > 36) runOnJS(goTo)(safeIndex - 1);
      });
  }, [goTo, pageCount, safeIndex]);

  if (visiblePages.length === 0 || !page) return null;

  return (
    <StaggerReveal index={staggerIndex}>
    <GlassPanel
      strength="card"
      testID={testID}
      style={{
        marginTop: dashboard.sectionGap,
        borderRadius: dashboard.cardRadius,
        borderCurve: "continuous",
        borderColor: t.colors.glass_stroke,
      }}
      contentStyle={{ padding: dashboard.cardPadding }}
    >
      <OverviewCardHeader title={title} icon={icon} actionLabel={actionLabel} onAction={onAction} action={action} />
      <GestureDetector gesture={swipe}>
        <View style={{ marginTop: dashboard.compactGap }} accessibilityLabel="overview-swipe-page">
          <HorizonPane watchKey={page.key}>
            <View style={styles.pageHeader}>
              <Text style={[t.typography.subhead, { color: t.colors.text_primary, fontWeight: "600" }]} numberOfLines={1}>
                {page.label}
              </Text>
              {page.hint ? (
                <Text style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]} numberOfLines={2}>
                  {page.hint}
                </Text>
              ) : null}
            </View>
            {page.content}
          </HorizonPane>
        </View>
      </GestureDetector>
      {visiblePages.length > 1 ? (
        <PageDots
          count={visiblePages.length}
          active={safeIndex}
          t={t}
          onSelect={setPageIndex}
          labels={visiblePages.map((item) => item.label)}
        />
      ) : null}
    </GlassPanel>
    </StaggerReveal>
  );
}

function PageDots({
  count,
  active,
  t,
  onSelect,
  labels,
}: {
  count: number;
  active: number;
  t: Theme;
  onSelect: (index: number) => void;
  labels: string[];
}) {
  return (
    <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel={`Page ${active + 1} of ${count}`}>
      {Array.from({ length: count }, (_, index) => (
        <AnimatedDot
          key={index}
          active={index === active}
          t={t}
          onPress={() => onSelect(index)}
          label={labels[index] ?? `Page ${index + 1}`}
        />
      ))}
    </View>
  );
}

function AnimatedDot({
  active,
  t,
  onPress,
  label,
}: {
  active: boolean;
  t: Theme;
  onPress: () => void;
  label: string;
}) {
  const reduceMotion = useReduceMotion();
  const width = useSharedValue(active ? 16 : 6);
  const opacity = useSharedValue(active ? 1 : 0.55);

  useEffect(() => {
    if (reduceMotion) {
      width.set(active ? 16 : 6);
      opacity.set(active ? 1 : 0.55);
      return;
    }
    width.set(withTiming(active ? 16 : 6, { duration: motion.fastState, easing: EASE_OUT }));
    opacity.set(withTiming(active ? 1 : 0.55, { duration: motion.fastState, easing: EASE_OUT }));
  }, [active, opacity, reduceMotion, width]);

  const style = useAnimatedStyle(() => ({
    width: width.get(),
    opacity: opacity.get(),
  }));

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: active ? t.colors.tone_primary : t.colors.background_tertiary },
          style,
        ]}
      />
    </PressableScale>
  );
}

export function SwipeEmpty({ message, t }: { message: string; t: Theme }) {
  return (
    <Text style={[t.typography.meta, { color: t.colors.text_secondary, paddingVertical: t.spacing.sm }]}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    marginBottom: dashboard.compactGap,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: dashboard.compactGap,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
