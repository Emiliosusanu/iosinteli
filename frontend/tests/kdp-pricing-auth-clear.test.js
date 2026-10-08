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

test("pricing sync tries every setup-page route before declaring the auth gate", () => {
  const fetchStart = sync.indexOf("async function fetchSetupPage");
  const fetchEnd = sync.indexOf("function resolveTitleExpandedDistribution", fetchStart);
  const fetchBlock = sync.slice(fetchStart, fetchEnd);
  const candidateStart = fetchBlock.indexOf("const candidate:");
  const successReturn = fetchBlock.indexOf("if (candidate.ok) return candidate", candidateStart);
  assert.ok(candidateStart >= 0 && successReturn > candidateStart);
  assert.doesNotMatch(
    fetchBlock.slice(candidateStart, successReturn),
    /setupPageLooksUnauthenticated\(candidate\)/,
    "a 200 HTML shell from one legacy route must not prevent a later /v2/ JSON success",
  );
  assert.match(fetchBlock.slice(successReturn), /return \(\s*best \|\|/);
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

test("permanent 404 setup IDs do not stop later live books", () => {
  const loopIdx = sync.indexOf("for (let i = 0; i < todo.length; i += 1)");
  const loopBlock = sync.slice(loopIdx, loopIdx + 4200);
  assert.match(loopBlock, /const permanentMiss = isKdpSetupPagePermanentMiss\(fetched\)/);
  assert.match(loopBlock, /if \(permanentMiss\) consecutiveHard = 0/);
  assert.match(loopBlock, /if \(consecutiveHard >= 3\)/);
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

test("visible helper falls back from native HTML shell to authenticated WebView", () => {
  const runtime = readFileSync(new URL("../src/lib/kdp/runtime.ts", import.meta.url), "utf8");
  assert.match(runtime, /function looksLikeHtmlDocument/);
  assert.match(runtime, /req\.authScope === "pricing"/);
  assert.match(runtime, /pricingHtmlShell/);
  assert.match(runtime, /if \(!loggedOut && !pricingHtmlShell\) return native/);
  assert.match(runtime, /use the authenticated page context, as Chrome does/);
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

test("iOS pricing gate rechecks every metronome wake and sweeps the live shelf", () => {
  assert.match(sync, /const PRICING_FRESH_MS = 15 \* 60 \* 1000/);
  assert.match(sync, /\?view=ALL/);
  assert.match(sync, /\?page=\$\{index \+ 2\}/);
  const bridge = readFileSync(new URL("../src/lib/kdp/bridge.ts", import.meta.url), "utf8");
  assert.match(bridge, /selectAllBookshelfRows/);
  assert.match(bridge, /value = 'ALL'/);
});

test("pricing auth has a one-shot onboarding prompt with a direct retry", () => {
  const screen = readFileSync(
    new URL("../app/more/kdp-helper.tsx", import.meta.url),
    "utf8",
  );
  assert.match(screen, /Amazon access needed/);
  assert.match(screen, /Open KDP pricing/);
  assert.match(screen, /pricingPromptedFor/);
});
