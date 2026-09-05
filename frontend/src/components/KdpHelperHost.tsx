import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { useApp } from "@/src/contexts/AppContext";
import { kdpInjectedJavaScript } from "@/src/lib/kdp/bridge";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import {
  attachKdpWebView,
  handleKdpWebViewMessage,
} from "@/src/lib/kdp/runtime";

const KDP_HOME = "https://kdpreports.amazon.com/reports/royalties";

/**
 * Hidden authenticated KDP WebView. Mounted whenever Royalty source includes
 * this iPhone so background / resume ticks can replay captured templates.
 */
export function KdpHelperHost() {
  const { kdpRoyaltySource } = useApp();
  const ref = useRef<WebView>(null);
  const enabled = isIosHelperEnabled(kdpRoyaltySource);

  useEffect(() => {
    if (!enabled) {
      attachKdpWebView(null);
      return;
    }
    attachKdpWebView((js) => {
      ref.current?.injectJavaScript(js);
    });
    return () => attachKdpWebView(null);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <View style={styles.host} pointerEvents="none" collapsable={false}>
      <WebView
        ref={ref}
        source={{ uri: KDP_HOME }}
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
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    width: 1,
    height: 1,
    left: -4,
    top: -4,
    opacity: 0,
    overflow: "hidden",
  },
});
