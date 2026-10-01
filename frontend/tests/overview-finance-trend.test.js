import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOverviewFinanceTrend } from "../src/lib/overviewFinanceTrend.ts";

test("Gross, Net and spend share the same sorted calendar", () => {
  const royalties = new Map([
    ["2026-09-01", 40],
    ["2026-09-02", 25],
    ["2026-09-03", 10],
  ]);
  const result = buildOverviewFinanceTrend({
    adsDaily: [
      { date: "2026-09-03", spend: 3, sales: 8 },
      { date: "2026-09-01", spend: 5, sales: 12 },
    ],
    kdpDates: ["2026-09-02", "2026-09-01", "2026-09-03"],
    royaltiesForDate: (date) => royalties.get(date) ?? null,
    kdpReady: true,
  });

  assert.deepEqual(result, [
    { date: "2026-09-01", royalties: 40, spend: 5, net: 35, sales: 12 },
    { date: "2026-09-02", royalties: 25, spend: 0, net: 25, sales: 0 },
    { date: "2026-09-03", royalties: 10, spend: 3, net: 7, sales: 8 },
  ]);
});

test("unknown royalty dates are excluded instead of rendered as zero", () => {
  const result = buildOverviewFinanceTrend({
    adsDaily: [
      { date: "2026-09-01", spend: 5 },
      { date: "2026-09-02", spend: 7 },
    ],
    kdpDates: ["2026-09-01", "2026-09-02"],
    royaltiesForDate: (date) => date === "2026-09-01" ? 20 : null,
    kdpReady: true,
  });

  assert.deepEqual(result, [
    { date: "2026-09-01", royalties: 20, spend: 5, net: 15, sales: 0 },
  ]);
});

test("unverified KDP scope produces no finance trend", () => {
  assert.deepEqual(buildOverviewFinanceTrend({
    adsDaily: [{ date: "2026-09-01", spend: 5 }],
    kdpDates: ["2026-09-01"],
    royaltiesForDate: () => 20,
    kdpReady: false,
  }), []);
});
