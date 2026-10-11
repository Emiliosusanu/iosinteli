import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveChartDayFinance,
  seriesValueOnDate,
} from "../src/lib/chartDayFinance.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");

test("seriesValueOnDate matches by calendar day, not index", () => {
  const spend = [
    { date: "2026-09-01", value: 10 },
    { date: "2026-09-03", value: 30 },
  ];
  assert.equal(seriesValueOnDate(spend, "2026-09-03"), 30);
  assert.equal(seriesValueOnDate(spend, "2026-09-02"), null);
  assert.equal(seriesValueOnDate(spend, undefined), null);
});

test("scrub finance never invents $0 when Ads day is missing", () => {
  const resolved = resolveChartDayFinance({
    index: 1,
    netPoint: { value: 80, date: "2026-09-02", label: "2 Sep", sales: null },
    royaltiesSeries: [
      { date: "2026-09-01", value: 100 },
      { date: "2026-09-02", value: 80 },
    ],
    // Shorter Ads series — royalty-only day has no spend row
    spendSeries: [{ date: "2026-09-01", value: 20 }],
  });
  assert.equal(resolved.date, "2026-09-02");
  assert.equal(resolved.royalties, 80);
  assert.equal(resolved.spend, null);
  assert.equal(resolved.sales, null);
  // Net comes from plotted point (known), not royalties − invent-0
  assert.equal(resolved.net, 80);
});

test("scrub finance stays null when royalties and spend are both missing", () => {
  const resolved = resolveChartDayFinance({
    index: 0,
    netPoint: { value: null, date: "2026-09-28", label: "28 Sep" },
    royaltiesSeries: [{ date: "2026-09-01", value: 50 }],
    spendSeries: [{ date: "2026-09-01", value: 10 }],
  });
  assert.equal(resolved.royalties, null);
  assert.equal(resolved.spend, null);
  assert.equal(resolved.net, null);
});

test("verified $0 spend still resolves (not treated as missing)", () => {
  const resolved = resolveChartDayFinance({
    index: 0,
    netPoint: { value: 40, date: "2026-09-01", label: "1 Sep", sales: 0 },
    royaltiesSeries: [{ date: "2026-09-01", value: 40 }],
    spendSeries: [{ date: "2026-09-01", value: 0 }],
  });
  assert.equal(resolved.spend, 0);
  assert.equal(resolved.sales, 0);
  assert.equal(resolved.net, 40);
});

test("Home scrub path does not latch period totals or coerce missing to 0", () => {
  assert.match(home, /Day scrub: never coerce missing/);
  assert.doesNotMatch(home, /paintedFinanceRef\.current\.royalties \?\? 0/);
  assert.doesNotMatch(home, /paintedFinanceRef\.current\.spend \?\? 0/);
  assert.doesNotMatch(home, /paintedFinanceRef\.current\.net \?\? 0/);
  assert.match(charts, /resolveChartDayFinance/);
});
