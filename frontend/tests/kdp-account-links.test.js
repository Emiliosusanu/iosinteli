import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeLinkedKdpAccountIdsFromRows } from "../src/lib/kdpAccountLinks.ts";
import { formatCompact } from "../src/lib/format.ts";
import { kdpRoyaltyQueryScope, selectKdpRoyaltyScope } from "../src/lib/kdpRoyaltyScope.ts";
import { booksKdpQueryScope } from "../src/lib/booksProfileScope.ts";

const royaltyScopeSrc = readFileSync(
  new URL("../src/lib/kdpRoyaltyScope.ts", import.meta.url),
  "utf8",
);
const queriesSrc = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");

test("same kdp_account linked to US+CA is counted once for royalty aggregation", () => {
  const linked = activeLinkedKdpAccountIdsFromRows(
    [
      { kdp_account_id: "kdp-emi", amazon_profile_id: "us-emi", is_paused: false },
      { kdp_account_id: "kdp-emi", amazon_profile_id: "ca-emi", is_paused: false },
      { kdp_account_id: "kdp-vp1", amazon_profile_id: "us-vp1", is_paused: false },
      { kdp_account_id: "kdp-vp2", amazon_profile_id: "us-vp2", is_paused: false },
      { kdp_account_id: "kdp-vp2", amazon_profile_id: "ca-vp2", is_paused: false },
      { kdp_account_id: "kdp-mary", amazon_profile_id: "us-mary", is_paused: false },
      { kdp_account_id: "kdp-paused", amazon_profile_id: "us-emi", is_paused: true },
    ],
    ["us-emi", "ca-emi", "us-vp1", "us-vp2", "ca-vp2", "us-mary"],
  ).sort();
  assert.deepEqual(linked, ["kdp-emi", "kdp-mary", "kdp-vp1", "kdp-vp2"]);
});

test("Sep 1–22 Amazon estimator ground truth formats as $3.8K not $4.1K/$4.2K", () => {
  const amazonMonth = Number((830.16 + 1597.49 + 563.76 + 776.36).toFixed(2));
  assert.equal(amazonMonth, 3767.77);
  assert.equal(formatCompact(amazonMonth), "3.8K");
  // Overview screenshot $4.1K requires 4050.01–4149.99 — not the four-account sum.
  assert.equal(formatCompact(4050), "4.0K");
  assert.equal(formatCompact(4050.01), "4.1K");
  assert.equal(formatCompact(4149.99), "4.1K");
  // Classic US→user_accounts / legacy Disabled-profile inflate (~+$332) lands in $4.1K.
  assert.equal(formatCompact(amazonMonth + 332.23), "4.1K");
  // $4.2K is 4150–4249.99 — still overcount vs Amazon four-account sum.
  assert.equal(formatCompact(4150), "4.2K");
  assert.equal(formatCompact(4249.99), "4.2K");
});

test("US Ads country scope must stay linked_profiles (no owned-shelf widen)", () => {
  const scope = selectKdpRoyaltyScope([
    { id: "us", profile_id: "ads-us", country_code: "US", is_enabled: true },
    { id: "ca", profile_id: "ads-ca", country_code: "CA", is_enabled: true },
  ]);
  assert.equal(scope.country, "US");
  assert.equal(kdpRoyaltyQueryScope(scope), "linked_profiles");
  assert.equal(booksKdpQueryScope(scope), "linked_profiles");
  // Build ≤169 shipped: country===US → user_accounts (Sebastian / extra shelf leak).
  assert.doesNotMatch(royaltyScopeSrc, /country === ["']US["']/);
  assert.match(queriesSrc, /activeLinkedKdpAccountIdsFromRows|linkedKdpAccountIdsFromRows/);
});

test("Overview Gross skips legacy profile links and paused-only shelves", () => {
  const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
  assert.match(home, /allowLegacyProfileLinks:\s*false/);
  assert.match(home, /booksRoyaltyScopeForSelection\(profiles, moneyProfileIds\)/);
  assert.match(home, /scopeProfiles = moneyProfileIds/);
  assert.doesNotMatch(home, /includePausedLinks:\s*true/);
  assert.doesNotMatch(home, /CERTIFIED_MONEY_/);
  assert.doesNotMatch(home, /overviewRoyaltyScopeForPortfolio/);
  assert.match(queriesSrc, /allowLegacy === false/);
  assert.match(queriesSrc, /filterOwnedKdpAccountIds/);
  assert.match(queriesSrc, /Shared Ads profiles can bridge other users/);
});
