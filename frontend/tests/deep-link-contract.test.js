import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEEP_LINK_HREFS,
  isAllowedAppHref,
  normalizeDeepLinkPath,
  redirectSystemPath,
  resolveDeepLinkHref,
} from "../src/lib/deepLinkContract.ts";

test("canonical Overview aliases remap onto the tabs root", () => {
  assert.equal(resolveDeepLinkHref("inteliads://index"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("inteliads://(tabs)/index"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("inteliads:///(tabs)"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("/index"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("(tabs)/index"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("daily-report"), DEEP_LINK_HREFS.overview);
});

test("required notification destinations stay inside the allowlist", () => {
  assert.equal(resolveDeepLinkHref("inteliads://new-orders"), DEEP_LINK_HREFS.campaigns);
  assert.equal(resolveDeepLinkHref("inteliads://campaigns"), DEEP_LINK_HREFS.campaigns);
  assert.equal(resolveDeepLinkHref("inteliads://sync"), DEEP_LINK_HREFS.sync);
  assert.equal(resolveDeepLinkHref("inteliads://rules"), DEEP_LINK_HREFS.ruleHistory);
  assert.equal(resolveDeepLinkHref("inteliads://bid-bot"), DEEP_LINK_HREFS.bidBot);
  assert.equal(resolveDeepLinkHref("inteliads://product/B0FSSV2PRT"), "/product/B0FSSV2PRT");
  assert.equal(resolveDeepLinkHref("inteliads://kdp-helper"), DEEP_LINK_HREFS.kdpHelper);
  assert.equal(resolveDeepLinkHref("inteliads://more/kdp-source"), DEEP_LINK_HREFS.kdpSource);
  assert.equal(resolveDeepLinkHref("inteliads://more/notifications"), DEEP_LINK_HREFS.notifications);
  assert.equal(resolveDeepLinkHref("inteliads://kdp-data-stale"), DEEP_LINK_HREFS.kdpSource);
});

test("unknown and external paths fall back to Overview", () => {
  assert.equal(resolveDeepLinkHref("https://evil.example/phish"), DEEP_LINK_HREFS.overview);
  assert.equal(resolveDeepLinkHref("inteliads://not-a-real-screen"), DEEP_LINK_HREFS.overview);
  assert.equal(isAllowedAppHref("https://api.inteliads.io/dashboard"), false);
  assert.equal(isAllowedAppHref("/(tabs)"), true);
});

test("native-intent uses the same allowlist", () => {
  assert.equal(redirectSystemPath("index"), DEEP_LINK_HREFS.overview);
  assert.equal(redirectSystemPath("(tabs)/index"), DEEP_LINK_HREFS.overview);
  assert.equal(normalizeDeepLinkPath("inteliads://(tabs)/index?x=1"), "/(tabs)/index");
});
