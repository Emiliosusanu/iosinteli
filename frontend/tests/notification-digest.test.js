import { test } from "node:test";
import assert from "node:assert/strict";

import {
  digestMetricsLine,
  notificationBodyWithTotals,
  shouldSendDigestHour,
  DIGEST_HOURS,
} from "../src/lib/notificationDigest.ts";

test("digest line always includes spend orders and acos", () => {
  const line = digestMetricsLine({ spend: 3400, orders: 12, acos: 37.9 }, "USD", false);
  assert.match(line, /Spend \$3\.4K/);
  assert.match(line, /12 orders/);
  assert.match(line, /ACoS 37\.9%/);
  assert.doesNotMatch(line, /Net/);
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

test("digest hours dedupe within the same local day", () => {
  assert.equal(shouldSendDigestHour(12, undefined, "2026-08-25", undefined), true);
  assert.equal(shouldSendDigestHour(12, 12, "2026-08-25", "2026-08-25"), false);
  assert.equal(shouldSendDigestHour(9, 12, "2026-08-25", "2026-08-25"), false);
  assert.equal(DIGEST_HOURS.includes(20), true);
});
