import React, { useEffect, useMemo } from "react";
import {
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SFSymbol } from "@/src/components/ios/Native";
import { PressableScale } from "@/src/components/Motion";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { dockScaleForWidth } from "@/src/lib/dockScale";
import { useReduceMotion, useTheme } from "@/src/lib/theme";

/**
 * Nest into the home-indicator inset so the dock sits low without covering it.
 * Keep small enough that paddingBottom never pushes the rail off-screen.
 */
const SAFE_AREA_NEST = 18;
const PILL_SPRING = { damping: 24, stiffness: 380, mass: 0.42 };

type TabVisual = {
  label: string;
  shortLabel: string;
  symbol: SFSymbolName;
  /** Filled variant when focused; falls back to outline if SF has no fill. */
  symbolFill: SFSymbolName;
};

const TAB_VISUAL: Record<string, TabVisual> = {
  index: {
    label: "Overview",
    shortLabel: "Home",
    symbol: "house",
    symbolFill: "house.fill",
  },
  campaigns: {
    label: "Campaigns",
    shortLabel: "Ads",
    symbol: "megaphone",
    symbolFill: "megaphone.fill",
  },
  targeting: {
    label: "Targets",
    shortLabel: "Target",
    // SF `scope` has no fill sibling — same glyph active + idle.
    symbol: "scope",
    symbolFill: "scope",
  },
  products: {
    label: "Books",
    shortLabel: "Books",
    symbol: "books.vertical",
    symbolFill: "books.vertical.fill",
  },
  more: {
    label: "More",
    shortLabel: "More",
    symbol: "ellipsis.circle",
    symbolFill: "ellipsis.circle.fill",
  },
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

type TabChrome = {
  fill: string;
  stroke: string;
  selected: string;
  selectedFg: string;
  inactive: string;
};

type DockScale = ReturnType<typeof dockScaleForWidth>;

function TabSegment({
  focused,
  visual,
  a11y,
  testID,
  scale,
  chrome,
  onPress,
  onLongPress,
}: {
  focused: boolean;
  visual: TabVisual;
  a11y: string;
  testID: string;
  scale: DockScale;
  chrome: TabChrome;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const active = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    active.set(
      reduceMotion
        ? focused
          ? 1
          : 0
        : withSpring(focused ? 1 : 0, PILL_SPRING),
    );
  }, [active, focused, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => {
    const progress = active.get();
    return {
      opacity: progress,
      transform: [{ scale: 0.86 + progress * 0.14 }],
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    opacity: active.get(),
    transform: [{ translateY: (1 - active.get()) * 4 }],
  }));

  const iconColor = focused ? chrome.selectedFg : chrome.inactive;
  const iconSize = focused ? scale.iconActive : scale.icon;
  const labelText = scale.useShortLabel ? visual.shortLabel : visual.label;
  const showLabel = focused && scale.showSelectedLabel;
  const symbolName = focused ? visual.symbolFill : visual.symbol;

  return (
    <View style={styles.segmentSlot}>
      <PressableScale
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={a11y}
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        hitSlop={6}
        style={[
          styles.segment,
          { minHeight: scale.segmentMinHeight },
          focused ? styles.segmentActive : styles.segmentIdle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            styles.activePill,
            { backgroundColor: chrome.selected },
            pillStyle,
          ]}
        />
        <SFSymbol name={symbolName} size={iconSize} color={iconColor} />
        {showLabel ? (
          <Animated.View style={labelStyle}>
            <Text
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              ellipsizeMode="clip"
              style={[
                styles.label,
                {
                  color: chrome.selectedFg,
                  fontSize: scale.labelSize,
                },
              ]}
            >
              {labelText}
            </Text>
          </Animated.View>
        ) : null}
      </PressableScale>
    </View>
  );
}

/**
 * Floating stadium dock: solid theme-synced pill (white / #141417), soft
 * floating shadow, SF Symbol tabs. Selected = blue-tinted vertical stadium
 * (filled icon + short label); idle = outline icon only.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const scale = useMemo(() => dockScaleForWidth(windowWidth), [windowWidth]);
  const routes = state.routes;
  // Navigator state is the rendering authority — pathname can lead the scene
  // by a frame and paint the wrong selected label.
  const focusedName = routes[state.index]?.name ?? "index";
  const bottomPad =
    insets.bottom > 0 ? Math.max(insets.bottom - SAFE_AREA_NEST, 6) : 10;

  const chrome = useMemo(
    () => ({
      fill: t.colors.tabbar_background,
      stroke: t.colors.tabbar_stroke,
      selected: t.colors.tabbar_selected,
      selectedFg: t.colors.tabbar_selected_fg,
      inactive: t.colors.tabbar_inactive,
      elevation: t.shadow.floating,
    }),
    [t.colors, t.shadow.floating],
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: bottomPad, paddingHorizontal: scale.sideInset },
      ]}
    >
      <View
        style={[
          styles.shadowLift,
          { maxWidth: scale.maxWidth, ...chrome.elevation },
        ]}
      >
        <View
          accessibilityRole="tablist"
          testID={`tab-rail-${scale.tier}`}
          style={[
            styles.rail,
            {
              minHeight: scale.railMinHeight,
              paddingHorizontal: scale.padH,
              paddingVertical: scale.padV,
              borderColor: chrome.stroke,
              backgroundColor: chrome.fill,
            },
          ]}
        >
          <View style={styles.railRow}>
            {routes.map((route) => {
              const focused = route.name === focusedName;
              const { options } = descriptors[route.key];
              const visual = TAB_VISUAL[route.name] ?? {
                label: options.title ?? route.name,
                shortLabel: options.title ?? route.name,
                symbol: "house" as SFSymbolName,
                symbolFill: "house.fill" as SFSymbolName,
              };
              const a11y =
                options.tabBarAccessibilityLabel ??
                options.title ??
                visual.label;

              return (
                <TabSegment
                  key={route.key}
                  focused={focused}
                  visual={visual}
                  a11y={a11y}
                  testID={`tab-${route.name}`}
                  scale={scale}
                  chrome={chrome}
                  onPress={() => {
                    playHaptic("select");
                    const event = navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!focused && !event.defaultPrevented) {
                      navigation.navigate(route.name, route.params);
                    }
                  }}
                  onLongPress={() => {
                    navigation.emit({ type: "tabLongPress", target: route.key });
                  }}
                />
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
    zIndex: 50,
    elevation: 16,
  },
  shadowLift: {
    width: "100%",
    borderRadius: 999,
  },
  rail: {
    width: "100%",
    borderRadius: 999,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  railRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  /** Equal share — minWidth:0 stops fixed-content pills from blowing the rail. */
  segmentSlot: {
    flex: 1,
    minWidth: 0,
    zIndex: 1,
    alignItems: "stretch",
  },
  segment: {
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  /** Mockup: icon above short label inside the blue-tinted stadium. */
  segmentActive: {
    alignSelf: "stretch",
    marginHorizontal: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "column",
    gap: 2,
  },
  segmentIdle: {
    alignSelf: "stretch",
    width: "100%",
    paddingHorizontal: 0,
    flexDirection: "column",
  },
  activePill: {
    borderRadius: 999,
    borderCurve: "continuous",
  },
  label: {
    flexShrink: 1,
    fontWeight: "700",
    letterSpacing: -0.2,
    textAlign: "center",
    lineHeight: 14,
  },
});
