import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { OverviewCardHeader } from "@/src/components/DashboardSurface";
import { GlassPanel } from "@/src/components/GlassPanel";
import type { InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { HorizonPane, PressableScale, StaggerReveal } from "@/src/components/Motion";
import { useOverviewPeriodSwipeGesture } from "@/src/components/OverviewPeriodSwipe";
import { OverviewWidgetPageSwipeContext } from "@/src/components/OverviewWidgetPageSwipe";
import { SFSymbol } from "@/src/components/ios/Native";
import { motion } from "@/src/lib/motion";
import { dashboard, useReduceMotion, useTheme, type Theme } from "@/src/lib/theme";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export type OverviewSwipePage = {
  key: string;
  label: string;
  /** Short caption under the card header (rare). */
  hint?: string;
  /** Tertiary caption under title (e.g. break-even %). */
  meta?: string;
  /** One-line metrics top-right of the header. */
  summary?: React.ReactNode;
  content: React.ReactNode;
  hidden?: boolean;
};

/**
 * Nested horizontal FlatList/ScrollView collapses content height inside the
 * Overview vertical ScrollView. Page via swipe + bottom dots + chevrons so height stays.
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
  /** @deprecated Page label is folded into the card title. Kept for call-site compat. */
  inlinePageLabel?: boolean;
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
  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < pageCount - 1;

  const goTo = useCallback(
    (next: number) => {
      setPageIndex((current) => {
        const clamped = Math.max(0, Math.min(next, pageCount - 1));
        return clamped === current ? current : clamped;
      });
    },
    [pageCount],
  );

  const periodSwipe = useOverviewPeriodSwipeGesture();
  const swipe = useMemo(() => {
    if (pageCount < 2) return Gesture.Pan().enabled(false);
    // Slightly firmer than chart scrub (±6) so a deliberate page swipe wins off-chart.
    const pan = Gesture.Pan()
      .activeOffsetX([-22, 22])
      .failOffsetY([-14, 14])
      .onEnd((event) => {
        if (event.translationX < -40) runOnJS(goTo)(safeIndex + 1);
        else if (event.translationX > 40) runOnJS(goTo)(safeIndex - 1);
      });
    if (periodSwipe) pan.blocksExternalGesture(periodSwipe);
    return pan;
  }, [goTo, pageCount, periodSwipe, safeIndex]);

  if (visiblePages.length === 0 || !page) return null;

  const pageLabel = page.label?.trim() ?? "";
  const headerTitle = pageLabel ? `${title} · ${pageLabel}` : title;

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
      <OverviewCardHeader
        title={headerTitle}
        icon={icon}
        actionLabel={actionLabel}
        onAction={onAction}
        action={action}
        meta={page.meta}
        trailing={page.summary}
      />
      {page.hint ? (
        <Text
          style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}
          numberOfLines={1}
        >
          {page.hint}
        </Text>
      ) : null}
      <OverviewWidgetPageSwipeContext.Provider value={pageCount > 1 ? swipe : null}>
      <View style={{ marginTop: dashboard.compactGap }} accessibilityLabel="overview-swipe-page">
        <HorizonPane watchKey={page.key}>
          <GestureDetector gesture={swipe}>
            <View>{page.content}</View>
          </GestureDetector>
        </HorizonPane>
      </View>
      </OverviewWidgetPageSwipeContext.Provider>
      {pageCount > 1 ? (
        <View style={styles.bottomNav} accessibilityLabel={`Page ${safeIndex + 1} of ${pageCount}`}>
          <PressableScale
            onPress={() => canGoPrev && goTo(safeIndex - 1)}
            disabled={!canGoPrev}
            accessibilityRole="button"
            accessibilityLabel="Previous widget page"
            accessibilityState={{ disabled: !canGoPrev }}
            hitSlop={10}
            style={styles.pageChevronHit}
          >
            <SFSymbol
              name="chevron.left"
              size={15}
              color={canGoPrev ? t.colors.tone_primary : t.colors.text_tertiary}
            />
          </PressableScale>
          <PageDots
            count={pageCount}
            active={safeIndex}
            t={t}
            onSelect={setPageIndex}
            labels={visiblePages.map((item) => item.label || item.key)}
          />
          <PressableScale
            onPress={() => canGoNext && goTo(safeIndex + 1)}
            disabled={!canGoNext}
            accessibilityRole="button"
            accessibilityLabel="Next widget page"
            accessibilityState={{ disabled: !canGoNext }}
            hitSlop={10}
            style={styles.pageChevronHit}
          >
            <SFSymbol
              name="chevron.right"
              size={15}
              color={canGoNext ? t.colors.tone_primary : t.colors.text_tertiary}
            />
          </PressableScale>
        </View>
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
  const width = useSharedValue(active ? 18 : 7);
  const opacity = useSharedValue(active ? 1 : 0.55);

  useEffect(() => {
    if (reduceMotion) {
      width.set(active ? 18 : 7);
      opacity.set(active ? 1 : 0.55);
      return;
    }
    width.set(withTiming(active ? 18 : 7, { duration: motion.fastState, easing: EASE_OUT }));
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
      hitSlop={12}
      style={styles.dotHit}
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
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: dashboard.compactGap,
    paddingVertical: 2,
  },
  pageChevronHit: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    paddingVertical: 4,
  },
  dotHit: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dot: {
    height: 7,
    borderRadius: 3.5,
  },
});
