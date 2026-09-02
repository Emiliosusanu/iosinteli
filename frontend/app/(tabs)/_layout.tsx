import React from "react";
import { Tabs } from "expo-router";
import { View } from "react-native";
import { FloatingTabBar } from "@/src/components/FloatingTabBar";
import { InteliAdsIcon, type InteliAdsIconName } from "@/src/components/InteliAdsIcon";
import { SFSymbol as TabSymbol } from "@/src/components/ios/Native";
import { dashboard, useTheme } from "@/src/lib/theme";

/** Kept for contract tests + a11y fallbacks; visual chrome is FloatingTabBar. */
function ProductTabIcon({
  name,
  color,
  focused,
}: {
  name: InteliAdsIconName;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
      <InteliAdsIcon
        name={name}
        size={dashboard.iconLg}
        color={color}
        selected={focused}
        state={focused ? "selected" : "default"}
      />
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as unknown as React.ComponentProps<typeof FloatingTabBar>)} />}
      screenOptions={{
        headerShown: false,
        animation: "none",
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: t.colors.tone_primary,
        tabBarInactiveTintColor: t.colors.text_tertiary,
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarAccessibilityLabel: "Overview",
          tabBarIcon: ({ color, focused }) => <ProductTabIcon name="overview" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: "Campaigns",
          tabBarAccessibilityLabel: "Campaigns",
          tabBarIcon: ({ color, focused }) => <ProductTabIcon name="campaigns" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="targeting"
        options={{
          title: "Targets",
          tabBarAccessibilityLabel: "Targets",
          tabBarIcon: ({ color, focused }) => <ProductTabIcon name="targeting" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Books",
          tabBarAccessibilityLabel: "Books",
          tabBarIcon: ({ color, focused }) => <ProductTabIcon name="books" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarAccessibilityLabel: "More",
          tabBarIcon: ({ color, focused }) => (
            <TabSymbol name={focused ? "ellipsis.circle.fill" : "ellipsis.circle"} size={dashboard.iconLg} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
