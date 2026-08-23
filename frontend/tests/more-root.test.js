import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MORE_GROUPS,
  moreAccountBannerCaption,
  moreRowAccessibilityLabel,
} from "../src/lib/moreRoot.ts";

const screen = readFileSync(new URL("../app/(tabs)/more.tsx", import.meta.url), "utf8");

function allItems() {
  return MORE_GROUPS.flatMap((group) => group.items);
}

function allCopy() {
  return allItems()
    .map((item) => `${item.label} ${item.subtitle}`.toLowerCase())
    .join("\n");
}

test("More is a navigation hub with no queries or Amazon mutations", () => {
  assert.match(screen, /MORE_GROUPS/);
  assert.doesNotMatch(screen, /useQuery|useMutation|fetchSync|runBidEngine|unlink|sync now|apply bid/i);
  assert.doesNotMatch(screen, /selectedProfiles|selectedProfileIds/);
});

test("grouping is Automation, Data, App with the live routes", () => {
  assert.deepEqual(
    MORE_GROUPS.map((group) => group.title),
    ["Automation", "Data", "App"],
  );
  assert.deepEqual(
    allItems().map((item) => item.href),
    [
      "/more/bid-bot",
      "/more/automation",
      "/more/rule-history",
      "/more/search-terms",
      "/more/ad-groups",
      "/more/negative-targeting",
      "/more/sync",
      "/more/accounts",
      "/more/data-map",
      "/more/settings",
      "/more/account",
    ],
  );
});

test("More copy does not contradict BidBot / Sync / Accounts contracts", () => {
  const copy = allCopy();
  assert.match(copy, /recommendations and automation/);
  assert.match(copy, /amazon ads sync/);
  assert.match(copy, /profiles, connection, and kdp links/);
  assert.match(copy, /keywords and product targets/);
  assert.match(copy, /alerts and app preferences/);
  assert.doesNotMatch(copy, /24\/7|always up to date|selected profile|auto scheduling|confidence|probability/);
  assert.doesNotMatch(copy, /sync all|kdp \+|kdp sync|all your data/);
  assert.doesNotMatch(copy, /disconnect|bidbot limit|bid bot limit|engine guardrail/);
  assert.equal(moreRowAccessibilityLabel("Bid bot", "Recommendations and automation"), "Bid bot. Recommendations and automation");
});

test("banner distinguishes InteliAds account from Amazon profiles", () => {
  assert.equal(moreAccountBannerCaption({ guestMode: false, viewingCustomer: false }), "InteliAds account");
  assert.equal(moreAccountBannerCaption({ guestMode: true, viewingCustomer: false }), "InteliAds account · Demo");
  assert.equal(moreAccountBannerCaption({ guestMode: false, viewingCustomer: true }), "InteliAds account · Viewing a customer");
  assert.match(screen, /moreAccountBannerCaption/);
  assert.doesNotMatch(screen, /profile\$\{|profiles\}/);
});
