import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  enabledRoyaltyCountries,
  knownKdpRoyaltyTotal,
  kdpRoyaltyProfileIdsForQuery,
  normalizeRoyaltyCountry,
  selectKdpRoyaltyScope,
  selectKdpRoyaltyScopeForSelection,
} from "../src/lib/kdpRoyaltyScope.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/lib/backgroundFinancialSync.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const productDetail = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");

function profile(partial) {
  return {
    id: "id",
    profile_id: "ads",
    country_code: "US",
    is_enabled: true,
    ...partial,
  };
}

test("normalizeRoyaltyCountry treats GB as UK and ignores blanks", () => {
  assert.equal(normalizeRoyaltyCountry("ca"), "CA");
  assert.equal(normalizeRoyaltyCountry("GB"), "UK");
  assert.equal(normalizeRoyaltyCountry(" uk "), "UK");
  assert.equal(normalizeRoyaltyCountry(""), null);
  assert.equal(normalizeRoyaltyCountry(null), null);
});

test("CAD-only enabled profiles select CA royalties even if a US profile is only in view", () => {
  const scope = selectKdpRoyaltyScope([
    profile({ id: "us", profile_id: "us-ads", country_code: "US", is_enabled: false }),
    profile({ id: "ca", profile_id: "ca-ads", country_code: "CA", is_enabled: true }),
  ]);
  assert.equal(scope.kind, "country");
  assert.equal(scope.country, "CA");
  assert.equal(scope.reason, "single_enabled_country");
  assert.deepEqual(scope.profileIds, ["ca", "ca-ads"]);
});

test("mixed enabled countries including US use US royalties, not the CAD view chips", () => {
  const scope = selectKdpRoyaltyScope([
    profile({ id: "us", profile_id: "us-ads", country_code: "US", is_enabled: true }),
    profile({ id: "ca", profile_id: "ca-ads", country_code: "CA", is_enabled: true }),
    profile({ id: "uk", profile_id: "uk-ads", country_code: "UK", is_enabled: false }),
  ]);
  assert.equal(scope.kind, "country");
  assert.equal(scope.country, "US");
  assert.equal(scope.reason, "us_covers_all_marketplaces");
  assert.deepEqual(scope.profileIds, ["us", "us-ads"]);
  assert.deepEqual(enabledRoyaltyCountries(scope.kind === "country" ? [
    profile({ country_code: "US", is_enabled: true }),
    profile({ country_code: "CA", is_enabled: true }),
  ] : []), ["CA", "US"]);
});

test("mixed non-US enabled countries do not invent a US total", () => {
  const scope = selectKdpRoyaltyScope([
    profile({ id: "ca", profile_id: "ca-ads", country_code: "CA", is_enabled: true }),
    profile({ id: "uk", profile_id: "uk-ads", country_code: "GB", is_enabled: true }),
  ]);
  assert.equal(scope.kind, "unavailable");
  assert.equal(scope.reason, "mixed_non_us");
  assert.deepEqual(scope.profileIds, []);
  assert.deepEqual(kdpRoyaltyProfileIdsForQuery([
    profile({ id: "ca", profile_id: "ca-ads", country_code: "CA", is_enabled: true }),
    profile({ id: "uk", profile_id: "uk-ads", country_code: "UK", is_enabled: true }),
  ]), []);
});

test("missing is_enabled counts as Nest-enabled; no enabled country stays unavailable", () => {
  const implied = selectKdpRoyaltyScope([
    profile({ id: "us", profile_id: "us-ads", country_code: "US", is_enabled: undefined }),
  ]);
  assert.equal(implied.kind, "country");
  assert.equal(implied.country, "US");

  const none = selectKdpRoyaltyScope([
    profile({ id: "us", profile_id: "us-ads", country_code: "US", is_enabled: false }),
  ]);
  assert.equal(none.kind, "unavailable");
  assert.equal(none.reason, "none_enabled");

  const unknownCountry = selectKdpRoyaltyScope([
    profile({ id: "x", profile_id: "x-ads", country_code: null, is_enabled: true }),
  ]);
  assert.equal(unknownCountry.kind, "unavailable");
  assert.equal(unknownCountry.reason, "none_enabled");
});

test("knownKdpRoyaltyTotal never turns missing coverage into zero", () => {
  assert.equal(knownKdpRoyaltyTotal({ hasKdpData: true, totalRoyalties: 12.5 }), 12.5);
  assert.equal(knownKdpRoyaltyTotal({ hasKdpData: false, totalRoyalties: 0 }), null);
  assert.equal(knownKdpRoyaltyTotal({ hasKdpData: true, totalRoyalties: Number.NaN }), null);
  assert.equal(knownKdpRoyaltyTotal(undefined), null);
});

test("Home, Books, notifications, and background refresh use enabled-country royalty scope", () => {
  assert.match(home, /selectKdpRoyaltyScope/);
  assert.match(home, /royaltyProfiles/);
  assert.match(home, /fetchKdpRoyaltiesRange\(royaltyProfiles/);
  assert.match(home, /knownKdpRoyaltyTotal\(royaltyRange\)/);
  assert.match(home, /knownKdpRoyaltyTotal\(prevRoyaltyRange\)/);
  assert.match(home, /sellerReady && royaltyProfiles\.length > 0/);
  assert.match(home, /kdpProfileIds: royaltyProfiles/);
  assert.match(products, /selectKdpRoyaltyScope/);
  assert.match(products, /kdpProfileIds: royaltyProfiles/);
  assert.match(products, /fetchKdpRoyaltiesRange\(royaltyProfiles/);
  assert.match(notifications, /selectKdpRoyaltyScopeForSelection/);
  assert.match(notifications, /knownKdpRoyaltyTotal/);
  assert.match(background, /selectKdpRoyaltyScopeForSelection/);
  assert.match(productDetail, /selectKdpRoyaltyScope/);
  assert.match(queries, /kdpLinkProfileIds/);
  assert.match(queries, /kdpProfileIds !== undefined \? opts\.kdpProfileIds : profileIds/);
  assert.equal(
    selectKdpRoyaltyScopeForSelection(
      [
        profile({ id: "us", profile_id: "us-ads", country_code: "US", is_enabled: true }),
        profile({ id: "ca", profile_id: "ca-ads", country_code: "CA", is_enabled: true }),
      ],
      ["ca"],
    ).country,
    "CA",
  );
});
