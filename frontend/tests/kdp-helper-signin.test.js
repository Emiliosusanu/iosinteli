import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { kdpHelperShouldInstallPageHook, kdpInjectedJavaScript } from "../src/lib/kdp/bridge.ts";
import {
  isKdpHelperScreenFocused,
  setKdpHelperScreenFocused,
} from "../src/lib/kdp/helperUi.ts";

const helper = readFileSync(new URL("../app/more/kdp-helper.tsx", import.meta.url), "utf8");
const host = readFileSync(new URL("../src/components/KdpHelperHost.tsx", import.meta.url), "utf8");
const web = readFileSync(new URL("../src/components/KdpReportsWebView.tsx", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");

test("page hook stays off Amazon sign-in so Continue is not intercepted", () => {
  assert.equal(kdpHelperShouldInstallPageHook("https://www.amazon.com/ap/signin"), false);
  assert.equal(kdpHelperShouldInstallPageHook("www.amazon.com"), false);
  assert.equal(kdpHelperShouldInstallPageHook("https://kdpreports.amazon.com/reports/royalties"), true);
  assert.equal(kdpHelperShouldInstallPageHook("kdp.amazon.com"), true);
  const injected = kdpInjectedJavaScript();
  assert.match(injected, /hostAllowsPageHook/);
  assert.match(injected, /kdpreports\.amazon\./);
});

test("helper screen pauses the hidden host and skips background ticks", () => {
  setKdpHelperScreenFocused(false);
  assert.equal(isKdpHelperScreenFocused(), false);
  setKdpHelperScreenFocused(true);
  assert.equal(isKdpHelperScreenFocused(), true);
  setKdpHelperScreenFocused(false);

  assert.match(helper, /setKdpHelperScreenFocused\(true\)/);
  assert.match(helper, /attachKdpWebView\("ui"/);
  assert.match(helper, /!status\.loggedIn/);
  assert.match(host, /helperScreenFocused/);
  assert.match(host, /attachKdpWebView\("host"/);
  assert.match(runtime, /injectSlots\.ui \?\? injectSlots\.host/);
  assert.match(importer, /helper_ui_focused/);
  assert.match(importer, /reason !== "manual" && !getKdpHelperStatus\(\)\.loggedIn/);
});

test("KDP WebView keeps Amazon Continue in the same window", () => {
  assert.match(web, /onOpenWindow/);
  assert.match(web, /applicationNameForUserAgent="Safari\/604.1"/);
  assert.match(web, /javaScriptCanOpenWindowsAutomatically/);
  assert.match(web, /setSupportMultipleWindows=\{false\}/);
  assert.match(helper, /KdpReportsWebView/);
  assert.match(host, /KdpReportsWebView/);
});
