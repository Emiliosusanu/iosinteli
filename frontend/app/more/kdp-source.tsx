import React from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { type Href, useRouter } from "expo-router";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTheme } from "@/src/lib/theme";
import { IOSGroupedSection, IOSSettingsRow, SFSymbol } from "@/src/components/ios/Native";
import {
  KDP_ROYALTY_SOURCES,
  kdpRoyaltySourceOptionSubtitle,
  kdpRoyaltySourceOptionTitle,
  type KdpRoyaltySource,
} from "@/src/lib/kdp/source";
import { KDP_SOURCE_PICKER_FOOTER, KDP_SOURCE_PICKER_TITLE } from "@/src/lib/settingsContract";

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
    <SubScreen title={KDP_SOURCE_PICKER_TITLE}>
      <IOSGroupedSection footer={KDP_SOURCE_PICKER_FOOTER}>
        {KDP_ROYALTY_SOURCES.map((source, index) => {
          const selected = source === kdpRoyaltySource;
          const last = index === KDP_ROYALTY_SOURCES.length - 1;
          const title = kdpRoyaltySourceOptionTitle(source);
          return (
            <TouchableOpacity
              key={source}
              testID={`kdp-source-option-${source}`}
              onPress={() => onSelect(source)}
              disabled={guestMode}
              activeOpacity={0.55}
              accessible
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: guestMode }}
              accessibilityLabel={`${title}. ${selected ? "Selected" : "Not selected"}`}
              style={[
                styles.row,
                {
                  borderBottomColor: t.colors.separator,
                  borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
                  opacity: guestMode ? 0.5 : 1,
                },
              ]}
            >
              <View style={styles.copy}>
                <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{title}</Text>
                <Text
                  style={[
                    t.typography.footnote,
                    { color: t.colors.text_secondary, marginTop: 3, lineHeight: 18 },
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
            </TouchableOpacity>
          );
        })}
      </IOSGroupedSection>
      {kdpRoyaltySource === "extension_ios" ? (
        <IOSGroupedSection>
          <IOSSettingsRow
            testID="kdp-source-open-helper"
            label="Set up iPhone helper"
            subtitle="Sign in to KDP and import royalties on this iPhone"
            symbol="book"
            symbolColor={t.colors.tone_primary}
            last
            onPress={() => router.push("/more/kdp-helper" as Href)}
          />
        </IOSGroupedSection>
      ) : null}
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  copy: { flex: 1 },
  check: { width: 22, alignItems: "center", paddingTop: 2 },
});
