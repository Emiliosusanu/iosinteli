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
const accounts = readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
const persist = readFileSync(new URL("../src/lib/kdp/persist.ts", import.meta.url), "utf8");

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
  assert.match(helper, /status\.savedSession/);
  assert.match(helper, /Saved session · background ready/);
  assert.match(helper, /hydrateKdpRuntimeFromPersistence/);
  assert.match(helper, /automaticRetryCount/);
  assert.match(helper, /result\.ok/);
  assert.match(host, /hydrateKdpRuntimeFromPersistence/);
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

test("helper destination is explicit and Ads filters cannot silently switch KDP account", () => {
  assert.match(helper, /KDP import account/);
  assert.match(helper, /selectHelperAccountId/);
  assert.match(helper, /Ads profile and marketplace filters never change it/);
  assert.match(importer, /if \(owned\?\.id\) return cached/);
  assert.doesNotMatch(importer, /accountLinkedToProfiles\(cached, profileIds\)/);
  assert.match(accounts, /if \(linked\.length > 1\)/);
  assert.match(accounts, /Choose the KDP import account/);
  assert.match(persist, /export async function selectHelperAccountId/);
  assert.match(persist, /removeItem\(STATE_KEY\)/);
  assert.match(persist, /removeItem\(DEFERRED_KEY\)/);
  assert.match(persist, /removeItem\(TEMPLATES_KEY\)/);
  assert.match(persist, /clearKdpWebSession/);
  assert.match(persist, /clearNativeAmazonKdpCookies/);
  assert.match(persist, /webSessionCleared !== true \|\| nativeCookiesCleared !== true/);
  assert.match(persist, /progressCleared\.some/);
  assert.ok(
    persist.indexOf("clearNativeAmazonKdpCookies()") < persist.indexOf("saveHelperAccountId(next)"),
    "the new helper account must only be saved after Amazon cookies are cleared",
  );
  assert.match(helper, /Switch KDP account\?/);
  assert.match(helper, /Your InteliAds login and imported data stay available/);
});
