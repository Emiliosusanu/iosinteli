import React, { useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenAmbient } from "@/src/components/ScreenAmbient";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Reanimated, { FadeIn, FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { InteliAdsIcon, type InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { dashboard, useReduceMotion, useTheme } from "@/src/lib/theme";
import { storage } from "@/src/utils/storage";

const ONBOARDED_KEY = "inteliads.onboarded";
const inteliadsIcon = require("../../assets/images/icon.png");

type Slide = { icon: InteliAdsIconName; title: string; body: string };

const SLIDES: Slide[] = [
  { icon: "netRoyalties", title: "Profit by book", body: "KDP royalties minus Amazon Ads spend, per title." },
  { icon: "attention", title: "Catch waste early", body: "High ACoS and $0 targets in one list." },
  { icon: "bidBot", title: "Change bids here", body: "Rules stay reviewable." },
];

export default function WelcomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  async function finish(target: "/auth/signup" | "/auth/login") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await storage.setItem(ONBOARDED_KEY, true);
    router.replace(target);
  }

  function next() {
    if (index < SLIDES.length - 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      listRef.current?.scrollToIndex({ index: index + 1, animated: !reduceMotion });
    } else {
      void finish("/auth/signup");
    }
  }

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: false,
    listener: (e: any) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      if (i !== index) setIndex(i);
    },
  });

  const isLast = index === SLIDES.length - 1;
  const enter = (value: any) => (reduceMotion ? undefined : value);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.colors.background_primary }]} edges={["top", "bottom"]}>
      <ScreenAmbient />
      <View style={styles.topBar}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} pointerEvents="none">
          <Image source={inteliadsIcon} style={{ width: 22, height: 22, borderRadius: 6 }} contentFit="contain" />
          <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>InteliAds</Text>
        </View>
        <TouchableOpacity
          testID="welcome-sign-in"
          onPress={() => void finish("/auth/login")}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          style={styles.signInHit}
        >
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Sign in</Text>
        </TouchableOpacity>
      </View>

      <Animated.FlatList
        ref={listRef as any}
        data={SLIDES}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
        renderItem={({ item }) => (
          <View style={{ width, paddingHorizontal: 28, alignItems: "center", justifyContent: "center", flex: 1 }}>
            <Reanimated.View entering={enter(FadeIn.duration(280))} style={styles.iconMark}>
              <InteliAdsIcon name={item.icon} size={dashboard.iconEmpty} color={t.colors.text_primary} />
            </Reanimated.View>
            <Reanimated.Text
              entering={enter(FadeInDown.delay(80).duration(380))}
              style={[t.typography.title1, { color: t.colors.text_primary, textAlign: "center", lineHeight: undefined }]}
            >
              {item.title}
            </Reanimated.Text>
            <Reanimated.Text
              entering={enter(FadeInDown.delay(140).duration(380))}
              style={[t.typography.body, { color: t.colors.text_secondary, textAlign: "center", marginTop: 10, lineHeight: undefined }]}
            >
              {item.body}
            </Reanimated.Text>
          </View>
        )}
      />

      <View style={styles.dots} accessibilityElementsHidden>
        {SLIDES.map((_, i) => {
          const w = scrollX.interpolate({
            inputRange: [(i - 1) * width, i * width, (i + 1) * width],
            outputRange: [6, 18, 6],
            extrapolate: "clamp",
          });
          const opacity = scrollX.interpolate({
            inputRange: [(i - 1) * width, i * width, (i + 1) * width],
            outputRange: [0.28, 1, 0.28],
            extrapolate: "clamp",
          });
          return (
            <Animated.View
              key={i}
              style={{ width: w, height: 6, borderRadius: 3, backgroundColor: t.colors.tone_primary, opacity, marginHorizontal: 3 }}
            />
          );
        })}
      </View>

      <Reanimated.View entering={enter(FadeInUp.delay(180).duration(400))} style={styles.footer}>
        <Reanimated.View style={pressStyle}>
          <Pressable
            testID="welcome-next"
            onPress={next}
            onPressIn={() => {
              if (reduceMotion) return;
              scale.value = withSpring(0.97, { damping: 16, stiffness: 320 });
            }}
            onPressOut={() => {
              if (reduceMotion) return;
              scale.value = withSpring(1, { damping: 16, stiffness: 320 });
            }}
            accessibilityRole="button"
            accessibilityLabel={isLast ? "Create account" : "Next"}
            style={[styles.primary, { backgroundColor: t.colors.tone_primary }]}
          >
            <Text style={[t.typography.headline, { color: t.colors.text_inverse }]}>{isLast ? "Create account" : "Next"}</Text>
          </Pressable>
        </Reanimated.View>
      </Reanimated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    zIndex: 2,
    elevation: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    minHeight: 44,
  },
  signInHit: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 8,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  pager: { flex: 1, zIndex: 0 },
  iconMark: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
    minHeight: 44,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  footer: {
    zIndex: 2,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  primary: {
    minHeight: 48,
    borderRadius: dashboard.metricChipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
});
