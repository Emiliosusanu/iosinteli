import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { CHECKING_SESSION_LABEL } from "@/src/lib/authContract";
import { palette } from "@/src/lib/theme";

export default function Index() {
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={CHECKING_SESSION_LABEL}
    >
      <ActivityIndicator color={palette.light.tone_primary} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.light.background_secondary,
  },
});
