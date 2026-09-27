import { useCallback, useEffect } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { motion } from "@/src/lib/motion";

/** Hide TopBar+filters after scrolling past this offset. */
export const SCROLL_CHROME_HIDE_Y = 96;
/** Reveal again when the list returns near the top. */
export const SCROLL_CHROME_SHOW_Y = 28;
/** Min |Δy| before mid-list direction flips chrome (avoids jitter). */
export const SCROLL_CHROME_DIR_DELTA = 8;

/** Primitive duration for worklets — do not close over the `motion` object. */
const CHROME_TIMING_MS = motion.glassSettle;

type CollapseOpts = {
  /** AccessibilityInfo reduce-motion — snap without timing. */
  reduceMotion?: boolean;
};

/**
 * Soft scroll-hide for list chrome (Books entities hero).
 * Keeps TopBar / filters mounted (profile sheet + search stay reachable after
 * scroll-up). Animates opacity + translateY + negative margin so vertical
 * space returns to the list without LayoutAnimation mount/unmount pops.
 */
export function useScrollChromeCollapse(opts?: CollapseOpts) {
  const reduceMotion = !!opts?.reduceMotion;
  const progress = useSharedValue(0);
  const measuredH = useSharedValue(0);
  const lastY = useSharedValue(0);
  const reduceSV = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    reduceSV.value = reduceMotion ? 1 : 0;
  }, [reduceMotion, reduceSV]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      const y = Math.max(0, event.contentOffset.y);
      const dy = y - lastY.value;
      lastY.value = y;
      const duration = reduceSV.value ? 0 : CHROME_TIMING_MS;
      const timing = { duration, easing: Easing.out(Easing.cubic) };

      if (y <= SCROLL_CHROME_SHOW_Y) {
        if (progress.value !== 0) {
          progress.value = withTiming(0, timing);
        }
        return;
      }

      if (progress.value < 0.5) {
        // Visible → hide on sustained downward scroll past threshold.
        if (y >= SCROLL_CHROME_HIDE_Y && dy >= SCROLL_CHROME_DIR_DELTA) {
          progress.value = withTiming(1, timing);
        }
      } else if (dy <= -SCROLL_CHROME_DIR_DELTA) {
        // Hidden → show on upward scroll (near-top handled above).
        progress.value = withTiming(0, timing);
      }
    },
  });

  const chromeAnimatedStyle = useAnimatedStyle(() => {
    const h = measuredH.value > 0 ? measuredH.value : 0;
    const p = progress.value;
    return {
      transform: [{ translateY: -h * p }],
      opacity: 1 - p * 0.95,
      // Recover layout height so book rows claim the freed space.
      marginBottom: -h * p,
    };
  });

  const onChromeLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const h = event.nativeEvent.layout.height;
      if (!(h > 0)) return;
      // Ignore sub-pixel churn from hairlines / safe-area.
      if (Math.abs(h - measuredH.value) < 1) return;
      measuredH.value = h;
    },
    [measuredH],
  );

  return {
    progress: progress as SharedValue<number>,
    onScroll,
    chromeAnimatedStyle,
    onChromeLayout,
    scrollEventThrottle: 16 as const,
  };
}
