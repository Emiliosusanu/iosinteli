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
  // Hub labels only — no tutorial subtitles.
  assert.doesNotMatch(copy, /recommendations and automation/);
  assert.doesNotMatch(copy, /profiles, connection, and kdp links/);
  assert.doesNotMatch(copy, /alerts and app preferences/);
  assert.match(copy, /bid bot/);
  assert.match(copy, /amazon accounts/);
  assert.match(copy, /my account/);
  assert.doesNotMatch(copy, /24\/7|always up to date|selected profile|auto scheduling|confidence|probability/);
  assert.doesNotMatch(copy, /sync all|kdp \+|kdp sync|all your data/);
  assert.doesNotMatch(copy, /disconnect|bidbot limit|bid bot limit|engine guardrail/);
  assert.equal(moreRowAccessibilityLabel("Bid bot"), "Bid bot");
});

test("banner distinguishes InteliAds account from Amazon profiles", () => {
  assert.equal(moreAccountBannerCaption({ guestMode: false, viewingCustomer: false }), "InteliAds account");
  assert.equal(moreAccountBannerCaption({ guestMode: true, viewingCustomer: false }), "InteliAds account · Demo");
  assert.equal(moreAccountBannerCaption({ guestMode: false, viewingCustomer: true }), "InteliAds account · Viewing a customer");
  assert.match(screen, /moreAccountBannerCaption/);
  assert.doesNotMatch(screen, /profile\$\{|profiles\}/);
});
