import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "@/src/lib/theme";
import { useAuth } from "@/src/contexts/AuthContext";
import { useApp } from "@/src/contexts/AppContext";
import { BrandIcon } from "@/src/components/Primitives";
import { IOSGroupedSection, IOSSettingsRow, SFSymbol } from "@/src/components/ios/Native";
import {
  MORE_GROUPS,
  moreAccountBannerAccessibilityLabel,
  moreAccountBannerCaption,
  moreRowAccessibilityLabel,
} from "@/src/lib/moreRoot";

export default function MoreScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user, guestMode } = useAuth();
  const { adminFilterUserId } = useApp();
  const viewingCustomer = !!adminFilterUserId;
  const email = user?.email ?? "Guest";
  const bannerCaption = moreAccountBannerCaption({ guestMode, viewingCustomer });
  const bannerLabel = moreAccountBannerAccessibilityLabel({ email, caption: bannerCaption });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background_primary }} edges={["top"]}>
      <View style={styles.largeTitle}>
        <Text
          accessibilityRole="header"
          style={[t.typography.largeTitle, { color: t.colors.text_primary }]}
        >
          More
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic">
        <TouchableOpacity
          testID="menu-account-banner"
          onPress={() => router.push("/more/account")}
          activeOpacity={0.55}
          accessibilityRole="button"
          accessibilityLabel={bannerLabel}
          style={[styles.banner, { backgroundColor: t.colors.background_secondary }]}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.avatar, { backgroundColor: t.colors.tone_primary + "1F" }]}
          >
            <BrandIcon size={20} radius={6} />
          </View>
          <View style={styles.bannerCopy}>
            <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{email}</Text>
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
              {bannerCaption}
            </Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <SFSymbol name="chevron.right" size={12} color={t.colors.text_tertiary} />
          </View>
        </TouchableOpacity>

        {MORE_GROUPS.map((group) => (
          <IOSGroupedSection key={group.title} title={group.title}>
            {group.items.map((item, index) => (
              <IOSSettingsRow
                key={item.key}
                testID={`menu-${item.key}`}
                label={item.label}
                subtitle={item.subtitle}
                accessibilityLabel={moreRowAccessibilityLabel(item.label, item.subtitle)}
                symbol={item.symbol}
                symbolColor={t.colors[item.color]}
                last={index === group.items.length - 1}
                onPress={() => router.push(item.href)}
              />
            ))}
          </IOSGroupedSection>
        ))}

        <Text
          style={[t.typography.footnote, { color: t.colors.text_secondary, textAlign: "center", marginTop: 28 }]}
        >
          InteliAds
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  largeTitle: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  scroll: {
    paddingBottom: 120,
  },
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  bannerCopy: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
