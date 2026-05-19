import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/contexts/AuthContext";

export default function Index() {
  const router = useRouter();
  const { state } = useAuth();
  const t = useTheme();

  useEffect(() => {
    if (state === "authenticated") router.replace("/(tabs)");
    else if (state === "unauthenticated") router.replace("/auth/login");
  }, [state, router]);

  return (
    <View style={[styles.container, { backgroundColor: t.colors.background_primary }]}>
      <ActivityIndicator color={t.colors.tone_primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
