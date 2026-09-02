import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, type StyleProp, type TextProps, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { PRESS_SCALE, motion, shouldCrossfadeMetric } from "@/src/lib/motion";
import { useReduceMotion } from "@/src/lib/theme";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PRESS_SPRING = { damping: 22, stiffness: 420, mass: 0.35 };

let overviewFirstRevealDone = false;

export function resetOverviewFirstReveal() {
  overviewFirstRevealDone = false;
}

export function PressableScale({
  children,
  onPress,
  disabled,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "none" | "tab";
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * (1 - PRESS_SCALE) }],
    opacity: 1 - pressed.get() * 0.04,
  }));

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        pressed.set(
          reduceMotion
            ? 1
            : withSpring(1, PRESS_SPRING),
        );
      }}
      onPressOut={() => {
        pressed.set(
          reduceMotion
            ? 0
            : withSpring(0, PRESS_SPRING),
        );
      }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={hitSlop}
      accessibilityState={
        accessibilityState || disabled
          ? { ...accessibilityState, disabled: disabled || accessibilityState?.disabled }
          : undefined
      }
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * Crossfade verified strings (and optional color). Slight Y tick on swap so
 * chart-day scrubbing feels alive without inventing a $0 start.
 */
export function VerifiedValue({
  value,
  color,
  style,
  ...props
}: TextProps & { value: string; color?: string }) {
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(value);
  const [shownColor, setShownColor] = useState(color);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  const gen = useRef(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: translateY.get() }],
  }));

  useEffect(() => {
    if (value === shown && color === shownColor) return;
    const id = ++gen.current;
    if (reduceMotion || !shouldCrossfadeMetric(shown, value)) {
      setShown(value);
      setShownColor(color);
      opacity.set(1);
      translateY.set(0);
      return;
    }
    opacity.set(withTiming(0.28, { duration: motion.fastState / 2, easing: EASE_OUT }));
    translateY.set(withTiming(4, { duration: motion.fastState / 2, easing: EASE_OUT }));
    const timer = setTimeout(() => {
      if (id !== gen.current) return;
      setShown(value);
      setShownColor(color);
      translateY.set(-3);
      opacity.set(withTiming(1, { duration: motion.contentChange, easing: EASE_OUT }));
      translateY.set(withTiming(0, { duration: motion.contentChange, easing: EASE_OUT }));
    }, motion.fastState / 2);
    return () => clearTimeout(timer);
  }, [color, opacity, reduceMotion, shown, shownColor, translateY, value]);

  return (
    <Animated.Text
      {...props}
      style={[style, animatedStyle, shownColor != null ? { color: shownColor } : null]}
    >
      {shown}
    </Animated.Text>
  );
}

/** Opacity + Y settle when a sibling pane key changes (period, swipe page). */
export function HorizonPane({
  watchKey,
  children,
  style,
}: {
  watchKey: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const first = useRef(true);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: translateY.get() }],
  }));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduceMotion) {
      opacity.set(1);
      translateY.set(0);
      return;
    }
    opacity.set(0.88);
    translateY.set(4);
    opacity.set(withTiming(1, { duration: motion.segmentTransition, easing: EASE_OUT }));
    translateY.set(withTiming(0, { duration: motion.segmentTransition, easing: EASE_OUT }));
  }, [opacity, reduceMotion, translateY, watchKey]);

  return (
    <Animated.View style={[style, animatedStyle]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

/**
 * Smooth scrub cursor for chart day selection (opacity + position only).
 * Sits above the SVG so Reanimated can drive it without SVG bindings.
 */
export function ChartScrubCursor({
  x,
  y,
  plotTop,
  plotBottom,
  color,
  visible,
  stroke,
}: {
  x: number;
  y: number;
  plotTop: number;
  plotBottom: number;
  color: string;
  visible: boolean;
  stroke: string;
}) {
  const reduceMotion = useReduceMotion();
  const ax = useSharedValue(x);
  const ay = useSharedValue(y);
  const op = useSharedValue(visible ? 1 : 0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      ax.set(x);
      ay.set(y);
      op.set(visible ? 1 : 0);
      return;
    }
    if (reduceMotion) {
      ax.set(x);
      ay.set(y);
      op.set(visible ? 1 : 0);
      return;
    }
    ax.set(withTiming(x, { duration: motion.fastState, easing: EASE_OUT }));
    ay.set(withTiming(y, { duration: motion.fastState, easing: EASE_OUT }));
    op.set(withTiming(visible ? 1 : 0, { duration: motion.fastState, easing: EASE_OUT }));
  }, [ax, ay, op, reduceMotion, visible, x, y]);

  const lineStyle = useAnimatedStyle(() => ({
    opacity: op.get() * 0.22,
    transform: [{ translateX: ax.get() }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: op.get() * 0.18,
    transform: [{ translateX: ax.get() - 16 }, { translateY: ay.get() - 16 }, { scale: 0.9 + op.get() * 0.12 }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: op.get() * 0.9,
    transform: [{ translateX: ax.get() - 8 }, { translateY: ay.get() - 8 }, { scale: 0.94 + op.get() * 0.06 }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: op.get(),
    transform: [{ translateX: ax.get() - 4.5 }, { translateY: ay.get() - 4.5 }],
  }));

  const lineHeight = Math.max(0, plotBottom - plotTop);

  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: plotTop,
            width: StyleSheet.hairlineWidth * 2 || 1,
            height: lineHeight,
            backgroundColor: color,
            marginLeft: -0.5,
          },
          lineStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: color,
          },
          glowStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 1.5,
            borderColor: color,
            backgroundColor: "transparent",
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            top: 0,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: color,
            borderWidth: 2,
            borderColor: stroke,
          },
          dotStyle,
        ]}
      />
    </Animated.View>
  );
}

/** Staggered entrance for stacked Overview widgets — opacity + Y only. */
export function StaggerReveal({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : 10);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: translateY.get() }],
  }));

  useEffect(() => {
    if (reduceMotion) {
      opacity.set(1);
      translateY.set(0);
      return;
    }
    const delay = Math.min(index, 8) * motion.staggerStep;
    const timer = setTimeout(() => {
      opacity.set(withTiming(1, { duration: motion.glassSettle, easing: EASE_OUT }));
      translateY.set(withTiming(0, { duration: motion.glassSettle, easing: EASE_OUT }));
    }, delay);
    return () => clearTimeout(timer);
  }, [index, opacity, reduceMotion, translateY]);

  return (
    <Animated.View style={[style, animatedStyle]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}

export function FirstReveal({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const already = overviewFirstRevealDone;
  const opacity = useSharedValue(already || reduceMotion ? 1 : 0.92);
  const translateY = useSharedValue(already || reduceMotion ? 0 : 6);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: translateY.get() }],
  }));

  useEffect(() => {
    if (already || reduceMotion) {
      overviewFirstRevealDone = true;
      opacity.set(1);
      translateY.set(0);
      return;
    }
    opacity.set(withTiming(1, { duration: motion.contentChange, easing: EASE_OUT }));
    translateY.set(withTiming(0, { duration: motion.contentChange, easing: EASE_OUT }));
    overviewFirstRevealDone = true;
  }, [already, opacity, reduceMotion, translateY]);

  return (
    <Animated.View style={[style, animatedStyle]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}
