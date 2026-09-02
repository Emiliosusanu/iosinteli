import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const iconSrc = readFileSync(new URL("../src/components/InteliAdsIcon.tsx", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../app/(tabs)/_layout.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const bidBot = readFileSync(new URL("../app/more/bid-bot.tsx", import.meta.url), "utf8");
const moreRoot = readFileSync(new URL("../src/lib/moreRoot.ts", import.meta.url), "utf8");
const welcome = readFileSync(new URL("../app/auth/welcome.tsx", import.meta.url), "utf8");

const required = [
  "overview",
  "campaigns",
  "targeting",
  "keywords",
  "productTargets",
  "searchTerms",
  "books",
  "royalties",
  "adSpend",
  "adsSales",
  "adsOrders",
  "acos",
  "breakEvenAcos",
  "netRoyalties",
  "bidBot",
  "rules",
  "manualChanges",
  "automation",
  "sync",
  "amazonAccounts",
  "notifications",
  "attention",
  "success",
  "warning",
  "error",
  "filter",
  "sort",
  "dateRange",
];

test("InteliAds icon family covers the product vocabulary", () => {
  for (const name of required) {
    assert.match(iconSrc, new RegExp(`\\b${name}:`), name);
  }
  assert.doesNotMatch(iconSrc, /sparkle|wand|brain|robot|starburst|orb|neural/i);
});

test("product tabs use the custom family; More stays a system ellipsis", () => {
  assert.match(tabs, /name="overview"/);
  assert.match(tabs, /name="campaigns"/);
  assert.match(tabs, /name="targeting"/);
  assert.match(tabs, /name="books"/);
  assert.match(tabs, /ellipsis\.circle/);
  assert.doesNotMatch(tabs, /megaphone|square\.grid\.2x2/);
});

test("BidBot is a tool mark, not a character or AI chip", () => {
  assert.match(home, /icon="bidBot"/);
  assert.match(bidBot, /productIcon="bidBot"|icon="bidBot"/);
  assert.doesNotMatch(moreRoot, /symbol: "cpu"/);
  assert.match(moreRoot, /slider\.horizontal\.3/);
  assert.doesNotMatch(home, /hardware-chip|sparkles|robot|brain/);
  assert.doesNotMatch(welcome, /iconBubble|sparkles|cpu/);
});
