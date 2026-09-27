import React from "react";
import { Text, Pressable, ScrollView, View, StyleSheet } from "react-native";
import { type Href, useRouter } from "expo-router";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { SFSymbol } from "@/src/components/ios/Native";
import {
  SettingsNavigationRow,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import {
  KDP_ROYALTY_SOURCES,
  kdpRoyaltySourceOptionSubtitle,
  kdpRoyaltySourceOptionTitle,
  type KdpRoyaltySource,
} from "@/src/lib/kdp/source";
import {
  KDP_HELPER_SETUP_ROW,
  KDP_SOURCE_PICKER_FOOTER,
  KDP_SOURCE_PICKER_TITLE,
} from "@/src/lib/settingsContract";

export default function KdpSourceScreen() {
  const t = useTheme();
  const router = useRouter();
  const { guestMode } = useAuth();
  const { kdpRoyaltySource, setKdpRoyaltySource } = useApp();

  const onSelect = (source: KdpRoyaltySource) => {
    if (guestMode) return;
    if (source !== kdpRoyaltySource) setKdpRoyaltySource(source);
    if (source === "extension_ios") router.push("/more/kdp-helper" as Href);
  };

  return (
    <SettingsScreen title={KDP_SOURCE_PICKER_TITLE}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <SettingsSection footer={KDP_SOURCE_PICKER_FOOTER || undefined}>
          {KDP_ROYALTY_SOURCES.map((source, index) => {
            const selected = source === kdpRoyaltySource;
            const last = index === KDP_ROYALTY_SOURCES.length - 1;
            const title = kdpRoyaltySourceOptionTitle(source);
            return (
              <Pressable
                key={source}
                testID={`kdp-source-option-${source}`}
                onPress={() => onSelect(source)}
                disabled={guestMode}
                accessible
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: guestMode }}
                accessibilityLabel={`${title}. ${selected ? "Selected" : "Not selected"}`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderBottomColor: t.colors.separator,
                    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
                    opacity: guestMode ? 0.5 : pressed ? 0.55 : 1,
                  },
                ]}
              >
                <View style={styles.copy}>
                  <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{title}</Text>
                  <Text
                    style={[
                      t.typography.footnote,
                      { color: t.colors.text_secondary, marginTop: 3 },
                    ]}
                  >
                    {kdpRoyaltySourceOptionSubtitle(source)}
                  </Text>
                </View>
                <View style={styles.check} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {selected ? (
                    <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </SettingsSection>
        {kdpRoyaltySource === "extension_ios" ? (
          <SettingsSection>
            <SettingsNavigationRow
              testID="kdp-source-open-helper"
              label={KDP_HELPER_SETUP_ROW}
              symbol="iphone"
              symbolColor={t.colors.tone_primary}
              last
              onPress={() => router.push("/more/kdp-helper" as Href)}
            />
          </SettingsSection>
        ) : null}
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
