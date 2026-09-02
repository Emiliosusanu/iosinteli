import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InteliAdsIcon, type InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { SFSymbol } from "@/src/components/ios/Native";
import { playHaptic } from "@/src/lib/hapticPolicy";
import { dashboard, useTheme } from "@/src/lib/theme";

const BAR_HEIGHT = 64;
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

/**
 * Light floating dock matched to the white app chrome: frosted bar, equal
 * slots, icon + label always visible, active tint = tone_primary.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  const index = state.index;
  const bottomPad = Math.max(insets.bottom, 8);

  const shell = useMemo(
    () => ({
      bar: t.colors.tabbar_background,
      stroke: t.scheme === "dark" ? t.colors.glass_stroke : "rgba(0,0,0,0.08)",
      inactive: t.colors.text_tertiary,
      active: t.colors.tone_primary,
      activeWell: t.scheme === "dark" ? "rgba(47,124,255,0.18)" : "rgba(0,122,255,0.12)",
      blurTint: t.scheme === "dark" ? ("dark" as const) : ("light" as const),
    }),
    [t.colors, t.scheme],
  );

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: bottomPad }]}>
      <View style={styles.shadowLift}>
        <View style={[styles.capsule, { borderColor: shell.stroke, backgroundColor: shell.bar }]}>
          {Platform.OS === "ios" ? (
            <BlurView intensity={t.scheme === "dark" ? 42 : 64} tint={shell.blurTint} style={StyleSheet.absoluteFillObject} />
          ) : null}

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

              const onLongPress = () => {
                navigation.emit({ type: "tabLongPress", target: route.key });
              };

              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={focused ? { selected: true } : {}}
                  accessibilityLabel={a11y}
                  testID={`tab-${route.name}`}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  style={styles.item}
                >
                  <View
                    style={[
                      styles.itemInner,
                      focused ? { backgroundColor: shell.activeWell } : null,
                    ]}
                  >
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
                  </View>
                </Pressable>
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
    paddingHorizontal: 16,
  },
  shadowLift: {
    width: "100%",
    maxWidth: 430,
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  capsule: {
    height: BAR_HEIGHT,
    borderRadius: 22,
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
  },
  itemInner: {
    minWidth: 56,
    maxWidth: 76,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: -0.1,
    lineHeight: 12,
    textAlign: "center",
  },
});
