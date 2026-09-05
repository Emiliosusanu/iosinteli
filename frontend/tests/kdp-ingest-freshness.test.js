import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KDP_INGEST_STALE_AFTER_MS,
  combineKdpAccountFreshness,
  formatIngestAge,
  isKdpIngestStale,
  kdpAccountsLinkedToSelection,
  kdpStallAlertCopy,
  latestIngestMs,
  parseIngestMs,
} from "../src/lib/kdpIngestFreshness.ts";

const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const productDetail = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
const monitor = readFileSync(new URL("../src/lib/kdpIngestMonitor.ts", import.meta.url), "utf8");

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-09-05T18:00:00.000Z");

test("ingest stall is last write age, not a missing royalty day", () => {
  assert.equal(KDP_INGEST_STALE_AFTER_MS, HOUR);
  assert.equal(parseIngestMs("2026-09-05T17:00:00.000Z"), now - HOUR);
  assert.equal(parseIngestMs(0), null);
  assert.equal(latestIngestMs([now - 3 * HOUR, now - 10 * 60_000, null]), now - 10 * 60_000);
  assert.equal(
    isKdpIngestStale({ lastIngestAtMs: now - 30 * 60_000, nowMs: now }),
    false,
  );
  assert.equal(
    isKdpIngestStale({ lastIngestAtMs: now - HOUR - 1, nowMs: now }),
    true,
  );
  assert.equal(
    isKdpIngestStale({ lastIngestAtMs: null, knownSinceMs: now - 2 * HOUR, nowMs: now }),
    true,
  );
  assert.equal(isKdpIngestStale({ lastIngestAtMs: null, nowMs: now }), false);
});

test("Chrome Nest last_synced and iPhone helper lastRun share the same stall rule", () => {
  const chromeFresh = combineKdpAccountFreshness({
    accountId: "k1",
    name: "US",
    lastSyncedAt: new Date(now - 20 * 60_000).toISOString(),
    helperEnabled: false,
    helperAccountId: "k1",
    helperLastRunAtMs: now - 5 * HOUR,
    nowMs: now,
  });
  assert.equal(chromeFresh.stale, false);

  const helperFresh = combineKdpAccountFreshness({
    accountId: "k1",
    name: "US",
    lastSyncedAt: new Date(now - 5 * HOUR).toISOString(),
    helperEnabled: true,
    helperAccountId: "k1",
    helperLastRunAtMs: now - 15 * 60_000,
    nowMs: now,
  });
  assert.equal(helperFresh.stale, false);

  const bothStale = combineKdpAccountFreshness({
    accountId: "k1",
    name: "US",
    lastSyncedAt: new Date(now - 3 * HOUR).toISOString(),
    helperEnabled: true,
    helperAccountId: "k1",
    helperLastRunAtMs: now - 2 * HOUR,
    nowMs: now,
  });
  assert.equal(bothStale.stale, true);

  const otherAccountHelper = combineKdpAccountFreshness({
    accountId: "k1",
    name: "US",
    lastSyncedAt: new Date(now - 3 * HOUR).toISOString(),
    helperEnabled: true,
    helperAccountId: "k2",
    helperLastRunAtMs: now - 1_000,
    nowMs: now,
  });
  assert.equal(otherAccountHelper.stale, true);
});

test("only KDP accounts linked to the selected Amazon profiles are watched", () => {
  const scoped = kdpAccountsLinkedToSelection(
    [
      { id: "k1", linked_amazon_profile_ids: ["us"] },
      { id: "k2", linked_amazon_profile_ids: ["uk"] },
    ],
    ["us"],
  );
  assert.deepEqual(scoped.map((row) => row.id), ["k1"]);
  assert.deepEqual(kdpAccountsLinkedToSelection([{ id: "k1", linked_amazon_profile_ids: ["us"] }], []), []);
});

test("stall copy names the account and does not invent a break-even percent", () => {
  assert.equal(kdpStallAlertCopy("US KDP").title, "KDP data stalled");
  assert.match(kdpStallAlertCopy("US KDP").body, /US KDP/);
  assert.match(kdpStallAlertCopy("US KDP").body, /Chrome extension or iPhone helper/);
  assert.doesNotMatch(kdpStallAlertCopy("US KDP").body, /44%|208%/);
  assert.equal(formatIngestAge(now - 90 * 60_000, now), "2h ago");
  assert.match(monitor, /kdp_daily_data/);
  assert.match(monitor, /lastRunAtMs/);
});

test("book ACoS coloring does not invent a 30% break-even", () => {
  assert.doesNotMatch(products, /hasBreakEven \? item\.breakeven_acos : 30/);
  assert.doesNotMatch(productDetail, /hasBreakEven \? book\.breakeven_acos : 30/);
  assert.match(charts, /hasAuthoritativeBreakEven\(breakEvenAcos\)/);
});
