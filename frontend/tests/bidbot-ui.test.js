import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ABOUT_BIDBOT_COPY,
  AGGRESSIVE_CONFIRM_MESSAGE,
  AGGRESSIVE_CONFIRM_TITLE,
  BIDBOT_SCOPE_HELPER,
  CURRENCY_GAP_CAPTION,
  MIN_MAX_DISPLAY_CAPTION,
  SNAPSHOT_BID_LABEL,
  VIEWING_CUSTOMER_BANNER,
  applyBidConfirmMessage,
  applyBidConfirmTitle,
  applyPlacementConfirmMessage,
  autoModeDescription,
  autoModeLabel,
  bidDeltaLabel,
  confidenceCategoryLabel,
  emptyBidRecsTitle,
  formatBidAmount,
  humanizeBidApplyError,
  isExpiredRecommendation,
  needsRunAutoConfirm,
  placementIdentity,
  recRowAccessibilityLabel,
  runEngineA11yLabel,
  runEngineConfirmMessage,
} from "../src/lib/bidBotContract.ts";

const screen = readFileSync(new URL("../app/more/bid-bot.tsx", import.meta.url), "utf8");

test("snapshot bid is not labeled current, and currency is not inferred", () => {
  assert.equal(SNAPSHOT_BID_LABEL, "Bid when analyzed");
  assert.equal(formatBidAmount(0.79), "0.79");
  assert.doesNotMatch(formatBidAmount(0.79), /\$|£|€/);
  assert.match(CURRENCY_GAP_CAPTION, /not included/);
  assert.match(screen, /SNAPSHOT_BID_LABEL/);
  assert.doesNotMatch(screen, /primaryCurrency/);
  assert.doesNotMatch(screen, /Current bid/);
  assert.equal(bidDeltaLabel(0.79, 0.71), "Decrease by 0.08");
  assert.notEqual(bidDeltaLabel(0.79, 0.71), "Decrease by 8%");
  assert.notEqual(bidDeltaLabel(0.79, 0.71), "Set to 0.08");
});

test("Apply and placement confirms name the Amazon Ads consequence", () => {
  assert.equal(applyBidConfirmTitle(1), "Apply recommended bid?");
  assert.match(
    applyBidConfirmMessage([
      { keyword: "japanese", campaignName: "Brand", currentBid: 0.79, recommendedBid: 0.71 },
    ]),
    /Bid when analyzed: 0\.79/,
  );
  assert.match(
    applyBidConfirmMessage([{ keyword: "japanese", currentBid: 0.79, recommendedBid: 0.71 }]),
    /This changes the bid on Amazon Ads/,
  );
  assert.match(applyPlacementConfirmMessage([{ campaignName: "US", currentText: "ToS 10%", recommendedText: "ToS 20%" }]), /not bids/);
  assert.match(screen, /applyBidConfirmTitle/);
  assert.match(screen, /applyPlacementConfirmTitle/);
});

test("Aggressive and Run-while-auto warn without calling the other mode safe", () => {
  assert.equal(autoModeLabel("high_confidence"), "Careful");
  assert.equal(needsRunAutoConfirm("off"), false);
  assert.equal(needsRunAutoConfirm("high_confidence"), true);
  assert.match(runEngineConfirmMessage("high_confidence"), /high-confidence/);
  assert.match(runEngineConfirmMessage("aggressive"), /medium/);
  assert.match(runEngineConfirmMessage("off"), /Nothing is applied automatically/);
  assert.equal(AGGRESSIVE_CONFIRM_TITLE, "Turn on Aggressive?");
  assert.match(AGGRESSIVE_CONFIRM_MESSAGE, /without tapping Apply/);
  assert.doesNotMatch(AGGRESSIVE_CONFIRM_MESSAGE + autoModeDescription("off"), /\bSafe\b|\bGuaranteed\b/);
  assert.match(screen, /AGGRESSIVE_CONFIRM_TITLE/);
  assert.match(screen, /needsRunAutoConfirm/);
});

test("view-as lock and account-wide scope stay explicit", () => {
  assert.equal(VIEWING_CUSTOMER_BANNER, "Viewing a customer. Apply, Run, Revert, and auto mode stay off.");
  assert.match(BIDBOT_SCOPE_HELPER, /header profile filter does not limit/);
  assert.match(screen, /VIEWING_CUSTOMER_BANNER/);
  assert.match(screen, /BIDBOT_SCOPE_HELPER/);
  assert.doesNotMatch(screen, /Showing selected profiles/);
});

test("min/max are display-only and confidence is categorical", () => {
  assert.match(MIN_MAX_DISPLAY_CAPTION, /display-only/);
  assert.match(screen, /MIN_MAX_DISPLAY_CAPTION/);
  assert.doesNotMatch(screen, /onChangeText=\{setMinBid\}/);
  assert.equal(confidenceCategoryLabel("high"), "High");
  assert.equal(confidenceCategoryLabel("92%"), undefined);
  assert.equal(confidenceCategoryLabel("85"), undefined);
  assert.match(ABOUT_BIDBOT_COPY, /not a probability/);
  assert.match(ABOUT_BIDBOT_COPY, /does not turn on a schedule/);
});

test("zero-applied and stale errors are not success copy", () => {
  assert.match(humanizeBidApplyError(new Error("STALE_BID")), /Refresh BidBot/);
  assert.equal(humanizeBidApplyError(new Error("Amazon didn't apply those changes.")), "Amazon didn't apply those changes.");
  assert.match(screen, /assertBidApplicationSucceeded/);
  assert.match(screen, /humanizeBidApplyError/);
  assert.equal(emptyBidRecsTitle(false), "BidBot hasn't run yet");
  assert.equal(emptyBidRecsTitle(true), "No bid recommendations right now");
});

test("VoiceOver rec row uses analyzed and recommended bids", () => {
  assert.match(
    recRowAccessibilityLabel({
      title: "Japanese",
      campaign: "Brand",
      analyzed: "0.79",
      proposed: "0.71",
      delta: "Decrease by 0.08",
    }),
    /Bid when analyzed 0\.79/,
  );
  assert.match(screen, /recRowAccessibilityLabel/);
  assert.match(screen, /applyBidsA11yLabel/);
  assert.match(runEngineA11yLabel("off"), /Generates recommendations only/);
  assert.match(runEngineA11yLabel("high_confidence"), /automatically/);
  assert.match(screen, /runEngineA11yLabel/);
});

test("placement identity stays percent-based and expired recs are not treated as live", () => {
  assert.equal(placementIdentity({ top_of_search: 10 }), "Top of search");
  assert.equal(placementIdentity({ top_of_search: 10, product_pages: 5 }), "Top of search · Product pages");
  assert.equal(isExpiredRecommendation("expired"), true);
  assert.equal(isExpiredRecommendation("pending"), false);
  assert.match(screen, /placementIdentity/);
  assert.match(screen, /isExpiredRecommendation/);
});
