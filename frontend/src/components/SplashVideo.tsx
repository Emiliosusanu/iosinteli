import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Animated, Image, AccessibilityInfo } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CHECKING_SESSION_LABEL } from "@/src/lib/authContract";

// Lightweight static logo (small PNG). The 7MB animated GIF was decoding at
// launch and could trip iOS's launch watchdog → app killed. The gentle pulse
// animation below keeps it feeling alive without the heavy asset.
const logo = require("../../assets/images/icon.png");

interface SplashVideoProps {
  // Called when the splash should hand off to the app.
  onFinish?: () => void;
  // Called after the React splash layer has painted at least once.
  onReady?: () => void;
  // When false, the splash begins fading out
  visible: boolean;
}

export function SplashVideo({ onFinish, onReady, visible }: SplashVideoProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.98)).current;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.015, duration: 1100, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 0.98, duration: 1100, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [scale]);

  // Fade out when no longer visible, then unmount
  useEffect(() => {
    if (!visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setHidden(true);
          onFinish?.();
        }
      });
    }
  }, [visible, opacity, onFinish]);

  if (hidden) return null;

  // White canvas matches the logo + native splash for a seamless handoff.
  const bg = "#FFFFFF";

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onReady}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={CHECKING_SESSION_LABEL}
      style={[StyleSheet.absoluteFill, styles.container, { backgroundColor: bg, opacity }]}
    >
      {/* Hide the status bar / Dynamic Island while the splash is up; restored on unmount */}
      <StatusBar hidden animated />
      <Animated.View style={[styles.logoWrap, { transform: [{ scale }] }]}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 220,
    height: 220,
  },
});
