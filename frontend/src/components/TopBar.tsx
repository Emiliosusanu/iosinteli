import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { SFSymbol as SFSymbolName } from "expo-symbols";
import { useRouter, type Href } from "expo-router";
import {
  fetchKdpAccountsForUser,
  updateKdpAccountName,
  type KdpAccountSummary,
} from "../lib/mutations";
import { useApp } from "../contexts/AppContext";
import { dashboard, density, layout, useTheme } from "../lib/theme";
import { formatDateRangeLabel, rangePresets, shortDateRangeContextLabel } from "../lib/format";
import { DateRange } from "../lib/types";
import { IOSDateField, SFSymbol, sfFromIonicon } from "./ios/Native";
import { GlassPanel } from "./GlassPanel";
import { MarketPill } from "./MarketPill";
import { PressableScale } from "./Motion";
import {
  NEST_DISABLED_VIEW_MESSAGE,
  NEST_DISABLED_VIEW_TITLE,
  PROFILE_LIST_ALL_LABEL,
  PROFILE_LIST_ADS_ONLY_LABEL,
  PROFILE_LIST_KDP_ADS_LABEL,
  PROFILE_LIST_READY_LABEL,
  type ProfileSheetMode,
  VIEW_SWITCH_HINT_OFF,
  VIEW_SWITCH_HINT_ON,
  adsAccountGroupHeading,
  countryFlagEmoji,
  filterProfilesBySheetMode,
  formatMarketPillLabel,
  groupProfilesByAdsAccount,
  isReadyToEnable,
  multiCountryCodes,
  profileAssociationHint,
  profileDisplayName,
  profileEnabled,
  profileInView,
  viewStatusLabel,
  viewSwitchAccessibilityLabel,
} from "../lib/accountsUi";

interface TopBarProps {
  title?: string;
  showProfileSelector?: boolean;
  showDateRange?: boolean;
  showKdpAccountGroups?: boolean;
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
          <Pressable
            key={preset.key}
            testID={`date-preset-${preset.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${preset.range.label}, ${preset.range.start} to ${preset.range.end}`}
            style={[styles.profileRow, { borderBottomColor: t.colors.separator, minHeight: layout.minTap }]}
            onPress={() => onPick(preset.range)}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{preset.range.label}</Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                {preset.range.start} – {preset.range.end}
              </Text>
            </View>
            {selected ? (
              <SFSymbol name="checkmark" size={16} color={t.colors.tone_primary} />
            ) : null}
          </Pressable>
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

/**
 * Premium iOS header pill — frosted glass, a tinted leading icon bubble, and a
 * stacked micro-label + value. Modeled on modern iOS finance-dashboard selectors
 * (Dribbble ios-app-design): clear hierarchy, 44pt tap target, spring press.
 */
function HeaderPill({
  icon,
  caption,
  value,
  trailing,
  onPress,
  accessibilityLabel,
  testID,
  flex = false,
  fullWidth = false,
  maxWidth,
}: {
  icon: SFSymbolName;
  caption: string;
  value: string;
  trailing?: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  flex?: boolean;
  fullWidth?: boolean;
  maxWidth?: number;
}) {
  const t = useTheme();
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={[
        flex && { flex: 1, minWidth: 0 },
        fullWidth && { alignSelf: "stretch" },
        maxWidth != null && !fullWidth ? { maxWidth } : null,
      ]}
    >
      <GlassPanel
        strength="chip"
        style={[styles.pillGlass, { borderColor: t.colors.glass_highlight }]}
        contentStyle={styles.pillInner}
      >
        <View
          style={[
            styles.iconBubble,
            caption
              ? {
                  backgroundColor: t.colors.tone_primary + "14",
                  borderColor: t.colors.tone_primary + "2E",
                }
              : {
                  backgroundColor: "transparent",
                  borderColor: "transparent",
                },
          ]}
        >
          <SFSymbol
            name={icon}
            size={caption ? 15 : 14}
            color={caption ? t.colors.tone_primary : t.colors.text_secondary}
          />
        </View>
        <View style={styles.pillLabel}>
          {caption ? (
            <Text style={[styles.pillCaption, { color: t.colors.text_tertiary }]} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
          <Text
            style={[
              styles.pillValue,
              { color: t.colors.text_primary },
              !caption ? { fontSize: 13, lineHeight: 16, marginTop: 0 } : null,
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
        </View>
        {trailing}
        <SFSymbol name="chevron.down" size={11} color={t.colors.text_tertiary} />
      </GlassPanel>
    </PressableScale>
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
  const dateLabel = shortDateRangeContextLabel(dateRange);
  const dateDetailLabel = formatDateRangeLabel(dateRange);
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
      <HeaderPill
        testID="date-range-btn"
        icon="calendar"
        caption=""
        value={dateLabel}
        onPress={() => setDateOpen(true)}
        accessibilityLabel={`Date range: ${dateLabel}. ${dateDetailLabel}`}
        fullWidth={fullWidth}
        maxWidth={168}
      />

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

export function TopBar({
  title,
  showProfileSelector = true,
  showDateRange = true,
  showKdpAccountGroups = true,
  rightAction,
}: TopBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const [listMode, setListMode] = useState<ProfileSheetMode>("ready");
  const [pendingKdpAccountId, setPendingKdpAccountId] = useState<string | null>(null);

  const kdpAccountsQ = useQuery({
    queryKey: ["profile-picker-kdp-accounts", adminFilterUserId ?? "self"],
    queryFn: () => fetchKdpAccountsForUser(adminFilterUserId),
    enabled: profileOpen && listMode === "kdp_ads",
    staleTime: 60_000,
  });

  const visibleProfiles = useMemo(
    () => filterProfilesBySheetMode(profiles, listMode),
    [profiles, listMode],
  );
  const groupedProfiles = useMemo(
    () => groupProfilesByAdsAccount(visibleProfiles),
    [visibleProfiles],
  );
  const readyCount = useMemo(
    () => profiles.filter((p) => isReadyToEnable(p) || profileEnabled(p)).length,
    [profiles],
  );
  const kdpAdsCount = useMemo(
    () => profiles.filter((p) => (p.kdp_account_count ?? 0) > 0).length,
    [profiles],
  );
  const adsOnlyCount = useMemo(
    () => filterProfilesBySheetMode(profiles, "ads_only").length,
    [profiles],
  );
  const enabledProfiles = useMemo(
    () => profiles.filter((p) => profileEnabled(p)),
    [profiles],
  );
  const selectedProfiles = useMemo(
    () =>
      profiles.filter(
        (p) => selectedProfileIds.includes(p.id) || selectedProfileIds.includes(p.profile_id),
      ),
    [profiles, selectedProfileIds],
  );
  const marketCountries = useMemo(() => {
    if (selectedProfiles.length > 0) {
      return multiCountryCodes(selectedProfiles, { onlyEnabled: false });
    }
    return multiCountryCodes(profiles, { onlyEnabled: true });
  }, [profiles, selectedProfiles]);
  const hasMarketPill = marketCountries.length > 0;

  const selectedLabel =
    selectedProfileIds.length === 0
      ? "No profiles"
      : enabledProfiles.length > 0 && selectedProfileIds.length === enabledProfiles.length
      ? `All active (${enabledProfiles.length})`
      : selectedProfileIds.length === 1
      ? profiles.find((p) => p.id === selectedProfileIds[0])?.account_name ?? "1 profile"
      : `${selectedProfileIds.length} active`;
  const profileA11yPrefix = viewingUser?.email
    ? `${viewingUser.email.split("@")[0]} · `
    : "";

  function onViewToggle(profileId: string) {
    const profile = profiles.find((p) => p.id === profileId || p.profile_id === profileId);
    if (profile && !profileEnabled(profile) && !profileInView(profile, selectedProfileIds)) {
      Alert.alert(NEST_DISABLED_VIEW_TITLE, NEST_DISABLED_VIEW_MESSAGE, [
        { text: "OK", style: "cancel" },
        {
          text: "Amazon Accounts",
          onPress: () => {
            setProfileOpen(false);
            router.push("/more/accounts" as Href);
          },
        },
      ]);
      return;
    }
    toggleProfile(profileId);
  }

  function renameKdpAccount(account: KdpAccountSummary) {
    if (adminFilterUserId) return;
    Alert.prompt(
      "Rename KDP account",
      "This name is shown only in InteliAds.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (value?: string) => {
            const name = String(value || "").trim();
            if (!name || name === account.name) return;
            void updateKdpAccountName(account.id, name)
              .then(() => kdpAccountsQ.refetch())
              .catch((error) => Alert.alert("Couldn't rename KDP account", error instanceof Error ? error.message : String(error)));
          },
        },
      ],
      "plain-text",
      account.name,
    );
  }

  function openKdpManager(account: KdpAccountSummary) {
    if (Platform.OS === "ios" && profileOpen) {
      setPendingKdpAccountId(account.id);
      setProfileOpen(false);
      return;
    }
    setProfileOpen(false);
    router.push({ pathname: "/more/kdp-manager", params: { accountId: account.id } });
  }

  function finishProfileDismiss() {
    if (!pendingKdpAccountId) return;
    const accountId = pendingKdpAccountId;
    setPendingKdpAccountId(null);
    router.push({ pathname: "/more/kdp-manager", params: { accountId } });
  }

  function renderProfileToggle(p: (typeof profiles)[number], groupItems: (typeof profiles)) {
    const selected = profileInView(p, selectedProfileIds);
    const nestOn = profileEnabled(p);
    const displayName = profileDisplayName(p);
    const association = profileAssociationHint(p, groupItems);
    const switchDisabled = !nestOn && !selected;
    return (
      <TouchableOpacity
        key={p.id}
        testID={`profile-row-${p.profile_id}`}
        style={[styles.profileRow, { borderBottomColor: t.colors.separator, opacity: switchDisabled ? 0.55 : 1 }]}
        onPress={() => onViewToggle(p.id)}
        activeOpacity={0.6}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>
            {countryFlagEmoji(p.country_code)} {displayName}
          </Text>
          <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
            {[p.country_code, p.currency_code, nestOn ? null : "Off in InteliAds"].filter(Boolean).join(" · ")}
          </Text>
          {association ? (
            <Text testID={`profile-assoc-${p.profile_id}`} style={[t.typography.caption2, { color: t.colors.text_tertiary, marginTop: 2 }]}>
              {association}
            </Text>
          ) : null}
          <Text style={[t.typography.caption2, { color: selected ? t.colors.tone_primary : t.colors.text_tertiary, marginTop: 2, fontWeight: "600" }]}>
            {viewStatusLabel(selected)}
          </Text>
        </View>
        <Switch
          value={selected}
          onValueChange={() => onViewToggle(p.id)}
          disabled={switchDisabled}
          trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
          ios_backgroundColor={t.colors.background_tertiary}
          accessibilityLabel={viewSwitchAccessibilityLabel(displayName, selected)}
          accessibilityHint={selected ? VIEW_SWITCH_HINT_ON : VIEW_SWITCH_HINT_OFF}
          accessibilityValue={{ text: viewStatusLabel(selected) }}
          testID={`profile-view-toggle-${p.profile_id}`}
        />
      </TouchableOpacity>
    );
  }

  function renderKdpGroups() {
    if (kdpAccountsQ.isPending) {
      return <Text style={[t.typography.body, { color: t.colors.text_secondary, padding: 16 }]}>Loading KDP groups…</Text>;
    }
    if (kdpAccountsQ.isError) {
      return (
        <TouchableOpacity onPress={() => void kdpAccountsQ.refetch()} style={{ padding: 16 }}>
          <Text style={[t.typography.body, { color: t.colors.tone_primary }]}>Retry KDP groups</Text>
        </TouchableOpacity>
      );
    }
    const accounts = kdpAccountsQ.data ?? [];
    if (!accounts.length) {
      return <Text style={[t.typography.body, { color: t.colors.text_secondary, padding: 16 }]}>No linked KDP accounts.</Text>;
    }
    return accounts.map((account) => {
      const linked = new Set(account.linked_amazon_profile_ids.map(String));
      const items = profiles.filter((profile) => linked.has(String(profile.profile_id)) || linked.has(String(profile.id)));
      return (
        <View key={account.id} testID={`profile-kdp-group-${account.id}`} style={[styles.kdpGroup, { borderColor: t.colors.separator, backgroundColor: t.colors.background_secondary }]}>
          <View style={styles.kdpGroupHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]} numberOfLines={1}>{account.name || "KDP account"}</Text>
              <Text style={[t.typography.caption1, { color: t.colors.text_secondary, marginTop: 2 }]}>
                {items.length} Ads marketplace{items.length === 1 ? "" : "s"} · {account.book_count ?? 0} books
              </Text>
            </View>
            {!adminFilterUserId ? (
              <TouchableOpacity testID={`rename-kdp-${account.id}`} onPress={() => renameKdpAccount(account)} hitSlop={8}>
                <SFSymbol name="pencil" size={16} color={t.colors.tone_primary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity testID={`view-kdp-books-${account.id}`} onPress={() => openKdpManager(account)} style={[styles.kdpBooksButton, { backgroundColor: t.colors.tone_primary + "16" }]}>
              <Text style={[t.typography.caption1, { color: t.colors.tone_primary, fontWeight: "700" }]}>Books</Text>
            </TouchableOpacity>
          </View>
          {items.length ? items.map((profile) => renderProfileToggle(profile, items)) : (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, paddingHorizontal: 14, paddingBottom: 12 }]}>No linked Ads marketplaces</Text>
          )}
        </View>
      );
    });
  }

  function renderProfileRows() {
    if (profiles.length === 0) {
      return (
        <Text style={[t.typography.body, { color: t.colors.text_secondary, padding: 16 }]}>
          No Amazon profiles found.
        </Text>
      );
    }
    if (visibleProfiles.length === 0) {
      return (
        <Text
          testID="profiles-ready-empty"
          style={[t.typography.body, { color: t.colors.text_secondary, padding: 16 }]}
        >
          None ready
        </Text>
      );
    }
    return groupedProfiles.map((group) => (
      <View key={group.key} testID={`profile-group-${group.accountId || group.key}`}>
        <Text
          style={[
            t.typography.caption1,
            {
              color: t.colors.text_secondary,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 6,
              fontWeight: "700",
              letterSpacing: 0.4,
              textTransform: "uppercase",
            },
          ]}
        >
          {adsAccountGroupHeading(group)}
        </Text>
        {group.items.map((p) => renderProfileToggle(p, group.items))}
      </View>
    ));
  }

  return (
    <>
      <View style={[styles.bar, { borderBottomColor: t.colors.border, paddingTop: Math.max(insets.top - 4, 4) }]}>
        {title ? (
          <View style={styles.headerRow}>
            <Text style={[t.typography.title2, styles.title, { color: t.colors.text_primary }]} numberOfLines={1}>
              {title}
            </Text>
            {rightAction ? (
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
            ) : null}
          </View>
        ) : null}
        {(showProfileSelector || showDateRange || (rightAction && !title)) && (
          <View style={[styles.controls, title ? { marginTop: 8 } : null]}>
            {showProfileSelector &&
              (hasMarketPill ? (
                <MarketPill
                  testID="profile-selector-btn"
                  countries={marketCountries}
                  currency={primaryCurrency}
                  onPress={() => setProfileOpen(true)}
                  accessibilityLabel={`Profiles: ${profileA11yPrefix}${formatMarketPillLabel(marketCountries, primaryCurrency)}`}
                  flex
                />
              ) : (
                <HeaderPill
                  testID="profile-selector-btn"
                  icon="building.2"
                  caption="Profiles"
                  value={`${profileA11yPrefix}${selectedLabel}`}
                  onPress={() => setProfileOpen(true)}
                  accessibilityLabel={`Profiles: ${selectedLabel}, currency ${primaryCurrency}`}
                  flex
                  trailing={
                    selectedProfileIds.length > 0 ? (
                      <View style={[styles.currencyTag, { backgroundColor: t.colors.tone_primary + "1A" }]}>
                        <Text style={[t.typography.caption2, { color: t.colors.tone_primary, fontWeight: "700" }]}>
                          {primaryCurrency}
                        </Text>
                      </View>
                    ) : null
                  }
                />
              ))}
            {showDateRange && <DateRangeControl />}
            {rightAction && !title ? (
              <PressableScale
                accessibilityLabel={rightAction.testID ?? "Screen action"}
                testID={rightAction.testID}
                onPress={rightAction.onPress}
              >
                <GlassPanel
                  strength="chip"
                  style={[styles.actionGlass, { borderColor: t.colors.glass_highlight }]}
                  contentStyle={styles.actionInner}
                >
                  <SFSymbol name={sfFromIonicon(rightAction.icon)} size={18} color={t.colors.tone_primary} />
                </GlassPanel>
              </PressableScale>
            ) : null}
          </View>
        )}
      </View>

      {/* Profile Selector Sheet — Switch = current view only (not Nest enable). */}
      <Modal
        visible={profileOpen}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
        transparent={Platform.OS !== "ios"}
        onRequestClose={() => setProfileOpen(false)}
        onDismiss={finishProfileDismiss}
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
            <View style={styles.filterRow}>
              <TouchableOpacity
                testID="profiles-filter-ready"
                onPress={() => setListMode("ready")}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: listMode === "ready" ? t.colors.tone_primary + "1A" : t.colors.background_tertiary,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    {
                      color: listMode === "ready" ? t.colors.tone_primary : t.colors.text_secondary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {PROFILE_LIST_READY_LABEL}
                  {readyCount ? ` (${readyCount})` : ""}
                </Text>
              </TouchableOpacity>
              {showKdpAccountGroups ? (
                <TouchableOpacity
                  testID="profiles-filter-kdp-ads"
                  onPress={() => setListMode("kdp_ads")}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: listMode === "kdp_ads" ? t.colors.tone_primary + "1A" : t.colors.background_tertiary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.typography.caption1,
                      {
                        color: listMode === "kdp_ads" ? t.colors.tone_primary : t.colors.text_secondary,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {PROFILE_LIST_KDP_ADS_LABEL} ({kdpAdsCount})
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                testID="profiles-filter-ads-only"
                onPress={() => setListMode("ads_only")}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: listMode === "ads_only" ? t.colors.tone_primary + "1A" : t.colors.background_tertiary,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    {
                      color: listMode === "ads_only" ? t.colors.tone_primary : t.colors.text_secondary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {PROFILE_LIST_ADS_ONLY_LABEL} ({adsOnlyCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="profiles-filter-all"
                onPress={() => setListMode("all")}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: listMode === "all" ? t.colors.tone_primary + "1A" : t.colors.background_tertiary,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption1,
                    {
                      color: listMode === "all" ? t.colors.tone_primary : t.colors.text_secondary,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {PROFILE_LIST_ALL_LABEL}
                </Text>
              </TouchableOpacity>
            </View>
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
              {listMode === "kdp_ads" ? renderKdpGroups() : renderProfileRows()}
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
                  <Text style={[t.typography.callout, { color: t.colors.tone_primary }]}>Select all</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.filterRow}>
                <TouchableOpacity testID="profiles-filter-ready" onPress={() => setListMode("ready")}>
                  <Text style={{ color: listMode === "ready" ? t.colors.tone_primary : t.colors.text_secondary }}>
                    {PROFILE_LIST_READY_LABEL}
                  </Text>
                </TouchableOpacity>
                {showKdpAccountGroups ? (
                  <TouchableOpacity testID="profiles-filter-kdp-ads" onPress={() => setListMode("kdp_ads")}>
                    <Text style={{ color: listMode === "kdp_ads" ? t.colors.tone_primary : t.colors.text_secondary }}>
                      {PROFILE_LIST_KDP_ADS_LABEL} ({kdpAdsCount})
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity testID="profiles-filter-ads-only" onPress={() => setListMode("ads_only")}>
                  <Text style={{ color: listMode === "ads_only" ? t.colors.tone_primary : t.colors.text_secondary }}>
                    {PROFILE_LIST_ADS_ONLY_LABEL} ({adsOnlyCount})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity testID="profiles-filter-all" onPress={() => setListMode("all")}>
                  <Text style={{ color: listMode === "all" ? t.colors.tone_primary : t.colors.text_secondary }}>
                    {PROFILE_LIST_ALL_LABEL}
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ maxHeight: 480 }}>{listMode === "kdp_ads" ? renderKdpGroups() : renderProfileRows()}</ScrollView>
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
    gap: density.chromeGap - 2,
  },
  pillGlass: {
    borderRadius: dashboard.headerShellRadius - 2,
    borderCurve: "continuous",
  },
  pillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: density.chromeGap,
    paddingLeft: 7,
    paddingRight: density.chipPadH + 1,
    paddingVertical: density.chipPadV,
    minHeight: layout.minTap,
  },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: dashboard.chipRadius - 2,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  pillLabel: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  pillCaption: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    lineHeight: 12,
  },
  pillValue: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
    lineHeight: 18,
    marginTop: 1,
  },
  currencyTag: {
    paddingHorizontal: density.chromeGap - 2,
    paddingVertical: 2,
    borderRadius: 7,
    borderCurve: "continuous",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: density.chromeGap,
    paddingHorizontal: dashboard.pageInset,
    paddingBottom: density.chromeGap,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: dashboard.chipRadius - 2,
    borderCurve: "continuous",
  },
  iconBtn: {
    width: layout.minTap - 6,
    height: layout.minTap - 6,
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  actionGlass: {
    borderRadius: dashboard.chipRadius,
    borderCurve: "continuous",
  },
  actionInner: {
    width: layout.minTap,
    height: layout.minTap,
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
  kdpGroup: {
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  kdpGroupHeader: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  kdpBooksButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 16,
    borderCurve: "continuous",
  },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
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
