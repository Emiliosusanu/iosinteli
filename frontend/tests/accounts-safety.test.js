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

test("Turning a profile off confirms and rolls selection back if Nest fails", () => {
  assert.equal(disableConfirmTitle("UK Ads"), "Turn off UK Ads?");
  assert.match(DISABLE_CONFIRM_MESSAGE, /It does not disconnect Amazon/);
  assert.match(accountsSource, /disableConfirmTitle/);
  assert.match(accountsSource, /DISABLE_CONFIRM_MESSAGE/);
  assert.match(accountsSource, /onError: \(\) => setSelectedProfileIds\(previous\)/);
  assert.match(accountsSource, /amazonAdsProfileId\(match\)/);
  assert.match(accountsSource, /setKdpLinkedProfiles\(kdpAccountId, amazonIds\)/);
});
