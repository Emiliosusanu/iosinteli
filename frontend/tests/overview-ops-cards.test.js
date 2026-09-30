import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cards = readFileSync(new URL("../src/components/OverviewOpsCards.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

test("Overview ops cards use glass + stagger + status affordances", () => {
  assert.match(cards, /OverviewBudgetTodayCard/);
  assert.match(cards, /OverviewBidBotCard/);
  assert.match(cards, /OverviewAutomationCard/);
  assert.match(cards, /GlassPanel/);
  assert.match(cards, /StaggerReveal/);
  assert.match(cards, /LinearGradient/);
  assert.match(cards, /SwipeOpen|Gesture\.Pan/);
  assert.match(cards, /Not synced|Waiting for sync/);
  assert.doesNotMatch(cards, /withRepeat/);
  assert.match(cards, /Almost gone|% used/);
});

test("Home wires the redesigned ops cards without prior-day budget fallback", () => {
  assert.match(home, /OverviewBudgetTodayCard/);
  assert.match(home, /OverviewBidBotCard/);
  assert.match(home, /OverviewAutomationCard/);
  assert.match(home, /budgetTodaySynced/);
  assert.doesNotMatch(home, /latestBudgetDay/);
  assert.doesNotMatch(home, /BudgetArcWidget/);
  assert.doesNotMatch(home, /function PulseStat/);
});

test("Home orders operational cards and never renders a pending monthly forecast", () => {
  const bidBot = home.indexOf("<OverviewBidBotCard");
  const budget = home.indexOf("<OverviewBudgetTodayCard");
  const automation = home.indexOf("<OverviewAutomationCard");
  const marketplace = home.indexOf("<OverviewMarketplaceAdsCard");
  const review = home.indexOf("<ActionReviewCard");

  assert.ok(bidBot >= 0 && bidBot < budget);
  assert.ok(budget < automation);
  assert.ok(automation < marketplace);
  assert.ok(marketplace < review);
  assert.match(home, /monthlyBudgetForecastReady = budgetHistoryQ\.isSuccess/);
  assert.match(home, /projectedMonthSpend=\{monthlyBudgetForecastReady \? monthlyBudgetForecast\.projectedMonthSpend : undefined\}/);
});

test("Marketplace card is real-data only and controls the Ads widget scope", () => {
  assert.match(cards, /OverviewMarketplaceAdsCard/);
  assert.match(cards, /if \(!rows\.length\) return null/);
  assert.match(home, /adsWidgetProfileIds/);
  assert.match(home, /selectedCountry=\{selectedAdsMarket\}/);
  assert.match(home, /onSelect=\{setSelectedAdsMarket\}/);
  assert.match(home, /scopeLabel=\{overviewMarketplaceLabel\(selectedAdsMarket\)\}/);
});
