import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FINANCIAL_QUERY_ROOTS,
  FINANCIAL_READ_VERSION,
  canPersistFinancialQuery,
  isCompleteFinancialQueryRoot,
  isObsoleteFinancialQueryRoot,
} from "../src/lib/financialReadVersion.ts";
import {
  QUERY_CACHE_KEY,
  shouldPersistQuery,
  stripObsoleteFinancialQueries,
} from "../src/lib/queryPersist.ts";
import { isPersistedHomeEnvelopeUsable } from "../src/lib/mobileHomeSnapshot.ts";

const persist = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const books = readFileSync(new URL("../tests/books-read-path.test.js", import.meta.url), "utf8");

const scope = {
  userId: "user-a",
  viewAs: null,
  profileIds: ["p1"],
  currency: "USD",
};

test("financial completeness generation is complete-v3 with a v4 cache", () => {
  assert.equal(FINANCIAL_READ_VERSION, "complete-v3");
  assert.equal(QUERY_CACHE_KEY, "inteliads.queryCache.v4");
  assert.match(books, /inteliads\.queryCache\.v4/);
  assert.match(persist, /inteliads\.queryCache\.v4/);
});

test("obsolete first-1000 financial roots cannot persist or hydrate", () => {
  assert.equal(isObsoleteFinancialQueryRoot("campaign-metrics"), true);
  assert.equal(isObsoleteFinancialQueryRoot("placement-mix-range"), true);
  assert.equal(isObsoleteFinancialQueryRoot("mobile-overview"), true);
  assert.equal(isCompleteFinancialQueryRoot(FINANCIAL_QUERY_ROOTS.campaignMetrics), true);
  const dehydrated = {
    queries: [
      { queryKey: ["campaign-metrics", ["p1"], "2026-08-01", "2026-08-26"], state: { status: "success" } },
      { queryKey: ["top-books-range", "self"], state: { status: "success" } },
      { queryKey: [FINANCIAL_QUERY_ROOTS.topBooks, "self"], state: { status: "success" } },
      { queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetrics, ["p1"], "2026-08-01", "2026-08-26"], state: { status: "success" } },
    ],
  };
  const stripped = stripObsoleteFinancialQueries(dehydrated);
  const keys = stripped.queries.map((query) => query.queryKey[0]);
  assert.deepEqual(keys, [FINANCIAL_QUERY_ROOTS.topBooks, FINANCIAL_QUERY_ROOTS.campaignMetrics]);
  assert.equal(
    shouldPersistQuery({
      queryKey: ["campaign-metrics", ["p1"]],
      state: { status: "success", dataUpdatedAt: Date.now() },
    }),
    false,
  );
});

test("incomplete financial success is not written over a good cache", () => {
  assert.equal(
    canPersistFinancialQuery({
      queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetrics],
      state: { status: "success" },
      meta: { complete: false, financialReadVersion: FINANCIAL_READ_VERSION },
    }),
    false,
  );
  assert.equal(
    canPersistFinancialQuery({
      queryKey: [FINANCIAL_QUERY_ROOTS.campaignMetrics],
      state: { status: "success" },
      meta: { complete: true, financialReadVersion: FINANCIAL_READ_VERSION },
    }),
    true,
  );
});

test("Home financial and Books reads use complete-v3 keys", () => {
  assert.equal(FINANCIAL_QUERY_ROOTS.campaignMetrics, "campaign-metrics-complete-v3");
  assert.equal(FINANCIAL_QUERY_ROOTS.placementMix, "placement-mix-range-complete-v3");
  assert.equal(FINANCIAL_QUERY_ROOTS.mobileOverview, "mobile-overview-complete-v3");
  assert.equal(FINANCIAL_QUERY_ROOTS.kdpRoyalties, "kdp-royalties-complete-v3");
  assert.equal(FINANCIAL_QUERY_ROOTS.products, "products-range-complete-v3");
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.campaignMetrics/);
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.placementMix/);
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.mobileOverview/);
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.kdpRoyalties/);
  assert.match(home, /FINANCIAL_QUERY_ROOTS\.topBooks/);
  assert.match(home, /home\.month\.cache/);
  assert.match(home, /home\.month\.server/);
  assert.match(home, /home\.today\.cache/);
  assert.match(home, /home\.today\.server/);
  assert.match(home, /noPeriodPlaceholder|HOME_PERIOD_QUERY_CACHE|periodFinancePending/);
  assert.match(home, /Array\.isArray\(metricsQ\.data\)/);
  assert.doesNotMatch(home, /\["campaign-metrics"/);
  assert.doesNotMatch(home, /\["placement-mix-range"/);
  assert.doesNotMatch(home, /\["mobile-overview"/);
});

test("hydrate refuses to overwrite fresher in-memory queries", () => {
  assert.match(persist, /incoming > current\.dataUpdatedAt/);
  assert.match(persist, /getQueryState/);
});

test("pre-completeness Home snapshot envelopes cannot become authoritative", () => {
  const snapshot = {
    schemaVersion: 1,
    generatedAt: "2026-08-26T10:00:00.000Z",
    dataVersion: "2026-08-26",
    scope: { userId: "user-a", profileIds: ["p1"], currency: "USD", mixedCurrency: false, timeZone: "UTC", localDate: "2026-08-26" },
    freshness: { adsDataAsOf: "2026-08-26", lastSuccessfulAdsSync: null, kdpDataAsOf: null, generatedAt: "2026-08-26T10:00:00.000Z", dataVersion: "2026-08-26" },
    today: { date: "2026-08-26", spend: 22.91, orders: 1, sales: 15.99, acos: 143.277, state: "verified" },
    yesterday: { date: "2026-08-25", spend: 0, orders: 0, sales: 0, acos: null, state: "verified_zero" },
    sevenDay: { start: "2026-08-20", end: "2026-08-26", spend: 1, orders: 1, sales: 1, acos: 100, state: "verified", points: [] },
    previousSevenDay: { start: "2026-08-13", end: "2026-08-19", spend: null, orders: null, sales: null, acos: null, state: "missing" },
    automation: { rulesEnabled: null, rulesTotal: null, lastRunAt: null, entitiesChanged: null },
    bidBot: { autoMode: "off", autoApplyEnabled: false, lastRunAt: null, pendingCount: null, appliedCount: null },
    attention: [],
    topBooks: [],
    recentActivity: [],
    activityModes: ["all"],
    sync: { lastSuccessfulAdsSync: null, pending: false },
  };
  assert.equal(
    isPersistedHomeEnvelopeUsable(
      { schemaVersion: 1, savedAt: "2026-08-26T10:00:00.000Z", verified: true, snapshot },
      scope,
    ),
    false,
  );
  assert.equal(
    isPersistedHomeEnvelopeUsable(
      {
        schemaVersion: 1,
        financialReadVersion: FINANCIAL_READ_VERSION,
        savedAt: "2026-08-26T10:00:00.000Z",
        verified: true,
        snapshot,
      },
      scope,
    ),
    true,
  );
});
