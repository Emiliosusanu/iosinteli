import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregateKdpDailyRows } from "../src/lib/kdpRoyaltiesTrace.ts";

test("kdp_daily_data Yesterday fixture sums to 150.75 across 4 accounts", () => {
  const rows = [
    { account_id: "a1", date: "2026-08-29", royalties: 74.67, orders: 1 },
    { account_id: "a2", date: "2026-08-29", royalties: 8.18, orders: 1 },
    { account_id: "a3", date: "2026-08-29", royalties: 38.74, orders: 1 },
    { account_id: "a4", date: "2026-08-29", royalties: 29.16, orders: 1 },
  ];
  const result = aggregateKdpDailyRows(rows, 4, { start: "2026-08-29", end: "2026-08-29", source: "kdp_daily_data" });
  assert.equal(Number(result.totalRoyalties.toFixed(2)), 150.75);
  assert.equal(result.rawCount, 4);
  assert.equal(result.accountCount, 4);
  assert.equal(result.completeness, "COMPLETE");
  assert.equal(result.coverage, "complete");
  assert.equal(result.coveredAccountDays, 4);
  assert.equal(result.expectedAccountDays, 4);
  assert.equal(result.daily.length, 1);
  assert.equal(result.daily[0].date, "2026-08-29");
});

test("missing one linked account is PARTIAL and under-reads", () => {
  const rows = [
    { account_id: "a1", date: "2026-08-29", royalties: 74.67, orders: 1 },
    { account_id: "a2", date: "2026-08-29", royalties: 8.18, orders: 1 },
    { account_id: "a4", date: "2026-08-29", royalties: 29.16, orders: 1 },
  ];
  const result = aggregateKdpDailyRows(rows, 4, { start: "2026-08-29", end: "2026-08-29", source: "kdp_daily_data" });
  assert.equal(Number(result.totalRoyalties.toFixed(2)), 112.01);
  assert.equal(result.accountCount, 3);
  assert.equal(result.completeness, "PARTIAL");
  assert.equal(result.coverage, "partial");
  assert.notEqual(Number(result.totalRoyalties.toFixed(2)), 150.75);
});

test("multi-day range still sums all account-day rows", () => {
  const rows = [
    { account_id: "a1", date: "2026-08-28", royalties: 10, orders: 1 },
    { account_id: "a1", date: "2026-08-29", royalties: 20, orders: 1 },
    { account_id: "a2", date: "2026-08-29", royalties: 5, orders: 0 },
  ];
  const result = aggregateKdpDailyRows(rows, 2, { start: "2026-08-28", end: "2026-08-29", source: "kdp_daily_data" });
  assert.equal(result.totalRoyalties, 35);
  assert.equal(result.daily.length, 2);
  assert.equal(result.completeness, "PARTIAL");
  assert.equal(result.coveredAccountDays, 3);
  assert.equal(result.expectedAccountDays, 4);
});

test("empty rows stay UNKNOWN completeness", () => {
  const result = aggregateKdpDailyRows([], 4, { start: "2026-08-29", end: "2026-08-29", source: "kdp_daily_data" });
  assert.equal(result.totalRoyalties, 0);
  assert.equal(result.completeness, "UNKNOWN");
  assert.equal(result.coverage, "missing");
});

test("kdp_entries fallback is partial even when every account has a row", () => {
  const rows = [
    { account_id: "a1", date: "2026-08-29", royalties: 10, orders: 1 },
    { account_id: "a2", date: "2026-08-29", royalties: 20, orders: 1 },
  ];
  const result = aggregateKdpDailyRows(rows, 2, { start: "2026-08-29", end: "2026-08-29", source: "kdp_entries" });
  assert.equal(result.coverage, "partial");
  assert.equal(result.completeness, "PARTIAL");
});
