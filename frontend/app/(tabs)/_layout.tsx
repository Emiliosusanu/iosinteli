import React from "react";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { BlurView } from "expo-blur";
import type { SFSymbol } from "expo-symbols";
import { SFSymbol as TabSymbol } from "@/src/components/ios/Native";
import { useTheme } from "@/src/lib/theme";

function TabIcon({ name, color }: { name: SFSymbol; color: string }) {
  return <TabSymbol name={name} size={24} color={color} />;
}

export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: "fade",
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: t.colors.tone_primary,
        tabBarInactiveTintColor: t.colors.text_tertiary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "500" },
        tabBarItemStyle: { paddingTop: 2 },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.OS === "ios" ? "transparent" : t.colors.background_secondary,
          borderTopColor: t.colors.border,
          borderTopWidth: 0.5,
          height: Platform.OS === "ios" ? 84 : 64,
          paddingTop: 6,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView intensity={88} tint={t.scheme} style={{ flex: 1 }} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "square.grid.2x2.fill" : "square.grid.2x2"} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: "Campaigns",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "megaphone.fill" : "megaphone"} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="targeting"
        options={{
          title: "Targets",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "location.fill" : "location"} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Books",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "book.fill" : "book"} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarAccessibilityLabel: "More",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "ellipsis.circle.fill" : "ellipsis.circle"} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
