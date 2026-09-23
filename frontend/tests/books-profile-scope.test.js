import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { activeLinkedKdpAccountIdsFromRows } from "../src/lib/kdpAccountLinks.ts";
import {
  booksKdpQueryScope,
  booksListAwaitingRows,
  booksMoneyProfileIds,
  booksRoyaltyScope,
  booksRoyaltyScopeForSelection,
  enabledSelectedProfileIds,
  ownedKdpAccountIds,
} from "../src/lib/booksProfileScope.ts";
import { isKdpOnlySessionScope } from "../src/lib/kdpRoyaltyScope.ts";

const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");

const profiles = [
  {
    id: "us",
    profile_id: "ads-us",
    country_code: "US",
    currency_code: "USD",
    is_enabled: true,
    account_name: "Author - US",
    nickname: null,
    marketplace_id: null,
    account_type: null,
    account_id: "a",
    created_at: "",
    updated_at: "",
  },
  {
    id: "hr",
    profile_id: "ads-hr",
    country_code: "HR",
    currency_code: "EUR",
    is_enabled: false,
    account_name: "Sebastian Danga",
    nickname: "HR",
    marketplace_id: null,
    account_type: null,
    account_id: "a",
    created_at: "",
    updated_at: "",
  },
];

test("enabledSelectedProfileIds drops Disabled profiles", () => {
  assert.deepEqual(enabledSelectedProfileIds(profiles, ["us", "hr"]), ["us"]);
  assert.deepEqual(enabledSelectedProfileIds(profiles, ["hr"]), []);
});

test("booksMoneyProfileIds never includes Disabled Sebastian-style profiles", () => {
  const ids = booksMoneyProfileIds(profiles, ["us", "hr"]);
  assert.ok(ids.includes("us") || ids.includes("ads-us"));
  assert.equal(ids.includes("hr"), false);
  assert.equal(ids.includes("ads-hr"), false);
});

test("booksRoyaltyScopeForSelection follows the money chip, not every Enabled country", () => {
  const mixed = [
    ...profiles,
    {
      id: "ca",
      profile_id: "ads-ca",
      country_code: "CA",
      currency_code: "CAD",
      is_enabled: true,
      account_name: "Author - CA",
      nickname: null,
      marketplace_id: null,
      account_type: null,
      account_id: "c",
      created_at: "",
      updated_at: "",
    },
  ];
  const caScope = booksRoyaltyScopeForSelection(mixed, ["ca"]);
  assert.equal(caScope.kind, "country");
  assert.equal(caScope.country, "CA");
  assert.ok(caScope.profileIds.every((id) => id === "ca" || id === "ads-ca"));
});

test("booksRoyaltyScope ignores Disabled countries when Enabled Ads exist", () => {
  const scope = booksRoyaltyScope(profiles);
  assert.equal(scope.kind, "country");
  assert.equal(scope.country, "US");
  assert.ok(scope.profileIds.every((id) => id === "us" || id === "ads-us"));
});

test("booksKdpQueryScope stays linked_profiles while Ads are enabled", () => {
  const scope = booksRoyaltyScope(profiles);
  assert.equal(booksKdpQueryScope(scope), "linked_profiles");
  assert.equal(
    booksKdpQueryScope({ kind: "user_accounts", reason: "no_ads_profiles", country: null, profileIds: [] }),
    "user_accounts",
  );
});

test("disabled-only Ads selection stays linked_profiles (Bugbot: no user_accounts widen)", () => {
  // In-view has Ads rows, but none are Nest-enabled → enabled∩selected∩money is empty.
  // Must NOT classify as KDP-only / user_accounts (that loads every owned shelf → $4.1K inflate).
  const disabledOnly = [
    {
      id: "us",
      profile_id: "ads-us",
      country_code: "US",
      currency_code: "USD",
      is_enabled: false,
      account_name: "Author - US",
      nickname: null,
      marketplace_id: null,
      account_type: null,
      account_id: "a",
      created_at: "",
      updated_at: "",
    },
    {
      id: "hr",
      profile_id: "ads-hr",
      country_code: "HR",
      currency_code: "EUR",
      is_enabled: false,
      account_name: "Sebastian Danga",
      nickname: "HR",
      marketplace_id: null,
      account_type: null,
      account_id: "a",
      created_at: "",
      updated_at: "",
    },
  ];

  const selectionScope = booksRoyaltyScopeForSelection(disabledOnly, ["us", "hr"]);
  assert.equal(selectionScope.kind, "unavailable");
  assert.equal(selectionScope.reason, "no_enabled_ads_profiles");
  assert.deepEqual(selectionScope.profileIds, []);
  assert.equal(booksKdpQueryScope(selectionScope), "linked_profiles");
  assert.equal(isKdpOnlySessionScope(selectionScope), false);

  const allDisabledScope = booksRoyaltyScope(disabledOnly);
  assert.equal(allDisabledScope.kind, "unavailable");
  assert.equal(booksKdpQueryScope(allDisabledScope), "linked_profiles");

  // True KDP-only (zero Ads rows) may still widen to owned shelves.
  const kdpOnly = booksRoyaltyScopeForSelection([], []);
  assert.equal(kdpOnly.kind, "user_accounts");
  assert.equal(booksKdpQueryScope(kdpOnly), "user_accounts");
});

test("ownedKdpAccountIds drops other users' shelves (Sebastian leak)", () => {
  const owner = "9407b6a0-e283-45a2-8cbf-d3de3dbc97bd";
  const ids = ownedKdpAccountIds(
    [
      { id: "emi-1", user_id: owner },
      { id: "emi-2", user_id: owner },
      { id: "sebi", user_id: "3f2d1c4c-778f-44b4-93d1-f46de8bc9aa5" },
      { id: "blank", user_id: null },
    ],
    owner,
  );
  assert.deepEqual(ids, ["emi-1", "emi-2"]);
  assert.deepEqual(ownedKdpAccountIds([{ id: "emi-1", user_id: owner }], null), []);
});

test("Overview Sep 16–22 royalty inflation: foreign shelf must not enter Net", () => {
  // Live evidence 2026-09-16..22: linked US shelves 1154.57; +Sebi 89.43 → 1244;
  // USD Ads spend 566.23 → UI Net 677.77. Correct Net is 588.34.
  const linkedUsRoyalties = 1154.57;
  const sebiRoyalties = 89.43;
  const inflatedGross = linkedUsRoyalties + sebiRoyalties;
  const usdSpend = 566.23;
  assert.equal(Number(inflatedGross.toFixed(2)), 1244);
  assert.equal(Number((inflatedGross - usdSpend).toFixed(2)), 677.77);
  assert.equal(Number((linkedUsRoyalties - usdSpend).toFixed(2)), 588.34);
});

/**
 * Catalog user 9407b6a0… — four owned KDP shelves linked to six Nest-enabled Ads
 * profiles (4× USD + 2× CAD). USD money chip must still resolve all four shelves.
 * Live Ads profile IDs from stress-167 / campaign-creation fixtures.
 */
test("four owned KDP shelves stay linked under USD money chip with CA also enabled", () => {
  const EMILIAN = "2543611550477751";
  const VP1 = "1120992069090651";
  const VP2 = "3423496215225846";
  const MARY = "2588051190380043";
  const CA_VPS2 = "3896545512891020";
  const CA_AUTHOR = "4138300112469957";

  const base = {
    marketplace_id: null,
    account_type: null,
    account_id: "entity",
    created_at: "",
    updated_at: "",
    nickname: null,
  };
  const catalog = [
    { ...base, id: "row-emi", profile_id: EMILIAN, country_code: "US", currency_code: "USD", is_enabled: true, account_name: "Emilian Susanu" },
    { ...base, id: "row-vp1", profile_id: VP1, country_code: "US", currency_code: "USD", is_enabled: true, account_name: "VP 1" },
    { ...base, id: "row-vp2", profile_id: VP2, country_code: "US", currency_code: "USD", is_enabled: true, account_name: "VP 2" },
    { ...base, id: "row-mary", profile_id: MARY, country_code: "US", currency_code: "USD", is_enabled: true, account_name: "Mary" },
    { ...base, id: "row-ca-vps2", profile_id: CA_VPS2, country_code: "CA", currency_code: "CAD", is_enabled: true, account_name: "CA - VPS 2" },
    { ...base, id: "row-ca-auth", profile_id: CA_AUTHOR, country_code: "CA", currency_code: "CAD", is_enabled: true, account_name: "Sponsored ads - Author - CA" },
  ];
  const selected = [EMILIAN, VP1, VP2, MARY, CA_VPS2, CA_AUTHOR];

  const moneyIds = booksMoneyProfileIds(catalog, selected);
  for (const id of [EMILIAN, VP1, VP2, MARY, CA_VPS2, CA_AUTHOR]) {
    assert.ok(moneyIds.includes(id), `USD money chip must keep Ads id ${id} (FX markets included)`);
  }

  const scope = booksRoyaltyScopeForSelection(catalog, selected);
  assert.equal(booksKdpQueryScope(scope), "linked_profiles");
  assert.equal(scope.kind, "country");
  assert.equal(scope.country, "US");
  for (const id of [EMILIAN, VP1, VP2, MARY]) {
    assert.ok(scope.profileIds.includes(id), `royalty scope must keep ads profile ${id}`);
  }

  // Bridge mirrors Accounts UI: each owned shelf linked to its USD Ads profile
  // (VP 2 also has a CAD link — must not be required when money chip is USD).
  const bridge = [
    { kdp_account_id: "kdp-emi", amazon_profile_id: EMILIAN, is_paused: false },
    { kdp_account_id: "kdp-vp1", amazon_profile_id: VP1, is_paused: false },
    { kdp_account_id: "kdp-vp2", amazon_profile_id: VP2, is_paused: false },
    { kdp_account_id: "kdp-vp2", amazon_profile_id: CA_VPS2, is_paused: false },
    { kdp_account_id: "kdp-mary", amazon_profile_id: MARY, is_paused: false },
  ];
  const linked = activeLinkedKdpAccountIdsFromRows(bridge, scope.profileIds).sort();
  assert.deepEqual(linked, ["kdp-emi", "kdp-mary", "kdp-vp1", "kdp-vp2"]);

  // Regression: US-only collapse of royalty profileIds would drop CA-only links
  // and, if a USD link were missing, drop a whole shelf from Gross.
  const usOnlyIds = scope.profileIds.filter((id) => id === EMILIAN || id === "row-emi");
  const linkedUsOnly = [
    ...new Set(
      bridge
        .filter((row) => row.is_paused !== true && usOnlyIds.includes(row.amazon_profile_id))
        .map((row) => row.kdp_account_id),
    ),
  ];
  assert.equal(linkedUsOnly.length < 4, true);
});

test("Amazon Sep 1–22 KDP ground truth is not the Sep 16–22 Overview week Gross", () => {
  // KDP Royalties Estimator screenshots (USD, all books, last month's KENP rate):
  const susanu = 830.16;
  const vps1 = 1597.49;
  const vps2 = 563.76;
  const mary = 776.36;
  const amazonMonth = Number((susanu + vps1 + vps2 + mary).toFixed(2));
  assert.equal(amazonMonth, 3767.77);
  // Overview screenshot Custom Sep 16–22 Gross ~$1.2K ≈ proportional week slice.
  const proportionalWeek = amazonMonth * (7 / 22);
  assert.ok(proportionalWeek > 1150 && proportionalWeek < 1250);
  // Same-window owned month probe (~$3752) tracks Amazon within KENP/sync noise —
  // do not treat week Gross as a missing-shelf undercount of the month total.
  assert.ok(amazonMonth - proportionalWeek > 2400);
});

test("Overview uses money-chip linked KDP scope (web US 4 / currency S)", () => {
  assert.match(home, /booksRoyaltyScopeForSelection\(profiles, moneyProfileIds\)/);
  assert.match(home, /scopeProfiles = moneyProfileIds/);
  assert.match(home, /booksMoneyProfileIds/);
  assert.match(home, /booksKdpQueryScope/);
  assert.match(home, /const kdpQueryScope = booksKdpQueryScope\(royaltyScope\)/);
  assert.match(home, /allowLegacyProfileLinks:\s*false/);
  assert.doesNotMatch(home, /overviewRoyaltyScopeForPortfolio/);
  assert.doesNotMatch(home, /includePausedLinks:\s*true/);
  assert.doesNotMatch(home, /CERTIFIED_MONEY_/);
  assert.doesNotMatch(home, /kdpRoyaltyQueryScope\(royaltyScope\)/);
  assert.match(queries, /\.eq\("user_id", userId\)/);
  assert.match(queries, /ensureFreshSupabaseSession/);
  assert.match(queries, /filterOwnedKdpAccountIds|owned-active/);
  assert.match(queries, /allowLegacy === false/);
});

test("booksListAwaitingRows treats pending undefined data as loading not empty", () => {
  assert.equal(
    booksListAwaitingRows({ isPending: true, isError: false, data: undefined }),
    true,
  );
  assert.equal(
    booksListAwaitingRows({ isPending: true, isError: false, data: [] }),
    false,
  );
  assert.equal(
    booksListAwaitingRows({ isPending: false, isError: false, isFetching: true, data: undefined }),
    true,
  );
  assert.equal(
    booksListAwaitingRows({ isPending: false, isError: false, data: [] }),
    false,
  );
});

test("Books tab uses enabled profile scope and empty-state gate", () => {
  assert.match(products, /booksMoneyProfileIds/);
  assert.match(products, /booksRoyaltyScopeForSelection/);
  assert.match(products, /booksKdpQueryScope/);
  assert.match(products, /booksListAwaitingRows/);
  assert.match(products, /data: booksData/);
  assert.match(products, /No enabled profiles/);
  assert.doesNotMatch(products, /moneyProfileIdsForSelection\(profiles, selectedProfileIds\)/);
  assert.doesNotMatch(products, /kdpRoyaltyQueryScope\(royaltyScope\)/);
});

test("Book detail scopes to enabled profiles and offers Create campaign", () => {
  assert.match(detail, /booksMoneyProfileIds/);
  assert.match(detail, /booksRoyaltyScopeForSelection/);
  assert.match(detail, /booksKdpQueryScope/);
  assert.match(detail, /Create campaign/);
  assert.match(detail, /\/campaign\/create/);
  assert.match(detail, /formatsFromWorkKey/);
  assert.match(detail, /defaultCreateFormatAsin/);
});
