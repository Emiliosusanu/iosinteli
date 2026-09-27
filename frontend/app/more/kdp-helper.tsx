import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, ScrollView } from "react-native";
import { WebView } from "react-native-webview";
import { PrimaryButton, SecondaryButton } from "@/src/components/Primitives";
import { KdpReportsWebView, KDP_HELPER_HOME } from "@/src/components/KdpReportsWebView";
import {
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from "@/src/components/settings/SettingsPrimitives";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { setKdpHelperScreenFocused } from "@/src/lib/kdp/helperUi";
import { runKdpIosHelperTick } from "@/src/lib/kdp/importer";
import {
  attachKdpWebView,
  getKdpHelperStatus,
  kdpTemplatesReady,
  subscribeKdpHelperStatus,
} from "@/src/lib/kdp/runtime";
import { KDP_CAPTURE_PAGES } from "@/src/lib/kdp/templates";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import {
  KDP_HELPER_FOOTER_DISABLED,
  KDP_HELPER_FOOTER_ENABLED,
} from "@/src/lib/settingsContract";

export default function KdpHelperScreen() {
  const t = useTheme();
  const { kdpRoyaltySource, selectedProfileIds } = useApp();
  const ref = useRef<WebView>(null);
  const [status, setStatus] = useState(getKdpHelperStatus());
  const enabled = isIosHelperEnabled(kdpRoyaltySource);

  useEffect(() => subscribeKdpHelperStatus(setStatus), []);

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

  useEffect(() => {
    if (!enabled || !status.loggedIn || status.running || startedAfterLogin.current) return;
    if (!kdpTemplatesReady()) return;
    startedAfterLogin.current = true;
    void runKdpIosHelperTick("manual", { force: true, profileIds: selectedProfileIds });
  }, [enabled, status.loggedIn, status.running, status.templates, selectedProfileIds]);

  const onSync = () => {
    void runKdpIosHelperTick("manual", { force: true, profileIds: selectedProfileIds });
  };

  const statusLabel = status.loggedIn ? "Signed in" : "Waiting for sign-in";
  const captureValue = captured.length ? captured.join(", ") : "Not yet";

  return (
    <SettingsScreen title="iPhone KDP helper">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection footer={enabled ? KDP_HELPER_FOOTER_ENABLED : KDP_HELPER_FOOTER_DISABLED}>
          <SettingsRow
            label="KDP session"
            value={statusLabel}
            symbol={status.loggedIn ? "checkmark.circle.fill" : "person.crop.circle"}
            symbolColor={status.loggedIn ? t.colors.tone_good : t.colors.tone_inactive}
          />
          <SettingsRow
            label="Report capture"
            value={captureValue}
            subtitle={
              captured.length
                ? undefined
                : "Open royalties, orders, and KENP once after sign-in"
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
            disabled={!enabled || status.running || !status.loggedIn}
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
