import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACCOUNT_BILLING_FOOTER,
  ACCOUNT_BILLING_URL,
  ACCOUNT_METADATA_PLAN_FOOTER,
  ACCOUNT_NEST_SUBSCRIPTION_FOOTER,
  ACCOUNT_NO_PLAN_FOOTER,
  ACCOUNT_PLAN_NONE,
  ACCOUNT_PLAN_UNAVAILABLE,
  ACCOUNT_STATUS_CHECKING,
  ACCOUNT_STATUS_NONE,
  ACCOUNT_STATUS_UNAVAILABLE,
  ACCOUNT_SUBSCRIPTION_LOAD_FAILED_FOOTER,
  ACCOUNT_VIEW_AS_NOTE,
  accountPlanPresentation,
  accountSubscriptionPresentation,
  amazonProfileViewSummary,
  nestPlanDisplayName,
  nestSubscriptionStatusLabel,
  normalizeNestUserPlanPayload,
  signOutConfirmMessage,
} from "../src/lib/accountContract.ts";
import { MORE_GROUPS } from "../src/lib/moreRoot.ts";

const account = readFileSync(new URL("../app/more/account.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/more/settings.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const persistence = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
const planHook = readFileSync(new URL("../src/hooks/useCurrentUserPlan.ts", import.meta.url), "utf8");

test("missing plan and status never become Pro or Active", () => {
  const plan = accountPlanPresentation({});
  assert.deepEqual(plan, {
    label: ACCOUNT_PLAN_UNAVAILABLE,
    source: null,
    truth: "UNKNOWN",
  });
  assert.equal(ACCOUNT_STATUS_UNAVAILABLE, "Unavailable");
  assert.deepEqual(
    accountSubscriptionPresentation({ nestStatus: "error" }),
    {
      planLabel: ACCOUNT_PLAN_UNAVAILABLE,
      statusLabel: ACCOUNT_STATUS_UNAVAILABLE,
      footer: ACCOUNT_SUBSCRIPTION_LOAD_FAILED_FOOTER,
      truth: "UNKNOWN",
    },
  );
  assert.doesNotMatch(account, /:\s*"Pro"|value="Active"|label="FREE PLAN"/);
});

test("Nest current plan maps plan name and subscription status", () => {
  const active = accountSubscriptionPresentation({
    nestStatus: "success",
    nestPlan: {
      planId: "p1",
      planName: "Pro Plan",
      planSlug: "pro-month",
      price: 49,
      isActive: true,
      isTrial: false,
      renewsAt: "2026-10-01T00:00:00.000Z",
    },
  });
  assert.deepEqual(active, {
    planLabel: "Pro Plan",
    statusLabel: "Active",
    planSubtitle: undefined,
    footer: ACCOUNT_NEST_SUBSCRIPTION_FOOTER,
    truth: "NEST",
  });

  assert.equal(
    nestSubscriptionStatusLabel({
      planId: "p1",
      planName: "Pro Plan",
      planSlug: "pro-month",
      price: 49,
      isActive: true,
      isTrial: true,
      trialEndsAt: "2026-09-20T00:00:00.000Z",
    }),
    "Trial",
  );
  assert.equal(
    nestSubscriptionStatusLabel({
      planId: "p1",
      planName: "Pro Plan",
      planSlug: "pro-month",
      price: 49,
      isActive: true,
      paymentFailed: true,
      stripeSubscriptionId: "sub_1",
    }),
    "Payment failed",
  );
  assert.equal(
    nestPlanDisplayName({
      planId: "p1",
      planName: "Pro Plan",
      planSlug: "pro-month",
      price: 49,
      isActive: true,
      effectivePlanName: "Unlimited (temporary)",
    }),
    "Unlimited (temporary)",
  );

  assert.deepEqual(
    accountSubscriptionPresentation({ nestStatus: "success", nestPlan: null }),
    {
      planLabel: ACCOUNT_PLAN_NONE,
      statusLabel: ACCOUNT_STATUS_NONE,
      footer: ACCOUNT_NO_PLAN_FOOTER,
      truth: "NO PLAN",
    },
  );
  assert.deepEqual(
    accountSubscriptionPresentation({ nestStatus: "loading" }),
    {
      planLabel: ACCOUNT_STATUS_CHECKING,
      statusLabel: ACCOUNT_STATUS_CHECKING,
      footer: ACCOUNT_BILLING_FOOTER,
      truth: "LOADING",
    },
  );
});

test("account metadata is fallback only when Nest fails — never claims Nest authority", () => {
  assert.deepEqual(
    accountPlanPresentation({ userMetadata: { plan: "pro_monthly" } }),
    { label: "Pro monthly", source: "user metadata", truth: "METADATA ONLY" },
  );
  assert.deepEqual(
    accountPlanPresentation({ appMetadata: { plan: "AGENCY" } }),
    { label: "AGENCY", source: "app metadata", truth: "METADATA ONLY" },
  );
  assert.deepEqual(
    accountSubscriptionPresentation({
      nestStatus: "error",
      userMetadata: { plan: "pro_monthly" },
    }),
    {
      planLabel: "Pro monthly",
      statusLabel: ACCOUNT_STATUS_UNAVAILABLE,
      planSubtitle: "Metadata only",
      footer: ACCOUNT_METADATA_PLAN_FOOTER,
      truth: "METADATA ONLY",
    },
  );
  assert.match(account, /accountSubscriptionPresentation/);
  assert.match(account, /useCurrentUserPlan/);
  assert.match(settings, /accountSubscriptionPresentation/);
  assert.match(settings, /useCurrentUserPlan/);
  assert.match(settings, /subscription\.planLabel/);
  assert.match(settings, /subscription\.statusLabel/);
  assert.match(settings, /subscription\.footer/);
  assert.doesNotMatch(settings, /accountPlanPresentation|ACCOUNT_STATUS_UNAVAILABLE/);
  assert.match(mutations, /\/pricing-plans\/current/);
  assert.match(mutations, /normalizeNestUserPlanPayload/);
  assert.match(ACCOUNT_NEST_SUBSCRIPTION_FOOTER, /Plan from your InteliAds account/);
  assert.match(ACCOUNT_BILLING_FOOTER, /Billing is managed on the web/);
  assert.doesNotMatch(ACCOUNT_BILLING_FOOTER, /does not receive authoritative/);
  assert.doesNotMatch(settings, /does not receive authoritative/);
  assert.doesNotMatch(account, /does not receive authoritative/);
});

test("AuthContext exports state (not authState); plan query enables on it", () => {
  assert.match(auth, /state:\s*AuthState/);
  assert.match(auth, /value=\{\{\s*state,/);
  assert.doesNotMatch(auth, /\bauthState\b/);
  // Hook must read AuthContext.state (alias authState locally is fine).
  assert.match(planHook, /state:\s*authState/);
  assert.match(planHook, /authState === "authenticated"/);
  assert.match(planHook, /!!user\?\.id/);
  assert.match(planHook, /!guestMode/);
  assert.match(planHook, /fetchCurrentUserPlan/);
});

test("Nest plan payload unwraps raw DTO or data envelope", () => {
  const plan = {
    planId: "p1",
    planName: "Pro Plan",
    planSlug: "pro-month",
    price: 49,
    isActive: true,
  };
  assert.deepEqual(normalizeNestUserPlanPayload(plan), plan);
  assert.deepEqual(normalizeNestUserPlanPayload({ data: plan }), plan);
  assert.equal(normalizeNestUserPlanPayload({ data: null }), null);
  assert.equal(normalizeNestUserPlanPayload(null), null);
  assert.equal(normalizeNestUserPlanPayload({ success: true }), null);
});

test("disabled/idle Nest plan stays Checking, not Unavailable", () => {
  assert.deepEqual(accountSubscriptionPresentation({ nestStatus: "idle" }), {
    planLabel: ACCOUNT_STATUS_CHECKING,
    statusLabel: ACCOUNT_STATUS_CHECKING,
    footer: ACCOUNT_BILLING_FOOTER,
    truth: "LOADING",
  });
});

test("view-as cannot replace the signed-in InteliAds identity", () => {
  assert.match(account, /user\?\.email/);
  assert.match(account, /ACCOUNT_VIEW_AS_NOTE/);
  assert.match(ACCOUNT_VIEW_AS_NOTE, /still shows your InteliAds account/);
  assert.doesNotMatch(account, /adminUsers|customer.*email/i);
});

test("Amazon profile summary says current view, not active accounts", () => {
  assert.equal(amazonProfileViewSummary(3, 12), "3 of 12");
  assert.equal(amazonProfileViewSummary(0, 0), "No profiles");
  assert.equal(amazonProfileViewSummary(20, 4), "4 of 4");
  assert.match(account, /Amazon profiles/);
  assert.doesNotMatch(account, /Amazon profiles in current view/);
  assert.match(account, /profilesLoading[\s\S]*"Checking…"/);
  assert.match(account, /profilesError[\s\S]*"Unavailable"/);
  assert.match(account, /Viewed customer data/);
  assert.match(account, /Customer view/);
  assert.doesNotMatch(account, /These profile counts belong to the customer/);
  assert.doesNotMatch(account, /Active accounts/);
});

test("guest state has auth actions and no real-account subscription UI", () => {
  assert.match(account, /Preview demo/);
  assert.match(account, /Preview demo — not signed in|No InteliAds account is signed in|ACCOUNT_GUEST_NOTE/);
  assert.match(account, /my-account-sign-in/);
  assert.match(account, /my-account-create-account/);
  assert.match(account, /guestMode \? \(/);
});

test("billing is an explicit web handoff", () => {
  assert.equal(ACCOUNT_BILLING_URL, "https://dashboard.inteliads.io/billing");
  assert.match(account, /Manage subscription on the web/);
  assert.match(account, /openBrowserAsync\(ACCOUNT_BILLING_URL\)/);
  assert.match(account, /Opens InteliAds billing in the browser/);
});

test("sign-out names the consequence and clears scoped state", () => {
  assert.equal(
    signOutConfirmMessage("person@example.test"),
    "person@example.test\n\nReturns to Sign in.",
  );
  assert.match(account, /Sign out of InteliAds\?/);
  assert.match(account, /Clears this session/);
  assert.doesNotMatch(account, /It does not disconnect Amazon Ads or delete your account/);
  assert.match(auth, /storage\.setItem\(GUEST_KEY, false\)/);
  assert.match(auth, /storage\.removeItem\(ADMIN_FILTER_KEY\)/);
  assert.match(auth, /await clearNotificationIdentity\(\)/);
  assert.match(auth, /await nestLogout\(\)/);
  assert.match(auth, /supabase\.auth\.signOut\(\)/);
  assert.match(auth, /queryClient\.clear\(\)/);
  assert.match(auth, /clearPersistedQueryCache\(\)/);
  assert.match(app, /setAdminFilterUserIdState\(null\)/);
  assert.match(app, /setSelectedProfileIdsState\(\[\]\)/);
  assert.match(persistence, /AsyncStorage\.removeItem\(CACHE_KEY\)/);
  assert.match(rulesApi, /inteliads\.rulesApi\.sessionValid/);
  assert.match(rulesApi, /storage\.setItem\(SESSION_VALID_KEY, false\)/);
  assert.match(rulesApi, /if \(!\(await nestSessionAllowed\(\)\)\)/);
});

test("invalid session restore clears financial caches and cannot race the 8s fallback", () => {
  assert.match(auth, /const clearStaleAuthCaches = async \(\) => \{/);
  assert.match(auth, /await clearStaleAuthCaches\(\)/);
  assert.match(auth, /let restoreSettled = false/);
  assert.match(auth, /if \(!mounted \|\| restoreSettled\) return/);
  assert.match(auth, /restoreSettled = true/);
});

test("More describes My Account without promising a known plan", () => {
  const item = MORE_GROUPS.flatMap((group) => group.items).find((candidate) => candidate.key === "account");
  assert.equal(item?.label, "My account");
  assert.equal(item?.subtitle, undefined);
});

test("email sign-in fails closed when Nest write session is missing", () => {
  assert.match(auth, /Couldn't start a write session/);
  assert.match(auth, /Use Continue with Amazon/);
  assert.match(auth, /await nestLogin\(email, password\)/);
});

test("Nest 401 recovery does not wipe write credentials", () => {
  assert.match(rulesApi, /Do NOT nestLogout/);
  assert.match(rulesApi, /Fall back to Supabase for this request only/);
});
