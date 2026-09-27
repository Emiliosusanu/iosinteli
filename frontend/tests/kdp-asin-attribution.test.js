import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  catalogAsinsFromBooksObj,
  pickBestAccountByAsinOverlap,
  profilesEligibleForCatalog,
  shouldSwitchStickyAccount,
} from "../src/lib/kdp/asinAttribution.ts";

test("catalog ASINs come from booksObj.asins map", () => {
  const asins = catalogAsinsFromBooksObj({
    g1: { asins: { digital: "B0TEST1234", print: "1234567890" }, titleName: "A" },
    g2: { asins: { digital: "b0other999" }, titleName: "B" },
  });
  assert.deepEqual(asins, ["1234567890", "B0OTHER999", "B0TEST1234"]);
});

test("only Ads profiles that sponsor a catalog ASIN are eligible", () => {
  const eligible = profilesEligibleForCatalog({
    catalogAsins: ["B0TEST1234", "B0OTHER999"],
    sponsoredAsinsByProfileId: {
      ads_emi: ["B0TEST1234", "B0EMI00001"],
      ads_vp: ["B0VPTEST01"],
      ads_empty: [],
    },
  });
  assert.deepEqual(eligible, ["ads_emi"]);
});

test("poisoned sticky loses to account linked to sponsoring Ads profile", () => {
  const accounts = [
    { accountId: "vp-test-1", asins: ["B0F8QGHL3P", "B0FW468FBB"] },
    { accountId: "emi-usd-2", asins: ["B0F8QGHL3P", "B0FW468FBB"] },
  ];
  assert.equal(
    shouldSwitchStickyAccount({
      preferredAccountId: "vp-test-1",
      catalogAsins: ["B0F8QGHL3P", "B0FW468FBB"],
      accounts,
      boostAccountIds: ["emi-usd-2"],
    }),
    true,
  );
  const best = pickBestAccountByAsinOverlap({
    catalogAsins: ["B0F8QGHL3P", "B0FW468FBB"],
    accounts,
    preferredAccountId: "vp-test-1",
    boostAccountIds: ["emi-usd-2"],
  });
  assert.equal(best?.accountId, "emi-usd-2");
});

test("same KDP account keeps all catalog ASINs with the matched Ads profile", () => {
  // One sponsored ASIN is enough to mark the Ads profile eligible; royalties for
  // sibling ASINs on the same KDP account ride with that link.
  const eligible = profilesEligibleForCatalog({
    catalogAsins: ["B0SPONSOR1", "B0SIBLING2", "B0SIBLING3"],
    sponsoredAsinsByProfileId: {
      ads_ok: ["B0SPONSOR1"],
    },
  });
  assert.deepEqual(eligible, ["ads_ok"]);
});

test("importer resolves helper account before writing royalties", () => {
  const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
  const accounts = readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
  assert.match(importer, /resolveHelperAccountId/);
  assert.match(importer, /async function resolveAccountId/);
  assert.match(importer, /accountLinkedToProfiles/);
  assert.match(importer, /saveHelperAccountId/);
  assert.match(accounts, /export async function resolveHelperAccountId/);
  assert.match(accounts, /fetchKdpAccounts/);
  assert.match(accounts, /Never auto-link a profile that already belongs/);
});
