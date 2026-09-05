import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { SubScreen } from "@/src/components/SubScreen";
import { PrimaryButton, SecondaryButton } from "@/src/components/Primitives";
import { IOSGroupedSection } from "@/src/components/ios/Native";
import { useApp } from "@/src/contexts/AppContext";
import { useTheme } from "@/src/lib/theme";
import { kdpInjectedJavaScript } from "@/src/lib/kdp/bridge";
import { runKdpIosHelperTick } from "@/src/lib/kdp/importer";
import {
  attachKdpWebView,
  getKdpHelperStatus,
  handleKdpWebViewMessage,
  kdpTemplatesReady,
  subscribeKdpHelperStatus,
} from "@/src/lib/kdp/runtime";
import { KDP_CAPTURE_PAGES } from "@/src/lib/kdp/templates";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";

const KDP_HOME = "https://kdpreports.amazon.com/reports/royalties";

export default function KdpHelperScreen() {
  const t = useTheme();
  const { kdpRoyaltySource, selectedProfileIds } = useApp();
  const ref = useRef<WebView>(null);
  const [status, setStatus] = useState(getKdpHelperStatus());
  const enabled = isIosHelperEnabled(kdpRoyaltySource);

  useEffect(() => subscribeKdpHelperStatus(setStatus), []);

  useEffect(() => {
    attachKdpWebView((js) => {
      ref.current?.injectJavaScript(js);
    });
    return () => attachKdpWebView(null);
  }, []);

  const captured = useMemo(
    () => KDP_CAPTURE_PAGES.filter((p) => status.templates[p.type]).map((p) => p.type),
    [status.templates],
  );

  const onSync = () => {
    void runKdpIosHelperTick("manual", { force: true, profileIds: selectedProfileIds });
  };

  return (
    <SubScreen title="iPhone KDP helper">
      <IOSGroupedSection
        footer={
          enabled
            ? "Sign in to KDP below once. Every ~15 minutes this iPhone imports today and yesterday, then continues any leftover last-30 days — even if the phone was off overnight. After 2am it starts a full 30-day correction and keeps going until every day is in. Web history skips the first 30→90 backfill."
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
        <WebView
          ref={ref}
          source={{ uri: KDP_HOME }}
          style={styles.web}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          injectedJavaScript={kdpInjectedJavaScript()}
          onMessage={(event) => handleKdpWebViewMessage(event.nativeEvent.data)}
          onNavigationStateChange={(nav) => {
            handleKdpWebViewMessage(JSON.stringify({ channel: "kdp", kind: "NAV", url: nav.url }));
          }}
          onLoadEnd={() => {
            ref.current?.injectJavaScript(kdpInjectedJavaScript());
          }}
        />
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={status.running ? "Importing…" : kdpTemplatesReady() ? "Import now" : "Capture and import"}
          onPress={onSync}
          disabled={!enabled || status.running}
        />
        <View style={{ height: 10 }} />
        <SecondaryButton
          label="Open royalties"
          onPress={() => ref.current?.injectJavaScript(`window.location.href=${JSON.stringify(KDP_HOME)};true;`)}
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
