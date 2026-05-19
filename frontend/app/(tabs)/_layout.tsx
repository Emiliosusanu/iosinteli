import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "@/src/lib/theme";

export default function TabsLayout() {
  const t = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.tone_primary,
        tabBarInactiveTintColor: t.colors.text_tertiary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        tabBarStyle: {
          position: "absolute",
          backgroundColor:
            Platform.OS === "ios" ? "transparent" : t.colors.background_secondary,
          borderTopColor: t.colors.border,
          borderTopWidth: 0.5,
          height: Platform.OS === "ios" ? 84 : 60,
          paddingTop: 6,
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={80}
              tint={t.scheme}
              style={{ flex: 1 }}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "pie-chart" : "pie-chart-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: "Campaigns",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "megaphone" : "megaphone-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="targeting"
        options={{
          title: "Targeting",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "locate" : "locate-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Products",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "cube" : "cube-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "menu" : "menu-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
