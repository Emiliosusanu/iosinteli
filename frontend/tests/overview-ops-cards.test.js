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
  assert.match(cards, /Today not synced yet/);
  assert.doesNotMatch(cards, /withRepeat/);
  assert.match(cards, /Daily budget is almost gone/);
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
