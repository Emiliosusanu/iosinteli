import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  decideAsinProvenProfileLinks,
  describeLinkRejects,
  stickyContaminatesLiveCatalog,
} from "../src/lib/kdp/linkGuards.ts";

test("same title is irrelevant — only sponsored ASIN overlap allows a link", () => {
  const decision = decideAsinProvenProfileLinks({
    catalogAsins: ["B0EMI00001", "B0EMI00002"],
    sponsoredAsinsByProfileId: {
      ads_emi: ["B0EMI00001"],
      ads_other: ["B0OTHER001"], // different publisher ASIN
      ads_empty: [],
    },
    profileIds: ["ads_emi", "ads_other", "ads_empty"],
  });
  assert.deepEqual(decision.allowedProfileIds, ["ads_emi"]);
  assert.equal(decision.rejected.length, 2);
  assert.equal(decision.matchedAsinsByProfileId.ads_emi?.[0], "B0EMI00001");
});

test("empty KDP catalog refuses all Ads links", () => {
  const decision = decideAsinProvenProfileLinks({
    catalogAsins: [],
    sponsoredAsinsByProfileId: { ads_a: ["B0EMI00001"] },
    profileIds: ["ads_a"],
  });
  assert.deepEqual(decision.allowedProfileIds, []);
  assert.equal(decision.rejected[0]?.reason, "no_kdp_catalog");
  assert.match(describeLinkRejects(decision.rejected), /no book ASINs yet/i);
});

test("sticky shelf with disjoint ASINs contaminates live catalog", () => {
  assert.equal(
    stickyContaminatesLiveCatalog({
      liveCatalogAsins: ["B0EMI00001"],
      stickyShelfAsins: ["B0VPTEST01"],
    }),
    true,
  );
  assert.equal(
    stickyContaminatesLiveCatalog({
      liveCatalogAsins: ["B0EMI00001", "B0EMI00002"],
      stickyShelfAsins: ["B0EMI00002"],
    }),
    false,
  );
});

test("Accounts UI links selected Ads profiles; helper bind clear + ASIN guards exist", () => {
  const accountsUi = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");
  const persist = readFileSync(new URL("../src/lib/kdp/persist.ts", import.meta.url), "utf8");
  const session = readFileSync(new URL("../src/lib/kdp/session.ts", import.meta.url), "utf8");
  const accounts = readFileSync(new URL("../src/lib/kdp/accounts.ts", import.meta.url), "utf8");
  const linkGuards = readFileSync(new URL("../src/lib/kdp/linkGuards.ts", import.meta.url), "utf8");
  const backgroundIds = readFileSync(
    new URL("../src/lib/kdp/backgroundProfileIds.ts", import.meta.url),
    "utf8",
  );
  assert.match(accountsUi, /amazonAdsProfileIdsForSelection/);
  assert.match(accountsUi, /setKdpLinkedProfiles/);
  assert.match(accountsUi, /Link profiles in view/);
  assert.match(persist, /clearHelperProgress/);
  assert.match(session, /clearKdpWebSession/);
  assert.match(accounts, /resolveHelperAccountId/);
  assert.match(linkGuards, /decideAsinProvenProfileLinks/);
  assert.match(linkGuards, /stickyContaminatesLiveCatalog/);
  assert.match(backgroundIds, /loadSelectedProfileIdsForBackground/);
});
