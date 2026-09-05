import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  amazonAdsProfileId,
  amazonAdsProfileIdsForSelection,
  VIEWING_CUSTOMER_MESSAGE,
} from "../src/lib/accountScope.ts";
import {
  DISABLE_CONFIRM_MESSAGE,
  ENABLE_PROFILE_FAILED_TITLE,
  isTransientEnableProfileError,
  disableConfirmTitle,
  planViewToggle,
} from "../src/lib/accountsUi.ts";

const accountsSource = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");

test("Nest writes use Amazon Ads profile_id when it differs from row id", () => {
  assert.equal(
    amazonAdsProfileId({ id: "uuid-row", profile_id: "4469306694455572" }),
    "4469306694455572",
  );
  assert.equal(amazonAdsProfileId({ id: "4469306694455572", profile_id: "4469306694455572" }), "4469306694455572");
  assert.deepEqual(
    amazonAdsProfileIdsForSelection(
      [{ id: "uuid-row", profile_id: "4469306694455572" }],
      ["uuid-row"],
    ),
    ["4469306694455572"],
  );
});

test("profile enable requires Nest toggle (same as web); local pivot is best-effort mirror", () => {
  assert.match(mutations, /user_amazon_profiles/);
  assert.match(mutations, /persistUserAmazonProfileEnabled/);
  assert.match(mutations, /is_enabled: enabled/);
  assert.match(mutations, /\.eq\("amazon_profile_id", id\)/);
  assert.match(mutations, /Do NOT rely on UPDATE … RETURNING/);
  assert.match(mutations, /opts\?\.rowId/);
  assert.match(mutations, /\/amazon\/profiles\/\$\{encodeURIComponent\(adsProfileId\)\}\/toggle/);
  // Soft-fail Nest (local-only success) would diverge from web Ads state.
  assert.doesNotMatch(mutations, /Nest\/rules were unavailable \(known soft failure\)/);
});

test("Accounts mutations stay off while an admin filter is set", () => {
  assert.match(accountsSource, /viewingCustomer = !!adminFilterUserId/);
  assert.match(accountsSource, /canMutate = !!user\?\.id && !guestMode && !viewingCustomer/);
  assert.match(accountsSource, /enabled: canMutate/);
  assert.match(accountsSource, /VIEWING_CUSTOMER_MESSAGE/);
  assert.equal(
    VIEWING_CUSTOMER_MESSAGE,
    "Account changes aren't available while viewing another user's accounts.",
  );
});

test("turning a profile off confirms and keeps local view independent of Nest", () => {
  assert.equal(disableConfirmTitle("UK Ads"), "Turn off UK Ads?");
  assert.match(DISABLE_CONFIRM_MESSAGE, /Does not disconnect Amazon/);
  assert.match(accountsSource, /disableConfirmTitle/);
  assert.match(accountsSource, /DISABLE_CONFIRM_MESSAGE/);
  assert.match(accountsSource, /amazonAdsProfileId\(match\)/);
  // Enable must not auto-call toggleProfile (would force single-currency view).
  // Disable still strips the profile from selectedProfileIds; view chip uses toggleProfile(item.id).
  assert.doesNotMatch(accountsSource, /toggleProfile\(rowId\)/);
  assert.match(accountsSource, /setSelectedProfileIds\(/);
  assert.match(accountsSource, /toggleProfile\(item\.id\)/);
  assert.match(accountsSource, /setKdpLinkedProfiles\(kdpAccountId, amazonIds\)/);
  assert.doesNotMatch(accountsSource, /onError: \(\) => setSelectedProfileIds\(previous\)/);
});

test("Nest 403 country-limit message stays honest on enable failure", () => {
  // NestApiError.message is surfaced via userMessageForNestError (no rewrite for 403).
  assert.match(rulesApi, /export function userMessageForNestError/);
  assert.match(rulesApi, /return error\.message \|\| fallback/);
  assert.equal(ENABLE_PROFILE_FAILED_TITLE, "Couldn't enable profile");
  assert.equal(
    isTransientEnableProfileError({ message: "Rule data is temporarily unavailable. Please try again." }),
    true,
  );
  assert.match(accountsSource, /enableProfileFailedTitle/);
  assert.match(accountsSource, /enableProfileFailedBody/);
  assert.match(accountsSource, /userMessageForNestError/);
  assert.match(accountsSource, /vars\.enabled/);
  assert.match(
    accountsSource,
    /Couldn't enable profile|enableProfileFailedTitle/,
  );
  assert.match(mutations, /isTransientEnableProfileError/);
  assert.match(mutations, /maxAttempts = isEnabled \? 3 : 1/);
  assert.doesNotMatch(mutations, /Nest\/rules were unavailable \(known soft failure\)/);
});

test("TopBar view switch is not Nest enable; mixed marketplaces stay selected", () => {
  assert.match(topBar, /viewStatusLabel|In view/);
  assert.match(topBar, /profile-view-toggle-/);
  assert.match(appContext, /planViewToggle/);
  const plan = planViewToggle({
    profileId: "ca",
    profiles: [
      {
        id: "us",
        profile_id: "us",
        currency_code: "USD",
        is_enabled: true,
        account_id: "1",
        account_name: "A",
        nickname: null,
        country_code: "US",
        marketplace_id: null,
        account_type: null,
        created_at: "",
        updated_at: "",
      },
      {
        id: "ca",
        profile_id: "ca",
        currency_code: "CAD",
        is_enabled: true,
        account_id: "1",
        account_name: "A",
        nickname: null,
        country_code: "CA",
        marketplace_id: null,
        account_type: null,
        created_at: "",
        updated_at: "",
      },
    ],
    selectedProfileIds: ["us"],
  });
  assert.equal(plan.kind, "add");
  if (plan.kind === "add") assert.deepEqual(plan.nextIds, ["us", "ca"]);
});
