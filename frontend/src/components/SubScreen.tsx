import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "../lib/theme";

interface SubScreenProps {
  title: string;
  children: React.ReactNode;
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; testID?: string };
}

export function SubScreen({ title, children, rightAction }: SubScreenProps) {
  const t = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <View style={[styles.navBar, { borderBottomColor: t.colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="back-btn">
          <Ionicons name="chevron-back" size={26} color={t.colors.tone_primary} />
        </TouchableOpacity>
        <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{title}</Text>
        {rightAction ? (
          <TouchableOpacity onPress={rightAction.onPress} hitSlop={10} testID={rightAction.testID}>
            <Ionicons name={rightAction.icon} size={22} color={t.colors.tone_primary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 26 }} />
        )}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
