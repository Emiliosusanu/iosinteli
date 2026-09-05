import React from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
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

/**
 * Edge-to-edge sub-screen: paint under the Dynamic Island, overlay back control
 * in the former black header band, and keep the date chip in that same band.
 */
export function SubScreen({ title, children, rightAction, showDateRange = false }: SubScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Math.max(insets.top, 8);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background_primary }}>
      <ScreenAmbient />
      <Stack.Screen
        options={{
          headerShown: false,
          title: "",
          contentStyle: { backgroundColor: t.colors.background_primary },
        }}
      />

      <View
        style={[
          styles.topChrome,
          {
            paddingTop: topPad,
            borderBottomColor: t.colors.border,
            backgroundColor: "transparent",
          },
        ]}
      >
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={`Back. ${title}`}
            hitSlop={8}
            style={[
              styles.backChip,
              {
                backgroundColor: t.colors.background_secondary + "CC",
                borderColor: t.colors.separator,
              },
            ]}
          >
            <SFSymbol name="chevron.left" size={16} color={t.colors.tone_primary} />
            <Text style={[t.typography.footnote, { color: t.colors.tone_primary, fontWeight: "600" }]}>Back</Text>
          </TouchableOpacity>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[
              t.typography.headline,
              styles.navTitle,
              { color: t.colors.text_primary },
            ]}
          >
            {title}
          </Text>
          {rightAction ? (
            <TouchableOpacity
              onPress={rightAction.onPress}
              testID={rightAction.testID}
              accessibilityRole="button"
              accessibilityLabel={rightAction.accessibilityLabel}
              accessibilityHint={rightAction.accessibilityHint}
              style={{
                minWidth: t.layout.minTap,
                minHeight: t.layout.minTap,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SFSymbol name={sfFromIonicon(rightAction.icon)} size={22} color={t.colors.tone_primary} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        {showDateRange ? (
          <View style={styles.dateBar}>
            <DateRangeControl fullWidth />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  topChrome: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6,
    gap: 6,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    minHeight: 36,
    gap: 8,
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
  },
  backChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  dateBar: {
    paddingHorizontal: 16,
    paddingBottom: 2,
  },
});
