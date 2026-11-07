import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { motion } from "@/src/lib/motion";
import { nextSyncFeedback, type SyncFeedbackState, type SyncReadEvidence } from "@/src/lib/syncFeedback";
import { useReduceMotion, useTheme } from "@/src/lib/theme";

/** Decorative feedback only: neither its border nor its motion changes layout. */
export function SyncGlowFrame({
  read,
  contextKey,
  visible = true,
  radius,
  testID,
  children,
}: {
  read: SyncReadEvidence;
  contextKey: string;
  visible?: boolean;
  radius: number;
  testID?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const reduceMotion = useReduceMotion();
  const glow = useSharedValue(0);
  const previous = useRef<SyncFeedbackState | null>(null);
  const [phase, setPhase] = useState<SyncFeedbackState["phase"]>("idle");
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const { fetching, failed, updatedAt, received } = read;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    cancelAnimation(glow);
    const next = nextSyncFeedback(previous.current, contextKey, { fetching, failed, updatedAt, received }, visible && foreground);
    previous.current = next;
    setPhase(next.phase);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (next.phase === "updating") {
      glow.set(reduceMotion ? 0.35 : 0.12);
      if (!reduceMotion) glow.set(withRepeat(withTiming(0.48, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true));
    } else if (next.phase === "success") {
      glow.set(reduceMotion ? 0.35 : 0.48);
      timer = setTimeout(() => glow.set(withTiming(0, { duration: reduceMotion ? 100 : motion.updateEmphasis })), reduceMotion ? 250 : 700);
    } else {
      glow.set(0);
    }
    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimation(glow);
    };
  }, [contextKey, failed, fetching, foreground, glow, received, reduceMotion, updatedAt, visible]);

  const borderStyle = useAnimatedStyle(() => ({
    opacity: glow.get(),
  }));
  const color = phase === "success" ? t.colors.tone_good : t.colors.tone_primary;

  return (
    <View style={styles.frame}>
      {children}
      <Animated.View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={testID}
        style={[styles.border, { borderRadius: radius, borderColor: color, shadowColor: color }, borderStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: "relative" },
  border: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
});
