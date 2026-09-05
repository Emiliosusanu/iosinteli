import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ActivityIndicator,
  ScrollView,
  Alert,
  AppState,
  Platform,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SubScreen } from "@/src/components/SubScreen";
import { useApp } from "@/src/contexts/AppContext";
import { useAuth } from "@/src/contexts/AuthContext";
import { dashboard, useTheme } from "@/src/lib/theme";
import { startAmazonConnect } from "@/src/lib/amazonAuth";
import {
  fetchKdpAccounts,
  setKdpLinkedProfiles,
  toggleAmazonProfile,
  triggerSync,
  unlinkKdpProfile,
  updateProfileNickname,
} from "@/src/lib/mutations";
import { EmptyState, PrimaryButton, RetryState, SecondaryButton } from "@/src/components/Primitives";
import { alertMutationError } from "@/src/components/Mutations";
import { SIGN_IN_TO_MUTATE_MESSAGE } from "@/src/lib/rulesApi";
import {
  amazonAdsProfileId,
  amazonAdsProfileIdsForSelection,
  VIEWING_CUSTOMER_MESSAGE,
} from "@/src/lib/accountScope";
import {
  DISABLE_CONFIRM_MESSAGE,
  KDP_SECTION_FOOTER,
  PROFILE_SWITCH_OFF_HINT,
  PROFILE_SWITCH_ON_HINT,
  VIEW_ADD_HINT,
  VIEW_REMOVE_HINT,
  disableConfirmTitle,
  enabledStatusLabel,
  profileDisplayName,
  profileEnabled,
  profileInView,
  profileRowAccessibilityLabel,
  profileSwitchAccessibilityLabel,
  viewStatusLabel,
} from "@/src/lib/accountsUi";
import { IOSGroupedSection } from "@/src/components/ios/Native";
import { AmazonProfile } from "@/src/lib/types";

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  JP: "Japan",
  IN: "India",
  MX: "Mexico",
  BR: "Brazil",
  NL: "Netherlands",
  SE: "Sweden",
  PL: "Poland",
  TR: "Turkey",
  SA: "Saudi Arabia",
  AE: "UAE",
  SG: "Singapore",
};

const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollars",
  GBP: "British Pounds",
  CAD: "Canadian Dollars",
  AUD: "Australian Dollars",
  EUR: "Euros",
  JPY: "Japanese Yen",
  INR: "Indian Rupees",
  BRL: "Brazilian Reais",
  MXN: "Mexican Pesos",
  SEK: "Swedish Krona",
  PLN: "Polish Zloty",
};

function countryLabel(code: string | null): string {
  if (!code) return "Other";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

function currencyLabel(code: string | null): string {
  if (!code) return "";
  return CURRENCY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

function profileLabel(profiles: AmazonProfile[], id: string): string {
  const match = profiles.find((p) => p.id === id || p.profile_id === id);
  return match ? profileDisplayName(match) : "Amazon profile";
}

export default function AmazonAccountsScreen() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const {
    profiles,
    profilesLoading,
    profilesError,
    refetchProfiles,
    selectedProfileIds,
    setSelectedProfileIds,
    adminFilterUserId,
    toggleProfile,
  } = useApp();
  const { user, guestMode } = useAuth();
  const [connectBusy, setConnectBusy] = useState(false);
  const [nicknameTarget, setNicknameTarget] = useState<{ id: string } | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [kdpBusy, setKdpBusy] = useState<string | null>(null);
  /** Sticky UI override so enable/disable never snaps back while refetch races. */
  const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({});
  /** Per-profile in-flight toggles — do not block other rows (was causing lag). */
  const [togglePendingIds, setTogglePendingIds] = useState<Record<string, true>>({});

  const viewingCustomer = !!adminFilterUserId;
  const canMutate = !!user?.id && !guestMode && !viewingCustomer;

  useEffect(() => {
    if (!profiles.length || !Object.keys(enabledOverrides).length) return;
    setEnabledOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, forced] of Object.entries(prev)) {
        const match = profiles.find((p) => p.id === id || p.profile_id === id);
        if (!match) continue;
        if (profileEnabled(match) === forced) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [profiles, enabledOverrides]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  const kdpQ = useQuery({
    queryKey: ["kdp-accounts", user?.id ?? "guest"],
    queryFn: fetchKdpAccounts,
    enabled: canMutate,
    retry: false,
  });

  const profilesQueryKey = ["amazon-profiles", user?.id ?? "guest", adminFilterUserId ?? "self"] as const;

  const profileToggle = useMutation({
    mutationFn: ({
      profileId,
      enabled,
      rowId,
      adsProfileId,
    }: {
      profileId: string;
      enabled: boolean;
      rowId?: string;
      adsProfileId?: string;
    }) => toggleAmazonProfile(profileId, enabled, { rowId, adsProfileId }),
    onMutate: async ({ enabled, rowId, adsProfileId, profileId }) => {
      const matchIds = [rowId, adsProfileId, profileId]
        .map((id) => String(id || "").trim())
        .filter(Boolean);
      setTogglePendingIds((prev) => {
        const next = { ...prev };
        for (const id of matchIds) next[id] = true;
        return next;
      });
      await queryClient.cancelQueries({ queryKey: profilesQueryKey });
      const previous = queryClient.getQueryData<AmazonProfile[]>(profilesQueryKey);
      const matchSet = new Set(matchIds);
      queryClient.setQueryData<AmazonProfile[]>(profilesQueryKey, (old) =>
        (old ?? []).map((profile) =>
          matchSet.has(profile.id) || matchSet.has(profile.profile_id)
            ? { ...profile, is_enabled: enabled }
            : profile,
        ),
      );
      return { previous, matchIds };
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["amazon-profiles", user?.id ?? "guest"] });
      // Match web: after enable, kick Ads sync so campaigns appear.
      if (vars.enabled) {
        void triggerSync().catch(() => {});
      }
    },
    onError: (error, vars, ctx) => {
      const matchSet = new Set(
        (ctx?.matchIds ?? [vars?.rowId, vars?.adsProfileId, vars?.profileId])
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      );
      if (matchSet.size) {
        queryClient.setQueryData<AmazonProfile[]>(profilesQueryKey, (old) =>
          (old ?? []).map((profile) => {
            if (!matchSet.has(profile.id) && !matchSet.has(profile.profile_id)) return profile;
            const prior = (ctx?.previous ?? []).find(
              (p) => matchSet.has(p.id) || matchSet.has(p.profile_id),
            );
            return prior ? { ...profile, is_enabled: prior.is_enabled } : profile;
          }),
        );
        setEnabledOverrides((prev) => {
          const next = { ...prev };
          for (const id of matchSet) delete next[id];
          return next;
        });
      } else if (ctx?.previous) {
        queryClient.setQueryData(profilesQueryKey, ctx.previous);
      }
      alertMutationError(error, "Couldn't update profile.");
      void refetchProfiles();
    },
    onSettled: (_data, _error, vars, ctx) => {
      const ids =
        ctx?.matchIds ??
        [vars?.rowId, vars?.adsProfileId, vars?.profileId]
          .map((id) => String(id || "").trim())
          .filter(Boolean);
      if (!ids.length) return;
      setTogglePendingIds((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    },
  });

  const requireSignIn = () => {
    Alert.alert("Sign in required", SIGN_IN_TO_MUTATE_MESSAGE);
  };

  const requireCanMutate = (): boolean => {
    if (viewingCustomer) {
      Alert.alert("Viewing a customer", VIEWING_CUSTOMER_MESSAGE);
      return false;
    }
    if (!user?.id || guestMode) {
      requireSignIn();
      return false;
    }
    return true;
  };

  function applyProfileActive(contextId: string, enabled: boolean) {
    const match = profiles.find((p) => p.id === contextId || p.profile_id === contextId);
    const rowId = match?.id ?? contextId;
    const adsId = match ? amazonAdsProfileId(match) : contextId;
    const matchIds = new Set([rowId, adsId, contextId].map((id) => String(id || "").trim()).filter(Boolean));

    // Flip is_enabled in the shared query cache BEFORE view selection so the
    // AppContext sync effect does not strip a just-re-enabled profile.
    setEnabledOverrides((prev) => {
      const next = { ...prev };
      for (const id of matchIds) next[id] = enabled;
      return next;
    });
    queryClient.setQueryData<AmazonProfile[]>(profilesQueryKey, (old) =>
      (old ?? []).map((profile) =>
        matchIds.has(profile.id) || matchIds.has(profile.profile_id)
          ? { ...profile, is_enabled: enabled }
          : profile,
      ),
    );

    if (enabled) {
      if (!profileInView(match ?? { id: rowId, profile_id: adsId }, selectedProfileIds)) {
        toggleProfile(rowId);
      }
    } else {
      setSelectedProfileIds(
        selectedProfileIds.filter((id) => id !== rowId && id !== match?.profile_id && id !== contextId),
      );
    }
    profileToggle.mutate({ profileId: adsId, enabled, rowId, adsProfileId: adsId });
  }

  function setProfileActive(profileId: string, enabled: boolean) {
    if (!requireCanMutate()) return;
    if (!enabled) {
      const match = profiles.find((p) => p.id === profileId || p.profile_id === profileId);
      Alert.alert(
        disableConfirmTitle(match ? profileDisplayName(match) : "this account"),
        DISABLE_CONFIRM_MESSAGE,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Turn off", style: "destructive", onPress: () => applyProfileActive(profileId, false) },
        ],
      );
      return;
    }
    applyProfileActive(profileId, true);
  }

  async function onConnectAmazon() {
    if (!requireCanMutate()) return;
    setConnectBusy(true);
    try {
      const result = await startAmazonConnect();
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["nest-token"] });
        await queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
        void triggerSync().catch(() => {});
        return;
      }
      if (result.cancelled) return;
      alertMutationError(new Error(result.error), "Couldn't start Amazon connect.");
    } catch (error) {
      alertMutationError(error, "Couldn't start Amazon connect.");
    } finally {
      setConnectBusy(false);
    }
  }

  function openNicknameEditor(profile: AmazonProfile) {
    if (!requireCanMutate()) return;
    const current = profile.nickname || profile.account_name || "";
    const mutationId = amazonAdsProfileId(profile);
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Nickname",
        "Shown only in InteliAds.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (value?: string) => {
              void saveNickname(mutationId, (value ?? "").trim());
            },
          },
        ],
        "plain-text",
        current,
      );
      return;
    }
    setNicknameDraft(current);
    setNicknameTarget({ id: mutationId });
  }

  async function saveNickname(profileId: string, nickname: string) {
    if (!requireCanMutate()) return;
    setNicknameSaving(true);
    try {
      await updateProfileNickname(profileId, nickname);
      void queryClient.invalidateQueries({ queryKey: ["amazon-profiles", user?.id ?? "guest"] });
      setNicknameTarget(null);
    } catch (error) {
      alertMutationError(error, "Couldn't save nickname.");
    } finally {
      setNicknameSaving(false);
    }
  }

  async function linkSelected(kdpAccountId: string, accountName: string, currentCount: number) {
    if (!requireCanMutate()) return;
    if (selectedProfileIds.length === 0) {
      Alert.alert("Nothing in view", "Select Amazon profiles in the account menu, then link.");
      return;
    }
    const amazonIds = amazonAdsProfileIdsForSelection(profiles, selectedProfileIds);
    Alert.alert(
      "Link selected profiles?",
      `This replaces ${currentCount} linked profile${currentCount === 1 ? "" : "s"} on ${accountName} with your ${amazonIds.length} selected Amazon profile${amazonIds.length === 1 ? "" : "s"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Link",
          onPress: () => {
            void (async () => {
              setKdpBusy(`link-${kdpAccountId}`);
              try {
                await setKdpLinkedProfiles(kdpAccountId, amazonIds);
                void queryClient.invalidateQueries({ queryKey: ["kdp-accounts"] });
                void queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
              } catch (error) {
                alertMutationError(error, "Couldn't link KDP account.");
              } finally {
                setKdpBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  function unlinkProfile(kdpAccountId: string, amazonProfileId: string, label: string) {
    if (!requireCanMutate()) return;
    Alert.alert("Unlink profile?", `Remove ${label} from this KDP account?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unlink",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setKdpBusy(`unlink-${kdpAccountId}-${amazonProfileId}`);
            try {
              await unlinkKdpProfile(kdpAccountId, amazonProfileId);
              void queryClient.invalidateQueries({ queryKey: ["kdp-accounts"] });
              void queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
            } catch (error) {
              alertMutationError(error, "Couldn't unlink profile.");
            } finally {
              setKdpBusy(null);
            }
          })();
        },
      },
    ]);
  }

  const groupedProfiles = useMemo(() => {
    const map = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      const key = (profile.country_code ?? "other").toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(profile);
    }
    return Array.from(map.entries())
      .map(([code, items]) => ({
        code,
        name: countryLabel(code),
        items,
        enabledCount: items.filter((p) => profileEnabled(p)).length,
      }))
      .sort((a, b) => {
        if (a.enabledCount > 0 && b.enabledCount === 0) return -1;
        if (a.enabledCount === 0 && b.enabledCount > 0) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [profiles]);

  const enabledCount = profiles.filter((p) => profileEnabled(p)).length;
  const viewCount = selectedProfileIds.length;
  const totalCount = profiles.length;
  const kdpAccounts = kdpQ.data ?? [];
  const showListSpinner = profilesLoading && profiles.length === 0 && !profilesError;
  const connectDisabled = connectBusy || !canMutate;

  const connectButton = (
    <PrimaryButton
      testID="connect-amazon-btn"
      label={connectBusy ? "Opening Amazon…" : "Connect Amazon"}
      icon="logo-amazon"
      onPress={() => void onConnectAmazon()}
      loading={connectBusy}
      disabled={connectDisabled}
      full
    />
  );

  return (
    <SubScreen title="Amazon Accounts">
      <ScrollView contentContainerStyle={styles.scroll}>
        {viewingCustomer ? (
          <View
            testID="accounts-viewing-customer"
            accessibilityRole="text"
            accessibilityLabel="Viewing a customer. Connect, enable, nickname, and KDP changes are off."
            style={[styles.banner, { backgroundColor: t.colors.tone_warning + "12", borderColor: t.colors.tone_warning + "30" }]}
          >
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              Viewing a customer. Changes are off.
            </Text>
          </View>
        ) : null}

        {guestMode ? (
          <View
            testID="accounts-guest"
            style={[styles.banner, { backgroundColor: t.colors.background_secondary, borderColor: t.colors.separator }]}
          >
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary }]}>
              Demo. Amazon connect and profile changes need a signed-in account.
            </Text>
          </View>
        ) : null}

        <View
          accessibilityRole="header"
          accessibilityLabel={
            totalCount > 0
              ? `${user?.email ?? "Guest"}. InteliAds account. ${enabledCount} of ${totalCount} enabled. ${viewCount} in current view`
              : `${user?.email ?? "Guest"}. InteliAds account`
          }
          style={styles.identity}
        >
          <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>{user?.email ?? "Guest"}</Text>
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
            InteliAds account
          </Text>
          {totalCount > 0 ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
              {enabledCount} of {totalCount} enabled
              {"\n"}
              {viewCount} in current view
            </Text>
          ) : null}
        </View>

        {profilesError && profiles.length === 0 ? (
          <RetryState
            title="Couldn't load Amazon profiles"
            subtitle="Check the connection and try again."
            onRetry={() => refetchProfiles()}
            retrying={profilesLoading}
          />
        ) : showListSpinner ? (
          <ActivityIndicator color={t.colors.tone_primary} style={{ marginTop: 28 }} />
        ) : profiles.length === 0 ? (
          <View>
            <EmptyState
              icon="business-outline"
              title="No Amazon profiles"
              subtitle="Connect Amazon Ads in the browser. This does not disconnect an existing Amazon login."
            />
            {canMutate ? <View style={{ marginTop: 4 }}>{connectButton}</View> : null}
          </View>
        ) : (
          <View>
            {groupedProfiles.map(({ code, name, items, enabledCount: groupEnabled }) => (
              <IOSGroupedSection
                key={code}
                title={`${name}${code !== "OTHER" ? ` · ${code}` : ""}`}
                footer={`${groupEnabled} of ${items.length} enabled`}
              >
                {items.map((item, idx) => {
                  const serverEnabled = profileEnabled(item);
                  const enabled =
                    enabledOverrides[item.id] ??
                    enabledOverrides[item.profile_id] ??
                    serverEnabled;
                  const inView = profileInView(item, selectedProfileIds);
                  const displayName = profileDisplayName(item);
                  const currency = currencyLabel(item.currency_code);
                  const marketplace = countryLabel(item.country_code);
                  const pending =
                    !!togglePendingIds[item.id] ||
                    !!togglePendingIds[item.profile_id] ||
                    (profileToggle.isPending &&
                      (profileToggle.variables?.profileId === item.id ||
                        profileToggle.variables?.profileId === item.profile_id ||
                        profileToggle.variables?.rowId === item.id ||
                        profileToggle.variables?.adsProfileId === item.profile_id));
                  return (
                    <View
                      key={item.id}
                      testID={`account-row-${item.profile_id}`}
                      accessible
                      accessibilityLabel={profileRowAccessibilityLabel({
                        name: displayName,
                        marketplace,
                        currency,
                        enabled,
                        inView,
                      })}
                      style={[
                        styles.profileRow,
                        idx < items.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: t.colors.separator,
                        },
                      ]}
                    >
                      <Pressable
                        testID={`account-nickname-${item.profile_id}`}
                        onPress={() => openNicknameEditor(item)}
                        disabled={!canMutate}
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${displayName}`}
                        accessibilityHint="Shown only in InteliAds."
                        style={styles.profileCopy}
                      >
                        <Text style={[t.typography.body, { color: t.colors.text_primary }]}>{displayName}</Text>
                        <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
                          {enabledStatusLabel(enabled)}
                          {currency ? ` · ${currency}` : ""}
                        </Text>
                        <Pressable
                          testID={`account-view-${item.profile_id}`}
                          onPress={() => {
                            if (!requireCanMutate()) return;
                            if (!enabled) {
                              Alert.alert(
                                "Profile is off",
                                "Turn this Amazon profile on first, then add it to the current view.",
                              );
                              return;
                            }
                            toggleProfile(item.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={viewStatusLabel(inView)}
                          accessibilityHint={inView ? VIEW_REMOVE_HINT : VIEW_ADD_HINT}
                          hitSlop={6}
                          style={{ marginTop: 4, alignSelf: "flex-start" }}
                        >
                          <Text
                            style={[
                              t.typography.footnote,
                              {
                                color: inView ? t.colors.tone_primary : t.colors.tone_warning,
                                fontWeight: "600",
                              },
                            ]}
                          >
                            {viewStatusLabel(inView)}
                          </Text>
                        </Pressable>
                      </Pressable>
                      <View style={styles.switchHit}>
                        <Switch
                          value={enabled}
                          onValueChange={(value) => setProfileActive(item.id, value)}
                          trackColor={{ false: t.colors.background_tertiary, true: t.colors.tone_primary }}
                          thumbColor="#fff"
                          disabled={viewingCustomer}
                          accessibilityState={{ disabled: viewingCustomer, busy: pending }}
                          testID={`account-toggle-${item.profile_id}`}
                          accessibilityLabel={profileSwitchAccessibilityLabel(displayName, enabled)}
                          accessibilityValue={{ text: enabledStatusLabel(enabled) }}
                          accessibilityHint={enabled ? PROFILE_SWITCH_ON_HINT : PROFILE_SWITCH_OFF_HINT}
                        />
                      </View>
                    </View>
                  );
                })}
              </IOSGroupedSection>
            ))}
            {canMutate ? (
              <View style={{ marginTop: 16 }}>{connectButton}</View>
            ) : null}
          </View>
        )}

        <IOSGroupedSection title="KDP data" footer={KDP_SECTION_FOOTER}>
          {viewingCustomer ? (
            <Text style={[t.typography.footnote, styles.kdpNote, { color: t.colors.text_secondary }]}>
              {"KDP links aren't shown while viewing a customer."}
            </Text>
          ) : !canMutate ? (
            <Text style={[t.typography.footnote, styles.kdpNote, { color: t.colors.text_secondary }]}>
              Sign in to link KDP data to Amazon Ads profiles.
            </Text>
          ) : kdpQ.isLoading ? (
            <ActivityIndicator color={t.colors.tone_primary} style={{ marginVertical: 16 }} />
          ) : kdpQ.isError ? (
            <View style={{ padding: 16 }}>
              <RetryState
                title="Couldn't load KDP accounts"
                subtitle="Check your connection, then retry. You can also open Settings → Royalty source."
                onRetry={() => void kdpQ.refetch()}
                retrying={kdpQ.isFetching}
              />
            </View>
          ) : kdpAccounts.length === 0 ? (
            <Text style={[t.typography.footnote, styles.kdpNote, { color: t.colors.text_secondary }]}>
              No KDP accounts yet. Turn on Royalty source → iPhone helper in Settings, or connect with the Chrome helper — then link Ads profiles here.
            </Text>
          ) : (
            kdpAccounts.map((account, index) => {
              const linked = account.linked_amazon_profile_ids ?? [];
              const linking = kdpBusy === `link-${account.id}`;
              return (
                <View
                  key={account.id}
                  testID={`kdp-account-${account.id}`}
                  style={[
                    styles.kdpAccount,
                    index < kdpAccounts.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: t.colors.separator,
                    },
                  ]}
                >
                  <Text style={[t.typography.body, { color: t.colors.text_primary }]}>
                    {account.name || "KDP account"}
                  </Text>
                  <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 2 }]}>
                    {linked.length} Amazon profile{linked.length === 1 ? "" : "s"} linked
                    {account.book_count != null ? ` · ${account.book_count} books` : ""}
                  </Text>
                  {linked.length === 0 ? (
                    <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 8 }]}>
                      No Amazon profiles linked
                    </Text>
                  ) : (
                    linked.map((profileId) => {
                      const label = profileLabel(profiles, profileId);
                      const unlinking = kdpBusy === `unlink-${account.id}-${profileId}`;
                      return (
                        <View key={profileId} style={styles.kdpLinkRow}>
                          <Text style={[t.typography.footnote, { color: t.colors.text_primary, flex: 1 }]}>
                            {label}
                          </Text>
                          <Pressable
                            testID={`kdp-unlink-${account.id}-${profileId}`}
                            onPress={() => unlinkProfile(account.id, profileId, label)}
                            disabled={!!kdpBusy}
                            accessibilityRole="button"
                            accessibilityLabel={`Unlink ${label} from ${account.name || "KDP account"}`}
                            style={styles.unlinkHit}
                          >
                            <Text style={[t.typography.footnote, { color: t.colors.tone_danger }]}>
                              {unlinking ? "Unlinking…" : "Unlink"}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })
                  )}
                  <View style={{ marginTop: 10 }}>
                    <SecondaryButton
                      testID={`kdp-link-selected-${account.id}`}
                      label={linking ? "Linking…" : "Link profiles in view"}
                      onPress={() => void linkSelected(account.id, account.name || "this KDP account", linked.length)}
                      disabled={!!kdpBusy}
                      full
                    />
                  </View>
                </View>
              );
            })
          )}
        </IOSGroupedSection>
      </ScrollView>

      <Modal visible={!!nicknameTarget} transparent animationType="fade" onRequestClose={() => setNicknameTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setNicknameTarget(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: t.colors.background_secondary }]}>
              <Text style={[t.typography.headline, { color: t.colors.text_primary }]}>Nickname</Text>
              <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]}>
                Shown only in InteliAds.
              </Text>
              <TextInput
                testID="nickname-input"
                value={nicknameDraft}
                onChangeText={setNicknameDraft}
                autoFocus
                style={[
                  t.typography.body,
                  styles.nicknameInput,
                  { color: t.colors.text_primary, borderColor: t.colors.border, backgroundColor: t.colors.background_primary },
                ]}
                placeholder="Profile name"
                placeholderTextColor={t.colors.text_tertiary}
              />
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <SecondaryButton label="Cancel" onPress={() => setNicknameTarget(null)} />
                <PrimaryButton
                  label="Save"
                  loading={nicknameSaving}
                  onPress={() => {
                    if (nicknameTarget) void saveNickname(nicknameTarget.id, nicknameDraft.trim());
                  }}
                />
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  identity: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  banner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: dashboard.cardRadius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileRow: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: "center",
  },
  switchHit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  kdpNote: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  kdpAccount: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  kdpLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  unlinkHit: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    borderRadius: dashboard.cardRadius,
    padding: 18,
  },
  nicknameInput: {
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: dashboard.chipRadius,
    paddingHorizontal: 12,
    minHeight: 48,
  },
});
