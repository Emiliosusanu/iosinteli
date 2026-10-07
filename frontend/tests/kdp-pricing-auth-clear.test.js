/**
 * Contract: sticky print-setup auth must clear when every paperback already
 * has calculator pricing (Chrome / prior helper), even if get-setup-page 403s.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sync = readFileSync(new URL("../src/lib/kdp/pricingSync.ts", import.meta.url), "utf8");

test("pricing sync clears auth when no refresh is due", () => {
  assert.match(sync, /if \(!todo\.length\)/);
  assert.match(sync, /if \(pending === 0\)/);
  assert.match(sync, /setKdpHelperPricingAuth\(\{ required: false/);
  assert.match(sync, /authBlockedAt: null/);
  assert.match(sync, /KDP_PRICING_AUTH_REQUIRED_MSG/);
});

test("pricing sync treats HTML/non-JSON setup-page as auth, not 17 silent fails", () => {
  assert.match(sync, /setupPageLooksUnauthenticated/);
  assert.match(sync, /isKdpSetupPageTransportFailure/);
  assert.match(sync, /looksLikeHtmlErrorPage/);
  assert.match(sync, /diagnoseKdpSetupPageFailure/);
  assert.match(sync, /stopping after repeated setup-page misses/);
  assert.match(sync, /Native Keychain replay cannot resolve bookshelf-relative paths/);
  assert.match(sync, /resolvePricingMarketplaceKey/);
  assert.equal(
    (sync.match(/authScope: "pricing"/g) || []).length,
    2,
    "both bookshelf and setup-page pricing fetches must preserve reports auth",
  );
});

test("pricing sync moves WebView onto kdp.amazon.com before setup-page probes", () => {
  assert.match(sync, /Cross-origin get-setup-page from kdpreports/);
  assert.match(sync, /navigateKdpWebView\(bookshelfUrlForLocale/);
  const ensureIdx = sync.indexOf("async function ensureKdpBookshelfContext");
  const ensureBlock = sync.slice(ensureIdx, ensureIdx + 1800);
  assert.ok(
    ensureBlock.indexOf("navigateKdpWebView(bookshelfUrlForLocale") <
      ensureBlock.indexOf("fetchBookshelfHtml"),
    "silent bookshelf nav must run before first bookshelf HTML fetch when off-host",
  );
});

test("pricing sync requests auth for stale prices when a refresh probe is blocked", () => {
  // A catalog with old capture timestamps has no missing prices, but todo is
  // non-empty and the failed refresh must stay visible and retryable.
  const probeIdx = sync.indexOf("const probe = await fetchSetupPage");
  const probeBlock = sync.slice(probeIdx, probeIdx + 2200);
  assert.match(probeBlock, /refreshPending = Math\.max\(pendingAfterAuth, todo\.length\)/);
  assert.match(probeBlock, /authRequired: true/);
  assert.doesNotMatch(probeBlock, /catalog already priced/);
});

test("helper hydrates sticky pricing auth and allows print-setup while focused", () => {
  const boot = readFileSync(
    new URL("../src/lib/kdp/pricingBootstrap.ts", import.meta.url),
    "utf8",
  );
  const helper = readFileSync(new URL("../app/more/kdp-helper.tsx", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
  assert.match(boot, /export async function hydratePricingAuthBannerFromBootstrap/);
  assert.match(sync, /allowAuthNavigate/);
  assert.match(sync, /isKdpHelperScreenFocused\(\)/);
  assert.match(helper, /kdpRoyaltySource|helper/i);
  assert.match(runtime, /attachKdpWebView|navigateKdpWebView/);
});

test("iOS helper tick integrates pricing without forcing unchanged books", () => {
  const importer = readFileSync(
    new URL("../src/lib/kdp/importer.ts", import.meta.url),
    "utf8",
  );
  assert.match(importer, /import \{ syncKdpPaperbackPricing \} from "\.\/pricingSync\.ts"/);
  assert.match(importer, /hydratePricingAuthBannerFromBootstrap\(accountId\)/);
  assert.match(importer, /await syncKdpPaperbackPricing\(\{/);
  assert.match(importer, /accountId,\s*\n\s*titlesJson,\s*\n\s*booksObj: pricingBooksObj/);
  assert.match(importer, /allowAuthNavigate: isKdpHelperScreenFocused\(\)/);
  assert.doesNotMatch(importer, /syncKdpPaperbackPricing\(\{[\s\S]{0,400}forceRefresh:/);
});

test("KDP helper presents pricing gate separately from report session", () => {
  const screen = readFileSync(
    new URL("../app/more/kdp-helper.tsx", import.meta.url),
    "utf8",
  );
  assert.match(screen, /status\.pricingAuthRequired/);
  assert.match(screen, /Reports remain signed in/);
  assert.match(screen, /break-even ACoS/);
});
