import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adsProfileIdsForSelection,
  mergeBackgroundScope,
  parseSelectedProfileIds,
  uniqueProfileIds,
} from "../src/lib/notificationScope.ts";
import { selectKdpRoyaltyScopeForSelection } from "../src/lib/kdpRoyaltyScope.ts";

const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/lib/backgroundFinancialSync.ts", import.meta.url), "utf8");

test("parseSelectedProfileIds accepts array, JSON, and AppContext double-encoding", () => {
  assert.deepEqual(parseSelectedProfileIds(["us", "ca", "us"]), ["us", "ca"]);
  assert.deepEqual(parseSelectedProfileIds(JSON.stringify(["us", "ca"])), ["us", "ca"]);
  assert.deepEqual(parseSelectedProfileIds(JSON.stringify(JSON.stringify(["us", "ca"]))), ["us", "ca"]);
  assert.deepEqual(parseSelectedProfileIds(""), []);
  assert.deepEqual(parseSelectedProfileIds(null), []);
});

test("mergeBackgroundScope prefers live header selection over a stale Home snapshot", () => {
  const lastHome = {
    userId: "user-a",
    viewAs: null,
    profileIds: ["ads-old"],
    currency: "USD",
  };
  const selected = mergeBackgroundScope({
    selectedIds: ["uuid-us", "uuid-ca"],
    lastHome,
    sessionUserId: "user-a",
  });
  assert.deepEqual(selected?.profileIds, ["uuid-us", "uuid-ca"]);
  assert.equal(selected?.userId, "user-a");

  const fallback = mergeBackgroundScope({
    selectedIds: [],
    lastHome,
    sessionUserId: "user-a",
  });
  assert.deepEqual(fallback?.profileIds, ["ads-old"]);

  const otherUserHome = mergeBackgroundScope({
    selectedIds: ["uuid-us"],
    lastHome: { ...lastHome, userId: "user-b", viewAs: "customer" },
    sessionUserId: "user-a",
  });
  assert.equal(otherUserHome?.viewAs, null);
  assert.deepEqual(otherUserHome?.profileIds, ["uuid-us"]);
});

test("adsProfileIdsForSelection maps every selected row to its Amazon ads id", () => {
  const profiles = [
    { id: "uuid-us", profile_id: "ads-us", is_enabled: true },
    { id: "uuid-ca", profile_id: "ads-ca", is_enabled: true },
    { id: "uuid-uk", profile_id: "ads-uk", is_enabled: true },
  ];
  assert.deepEqual(adsProfileIdsForSelection(["uuid-us", "uuid-ca"], profiles), ["ads-us", "ads-ca"]);
  assert.deepEqual(adsProfileIdsForSelection(["ads-uk"], profiles), ["ads-uk"]);
  assert.deepEqual(uniqueProfileIds(["a", "", "a", "b"]), ["a", "b"]);
});

test("adsProfileIdsForSelection drops disabled profiles from alert totals", () => {
  const profiles = [
    { id: "uuid-us", profile_id: "ads-us", is_enabled: true },
    { id: "uuid-ca", profile_id: "ads-ca", is_enabled: false },
    { id: "uuid-uk", profile_id: "ads-uk", is_enabled: true },
  ];
  assert.deepEqual(
    adsProfileIdsForSelection(["uuid-us", "uuid-ca", "uuid-uk"], profiles),
    ["ads-us", "ads-uk"],
  );
  assert.deepEqual(adsProfileIdsForSelection(["uuid-ca"], profiles), []);
});

test("KDP net on selected US+CA still uses US royalties only", () => {
  const profiles = [
    { id: "uuid-us", profile_id: "ads-us", country_code: "US", is_enabled: true },
    { id: "uuid-ca", profile_id: "ads-ca", country_code: "CA", is_enabled: true },
    { id: "uuid-uk", profile_id: "ads-uk", country_code: "UK", is_enabled: true },
  ];
  const selected = selectKdpRoyaltyScopeForSelection(profiles, ["uuid-us", "uuid-ca"]);
  assert.equal(selected.kind, "country");
  assert.equal(selected.country, "US");
  assert.deepEqual(selected.profileIds, ["ads-us", "uuid-us"]);

  const caOnly = selectKdpRoyaltyScopeForSelection(profiles, ["uuid-ca"]);
  assert.equal(caOnly.country, "CA");
  assert.deepEqual(caOnly.profileIds, ["ads-ca", "uuid-ca"]);
});

test("alerts and background refresh expand selected profiles before Nest totals", () => {
  assert.match(notifications, /adsProfileIdsForSelection/);
  assert.match(notifications, /selectKdpRoyaltyScopeForSelection/);
  assert.match(notifications, /fetchMobileOverview/);
  assert.match(background, /parseSelectedProfileIds/);
  assert.match(background, /mergeBackgroundScope/);
  assert.match(background, /adsProfileIdsForSelection/);
  assert.match(background, /selectKdpRoyaltyScopeForSelection/);
  assert.doesNotMatch(background, /storage\.getItem<string\[\]>\(PROFILES_KEY, \[\]\)/);
});
