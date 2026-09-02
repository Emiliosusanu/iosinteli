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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useApp } from "../contexts/AppContext";
import { dashboard, useTheme } from "../lib/theme";
import { formatDateRangeLabel, rangePresets } from "../lib/format";
import { DateRange } from "../lib/types";
import { IOSDateField, SFSymbol, sfFromIonicon } from "./ios/Native";

interface TopBarProps {
  title?: string;
  showProfileSelector?: boolean;
  showDateRange?: boolean;
  rightAction?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; testID?: string };
}

function DatePresetList({
  presets,
  dateRange,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  onPick,
}: {
  presets: { key: string; range: DateRange }[];
  dateRange: DateRange;
  customStart: string;
  customEnd: string;
  onCustomStart: (next: string) => void;
  onCustomEnd: (next: string) => void;
  onPick: (range: DateRange) => void;
}) {
  const t = useTheme();
  return (
    <>
      {presets.map((preset) => {
        const selected = preset.range.start === dateRange.start && preset.range.end === dateRange.end;
        return (
          <TouchableOpacity
            key={preset.key}
            testID={`date-preset-${preset.key}`}
            style={[styles.profileRow, { borderBottomColor: t.colors.separator }]}
            onPress={() => onPick(preset.range)}
            activeOpacity={0.6}
          >
            <View style={{ flex: 1 }}>
              <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{preset.range.label}</Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                {preset.range.start} {"->"} {preset.range.end}
              </Text>
            </View>
            {selected ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
          </TouchableOpacity>
        );
      })}
      <View style={[styles.profileRow, { borderBottomWidth: 0, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>Custom</Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <View style={{ flex: 1 }}>
            <IOSDateField testID="date-custom-start" label="From" value={customStart} onChange={onCustomStart} />
          </View>
          <View style={{ flex: 1 }}>
            <IOSDateField testID="date-custom-end" label="To" value={customEnd} onChange={onCustomEnd} />
          </View>
        </View>
        <TouchableOpacity
          testID="date-preset-custom"
          onPress={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) return;
            if (customStart > customEnd) return;
            onPick({ start: customStart, end: customEnd, label: "Custom" });
          }}
          style={[styles.applyCustom, { backgroundColor: t.colors.tone_primary }]}
        >
          <Text style={[t.typography.callout, { color: t.colors.text_inverse, fontWeight: "600" }]}>Apply custom</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

export function DateRangeControl({ fullWidth = false }: { fullWidth?: boolean }) {
  const t = useTheme();
  const { dateRange, setDateRange } = useApp();
  const [dateOpen, setDateOpen] = useState(false);
  const presets = rangePresets();
  const presetEntries: { key: string; range: DateRange }[] = [
    { key: "today", range: presets.today },
    { key: "yesterday", range: presets.yesterday },
    { key: "thisMonth", range: presets.thisMonth },
    { key: "last7", range: presets.last7 },
    { key: "last30", range: presets.last30 },
    { key: "last60", range: presets.last60 },
    { key: "last90", range: presets.last90 },
    { key: "allTime", range: presets.allTime },
  ];
  const dateLabel = formatDateRangeLabel(dateRange);
  const [customStart, setCustomStart] = useState(dateRange.start);
  const [customEnd, setCustomEnd] = useState(dateRange.end);

  React.useEffect(() => {
    if (dateOpen) {
      setCustomStart(dateRange.start);
      setCustomEnd(dateRange.end);
    }
  }, [dateOpen, dateRange.start, dateRange.end]);

  return (
    <>
      <TouchableOpacity
        accessibilityLabel={`Date range: ${dateLabel}`}
        testID="date-range-btn"
        onPress={() => setDateOpen(true)}
        style={[
          styles.chip,
          fullWidth && styles.fullWidthChip,
          {
            backgroundColor: t.colors.glass_background,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.colors.glass_stroke,
          },
        ]}
        activeOpacity={0.7}
      >
        <SFSymbol name="calendar" size={14} color={t.colors.tone_primary} />
        <Text style={[t.typography.caption1, { color: t.colors.text_primary, marginLeft: 4, flexShrink: 1 }]} numberOfLines={1}>
          {dateLabel}
        </Text>
        <SFSymbol name="chevron.down" size={10} color={t.colors.text_secondary} />
      </TouchableOpacity>

      <Modal
        visible={dateOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setDateOpen(false)}
      >
        {Platform.OS === "ios" ? (
          <View style={[styles.sheetFill, { backgroundColor: t.colors.background_secondary }]}>
            <View style={styles.sheetHeader}>
              <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Date Range</Text>
              <TouchableOpacity onPress={() => setDateOpen(false)} hitSlop={10}>
                <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
              <DatePresetList
                presets={presetEntries}
                dateRange={dateRange}
                customStart={customStart}
                customEnd={customEnd}
                onCustomStart={setCustomStart}
                onCustomEnd={setCustomEnd}
                onPick={(range) => {
                  setDateRange(range);
                  setDateOpen(false);
                }}
              />
            </ScrollView>
          </View>
        ) : (
          <Pressable style={[styles.modalOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setDateOpen(false)}>
            <Pressable
              style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.handle, { backgroundColor: t.colors.separator }]} />
              <View style={styles.sheetHeader}>
                <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Date Range</Text>
                <TouchableOpacity onPress={() => setDateOpen(false)} hitSlop={10}>
                  <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 520 }}>
                <DatePresetList
                  presets={presetEntries}
                  dateRange={dateRange}
                  customStart={customStart}
                  customEnd={customEnd}
                  onCustomStart={setCustomStart}
                  onCustomEnd={setCustomEnd}
                  onPick={(range) => {
                    setDateRange(range);
                    setDateOpen(false);
                  }}
                />
              </ScrollView>
            </Pressable>
          </Pressable>
        )}
      </Modal>
    </>
  );
}

export function TopBar({ title, showProfileSelector = true, showDateRange = true, rightAction }: TopBarProps) {
  const t = useTheme();
  const {
    profiles,
    selectedProfileIds,
    primaryCurrency,
    toggleProfile,
    selectAllProfiles,
    adminUsers,
    adminFilterUserId,
    setAdminFilterUserId,
  } = useApp();
  const viewingUser = adminUsers.find((user) => user.id === adminFilterUserId);
  const [profileOpen, setProfileOpen] = useState(false);

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
        {(title || rightAction) && (
          <View style={styles.headerRow}>
            {title ? (
              <Text style={[t.typography.largeTitle, styles.title, { color: t.colors.text_primary }]} numberOfLines={1}>
                {title}
              </Text>
            ) : <View style={{ flex: 1 }} />}
            {rightAction && (
              <TouchableOpacity
                accessibilityLabel={rightAction.testID ?? "Screen action"}
                testID={rightAction.testID}
                onPress={rightAction.onPress}
                style={[
                  styles.iconBtn,
                  {
                    backgroundColor: t.colors.glass_background,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: t.colors.glass_stroke,
                  },
                ]}
                activeOpacity={0.7}
              >
                <SFSymbol name={sfFromIonicon(rightAction.icon)} size={19} color={t.colors.tone_primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        {(showProfileSelector || showDateRange || (rightAction && !title)) && <View style={[styles.controls, title && { marginTop: 8 }]}> 
          {showProfileSelector && (
            <TouchableOpacity
              accessibilityLabel={`Profiles: ${selectedLabel}, currency ${primaryCurrency}`}
              testID="profile-selector-btn"
              onPress={() => setProfileOpen(true)}
              style={[
                styles.chip,
                {
                  backgroundColor: t.colors.glass_background,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: t.colors.glass_stroke,
                },
              ]}
              activeOpacity={0.7}
            >
              <SFSymbol name="building.2" size={13} color={t.colors.tone_primary} />
              <Text style={[t.typography.caption1, { color: t.colors.text_primary, marginLeft: 4, flexShrink: 1 }]} numberOfLines={1}>
                {viewingUser?.email ? viewingUser.email.split("@")[0] + " · " : ""}
                {selectedLabel}
              </Text>
              {selectedProfileIds.length > 0 && (
                <View style={[styles.currencyTag, { backgroundColor: t.colors.tone_primary + "16" }]}> 
                  <Text style={[t.typography.caption2, { color: t.colors.tone_primary }]}>{primaryCurrency}</Text>
                </View>
              )}
              <SFSymbol name="chevron.down" size={10} color={t.colors.text_secondary} />
            </TouchableOpacity>
          )}
          {showDateRange && <DateRangeControl />}
          {rightAction && !title && (
            <TouchableOpacity
              testID={rightAction.testID}
              onPress={rightAction.onPress}
              style={[
                styles.iconBtn,
                {
                  backgroundColor: t.colors.glass_background,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: t.colors.glass_stroke,
                },
              ]}
              activeOpacity={0.7}
            >
              <SFSymbol name={sfFromIonicon(rightAction.icon)} size={16} color={t.colors.tone_primary} />
            </TouchableOpacity>
          )}
        </View>}
      </View>

      {/* Profile Selector Sheet */}
      <Modal
        visible={profileOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setProfileOpen(false)}
      >
        {Platform.OS === "ios" ? (
          <View style={[styles.sheetFill, { backgroundColor: t.colors.background_secondary }]}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={selectAllProfiles} testID="select-all-profiles">
                <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Select all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setProfileOpen(false)} hitSlop={10}>
                <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <Text style={[t.typography.title3, { color: t.colors.text_primary, paddingHorizontal: 16, paddingBottom: 8 }]}>
              Amazon Profiles
            </Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
              {adminUsers.length > 0 ? (
                <View style={{ paddingBottom: 12 }}>
                  <Text style={[t.typography.caption1, { color: t.colors.text_secondary, paddingHorizontal: 16, paddingBottom: 6 }]}>
                    ACCOUNT
                  </Text>
                  {adminUsers.filter((user) => !user.isAdmin).map((user) => {
                    const active = user.id === adminFilterUserId;
                    return (
                      <TouchableOpacity
                        key={user.id}
                        testID={`admin-user-row-${user.id}`}
                        style={[styles.profileRow, { borderBottomColor: t.colors.separator }]}
                        onPress={() => setAdminFilterUserId(user.id)}
                        activeOpacity={0.6}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[t.typography.body, { color: t.colors.text_primary }]} numberOfLines={1}>
                            {user.email}
                          </Text>
                        </View>
                        {active ? <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
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
                          {[p.country_code, p.currency_code].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      <Switch
                        value={selected}
                        onValueChange={() => toggleProfile(p.id)}
                        trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                        ios_backgroundColor={t.colors.background_tertiary}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : (
          <Pressable style={[styles.modalOverlay, { backgroundColor: t.colors.overlay }]} onPress={() => setProfileOpen(false)}>
            <Pressable
              style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.handle, { backgroundColor: t.colors.separator }]} />
              <View style={styles.sheetHeader}>
                <Text style={[t.typography.title3, { color: t.colors.text_primary }]}>Amazon Profiles</Text>
                <TouchableOpacity onPress={selectAllProfiles} testID="select-all-profiles">
                  <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Select all {primaryCurrency}</Text>
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
                            {[p.country_code, p.currency_code].filter(Boolean).join(" · ")}
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
        )}
      </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    marginRight: 12,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    maxWidth: 210,
    minWidth: 0,
    flexShrink: 1,
  },
  currencyTag: {
    marginLeft: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  fullWidthChip: {
    maxWidth: "100%",
    alignSelf: "stretch",
    justifyContent: "center",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetFill: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: dashboard.cardRadius,
    borderTopRightRadius: dashboard.cardRadius,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "transparent",
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
  dateInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
  },
  applyCustom: {
    alignSelf: "flex-start",
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
