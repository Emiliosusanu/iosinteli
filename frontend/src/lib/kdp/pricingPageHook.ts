/**
 * MAIN-world hook stacked on the royalty page hook.
 * Detects print-setup price saves (Chrome pageHook KDP_PRICING_CHANGED parity).
 */
export const KDP_PRICING_DIRTY_HOOK_JS = `
(function () {
  try {
    if (window.__inteliadsPricingDirtyHookInstalled === true) return;
    window.__inteliadsPricingDirtyHookInstalled = true;
  } catch (e) {}

  var pricingChangeSeenAt = {};
  function getPricingEditorContext() {
    try {
      var path = decodeURIComponent(location.pathname || "");
      var match = path.match(/\\/(?:print|title)-setup\\/(paperback|hardcover)\\/([A-Z0-9]+)(?:\\/|$)/i);
      var format = match ? match[1] : null;
      var setupId = match ? match[2] : null;
      if (!setupId) {
        match = path.match(/\\/(?:print|title)-setup\\/print-book\\/([A-Z0-9]+)\\/(paperback|hardcover)(?:\\/|$)/i);
        setupId = match ? match[1] : null;
        format = match ? match[2] : null;
      }
      if (!setupId || String(format || "").toLowerCase() !== "paperback") return null;
      return {
        setupId: String(setupId).trim().toUpperCase(),
        pricingRoute: /\\/pricing(?:\\/|$)/i.test(path),
      };
    } catch (e) {
      return null;
    }
  }

  function isLikelyPricingMutation(url, method, body) {
    var context = getPricingEditorContext();
    if (!context) return null;
    var verb = String(method || "GET").trim().toUpperCase();
    if (verb !== "POST" && verb !== "PUT" && verb !== "PATCH") return null;
    var requestText = (String(url || "") + " " + String(body || "")).toLowerCase();
    if (/dataplane\\.rum|unagi-|\\/telemetry|\\/metrics|\\/logging/.test(requestText)) return null;
    var hasPricingSignal = /pric|royalt|list.?price|printing.?cost|distribution/.test(requestText);
    var hasSetupSignal = /(?:print|title)-setup|setup-page|save-setup/.test(requestText);
    return hasPricingSignal || (context.pricingRoute && hasSetupSignal) ? context : null;
  }

  function postPricingChanged(source, status) {
    try {
      var context = getPricingEditorContext();
      if (!context) return;
      var key = context.setupId + ":" + String(source || "page");
      var previousAt = Number(pricingChangeSeenAt[key] || 0);
      if (previousAt && Date.now() - previousAt < 5000) return;
      pricingChangeSeenAt[key] = Date.now();
      window.postMessage({
        __royaltixHelper: true,
        kind: "KDP_PRICING_CHANGED",
        payload: {
          setupId: context.setupId,
          source: String(source || "page").slice(0, 40),
          status: status == null ? null : Number(status),
          detectedAt: new Date().toISOString(),
        },
      }, "*");
    } catch (e) {}
  }

  try {
    var origFetch = window.fetch;
    window.fetch = async function (input, init) {
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var method = (init && init.method) || (input && input.method) || "GET";
      var body = init && init.body != null ? String(init.body) : null;
      var pricingCtx = isLikelyPricingMutation(url, method, body);
      var resp = await origFetch.apply(this, arguments);
      try {
        if (pricingCtx && resp && resp.ok) postPricingChanged("fetch_save", resp.status);
      } catch (e) {}
      return resp;
    };
  } catch (e) {}

  try {
    var OrigXHR = window.XMLHttpRequest;
    function XHRProxy() {
      var xhr = new OrigXHR();
      var url = "";
      var method = "GET";
      var body = null;
      var origOpen = xhr.open;
      xhr.open = function (m, u) {
        method = String(m || "GET");
        url = String(u || "");
        return origOpen.apply(xhr, arguments);
      };
      var origSend = xhr.send;
      xhr.send = function (b) {
        body = b == null ? null : String(b);
        xhr.addEventListener("load", function () {
          try {
            if (isLikelyPricingMutation(url, method, body) && xhr.status >= 200 && xhr.status < 300) {
              postPricingChanged("xhr_save", xhr.status);
            }
          } catch (e) {}
        });
        return origSend.apply(xhr, arguments);
      };
      return xhr;
    }
    window.XMLHttpRequest = XHRProxy;
  } catch (e) {}
})();
`;
