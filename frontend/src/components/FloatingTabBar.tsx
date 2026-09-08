import React, { useMemo } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InteliAdsIcon, type InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { PressableScale } from "@/src/components/Motion";
import { SFSymbol } from "@/src/components/ios/Native";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { motion } from "@/src/lib/motion";
import { dashboard, density, layout, useReduceMotion, useTheme } from "@/src/lib/theme";

const BAR_HEIGHT = dashboard.tabBarHeight;
const H_PAD = 4;

type TabVisual = {
  label: string;
  kind: "product" | "system";
  product?: InteliAdsIconName;
  system?: "ellipsis.circle" | "ellipsis.circle.fill";
};

const TAB_VISUAL: Record<string, TabVisual> = {
  index: { label: "Overview", kind: "product", product: "overview" },
  campaigns: { label: "Campaigns", kind: "product", product: "campaigns" },
  targeting: { label: "Targets", kind: "product", product: "targeting" },
  products: { label: "Books", kind: "product", product: "books" },
  more: { label: "More", kind: "system", system: "ellipsis.circle" },
};

/** Loose props — expo-router nests its own @react-navigation copy. */
type FloatingTabBarProps = {
  state: {
    index: number;
    routes: { key: string; name: string; params?: object }[];
  };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarAccessibilityLabel?: string;
      };
    }
  >;
  navigation: {
    emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string, params?: object) => void;
  };
};

function TabItemInner({
  focused,
  activeWell,
  children,
}: {
  focused: boolean;
  activeWell: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(focused ? 1 : 0);
  React.useEffect(() => {
    progress.set(
      reduceMotion
        ? focused
          ? 1
          : 0
        : withTiming(focused ? 1 : 0, { duration: motion.fastState }),
    );
  }, [focused, progress, reduceMotion]);
  const wellStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.get() * 0.65,
    transform: [{ scale: 0.96 + progress.get() * 0.04 }],
    backgroundColor: activeWell,
  }));
  return (
    <Animated.View style={[styles.itemInner, focused ? wellStyle : null]}>
      {children}
    </Animated.View>
  );
}

/**
 * Floating dock: denser (less glass) fill, press scale, soft active-well motion.
 * No live frosted blur under tab routes (chrome stacking cost).
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  const index = state.index;
  const bottomPad = Math.max(insets.bottom, density.chromeGap);

  const shell = useMemo(
    () => ({
      bar: t.colors.tabbar_background,
      stroke: t.scheme === "dark" ? t.colors.glass_stroke : "rgba(0,0,0,0.10)",
      inactive: t.colors.text_tertiary,
      active: t.colors.tone_primary,
      activeWell: t.scheme === "dark" ? "rgba(47,124,255,0.22)" : "rgba(0,122,255,0.14)",
    }),
    [t.colors, t.scheme],
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: bottomPad }]}>
      <View style={styles.shadowLift}>
        <View style={[styles.capsule, { borderColor: shell.stroke, backgroundColor: shell.bar }]}>
          <View style={styles.track}>
            {routes.map((route, i) => {
              const focused = index === i;
              const { options } = descriptors[route.key];
              const visual = TAB_VISUAL[route.name] ?? {
                label: options.title ?? route.name,
                kind: "product" as const,
                product: "overview" as InteliAdsIconName,
              };
              const color = focused ? shell.active : shell.inactive;
              const a11y =
                options.tabBarAccessibilityLabel ??
                options.title ??
                visual.label;

              const onPress = () => {
                playHaptic("select");
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              };

              return (
                <PressableScale
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityState={focused ? { selected: true } : {}}
                  accessibilityLabel={a11y}
                  testID={`tab-${route.name}`}
                  onPress={onPress}
                  style={styles.item}
                >
                  <TabItemInner focused={focused} activeWell={shell.activeWell}>
                    {visual.kind === "product" && visual.product ? (
                      <InteliAdsIcon
                        name={visual.product}
                        size={dashboard.iconMd}
                        color={color}
                        selected={focused}
                        state={focused ? "selected" : "default"}
                      />
                    ) : (
                      <SFSymbol
                        name={focused ? "ellipsis.circle.fill" : "ellipsis.circle"}
                        size={dashboard.iconMd}
                        color={color}
                      />
                    )}
                    <Text numberOfLines={1} style={[styles.label, { color }]}>
                      {visual.label}
                    </Text>
                  </TabItemInner>
                </PressableScale>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: dashboard.pageInset,
  },
  shadowLift: {
    width: "100%",
    maxWidth: 430,
    borderRadius: dashboard.tabBarRadius,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.10,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  capsule: {
    height: BAR_HEIGHT,
    borderRadius: dashboard.tabBarRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  track: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: H_PAD,
  },
  item: {
    flex: 1,
    height: BAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    minHeight: layout.minTap,
  },
  itemInner: {
    minWidth: 56,
    maxWidth: 76,
    paddingHorizontal: 6,
    paddingVertical: density.chipPadV,
    borderRadius: dashboard.metricChipRadius,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
});
