import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyBudgetForecast } from "../src/lib/monthlyBudgetForecast.ts";

test("monthly forecast counts missing calendar days as zero and reports days remaining", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    spend: index < 5 ? 10 : 0,
  }));
  const result = buildMonthlyBudgetForecast(points, "2026-09-10", 20);
  assert.equal(result.monthToDateSpend, 50);
  assert.equal(result.daysRemaining, 20);
  assert.equal(result.monthlyBudget, 600);
  assert.ok(result.projectedMonthSpend >= 50);
  assert.ok(result.projectedBudgetPct != null);
});

test("monthly forecast is honest when no budget exists", () => {
  const result = buildMonthlyBudgetForecast([{ date: "2026-09-30", spend: 12 }], "2026-09-30", 0);
  assert.equal(result.monthToDateSpend, 12);
  assert.equal(result.daysRemaining, 0);
  assert.equal(result.projectedMonthSpend, 12);
  assert.equal(result.projectedBudgetPct, null);
});
