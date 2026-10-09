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

  // Keep the live Bookshelf source aligned with the Chrome helper.  KDP
  // exposes a view selector that can otherwise leave only the first page in
  // the DOM.  Selecting ALL is idempotent and does not touch title data.
  function selectAllBookshelfRows() {
    try {
      if (String(location.pathname || '').indexOf('/bookshelf') < 0) return;
      var select = document.querySelector('#refreshedbookshelftable_view_input-option, select[id*="bookshelftable_view"]');
      if (!select || String(select.value || '').toUpperCase() === 'ALL') return;
      select.value = 'ALL';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}
  }
  try { setTimeout(selectAllBookshelfRows, 350); } catch (e) {}
  try { setTimeout(selectAllBookshelfRows, 1200); } catch (e) {}

  // Capture processed orders, which include print sales. Placed orders are
  // a different report and cannot replace the royalties-aligned activity.
  function captureProcessedOrders() {
    try {
      if (String(location.pathname || '').indexOf('/reports/orders') < 0) return;
      var elements = Array.from(document.querySelectorAll('button,[role="tab"],[role="button"],label,span'));
      var choice = elements.find(function (el) { return /^orders processed$/i.test(String(el.textContent || '').trim()); });
      if (choice) (choice.closest('button,[role="tab"],[role="button"],label') || choice).click();
      var svg = document.querySelector('svg');
      if (svg) {
        var box = svg.getBoundingClientRect();
        svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
      }
    } catch (e) {}
  }
  try { setTimeout(captureProcessedOrders, 350); } catch (e) {}
  try { setTimeout(captureProcessedOrders, 1200); } catch (e) {}
  try { setTimeout(captureProcessedOrders, 2500); } catch (e) {}

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
