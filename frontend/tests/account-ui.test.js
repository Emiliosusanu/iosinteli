import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACCOUNT_BILLING_FOOTER,
  ACCOUNT_BILLING_URL,
  ACCOUNT_PLAN_UNAVAILABLE,
  ACCOUNT_STATUS_UNAVAILABLE,
  ACCOUNT_VIEW_AS_NOTE,
  accountPlanPresentation,
  amazonProfileViewSummary,
  signOutConfirmMessage,
} from "../src/lib/accountContract.ts";
import { MORE_GROUPS } from "../src/lib/moreRoot.ts";

const account = readFileSync(new URL("../app/more/account.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const persistence = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");

test("missing plan and status never become Pro or Active", () => {
  const plan = accountPlanPresentation({});
  assert.deepEqual(plan, {
    label: ACCOUNT_PLAN_UNAVAILABLE,
    source: null,
    truth: "UNKNOWN",
  });
  assert.equal(ACCOUNT_STATUS_UNAVAILABLE, "Unavailable");
  assert.doesNotMatch(account, /:\s*"Pro"|value="Active"|label="FREE PLAN"/);
});

test("account metadata can be displayed without claiming billing authority", () => {
  assert.deepEqual(
    accountPlanPresentation({ userMetadata: { plan: "pro_monthly" } }),
    { label: "Pro monthly", source: "user metadata", truth: "METADATA ONLY" },
  );
  assert.deepEqual(
    accountPlanPresentation({ appMetadata: { plan: "AGENCY" } }),
    { label: "AGENCY", source: "app metadata", truth: "METADATA ONLY" },
  );
  assert.match(account, /Account metadata only/);
  assert.match(account, /ACCOUNT_BILLING_FOOTER/);
  assert.match(ACCOUNT_BILLING_FOOTER, /does not receive authoritative subscription status/);
});

test("view-as cannot replace the signed-in InteliAds identity", () => {
  assert.match(account, /user\?\.email/);
  assert.match(account, /ACCOUNT_VIEW_AS_NOTE/);
  assert.match(ACCOUNT_VIEW_AS_NOTE, /still shows your signed-in InteliAds account/);
  assert.doesNotMatch(account, /adminUsers|customer.*email/i);
});

test("Amazon profile summary says current view, not active accounts", () => {
  assert.equal(amazonProfileViewSummary(3, 12), "3 of 12");
  assert.equal(amazonProfileViewSummary(0, 0), "No profiles");
  assert.equal(amazonProfileViewSummary(20, 4), "4 of 4");
  assert.match(account, /Amazon profiles in current view/);
  assert.match(account, /profilesLoading[\s\S]*"Checking…"/);
  assert.match(account, /profilesError[\s\S]*"Unavailable"/);
  assert.match(account, /Viewed customer data/);
  assert.doesNotMatch(account, /Active accounts/);
});

test("guest state has auth actions and no real-account subscription UI", () => {
  assert.match(account, /Preview demo/);
  assert.match(account, /No InteliAds account is signed in/);
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
    "person@example.test\n\nYou'll return to Sign in on this iPhone.",
  );
  assert.match(account, /Sign out of InteliAds\?/);
  assert.match(account, /It does not disconnect Amazon Ads or delete your account/);
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
  assert.equal(item?.subtitle, "InteliAds account and session");
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
