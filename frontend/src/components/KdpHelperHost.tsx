import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { KdpReportsWebView } from "@/src/components/KdpReportsWebView";
import { useApp } from "@/src/contexts/AppContext";
import {
  isKdpHelperScreenFocused,
  subscribeKdpHelperScreenFocused,
} from "@/src/lib/kdp/helperUi";
import { isIosHelperEnabled } from "@/src/lib/kdp/source";
import { attachKdpWebView } from "@/src/lib/kdp/runtime";

/**
 * Hidden authenticated KDP WebView. Mounted whenever Royalty source includes
 * this iPhone so background / resume ticks can replay captured templates.
 * Unmounted while the helper screen is focused so Amazon sign-in is not
 * shared with a second cookie-using WebView.
 */
export function KdpHelperHost() {
  const { kdpRoyaltySource } = useApp();
  const ref = useRef<WebView>(null);
  const enabled = isIosHelperEnabled(kdpRoyaltySource);
  const [helperScreenFocused, setHelperScreenFocused] = useState(isKdpHelperScreenFocused);

  useEffect(() => subscribeKdpHelperScreenFocused(setHelperScreenFocused), []);

  const active = enabled && !helperScreenFocused;

  useEffect(() => {
    if (!active) {
      attachKdpWebView("host", null);
      return;
    }
    attachKdpWebView("host", (js) => {
      ref.current?.injectJavaScript(js);
    });
    return () => attachKdpWebView("host", null);
  }, [active]);

  if (!active) return null;

  return (
    <View style={styles.host} pointerEvents="none" collapsable={false}>
      <KdpReportsWebView webRef={ref} />
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
