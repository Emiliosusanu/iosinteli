import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View, ScrollView } from "react-native";
import { WebView } from "react-native-webview";
import { PrimaryButton, SecondaryButton } from "@/src/components/Primitives";
import { KdpReportsWebView, KDP_HELPER_HOME } from "@/src/components/KdpReportsWebView";
import {
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import { useApp } from "@/src/contexts/AppContext";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/src/lib/theme";
import { setKdpHelperScreenFocused } from "@/src/lib/kdp/helperUi";
import { runKdpIosHelperTick } from "@/src/lib/kdp/importer";
import {
  attachKdpWebView,
  getKdpHelperStatus,
  hydrateKdpRuntimeFromPersistence,
  kdpTemplatesReady,
  subscribeKdpHelperStatus,
} from "@/src/lib/kdp/runtime";
import { KDP_CAPTURE_PAGES } from "@/src/lib/kdp/templates";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import { fetchKdpAccounts } from "@/src/lib/mutations";
import { loadHelperAccountId, selectHelperAccountId } from "@/src/lib/kdp/persist";
import {
  KDP_HELPER_FOOTER_DISABLED,
  KDP_HELPER_FOOTER_ENABLED,
} from "@/src/lib/settingsContract";

export default function KdpHelperScreen() {
  const t = useTheme();
  const { kdpRoyaltySource, selectedProfileIds } = useApp();
  const ref = useRef<WebView>(null);
  const [status, setStatus] = useState(getKdpHelperStatus());
  const [helperAccountId, setHelperAccountId] = useState<string | null>(null);
  const enabled = isIosHelperEnabled(kdpRoyaltySource);
  const accountsQ = useQuery({
    queryKey: ["kdp-helper-accounts"],
    queryFn: fetchKdpAccounts,
    staleTime: 30_000,
  });

  useEffect(() => {
    void hydrateKdpRuntimeFromPersistence();
    void loadHelperAccountId().then(setHelperAccountId);
    return subscribeKdpHelperStatus(setStatus);
  }, []);

  const applyHelperAccount = async (accountId: string) => {
    try {
      await selectHelperAccountId(accountId);
      setHelperAccountId(accountId);
      startedAfterLogin.current = false;
      automaticRetryCount.current = 0;
      setAutomaticRetryNonce((value) => value + 1);
    } catch (error) {
      Alert.alert(
        "Couldn't switch KDP account",
        error instanceof Error
          ? error.message
          : "The current Amazon session could not be cleared safely. Try again.",
      );
    }
  };

  const chooseHelperAccount = (accountId: string) => {
    if (helperAccountId === accountId) return;
    if (!status.loggedIn && !status.savedSession) {
      void applyHelperAccount(accountId);
      return;
    }
    Alert.alert(
      "Switch KDP account?",
      "To keep books and royalties separated, InteliAds will sign out only the current Amazon KDP session. Your InteliAds login and imported data stay available.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch and sign in",
          style: "destructive",
          onPress: () => void applyHelperAccount(accountId),
        },
      ],
    );
  };

  useLayoutEffect(() => {
    setKdpHelperScreenFocused(true);
    attachKdpWebView("ui", (js) => {
      ref.current?.injectJavaScript(js);
    });
    return () => {
      attachKdpWebView("ui", null);
      setKdpHelperScreenFocused(false);
    };
  }, []);

  const captured = useMemo(
    () => KDP_CAPTURE_PAGES.filter((p) => status.templates[p.type]).map((p) => p.type),
    [status.templates],
  );
  const startedAfterLogin = useRef(false);
  const automaticRetryCount = useRef(0);
  const automaticRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [automaticRetryNonce, setAutomaticRetryNonce] = useState(0);

  useEffect(() => () => {
    if (automaticRetryTimer.current) clearTimeout(automaticRetryTimer.current);
  }, []);

  useEffect(() => {
    if (!enabled || (!status.loggedIn && !status.savedSession)) {
      startedAfterLogin.current = false;
      automaticRetryCount.current = 0;
      return;
    }
    if (status.running || startedAfterLogin.current) return;
    if (!kdpTemplatesReady()) return;
    startedAfterLogin.current = true;
    void runKdpIosHelperTick("manual", { force: true, profileIds: selectedProfileIds }).then((result) => {
      if (result.ok || automaticRetryCount.current >= 1) {
        automaticRetryCount.current = 0;
        return;
      }
      automaticRetryCount.current += 1;
      automaticRetryTimer.current = setTimeout(() => {
        startedAfterLogin.current = false;
        setAutomaticRetryNonce((value) => value + 1);
      }, 1_500);
    });
  }, [
    enabled,
    status.loggedIn,
    status.savedSession,
    status.running,
    status.templates,
    selectedProfileIds,
    automaticRetryNonce,
  ]);

  const onSync = () => {
    void runKdpIosHelperTick("manual", { force: true, profileIds: selectedProfileIds });
  };

  const statusLabel = status.loggedIn
    ? "Signed in"
    : !status.sessionChecked
      ? "Checking saved session…"
      : status.savedSession
        ? "Saved session · background ready"
        : "Sign in required";
  const captureValue = captured.length ? captured.join(", ") : "Not yet";

  return (
    <SettingsScreen title="iPhone KDP helper">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection
          title="KDP import account"
          footer="This is the KDP account currently signed into Amazon. Ads profile and marketplace filters never change it."
        >
          {accountsQ.isLoading ? (
            <SettingsRow label="Loading KDP accounts…" last />
          ) : accountsQ.isError ? (
            <SettingsRow label="Couldn't load KDP accounts" value="Tap to retry" onPress={() => void accountsQ.refetch()} last />
          ) : (accountsQ.data ?? []).map((account, index, rows) => (
            <SettingsRow
              key={account.id}
              testID={`kdp-helper-account-${account.id}`}
              label={account.name || "KDP account"}
              subtitle={helperAccountId === account.id ? "Current import destination" : "Tap to select import destination"}
              value={helperAccountId === account.id ? "Selected" : undefined}
              symbol={helperAccountId === account.id ? "checkmark.circle.fill" : "books.vertical"}
              symbolColor={helperAccountId === account.id ? t.colors.tone_good : t.colors.tone_inactive}
              onPress={() => chooseHelperAccount(account.id)}
              last={index === rows.length - 1}
            />
          ))}
        </SettingsSection>

        <SettingsSection footer={enabled ? KDP_HELPER_FOOTER_ENABLED : KDP_HELPER_FOOTER_DISABLED}>
          <SettingsRow
            label="KDP session"
            value={statusLabel}
            symbol={status.loggedIn || status.savedSession ? "checkmark.circle.fill" : "person.crop.circle"}
            symbolColor={status.loggedIn || status.savedSession ? t.colors.tone_good : t.colors.tone_inactive}
          />
          <SettingsRow
            label="Report capture"
            value={captureValue}
            subtitle={
              captured.length
                ? undefined
                : "Open royalties once after sign-in"
            }
            last={!status.lastMessage && !status.lastError}
          />
          {status.lastMessage ? (
            <SettingsRow label="Last update" subtitle={status.lastMessage} last={!status.lastError} />
          ) : null}
          {status.lastError ? (
            <SettingsRow
              label="Error"
              subtitle={status.lastError}
              destructive
              last
            />
          ) : null}
        </SettingsSection>

        <View style={styles.webWrap}>
          <KdpReportsWebView webRef={ref} style={styles.web} />
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={status.running ? "Importing…" : kdpTemplatesReady() ? "Import now" : "Capture and import"}
            onPress={onSync}
            disabled={!enabled || status.running || (!status.loggedIn && !status.savedSession)}
          />
          <View style={{ height: 10 }} />
          <SecondaryButton
            label="Open royalties"
            onPress={() =>
              ref.current?.injectJavaScript(`window.location.href=${JSON.stringify(KDP_HELPER_HOME)};true;`)
            }
          />
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

const styles = StyleSheet.create({
  webWrap: {
    height: 360,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  web: { flex: 1, backgroundColor: "#fff" },
  actions: { paddingHorizontal: 16, paddingVertical: 16 },
});
