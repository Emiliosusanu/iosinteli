import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyExtensionLifecycle,
  classifyHelperLifecycle,
  kdpAccountLinkedToProfiles,
  latestAccountSyncMs,
  normalizeRoyaltySetupMemory,
  planKdpRoyaltySetup,
  royaltyCollectionShortcut,
} from "../src/lib/kdpRoyaltySetup.ts";
import { KDP_CHROME_HELPER_URL } from "../src/lib/accountContract.ts";

const now = Date.parse("2026-09-05T18:00:00.000Z");
const yesterday = "2026-09-04";

function base(overrides = {}) {
  return {
    guest: false,
    viewingCustomer: false,
    loading: false,
    accountsError: false,
    royaltyScopeReason: "single_enabled_country",
    source: "extension",
    helperLoggedIn: false,
    helperRunning: false,
    lastHelperRunAtMs: 0,
    lastHelperRunYmd: null,
    accounts: [],
    viewProfileIds: ["us"],
    latestImportedYmd: null,
    yesterdayYmd: yesterday,
    nowMs: now,
    dismissedUntilMs: 0,
    ...overrides,
  };
}

test("new users with no importer get onboard copy, not a stale-Chrome warning", () => {
  const plan = planKdpRoyaltySetup(base());
  assert.equal(plan.kind, "onboard_new");
  if (plan.kind !== "onboard_new") return;
  assert.match(plan.body, /Chrome extension/);
  assert.match(plan.body, /iPhone helper/);
  assert.equal(plan.primary.id, "helper");
  assert.equal(plan.secondary.id, "chrome");
});

test("existing account that never synced asks to activate Chrome or iPhone helper", () => {
  const plan = planKdpRoyaltySetup(
    base({
      accounts: [{ id: "k1", last_synced_at: null, linked_amazon_profile_ids: ["us"] }],
    }),
  );
  assert.equal(plan.kind, "never_activated");
  if (plan.kind !== "never_activated") return;
  assert.match(plan.title, /aren't arriving/);
  assert.equal(plan.primary.id, "helper");
  assert.equal(plan.secondary.id, "chrome");
});

test("Chrome active and linked does not prompt, even with no rows in the selected period", () => {
  const plan = planKdpRoyaltySetup(
    base({
      accounts: [{ id: "k1", last_synced_at: "2026-09-05T16:00:00.000Z", linked_amazon_profile_ids: ["us"] }],
      latestImportedYmd: null,
    }),
  );
  assert.equal(plan.kind, "none");
});

test("fresh imported day counts as Chrome active", () => {
  assert.equal(
    classifyExtensionLifecycle({
      accounts: [],
      latestImportedYmd: yesterday,
      yesterdayYmd: yesterday,
      nowMs: now,
    }),
    "active",
  );
  assert.equal(planKdpRoyaltySetup(base({ latestImportedYmd: yesterday })).kind, "none");
});

test("stale Chrome offers helper or reopen Chrome", () => {
  const plan = planKdpRoyaltySetup(
    base({
      accounts: [{ id: "k1", last_synced_at: "2026-09-01T12:00:00.000Z", linked_amazon_profile_ids: ["us"] }],
    }),
  );
  assert.equal(plan.kind, "extension_stale");
  if (plan.kind !== "extension_stale") return;
  assert.equal(plan.primary.id, "helper");
  assert.equal(plan.secondary.id, "chrome");
});

test("helper selected but never signed in asks to open the helper", () => {
  const plan = planKdpRoyaltySetup(base({ source: "extension_ios" }));
  assert.equal(plan.kind, "helper_needs_signin");
  if (plan.kind !== "helper_needs_signin") return;
  assert.equal(plan.primary.id, "helper");
  assert.equal(plan.secondary.id, "later");
});

test("helper currently running or recently run does not nag", () => {
  assert.equal(planKdpRoyaltySetup(base({ source: "extension_ios", helperRunning: true })).kind, "none");
  assert.equal(
    planKdpRoyaltySetup(base({ source: "extension_ios", lastHelperRunYmd: yesterday, lastHelperRunAtMs: now - 1000 })).kind,
    "none",
  );
});

test("active Chrome not linked to the current view goes to Accounts", () => {
  const plan = planKdpRoyaltySetup(
    base({
      accounts: [{ id: "k1", last_synced_at: "2026-09-05T16:00:00.000Z", linked_amazon_profile_ids: ["ca"] }],
      viewProfileIds: ["us"],
    }),
  );
  assert.equal(plan.kind, "unlinked");
  if (plan.kind !== "unlinked") return;
  assert.equal(plan.primary.id, "accounts");
});

test("guests, customer view, loading, errors, and mixed-non-US stay quiet", () => {
  assert.equal(planKdpRoyaltySetup(base({ guest: true })).kind, "none");
  assert.equal(planKdpRoyaltySetup(base({ viewingCustomer: true })).kind, "none");
  assert.equal(planKdpRoyaltySetup(base({ loading: true })).kind, "none");
  assert.equal(planKdpRoyaltySetup(base({ accountsError: true })).kind, "none");
  assert.equal(planKdpRoyaltySetup(base({ royaltyScopeReason: "mixed_non_us" })).kind, "none");
  assert.equal(planKdpRoyaltySetup(base({ dismissedUntilMs: now + 1000 })).kind, "none");
});

test("link and sync helpers stay honest", () => {
  assert.equal(latestAccountSyncMs([{ last_synced_at: "2026-09-01" }, { last_synced_at: "2026-09-03T00:00:00Z" }]) != null, true);
  assert.equal(kdpAccountLinkedToProfiles([{ linked_amazon_profile_ids: ["us"] }], ["us"]), true);
  assert.equal(kdpAccountLinkedToProfiles([{ linked_amazon_profile_ids: ["ca"] }], ["us"]), false);
  assert.equal(
    classifyHelperLifecycle({
      source: "extension",
      helperLoggedIn: true,
      helperRunning: true,
      lastHelperRunAtMs: now,
      lastHelperRunYmd: yesterday,
      yesterdayYmd: yesterday,
      nowMs: now,
    }),
    "off",
  );
});

test("memory ignores junk and Chrome setup is a web URL", () => {
  assert.deepEqual(normalizeRoyaltySetupMemory(null), { dismissedUntilMs: 0, askedKinds: [] });
  assert.deepEqual(normalizeRoyaltySetupMemory({ dismissedUntilMs: 9, askedKinds: ["onboard_new", ""] }), {
    dismissedUntilMs: 9,
    askedKinds: ["onboard_new"],
  });
  assert.match(KDP_CHROME_HELPER_URL, /dashboard\.inteliads\.io/);
});

test("collection shortcut never dumps Chrome-only users onto a dead helper", () => {
  assert.deepEqual(royaltyCollectionShortcut({ helperOn: false, askKind: "none" }), { label: "Import", dest: "source" });
  assert.deepEqual(royaltyCollectionShortcut({ helperOn: true, askKind: "none" }), { label: "Helper", dest: "helper" });
  assert.deepEqual(royaltyCollectionShortcut({ helperOn: false, askKind: "onboard_new" }), { label: "Import", dest: "ask" });
  assert.deepEqual(royaltyCollectionShortcut({ helperOn: false, askKind: "unlinked" }), { label: "Link", dest: "ask" });
  assert.deepEqual(royaltyCollectionShortcut({ helperOn: true, askKind: "helper_needs_signin" }), { label: "Helper", dest: "ask" });
});

test("Overview, welcome, and Accounts use the setup plan", () => {
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  const welcome = readFileSync(new URL("../app/auth/welcome.tsx", import.meta.url), "utf8");
  const accounts = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");
  const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/components/KdpRoyaltySetupCard.tsx", import.meta.url), "utf8");
  const widgets = readFileSync(new URL("../src/components/OverviewChartWidgets.tsx", import.meta.url), "utf8");
  assert.match(home, /useKdpRoyaltySetupPrompt/);
  assert.match(home, /KdpRoyaltySetupCard/);
  assert.match(home, /royaltySetup\.openCollection/);
  assert.doesNotMatch(home, /onAction=\{\(\) => router\.push\("\/more\/kdp-helper"\)\}/);
  assert.match(welcome, /Import royalties/);
  assert.match(accounts, /Set up royalties/);
  assert.match(products, /royaltySetup\.openCollection/);
  assert.match(products, /empty\.actionLabel/);
  assert.match(card, /presentRoyaltySetupAsk/);
  assert.match(card, /openChromeRoyaltyHelper/);
  assert.match(card, /openSource/);
  assert.match(widgets, /onImportRoyalties/);
  assert.match(widgets, /Chrome or the iPhone helper/);
});
