import React from "react";
import { Tabs } from "expo-router";
import { View } from "react-native";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import { FloatingTabBar } from "@/src/components/FloatingTabBar";
import { SFSymbol as TabSymbol } from "@/src/components/ios/Native";
import { dashboard, useTheme } from "@/src/lib/theme";

/** Kept for contract tests + a11y fallbacks; visual chrome is FloatingTabBar. */
function SystemTabIcon({
  name,
  nameFill,
  color,
  focused,
}: {
  name: SFSymbolName;
  nameFill: SFSymbolName;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
      <TabSymbol
        name={focused ? nameFill : name}
        size={dashboard.iconLg}
        color={color}
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
        freezeOnBlur: false,
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
          tabBarIcon: ({ color, focused }) => (
            <SystemTabIcon name="house" nameFill="house.fill" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: "Campaigns",
          tabBarAccessibilityLabel: "Campaigns",
          tabBarIcon: ({ color, focused }) => (
            <SystemTabIcon
              name="megaphone"
              nameFill="megaphone.fill"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="targeting"
        options={{
          title: "Targets",
          tabBarAccessibilityLabel: "Targets",
          tabBarIcon: ({ color, focused }) => (
            <SystemTabIcon name="scope" nameFill="scope" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Books",
          tabBarAccessibilityLabel: "Books",
          tabBarIcon: ({ color, focused }) => (
            <SystemTabIcon
              name="books.vertical"
              nameFill="books.vertical.fill"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarAccessibilityLabel: "More",
          tabBarIcon: ({ color, focused }) => (
            <SystemTabIcon
              name="ellipsis.circle"
              nameFill="ellipsis.circle.fill"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
