import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SFSymbol } from "@/src/components/ios/Native";
import {
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import {
  APPEARANCE_PICKER_FOOTER,
  APPEARANCE_PICKER_TITLE,
  THEME_PREFERENCE_OPTIONS,
  appearancePreferenceLabel,
  appearancePreferenceSubtitle,
} from "@/src/lib/settingsContract";
import {
  useTheme,
  useThemePreference,
  type ThemePreference,
} from "@/src/lib/theme";

export default function AppearanceScreen() {
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();

  return (
    <SettingsScreen title={APPEARANCE_PICKER_TITLE}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsSection footer={APPEARANCE_PICKER_FOOTER}>
          {THEME_PREFERENCE_OPTIONS.map((option, index) => {
            const selected = preference === option;
            const last = index === THEME_PREFERENCE_OPTIONS.length - 1;
            const title = appearancePreferenceLabel(option);
            return (
              <Pressable
                key={option}
                testID={`appearance-option-${option}`}
                onPress={() => setPreference(option as ThemePreference)}
                accessible
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${title}. ${selected ? "Selected" : "Not selected"}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
                    opacity: pressed ? 0.55 : 1,
                  },
                ]}
              >
                <View style={styles.copy}>
                  <Text style={[t.typography.body, { color: t.colors.text_primary }]}>
                    {title}
                  </Text>
                  <Text
                    style={[
                      t.typography.footnote,
                      { color: t.colors.text_secondary, marginTop: 3 },
                    ]}
                  >
                    {appearancePreferenceSubtitle(option)}
                  </Text>
                </View>
                <View
                  style={styles.check}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {selected ? (
                    <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    minHeight: 44,
  },
  copy: { flex: 1 },
  check: { width: 22, alignItems: "center", paddingTop: 2 },
});
