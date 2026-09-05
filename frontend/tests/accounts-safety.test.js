import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  amazonAdsProfileId,
  amazonAdsProfileIdsForSelection,
  VIEWING_CUSTOMER_MESSAGE,
} from "../src/lib/accountScope.ts";
import { DISABLE_CONFIRM_MESSAGE, disableConfirmTitle } from "../src/lib/accountsUi.ts";

const accountsSource = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");

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
  const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");
  assert.match(mutations, /user_amazon_profiles/);
  assert.match(mutations, /persistUserAmazonProfileEnabled/);
  assert.match(mutations, /is_enabled: enabled/);
  assert.match(mutations, /\.eq\("amazon_profile_id", id\)/);
  assert.match(mutations, /Do NOT rely on UPDATE … RETURNING/);
  assert.match(mutations, /opts\?\.rowId/);
  assert.match(mutations, /\/amazon\/profiles\/\$\{adsProfileId\}\/toggle/);
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
  assert.match(DISABLE_CONFIRM_MESSAGE, /It does not disconnect Amazon/);
  assert.match(accountsSource, /disableConfirmTitle/);
  assert.match(accountsSource, /DISABLE_CONFIRM_MESSAGE/);
  assert.match(accountsSource, /amazonAdsProfileId\(match\)/);
  assert.match(accountsSource, /toggleProfile\(rowId\)/);
  assert.match(accountsSource, /setKdpLinkedProfiles\(kdpAccountId, amazonIds\)/);
  assert.doesNotMatch(accountsSource, /onError: \(\) => setSelectedProfileIds\(previous\)/);
});
