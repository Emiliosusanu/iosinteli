import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { SubScreen } from "@/src/components/SubScreen";
import { PrimaryButton, SecondaryButton } from "@/src/components/Primitives";
import { IOSGroupedSection } from "@/src/components/ios/Native";
import { KdpReportsWebView, KDP_HELPER_HOME } from "@/src/components/KdpReportsWebView";
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

  return (
    <SubScreen title="iPhone KDP helper">
      <IOSGroupedSection
        footer={
          enabled
            ? "Sign in to KDP below once. Every ~15 minutes this iPhone imports today and yesterday. If Chrome has not already imported the last 90 days, this iPhone finishes that backfill in the background — even if you close the app — and resumes on the next wake. After 2am it starts a full 30-day correction and keeps going until every leftover day is in."
            : "Turn on Royalty source → Chrome + iPhone in Settings first."
        }
      >
        <View style={styles.meta}>
          <Text style={[t.typography.body, { color: t.colors.text_primary }]}>
            {status.loggedIn ? "Signed in to KDP" : "Waiting for KDP sign-in"}
          </Text>
          <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 4 }]}>
            {captured.length
              ? `Captured: ${captured.join(", ")}`
              : "Open royalties, orders, and KENP once after sign-in so the helper can learn the report requests."}
          </Text>
          {status.lastMessage ? (
            <Text style={[t.typography.footnote, { color: t.colors.text_secondary, marginTop: 6 }]}>
              {status.lastMessage}
            </Text>
          ) : null}
          {status.lastError ? (
            <Text style={[t.typography.footnote, { color: t.colors.tone_danger, marginTop: 6 }]}>
              {status.lastError}
            </Text>
          ) : null}
        </View>
      </IOSGroupedSection>

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
    </SubScreen>
  );
}

const styles = StyleSheet.create({
  meta: { paddingHorizontal: 16, paddingVertical: 12 },
  webWrap: {
    height: 360,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  web: { flex: 1, backgroundColor: "#fff" },
  actions: { paddingHorizontal: 16, paddingVertical: 16 },
});
