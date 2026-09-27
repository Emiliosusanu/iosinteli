import React, { useCallback } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { playHaptic } from "@/src/lib/hapticPolicy";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const PRESS_MS = 120;

/** Occasional Create-flow entrance — respects Reduce Motion. */
export function CreateReveal({
  delay = 0,
  children,
  style,
}: {
  delay?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const entering = reduceMotion
    ? undefined
    : FadeInDown.delay(delay).duration(280).easing(EASE_OUT);
  return (
    <Animated.View entering={entering} style={[{ overflow: "visible" }, style]}>
      {children}
    </Animated.View>
  );
}

/** Sticky chrome appear/disappear without layout thrash. */
export function CreateStickyReveal({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const entering = reduceMotion
    ? undefined
    : FadeIn.duration(180).easing(EASE_OUT);
  const exiting = reduceMotion
    ? undefined
    : FadeOut.duration(140).easing(EASE_OUT);
  return (
    <Animated.View entering={entering} exiting={exiting}>
      {children}
    </Animated.View>
  );
}

type ScalePressableProps = PressableProps & {
  style?: StyleProp<ViewStyle>;
  /** Fire selection haptic on press (marketplace / match chips). */
  hapticSelect?: boolean;
};

/**
 * Press scale 0.97 on the UI thread — feedback for Create chips/rows.
 */
export function CreateScalePressable({
  children,
  style,
  onPressIn,
  onPressOut,
  onPress,
  hapticSelect,
  disabled,
  ...rest
}: ScalePressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePressIn = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) => {
      scale.set(
        withTiming(0.97, {
          duration: reduceMotion ? 1 : PRESS_MS,
          easing: EASE_OUT,
        }),
      );
      onPressIn?.(e);
    },
    [onPressIn, reduceMotion, scale],
  );
  const handlePressOut = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) => {
      scale.set(
        withTiming(1, {
          duration: reduceMotion ? 1 : PRESS_MS,
          easing: EASE_OUT,
        }),
      );
      onPressOut?.(e);
    },
    [onPressOut, reduceMotion, scale],
  );
  const handlePress = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPress"]>>[0]) => {
      if (hapticSelect) void playHaptic("select", !!reduceMotion);
      onPress?.(e);
    },
    [hapticSelect, onPress, reduceMotion],
  );

  return (
    <Pressable
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      {...rest}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
