import React from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useTheme } from "../lib/theme";
import { DateRangeControl } from "./TopBar";
import { SFSymbol, sfFromIonicon } from "./ios/Native";
import { ScreenAmbient } from "./ScreenAmbient";

interface SubScreenProps {
  title: string;
  children: React.ReactNode;
  rightAction?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    testID?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
  };
  showDateRange?: boolean;
}

export function SubScreen({ title, children, rightAction, showDateRange = false }: SubScreenProps) {
  const t = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["bottom"]}>
      <ScreenAmbient />
      {/* Native iOS header — back only; page titles removed for denser chrome. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerBackTitle: "",
          headerAccessibilityLabel: title,
          headerStyle: { backgroundColor: t.colors.background_primary },
          headerTitleStyle: { color: t.colors.text_primary, fontSize: 17, fontWeight: "600" },
          headerTintColor: t.colors.tone_primary,
          headerShadowVisible: false,
          ...(rightAction
            ? {
                headerRight: () => (
                  <TouchableOpacity
                    onPress={rightAction.onPress}
                    testID={rightAction.testID}
                    accessibilityRole="button"
                    accessibilityLabel={rightAction.accessibilityLabel}
                    accessibilityHint={rightAction.accessibilityHint}
                    style={{ minWidth: t.layout.minTap, minHeight: t.layout.minTap, alignItems: "center", justifyContent: "center" }}
                  >
                    <SFSymbol name={sfFromIonicon(rightAction.icon)} size={22} color={t.colors.tone_primary} />
                  </TouchableOpacity>
                ),
              }
            : {}),
        }}
      />

      {showDateRange && (
        <View style={[styles.dateBar, { borderBottomColor: t.colors.border }]}>
          <DateRangeControl fullWidth />
        </View>
      )}

      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dateBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
