import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BIDBOT_VIEWING_CUSTOMER_MESSAGE,
  assertBidApplicationSucceeded,
  assertRevertSucceeded,
  autoModeLabel,
  bidBotReadFilterUserId,
  bidBotRecsQueryKey,
  bidBotStatusQueryKey,
  canMutateBidBot,
  persistableBidBotSettings,
} from "../src/lib/bidBotContract.ts";

const screen = readFileSync(new URL("../app/more/bid-bot.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/lib/mutations.ts", import.meta.url), "utf8");

test("admin view-as cannot mutate BidBot", () => {
  assert.equal(canMutateBidBot({ userId: "admin", guestMode: false, adminFilterUserId: "customer" }), false);
  assert.equal(canMutateBidBot({ userId: "seller", guestMode: false, adminFilterUserId: null }), true);
  assert.equal(canMutateBidBot({ userId: "seller", guestMode: true, adminFilterUserId: null }), false);
  assert.match(screen, /canMutateBidBot/);
  assert.match(screen, /BIDBOT_VIEWING_CUSTOMER_MESSAGE/);
  assert.equal(
    BIDBOT_VIEWING_CUSTOMER_MESSAGE,
    "Bid Bot changes aren't available while viewing another user's accounts.",
  );
});

test("reads always send a user id so admin GET is not the all-users list", () => {
  assert.equal(bidBotReadFilterUserId("admin", "customer"), "customer");
  assert.equal(bidBotReadFilterUserId("admin", null), "admin");
  assert.notDeepEqual(bidBotRecsQueryKey("admin", "a"), bidBotRecsQueryKey("admin", "b"));
  assert.notDeepEqual(bidBotStatusQueryKey("admin", null), bidBotStatusQueryKey("admin", "customer"));
  assert.match(mutations, /filterUserId: params.filterUserId/);
  assert.match(mutations, /\/bid-recommendations\/pending\$\{qs\(\{ filterUserId \}\)\}/);
  assert.doesNotMatch(mutations, /function runBidEngine\([^)]*filterUserId/);
  assert.doesNotMatch(mutations, /function applyBidRecommendations\([^)]*filterUserId/);
});

test("HTTP 200 apply envelope is not treated as Amazon applied", () => {
  assert.throws(
    () =>
      assertBidApplicationSucceeded({
        items: [{ outcome: "stale", message: "Bid changed" }],
        summary: { requested: 1, applied: 0, stale: 1 },
      }),
    /Bid changed/,
  );
  assert.throws(
    () =>
      assertBidApplicationSucceeded({
        items: [{ outcome: "applied" }, { outcome: "failed", message: "blocked" }],
        summary: { requested: 2, applied: 1, failed: 1 },
      }),
    /Applied 1 of 2/,
  );
  assert.doesNotThrow(() =>
    assertBidApplicationSucceeded({
      items: [{ outcome: "applied" }],
      summary: { requested: 1, applied: 1 },
    }),
  );
});

test("Careful is high_confidence and Save does not persist min/max", () => {
  assert.equal(autoModeLabel("high_confidence"), "Careful");
  assert.deepEqual(persistableBidBotSettings({ targetAcos: 32, autoMode: "aggressive" }), {
    targetAcos: 32,
    autoMode: "aggressive",
  });
  assert.match(screen, /persistableBidBotSettings/);
  assert.match(screen, /assertBidApplicationSucceeded/);
  assert.match(screen, /assertRevertSucceeded/);
});

test("revert failed outcomes are not success", () => {
  assert.doesNotThrow(() => assertRevertSucceeded({ outcome: "reverted" }));
  assert.doesNotThrow(() => assertRevertSucceeded({ outcome: "already_applied" }));
  assert.throws(() => assertRevertSucceeded({ outcome: "stale", message: "Amazon bid changed" }), /Amazon bid changed/);
});
