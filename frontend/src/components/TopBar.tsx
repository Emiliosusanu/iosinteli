import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Pressable,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useApp } from "../contexts/AppContext";
import { useTheme } from "../lib/theme";
import { rangePresets } from "../lib/format";
import { DateRange } from "../lib/types";

interface TopBarProps {
  title?: string;
  showProfileSelector?: boolean;
  showDateRange?: boolean;
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; testID?: string };
}

export function TopBar({ title, showProfileSelector = true, showDateRange = true, rightAction }: TopBarProps) {
  const t = useTheme();
  const { profiles, selectedProfileIds, toggleProfile, selectAllProfiles, dateRange, setDateRange } = useApp();
  const [profileOpen, setProfileOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const presets = rangePresets();
  const presetEntries: { key: string; range: DateRange }[] = [
    { key: "today", range: presets.today },
    { key: "yesterday", range: presets.yesterday },
    { key: "last7", range: presets.last7 },
    { key: "last30", range: presets.last30 },
    { key: "last90", range: presets.last90 },
  ];

  const selectedLabel =
    selectedProfileIds.length === 0
      ? "No profiles"
      : selectedProfileIds.length === profiles.length
      ? `All profiles (${profiles.length})`
      : selectedProfileIds.length === 1
      ? profiles.find((p) => p.id === selectedProfileIds[0])?.account_name ?? "1 profile"
      : `${selectedProfileIds.length} profiles`;

  return (
    <>
      <View style={[styles.bar, { borderBottomColor: t.colors.border }]}>
        {title && (
          <Text
            style={[t.typography.title3, { color: t.colors.text_primary, marginRight: 8 }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        )}
        <View style={{ flexDirection: "row", flex: 1, justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          {showProfileSelector && (
            <TouchableOpacity
              testID="profile-selector-btn"
              onPress={() => setProfileOpen(true)}
              style={[styles.chip, { backgroundColor: t.colors.background_tertiary }]}
              activeOpacity={0.7}
            >
              <Ionicons name="business-outline" size={13} color={t.colors.tone_primary} />
              <Text style={[t.typography.caption1, { color: t.colors.text_primary, marginLeft: 4 }]} numberOfLines={1}>
                {selectedLabel}
              </Text>
              <Ionicons name="chevron-down" size={12} color={t.colors.text_secondary} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}
          {showDateRange && (
            <TouchableOpacity
              testID="date-range-btn"
              onPress={() => setDateOpen(true)}
              style={[styles.chip, { backgroundColor: t.colors.background_tertiary }]}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={13} color={t.colors.tone_primary} />
              <Text style={[t.typography.caption1, { color: t.colors.text_primary, marginLeft: 4 }]}>
                {dateRange.label}
              </Text>
              <Ionicons name="chevron-down" size={12} color={t.colors.text_secondary} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}
          {rightAction && (
            <TouchableOpacity
              testID={rightAction.testID}
              onPress={rightAction.onPress}
              style={[styles.iconBtn, { backgroundColor: t.colors.background_tertiary }]}
              activeOpacity={0.7}
            >
              <Ionicons name={rightAction.icon} size={16} color={t.colors.tone_primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Profile Selector Sheet */}
      <Modal visible={profileOpen} transparent animationType="slide" onRequestClose={() => setProfileOpen(false)}>
        <Pressable style={[styles.modalOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setProfileOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Amazon Profiles</Text>
              <TouchableOpacity onPress={selectAllProfiles} testID="select-all-profiles">
                <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Select all</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 480 }}>
              {profiles.length === 0 ? (
                <Text style={[t.typography.body, { color: t.colors.text_secondary, padding: 16 }]}>
                  No Amazon profiles found.
                </Text>
              ) : (
                profiles.map((p) => {
                  const selected = selectedProfileIds.includes(p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      testID={`profile-row-${p.profile_id}`}
                      style={[styles.profileRow, { borderBottomColor: t.colors.separator }]}
                      onPress={() => toggleProfile(p.id)}
                      activeOpacity={0.6}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
                          {p.nickname || p.account_name || p.profile_id}
                        </Text>
                        <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                          {p.country_code || "—"} · {p.currency_code || "—"} · {p.profile_id}
                        </Text>
                      </View>
                      <Switch
                        value={selected}
                        onValueChange={() => toggleProfile(p.id)}
                        trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                        thumbColor="#fff"
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Date Range Sheet */}
      <Modal visible={dateOpen} transparent animationType="slide" onRequestClose={() => setDateOpen(false)}>
        <Pressable style={[styles.modalOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setDateOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Date Range</Text>
            </View>
            {presetEntries.map((preset) => {
              const selected = preset.range.label === dateRange.label;
              return (
                <TouchableOpacity
                  key={preset.key}
                  testID={`date-preset-${preset.key}`}
                  style={[styles.profileRow, { borderBottomColor: t.colors.separator }]}
                  onPress={() => {
                    setDateRange(preset.range);
                    setDateOpen(false);
                  }}
                  activeOpacity={0.6}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[t.typography.body, { color: t.colors.text_primary }]}>
                      {preset.range.label}
                    </Text>
                    <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                      {preset.range.start} → {preset.range.end}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark" size={20} color={t.colors.tone_primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    maxWidth: 180,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#8888",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
