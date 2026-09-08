import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { BrandIcon } from "./Primitives";

export function DynamicIsland() {
  const t = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { selectedProfileIds, profiles, notificationRuntime } = useApp();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const hidden = useMemo(() => {
    const root = (segments as unknown as string[])[0];
    return state !== "authenticated" || root === "auth" || root === "index";
  }, [segments, state]);

  if (hidden) return null;

  const ready = notificationRuntime.permission === "granted";
  const selected = selectedProfileIds.length;
  const enabledTotal = profiles.filter((p) => p.is_enabled !== false).length;
  const total = enabledTotal > 0 ? enabledTotal : profiles.length;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: Math.max(8, insets.top - 2) }]}>
      <Pressable
        accessibilityRole="button"
        testID="dynamic-island"
        onPress={() => router.push("/more/sync")}
        style={[styles.pressable, t.shadow.floating]}
      >
        <BlurView tint={t.scheme === "dark" ? "dark" : "light"} intensity={88} style={styles.blur}>
          <LinearGradient
            colors={t.scheme === "dark" ? ["#111827CC", "#020617DD"] : ["#FFFFFFE6", "#EEF6FFE6"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.inner}>
            <View style={styles.logoMark}>
              <BrandIcon size={22} radius={6} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: t.colors.text_primary }]} numberOfLines={1}>
                {selected > 0
                  ? `${selected}/${total || selected} active`
                  : "No profile"}
              </Text>
              <Text style={[styles.subtitle, { color: t.colors.text_secondary }]} numberOfLines={1}>
                {ready ? "alerts ready" : "alerts pending"}
              </Text>
            </View>
            <View style={[styles.signal, { backgroundColor: ready ? t.colors.tone_good + "1F" : t.colors.tone_warning + "1F" }]}>
              <Animated.View
                style={[
                  styles.signalPulse,
                  {
                    backgroundColor: ready ? t.colors.tone_good : t.colors.tone_warning,
                    opacity,
                    transform: [{ scale }],
                  },
                ]}
              />
              <Ionicons
                name={ready ? "radio-outline" : "notifications-outline"}
                size={15}
                color={ready ? t.colors.tone_good : t.colors.tone_warning}
              />
            </View>
          </View>
        </BlurView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: "center",
  },
  pressable: {
    width: 214,
    height: 44,
    borderRadius: 22,
    overflow: Platform.OS === "ios" ? "hidden" : "visible",
  },
  blur: {
    flex: 1,
    borderRadius: 22,
    overflow: "hidden",
  },
  inner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 9,
  },
  logoMark: {
    width: 25,
    height: 25,
    borderRadius: 8,
    backgroundColor: "#007AFF18",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 16,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 12,
    textTransform: "uppercase",
  },
  signal: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  signalPulse: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
  },
});
