import { KDP_PAGE_HOOK_JS } from "./vendor/kdpVendor.generated.js";

/** Page hook patches fetch/XHR — never install that on Amazon sign-in. */
export function kdpHelperShouldInstallPageHook(hrefOrHost: string): boolean {
  const s = String(hrefOrHost || "").toLowerCase();
  return (
    s.includes("kdpreports.amazon.") ||
    s.includes("kdp.amazon.") ||
    s.includes("advertising.amazon.")
  );
}

/** Injected into the KDP WebView: page hook + RN message bridge. */
export function kdpInjectedJavaScript(): string {
  return `
(function () {
  function hostAllowsPageHook() {
    try {
      var href = String(location.href || "").toLowerCase();
      var host = String(location.hostname || "").toLowerCase();
      var s = href + " " + host;
      return s.indexOf("kdpreports.amazon.") >= 0 || s.indexOf("kdp.amazon.") >= 0 || s.indexOf("advertising.amazon.") >= 0;
    } catch (e) {
      return false;
    }
  }
  if (hostAllowsPageHook()) {
    try { ${KDP_PAGE_HOOK_JS} } catch (e) {}
  }

  function send(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) {}
  }

  window.addEventListener("message", function (event) {
    try {
      if (event.source !== window) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.__royaltixHelper !== true) return;
      send({ channel: "kdp", kind: data.kind, payload: data.payload });
    } catch (e) {}
  });

  window.__inteliadsKdpFetch = function (payload) {
    window.postMessage({ __royaltixHelper: true, kind: "PAGE_FETCH", payload: payload }, "*");
  };

  // Soft UA/languages ping for Keychain session (cookies come from capture headers).
  try {
    send({
      channel: "kdp",
      kind: "SESSION_META",
      payload: {
        userAgent: String(navigator.userAgent || ""),
        languages: Array.isArray(navigator.languages) ? navigator.languages.join(",") : "",
      },
    });
  } catch (e) {}

  send({ channel: "kdp", kind: "READY" });
  send({ channel: "kdp", kind: "NAV", url: String(window.location.href || "") });
  true;
})();
`;
}
