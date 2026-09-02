import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACOS_DISPLAY_DECIMALS,
  acosFromSpendSales,
  aggregateAcos,
  formatAcosKpi,
  iosMonthToTodayRange,
  iosRolling7Range,
  webIsoWeekRange,
  webMonthRange,
} from "../src/lib/acosContract.ts";

const indexSrc = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const alertsSrc = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");

test("web-parity ACoS is spend / ad sales, not an average of percents", () => {
  assert.equal(acosFromSpendSales(50, 100), 50);
  assert.equal(formatAcosKpi(acosFromSpendSales(50, 100)), "50.0%");

  const multi = aggregateAcos([
    { spend: 80, sales: 100 },
    { spend: 20, sales: 400 },
  ]);
  assert.equal(multi.spend, 100);
  assert.equal(multi.sales, 500);
  assert.equal(multi.acos, 20);
  const naiveAvg = (80 + 5) / 2;
  assert.notEqual(multi.acos, naiveAvg);

  const zeroSales = aggregateAcos([{ spend: 12, sales: 0 }]);
  assert.equal(zeroSales.acos, 0);
  assert.equal(formatAcosKpi(0), "0.0%");

  const allZero = aggregateAcos([{ spend: 0, sales: 0 }]);
  assert.equal(allZero.acos, 0);

  const none = aggregateAcos([]);
  assert.equal(none.spend, 0);
  assert.equal(none.acos, 0);

  assert.equal(acosFromSpendSales(10, Number.NaN), 0);
  assert.equal(formatAcosKpi(37.64), "37.6%");
  assert.equal(ACOS_DISPLAY_DECIMALS, 1);
});

test("web month is calendar month; web week is ISO Monday-Sunday", () => {
  const tue = new Date(2026, 7, 25, 12);
  assert.deepEqual(webMonthRange(tue), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(webIsoWeekRange(tue), { start: "2026-08-24", end: "2026-08-30" });
  assert.deepEqual(iosRolling7Range(tue), { start: "2026-08-19", end: "2026-08-25" });
  assert.deepEqual(iosMonthToTodayRange(tue), { start: "2026-08-01", end: "2026-08-25" });
  assert.notDeepEqual(webIsoWeekRange(tue), iosRolling7Range(tue));
});

test("Overview Week uses the web ISO week window, not rolling 7", () => {
  assert.match(indexSrc, /webIsoWeekRange/);
  assert.match(indexSrc, /const iso = webIsoWeekRange\(anchor\)/);
  assert.doesNotMatch(indexSrc, /addDays\(end, -6\)/);
});

test("campaign_metrics range reads every page instead of the first 1000 rows", () => {
  const queriesSrc = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
  const fn = queriesSrc.slice(
    queriesSrc.indexOf("export async function fetchCampaignMetricsRange"),
    queriesSrc.indexOf("export async function fetchCampaignMetricsForCampaign"),
  );
  assert.match(fn, /fetchAllPages/);
  assert.match(fn, /\.range\(from, to\)/);
});

test("local alerts evaluate on device and include digest totals", () => {
  assert.match(alertsSrc, /runAlertCheck/);
  assert.match(alertsSrc, /digestMetricsLine/);
  assert.match(alertsSrc, /notificationBodyWithTotals/);
  assert.doesNotMatch(alertsSrc, /iOS is not the business-alert authority/);
});
