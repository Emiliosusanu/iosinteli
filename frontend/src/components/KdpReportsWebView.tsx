import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { kdpInjectedJavaScript } from "@/src/lib/kdp/bridge";
import { handleKdpWebViewMessage } from "@/src/lib/kdp/runtime";
import { KDP_CAPTURE_PAGES } from "@/src/lib/kdp/templates";

export const KDP_HELPER_HOME = KDP_CAPTURE_PAGES[0]!.url;

type Props = {
  webRef: React.RefObject<WebView | null>;
  style?: StyleProp<ViewStyle>;
};

/**
 * One KDP reports WebView. Amazon sign-in often opens a new window and
 * rejects WKWebView's default UA (no Safari token). Keep those in this
 * same view so email → Continue can reach the password step.
 */
export function KdpReportsWebView({ webRef, style }: Props) {
  return (
    <WebView
      ref={webRef}
      source={{ uri: KDP_HELPER_HOME }}
      style={style}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically
      setSupportMultipleWindows={false}
      domStorageEnabled
      applicationNameForUserAgent="Safari/604.1"
      injectedJavaScript={kdpInjectedJavaScript()}
      onMessage={(event) => handleKdpWebViewMessage(event.nativeEvent.data)}
      onNavigationStateChange={(nav: WebViewNavigation) => {
        handleKdpWebViewMessage(JSON.stringify({ channel: "kdp", kind: "NAV", url: nav.url }));
      }}
      onLoadEnd={() => {
        webRef.current?.injectJavaScript(kdpInjectedJavaScript());
      }}
      onOpenWindow={(event) => {
        const targetUrl = event.nativeEvent.targetUrl;
        if (!targetUrl) return;
        webRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(targetUrl)};true;`);
      }}
    />
  );
}
