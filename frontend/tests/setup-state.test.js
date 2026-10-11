import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adsDataArrivedFromSyncLogs,
  adsDataHasArrived,
  applySetupDismissals,
  deriveSetupSnapshot,
  mergeSetupProgress,
  newerSetupMemory,
  parseSetupProgressMemory,
} from "../src/lib/setupState.ts";
import { profileEnabled } from "../src/lib/accountsUi.ts";
import { SETUP_EVENTS, buildSetupEvent } from "../src/lib/setupAnalytics.ts";
import {
  activatedAdsProfileIds,
  countFreshCompletedProfiles,
  digestCoverageLine,
  digestFetchGroupsForMoney,
  digestMoneyAdsProfileIds,
  digestNativeCurrencyFetchGroups,
  nestMoneyHiddenForDigest,
  groupActivatedProfilesByCurrency,
} from "../src/lib/notificationAuthority.ts";

test("setup snapshot branches Ads-only vs missing activation and never invents a percent", () => {
  const empty = deriveSetupSnapshot({
    signedIn: true,
    guest: false,
    discoveredAdsProfiles: 0,
    activatedAdsProfiles: 0,
    kdpAccountLinked: false,
    kdpImporterActive: false,
    adsSyncSucceeded: false,
    planKnown: true,
    hasPlan: false,
  });
  assert.equal(empty.next?.id, "ads_connected");
  assert.match(empty.label, /needed/);
  assert.doesNotMatch(empty.label, /%/);

  const discovered = deriveSetupSnapshot({
    signedIn: true,
    guest: false,
    discoveredAdsProfiles: 2,
    activatedAdsProfiles: 0,
    kdpAccountLinked: false,
    kdpImporterActive: false,
    adsSyncSucceeded: false,
    planKnown: true,
    hasPlan: false,
  });
  assert.equal(discovered.next?.id, "profile_activated");

  const ready = deriveSetupSnapshot({
    signedIn: true,
    guest: false,
    discoveredAdsProfiles: 2,
    activatedAdsProfiles: 2,
    kdpAccountLinked: true,
    kdpImporterActive: true,
    adsSyncSucceeded: true,
    planKnown: true,
    hasPlan: true,
  });
  assert.equal(ready.next, null);
  assert.equal(ready.completedRequired, ready.requiredTotal);
});

test("newer setup memory is last-write-wins by updatedAt", () => {
  const older = { updatedAt: "2026-09-01T10:00:00.000Z", dismissed: { kdp_source: "2026-09-01T10:00:00.000Z" } };
  const newer = { updatedAt: "2026-09-02T10:00:00.000Z", dismissed: {} };
  assert.equal(newerSetupMemory(older, newer), newer);
  const snapped = applySetupDismissals(
    deriveSetupSnapshot({
      signedIn: true,
      guest: false,
      discoveredAdsProfiles: 1,
      activatedAdsProfiles: 1,
      kdpAccountLinked: false,
      kdpImporterActive: false,
      adsSyncSucceeded: true,
      planKnown: true,
      hasPlan: true,
    }),
    older,
  );
  assert.equal(snapped.steps.find((step) => step.id === "kdp_source")?.status, "done");
});

test("setup events are named facts", () => {
  const event = buildSetupEvent(SETUP_EVENTS.signupCompleted, { needs_confirmation: true });
  assert.equal(event.name, "signup_completed");
  assert.equal(event.properties.needs_confirmation, true);
});

test("notification authority uses enabled profiles and will not claim a complete mix", () => {
  const ids = activatedAdsProfileIds([
    { id: "us", profile_id: "ads-us", is_enabled: true, currency_code: "USD" },
    { id: "ca", profile_id: "ads-ca", is_enabled: true, currency_code: "CAD" },
    { id: "uk", profile_id: "ads-uk", is_enabled: false, currency_code: "GBP" },
  ]);
  assert.deepEqual(ids.sort(), ["ads-ca", "ads-us"].sort());
  assert.equal(
    digestCoverageLine({
      activatedCount: 2,
      updatedCount: 1,
      currencies: ["USD", "CAD"],
      displayCurrency: "USD",
    }),
    "1 of 2 profiles updated",
  );
  assert.equal(
    countFreshCompletedProfiles(
      [
        { amazon_profile_id: "ads-us", status: "completed", completed_at: "2026-09-06T08:00:00.000Z" },
        { amazon_profile_id: "ads-ca", status: "failed", completed_at: "2026-09-06T08:00:00.000Z" },
      ],
      ["ads-us", "ads-ca"],
      Date.parse("2026-09-06T09:00:00.000Z"),
    ),
    1,
  );
});

test("login no longer forces the welcome carousel; welcome can be skipped", () => {
  const login = readFileSync(new URL("../app/auth/login.tsx", import.meta.url), "utf8");
  const welcome = readFileSync(new URL("../app/auth/welcome.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(login, /login-submit-btn|amazon-login-btn|Auth/);
  assert.match(welcome, /welcome-next|welcome-sign-in|skip/i);
  assert.match(home, /SetupNextStepCard/);
  assert.match(home, /deriveSetupSnapshot/);
  assert.match(home, /home.handlers_mounted/);
  assert.match(home, /home.first_visible_content/);
  assert.match(home, /home.first_cached_usable/);
  assert.doesNotMatch(home, /markPerf\("interactive"\)/);
  const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /SplashScreen|SplashVideo|splash/i);
  assert.doesNotMatch(layout, /markPerf\("first_frame"\)/);
});

test("first Ads sync accepts completed logs, partial with entities, or live portfolio money — not empty leftover rows", () => {
  assert.equal(adsDataArrivedFromSyncLogs([]), false);
  assert.equal(adsDataArrivedFromSyncLogs([{ status: "failed" }, { status: "running" }]), false);
  assert.equal(adsDataArrivedFromSyncLogs([{ status: "Completed" }]), true);
  assert.equal(
    adsDataArrivedFromSyncLogs([{ status: "pending" }, { status: "completed" }]),
    true,
  );
  assert.equal(
    adsDataArrivedFromSyncLogs([{ status: "partial_failed", campaigns_synced: 0 }]),
    false,
  );
  assert.equal(
    adsDataArrivedFromSyncLogs([{ status: "partial_failed", campaigns_synced: 12 }]),
    true,
  );

  assert.equal(adsDataHasArrived({ syncLogs: [] }), false);
  assert.equal(adsDataHasArrived({ syncLogs: [], liveAdsSpend: 0, liveAdsSales: 0 }), false);
  assert.equal(adsDataHasArrived({ syncLogs: [], liveAdsSpend: 42 }), true);
  assert.equal(adsDataHasArrived({ syncLogs: [], liveAdsSales: 3800 }), true);
  assert.equal(
    adsDataHasArrived({ syncLogs: [], lastSuccessfulAdsSync: "2026-09-22T12:00:00.000Z" }),
    true,
  );
  assert.equal(adsDataHasArrived({ syncLogs: [], enabledCatalogCampaigns: 8 }), true);
  assert.equal(adsDataHasArrived({ syncLogs: [], enabledCatalogCampaigns: 0 }), false);

  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /adsDataHasArrived\(/);
  assert.match(home, /liveAdsSpend:/);
  assert.match(home, /enabledCatalogCampaigns/);
  assert.doesNotMatch(home, /adsSyncSucceeded:[\s\S]{0,160}metricRows\.length/);
});

test("unknown KDP signals stay unknown and are not treated as off or on", () => {
  const unknown = deriveSetupSnapshot({
    signedIn: true,
    guest: false,
    discoveredAdsProfiles: 1,
    activatedAdsProfiles: 1,
    kdpAccountLinked: "unknown",
    kdpImporterActive: "unknown",
    adsSyncSucceeded: true,
    planKnown: true,
    hasPlan: true,
  });
  const kdp = unknown.steps.find((step) => step.id === "kdp_source");
  assert.equal(kdp?.status, "optional");
  assert.match(kdp?.body ?? "", /not loaded/);
});

test("is_enabled null is not activation — Nest queries .eq('is_enabled', true)", () => {
  assert.equal(profileEnabled({ is_enabled: true }), true);
  assert.equal(profileEnabled({ is_enabled: false }), false);
  assert.equal(profileEnabled({ is_enabled: null }), false);
  assert.equal(profileEnabled({}), false);
  const accounts = readFileSync(new URL("../src/lib/accountsUi.ts", import.meta.url), "utf8");
  assert.match(accounts, /PROFILE_ENABLED_WHEN_NOT_FALSE = false/);
  assert.match(accounts, /Nest\/iOS activation contract/);
  const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
  assert.match(queries, /is_enabled === true/);
});

test("setup_progress stores only dismissals and last-write-wins", () => {
  const remote = parseSetupProgressMemory({
    updatedAt: "2026-09-06T12:00:00.000Z",
    dismissed: { kdp_source: "2026-09-06T12:00:00.000Z" },
  });
  const local = parseSetupProgressMemory({
    updatedAt: "2026-09-05T12:00:00.000Z",
    dismissed: { plan: "2026-09-05T12:00:00.000Z" },
  });
  const merged = mergeSetupProgress(local, remote);
  assert.equal(merged?.dismissed.kdp_source, "2026-09-06T12:00:00.000Z");
  assert.equal(merged?.dismissed.plan, undefined);
  assert.equal(parseSetupProgressMemory({ next: "ads_connected" }), null);
});

test("activated digest groups keep USD and CAD in separate buckets", () => {
  const groups = groupActivatedProfilesByCurrency([
    { id: "us", profile_id: "ads-us", is_enabled: true, currency_code: "USD" },
    { id: "ca", profile_id: "ads-ca", is_enabled: true, currency_code: "CAD" },
    { id: "off", profile_id: "ads-off", is_enabled: false, currency_code: "GBP" },
  ]);
  assert.deepEqual(groups.map((group) => group.currency), ["USD", "CAD"]);
  assert.equal(groups[0].profiles[0].id, "us");
  assert.equal(groups[1].profiles[0].id, "ca");
});

test("digest money scope stays full-portfolio when the Ads picker narrows", () => {
  const profiles = [
    { id: "us", profile_id: "ads-us", is_enabled: true, currency_code: "USD" },
    { id: "ca", profile_id: "ads-ca", is_enabled: true, currency_code: "CAD" },
    { id: "off", profile_id: "ads-off", is_enabled: false, currency_code: "GBP" },
  ];
  assert.deepEqual(
    digestMoneyAdsProfileIds(["us"], profiles).sort(),
    ["ads-ca", "ads-us"].sort(),
  );
  assert.deepEqual(
    digestMoneyAdsProfileIds(["us", "ca"], profiles).sort(),
    ["ads-ca", "ads-us"].sort(),
  );
  // Disabled selected id must not enter digests.
  assert.deepEqual(digestMoneyAdsProfileIds(["off"], profiles).sort(), ["ads-ca", "ads-us"].sort());
  assert.deepEqual(digestMoneyAdsProfileIds([], profiles).sort(), ["ads-ca", "ads-us"].sort());
});

test("multi-market USD digest uses one FX Nest group; native CAD stays per-currency", () => {
  const profiles = [
    { id: "us", profile_id: "ads-us", is_enabled: true, currency_code: "USD" },
    { id: "ca", profile_id: "ads-ca", is_enabled: true, currency_code: "CAD" },
  ];
  const money = ["ads-us", "ads-ca"];
  const usd = digestFetchGroupsForMoney(profiles, money, "USD");
  assert.equal(usd.length, 1);
  assert.equal(usd[0].currency, "USD");
  assert.deepEqual(usd[0].adsIds.sort(), money.sort());

  const cadOnly = digestFetchGroupsForMoney(profiles, ["ads-ca"], "CAD");
  assert.equal(cadOnly.length, 1);
  assert.equal(cadOnly[0].currency, "CAD");
  assert.deepEqual(cadOnly[0].adsIds, ["ads-ca"]);

  // Display CAD with both markets still splits by native currency (no FX into CAD here).
  const cadDisplay = digestFetchGroupsForMoney(profiles, money, "CAD");
  assert.deepEqual(cadDisplay.map((g) => g.currency).sort(), ["CAD", "USD"]);

  const native = digestNativeCurrencyFetchGroups(profiles, money);
  assert.deepEqual(native.map((g) => g.currency).sort(), ["CAD", "USD"]);
  assert.equal(nestMoneyHiddenForDigest({ scope: { mixedCurrency: true, currency: null } }), true);
  assert.equal(nestMoneyHiddenForDigest({ scope: { mixedCurrency: true, currency: "USD" } }), false);
});
