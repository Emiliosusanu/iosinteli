import { test } from "node:test";
import assert from "node:assert/strict";

import {
  digestMetricsLine,
  digestMetricsLines,
  digestTitleForHour,
  formatDigestBody,
  honestTotalsFromDayPoint,
  isMorningDigestHour,
  notificationBodyWithTotals,
  shouldSendDigestHour,
  DIGEST_HOURS,
  MORNING_DIGEST_HOUR,
} from "../src/lib/notificationDigest.ts";

test("digest line always includes spend orders and acos", () => {
  const line = digestMetricsLine({ spend: 3400, orders: 12, acos: 37.9 }, "USD", false);
  assert.match(line, /Spend \$3\.4K/);
  assert.match(line, /12 orders/);
  assert.match(line, /ACoS 37\.9%/);
  assert.doesNotMatch(line, /Net/);
});

test("null spend and orders print n/a, never fake $0", () => {
  const line = digestMetricsLine({ spend: null, orders: null, acos: null }, "USD", false);
  assert.match(line, /Spend n\/a/);
  assert.match(line, /n\/a orders/);
  assert.match(line, /ACoS n\/a/);
  assert.doesNotMatch(line, /Spend \$0/);
  assert.doesNotMatch(line, /—/);
});

test("verified_zero still prints Spend $0", () => {
  const honest = honestTotalsFromDayPoint(
    { spend: 0, orders: 0, sales: 0, acos: null, state: "verified_zero" },
    "USD",
  );
  assert.equal(honest.spend, 0);
  assert.equal(honest.state, "verified_zero");
  const line = digestMetricsLine(honest, "USD", false);
  assert.match(line, /Spend \$0/);
});

test("missing / no_sync day points never coerce spend to 0", () => {
  const missing = honestTotalsFromDayPoint(
    { spend: 0, orders: 0, state: "missing" },
    "USD",
  );
  assert.equal(missing.spend, null);
  assert.equal(missing.orders, null);
  assert.equal(missing.state, "missing");

  const noSync = honestTotalsFromDayPoint(
    { spend: null, orders: null, state: "no_sync" },
    "CAD",
  );
  assert.equal(noSync.spend, null);
  assert.equal(noSync.currency, "CAD");
});

test("unknown Nest zero-fill stays Spend n/a, never invents verified_zero", () => {
  const unknownZero = honestTotalsFromDayPoint(
    { spend: 0, orders: 0, sales: 0, acos: null },
    "USD",
  );
  assert.equal(unknownZero.spend, null);
  assert.equal(unknownZero.orders, null);
  assert.equal(unknownZero.state, "unknown");
  assert.match(digestMetricsLine(unknownZero, "USD", false), /Spend n\/a/);
  assert.doesNotMatch(digestMetricsLine(unknownZero, "USD", false), /Spend \$0/);

  const unknownSpend = honestTotalsFromDayPoint(
    { spend: 12, orders: 1, acos: 40 },
    "USD",
  );
  assert.equal(unknownSpend.spend, 12);
  assert.equal(unknownSpend.state, "verified");
});

test("multi-currency digest lines keep USD and CAD separate", () => {
  const lines = [
    honestTotalsFromDayPoint({ spend: 90, orders: 2, acos: 28, state: "verified" }, "USD"),
    honestTotalsFromDayPoint({ spend: null, orders: null, state: "no_sync" }, "CAD"),
  ];
  const body = digestMetricsLines(lines, false);
  assert.match(body, /USD Spend \$90/);
  assert.match(body, /CAD Spend n\/a/);
  assert.doesNotMatch(body, /CAD Spend C?\$0/);
});

test("formatDigestBody appends mixed-currency note and coverage", () => {
  const lines = [
    { spend: 10, orders: 1, acos: 20, state: "verified", currency: "USD" },
    { spend: 5, orders: 0, acos: null, state: "verified_zero", currency: "CAD" },
  ];
  const body = formatDigestBody({
    lines,
    includeKdpNet: false,
    coverageLine: "1 of 2 profiles updated",
  });
  assert.match(body, /USD Spend/);
  assert.match(body, /CAD Spend/);
  assert.match(body, /USD \+ CAD listed separately · not converted/);
  assert.match(body, /Open InteliAds for the full summary/);
  assert.match(body, /1 of 2 profiles updated/);
});

test("digest line can append KDP net when enabled", () => {
  const line = digestMetricsLine(
    { spend: 90, orders: 2, acos: 28, net: 158 },
    "USD",
    true,
  );
  assert.match(line, /Net \$158/);
});

test("notification body prefixes headline with digest totals", () => {
  const body = notificationBodyWithTotals(
    "1 new ad order",
    { spend: 90, orders: 2, acos: 28 },
    "USD",
    false,
  );
  assert.match(body, /^1 new ad order\nSpend/);
});

test("morning hour is yesterday digest; later hours are today so far", () => {
  assert.equal(MORNING_DIGEST_HOUR, 8);
  assert.equal(isMorningDigestHour(8), true);
  assert.equal(isMorningDigestHour(12), false);
  assert.equal(digestTitleForHour(8), "Yesterday's Amazon Ads");
  assert.equal(digestTitleForHour(12), "Today so far");
});

test("digest hours dedupe within the same local day", () => {
  assert.equal(shouldSendDigestHour(12, undefined, "2026-08-25", undefined), true);
  assert.equal(shouldSendDigestHour(12, 12, "2026-08-25", "2026-08-25"), false);
  assert.equal(shouldSendDigestHour(9, 12, "2026-08-25", "2026-08-25"), false);
  assert.equal(DIGEST_HOURS.includes(20), true);
  // Nest owns ~08:00 morning summary; local digests start at 10am by default.
  assert.equal(DIGEST_HOURS.includes(8), false);
  assert.equal(shouldSendDigestHour(8, undefined, "2026-08-25", undefined), false);
});
