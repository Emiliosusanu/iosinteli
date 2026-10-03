import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildVerifiedFinancialWidgetPayload,
  nativeFinancialScopeKey,
} from "../src/lib/widgetFinance.ts";

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-03T12:00:00.000Z",
    dataVersion: "v1",
    source: "nest",
    scope: {
      userId: "u1",
      profileIds: ["ca", "us"],
      currency: "USD",
      mixedCurrency: true,
      timeZone: "Europe/Bucharest",
      localDate: "2026-10-03",
    },
    freshness: {
      adsDataAsOf: "2026-10-03",
      lastSuccessfulAdsSync: "2026-10-03T11:55:00.000Z",
      kdpDataAsOf: null,
      generatedAt: "2026-10-03T12:00:00.000Z",
      dataVersion: "v1",
    },
    today: { date: "2026-10-03", spend: 0, orders: 0, sales: 0, acos: null, state: "verified_zero" },
    yesterday: { date: "2026-10-02", spend: 4, orders: 1, sales: 12, acos: 33.3, state: "verified" },
    sevenDay: {
      start: "2026-09-27",
      end: "2026-10-03",
      spend: 25.5,
      orders: 4,
      sales: 80,
      acos: 31.875,
      state: "verified",
      points: [],
    },
    previousSevenDay: { start: "2026-09-20", end: "2026-09-26", spend: 0, orders: 0, sales: 0, acos: null, state: "verified_zero" },
    automation: { rulesEnabled: null, rulesTotal: null, lastRunAt: null, entitiesChanged: null },
    bidBot: { autoMode: "off", autoApplyEnabled: false, lastRunAt: null, pendingCount: null, appliedCount: null },
    attention: [],
    topBooks: [],
    recentActivity: [],
    activityModes: ["all"],
    sync: { lastSuccessfulAdsSync: "2026-10-03T11:55:00.000Z", pending: false },
    ...overrides,
  };
}

const royalties = {
  hasKdpData: true,
  totalRoyalties: 70,
  totalOrders: 5,
  daily: [{ date: "2026-10-02", royalties: 70, orders: 5 }],
  coverage: "partial",
  coveredDays: 1,
  daysInRange: 7,
  coveredAccountDays: 1,
  expectedAccountDays: 7,
};

test("native widget publishes aligned verified Gross, spend, and Net", () => {
  const snap = snapshot();
  const payload = buildVerifiedFinancialWidgetPayload({
    snapshot: snap,
    royalties,
    nowMs: 1234,
  });
  assert.deepEqual(payload, {
    verified: true,
    asOfMs: 1234,
    periodLabel: "Sep 27–Oct 3",
    scopeKey: "u1:ca,us:USD",
    currencySymbol: "$",
    royalties: 70,
    adSpend: 25.5,
    net: 44.5,
    reload: true,
  });
  assert.equal(nativeFinancialScopeKey(snap), "u1:ca,us:USD");
});

test("native widget accepts a verified zero but rejects missing or incompatible money", () => {
  const zero = snapshot({ sevenDay: { ...snapshot().sevenDay, spend: 0, state: "verified_zero" } });
  assert.equal(buildVerifiedFinancialWidgetPayload({ snapshot: zero, royalties })?.adSpend, 0);

  const missing = snapshot({ sevenDay: { ...snapshot().sevenDay, spend: null, state: "missing" } });
  assert.equal(buildVerifiedFinancialWidgetPayload({ snapshot: missing, royalties }), null);
  assert.equal(buildVerifiedFinancialWidgetPayload({ snapshot: snapshot(), royalties: { ...royalties, hasKdpData: false } }), null);
  assert.equal(
    buildVerifiedFinancialWidgetPayload({
      snapshot: snapshot({ scope: { ...snapshot().scope, currency: "CAD" } }),
      royalties,
    }),
    null,
  );
});

test("WidgetKit hides old finance and background refresh publishes only complete sources", () => {
  const swift = readFileSync(new URL("../ios/InteliAdsSyncWidget/InteliAdsSyncStatusWidget.swift", import.meta.url), "utf8");
  const background = readFileSync(new URL("../src/lib/backgroundFinancialSync.ts", import.meta.url), "utf8");
  assert.match(swift, /age <= 6 \* 60 \* 60/);
  assert.match(swift, /hasFreshFinancials/);
  assert.match(swift, /Gross/);
  assert.match(swift, /Ad spend/);
  assert.match(swift, /Net/);
  assert.match(background, /buildVerifiedFinancialWidgetPayload/);
  assert.match(background, /updateNativeFinancialSnapshot/);
});

