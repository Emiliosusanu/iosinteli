import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HOME_SEVEN_DAY_CONTRACT,
  MOBILE_HOME_SCHEMA_VERSION,
  buildMobileHomeSnapshotFromAds,
  displayMetric,
  freshnessCaption,
  isCurrentHomeSnapshot,
  isFreshHomeSnapshot,
  usableCachedHomeSnapshot,
  snapshotAgeMs,
  SNAPSHOT_MAX_AGE_MS,
  isPersistedHomeEnvelopeUsable,
  isUsableMobileHomeSnapshot,
  mobileHomeCacheKey,
} from "../src/lib/mobileHomeSnapshot.ts";
import { FINANCIAL_READ_VERSION } from "../src/lib/financialReadVersion.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const persist = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const tabs = readFileSync(new URL("../app/(tabs)/_layout.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");

const baseScope = {
  userId: "user-a",
  viewAs: null,
  profileIds: ["p2", "p1"],
  currency: "USD",
};

function snapshot(overrides = {}) {
  return {
    schemaVersion: MOBILE_HOME_SCHEMA_VERSION,
    generatedAt: "2026-08-25T12:32:00.000Z",
    dataVersion: "2026-08-25",
    scope: {
      userId: "user-a",
      profileIds: ["p1", "p2"],
      currency: "USD",
      mixedCurrency: false,
      timeZone: "Europe/Rome",
      localDate: "2026-08-25",
    },
    freshness: {
      adsDataAsOf: "2026-08-25",
      lastSuccessfulAdsSync: "2026-08-25T12:00:00.000Z",
      kdpDataAsOf: "2026-08-24",
      generatedAt: "2026-08-25T12:32:00.000Z",
      dataVersion: "2026-08-25",
    },
    today: { date: "2026-08-25", spend: 8.38, orders: 1, sales: 20, acos: 41.9, state: "verified" },
    yesterday: { date: "2026-08-24", spend: 0, orders: 0, sales: 0, acos: null, state: "verified_zero" },
    sevenDay: {
      start: "2026-08-19",
      end: "2026-08-25",
      spend: 40,
      orders: 3,
      sales: 90,
      acos: 44.4,
      state: "verified",
      points: [],
    },
    previousSevenDay: {
      start: "2026-08-12",
      end: "2026-08-18",
      spend: 30,
      orders: 2,
      sales: 80,
      acos: 37.5,
      state: "verified",
    },
    automation: { rulesEnabled: 1, rulesTotal: 26, lastRunAt: null, entitiesChanged: null },
    bidBot: {
      autoMode: "off",
      autoApplyEnabled: false,
      lastRunAt: null,
      pendingCount: 0,
      appliedCount: null,
    },
    attention: [],
    topBooks: [],
    recentActivity: [],
    activityModes: ["all"],
    sync: { lastSuccessfulAdsSync: "2026-08-25T12:00:00.000Z", pending: false },
    ...overrides,
  };
}

test("cache key is namespaced by user, view-as, profiles, currency, and version", () => {
  assert.equal(
    mobileHomeCacheKey(baseScope),
    `inteliads.mobileHomeSnapshot.v1.${FINANCIAL_READ_VERSION}:user-a:self:p1,p2:USD`,
  );
  assert.notEqual(
    mobileHomeCacheKey(baseScope),
    mobileHomeCacheKey({ ...baseScope, userId: "user-b" }),
  );
  assert.notEqual(
    mobileHomeCacheKey(baseScope),
    mobileHomeCacheKey({ ...baseScope, viewAs: "user-b" }),
  );
  assert.notEqual(
    mobileHomeCacheKey(baseScope),
    mobileHomeCacheKey({ ...baseScope, currency: "GBP" }),
  );
});

test("old schema and other users cannot use a cached snapshot", () => {
  assert.equal(isUsableMobileHomeSnapshot(snapshot(), baseScope), true);
  assert.equal(isUsableMobileHomeSnapshot(snapshot({ schemaVersion: 0 }), baseScope), false);
  assert.equal(
    isUsableMobileHomeSnapshot(snapshot(), { ...baseScope, userId: "user-b" }),
    false,
  );
  assert.equal(
    isUsableMobileHomeSnapshot(snapshot(), { ...baseScope, profileIds: ["p9"] }),
    false,
  );
  assert.equal(
    isUsableMobileHomeSnapshot(snapshot(), { ...baseScope, profileIds: ["p1"] }),
    false,
  );
  assert.equal(
    isUsableMobileHomeSnapshot(snapshot(), { ...baseScope, currency: "GBP" }),
    false,
  );
});

test("missing and zero stay distinct, and ACoS stays null when sales are zero", () => {
  assert.equal(displayMetric(snapshot().today, "spend"), 8.38);
  assert.equal(displayMetric(snapshot().yesterday, "spend"), 0);
  assert.equal(displayMetric({ ...snapshot().today, state: "missing", spend: null }, "spend"), null);
  assert.equal(displayMetric({ ...snapshot().today, sales: 0, acos: null, state: "verified_zero" }, "acos"), null);
});

test("ads-built snapshot marks absent days missing, never verified $0", () => {
  const built = buildMobileHomeSnapshotFromAds({
    userId: "user-a",
    profileIds: ["p1", "p2"],
    currency: "USD",
    timeZone: "UTC",
    localDate: "2026-08-26",
    rows: [
      { date: "2026-08-25", spend: 0, sales: 0, orders: 0 },
      { date: "2026-08-20", spend: 30, sales: 60, orders: 2 },
    ],
  });
  assert.equal(built.source, "ads_fallback");
  assert.equal(built.today.state, "missing");
  assert.equal(built.today.spend, null);
  assert.equal(built.yesterday.state, "verified_zero");
  assert.equal(built.yesterday.spend, 0);
  assert.equal(displayMetric(built.today, "spend"), null);
  assert.equal(displayMetric(built.yesterday, "spend"), 0);
  assert.equal(built.sevenDay.points.filter((point) => point.state === "missing").length, 5);
  assert.equal(built.sevenDay.spend, 30);
  assert.equal(built.automation.rulesEnabled, null);
  assert.match(freshnessCaption(built, false), /Ads-only snapshot · as of 2026-08-25/);
});

test("failed refresh keeps cache and does not call request time the data time", () => {
  assert.match(freshnessCaption(snapshot(), true), /Couldn't refresh · Showing data from 12:32/);
  assert.match(freshnessCaption(snapshot(), false), /Ads data as of 2026-08-25/);
  assert.doesNotMatch(freshnessCaption(snapshot(), false), /data updated/);
});

test("Home uses the mobile snapshot and logout clears it", () => {
  assert.match(home, /tryFetchMobileOverview/);
  assert.match(home, /buildMobileHomeSnapshotFromAds/);
  assert.match(home, /loadMobileHomeSnapshot/);
  assert.match(home, /isAdsFallbackSnapshot/);
  assert.match(home, /noPeriodPlaceholder|HOME_PERIOD_QUERY_CACHE|periodFinancePending/);
  assert.doesNotMatch(home, /home-today-7d|home-horizon/);
  assert.doesNotMatch(home, /sparkles|robot-head|brain|magic-wand|wand/);
  assert.match(persist, /clearMobileHomeSnapshots/);
  assert.match(notifications, /refreshHomeCacheOpportunistic/);
  assert.doesNotMatch(notifications, /fetchNamedCampaignTotals/);
});

test("Home 7D is rolling last seven days, not ISO week", () => {
  assert.equal(HOME_SEVEN_DAY_CONTRACT, "rolling_7d");
  const built = buildMobileHomeSnapshotFromAds({
    userId: "user-a",
    profileIds: ["p1", "p2"],
    currency: "USD",
    timeZone: "UTC",
    localDate: "2026-08-26",
    rows: [
      { date: "2026-08-26", spend: 10, sales: 20, orders: 1 },
      { date: "2026-08-20", spend: 30, sales: 60, orders: 2 },
    ],
  });
  assert.equal(built.today.spend, 10);
  assert.equal(built.today.acos, 50);
  assert.equal(built.sevenDay.start, "2026-08-20");
  assert.equal(built.sevenDay.end, "2026-08-26");
  assert.equal(built.sevenDay.spend, 40);
  assert.equal(built.sevenDay.acos, 50);
  assert.equal(built.sevenDay.points.length, 7);
  assert.equal(built.sevenDay.points.filter((point) => point.state === "missing").length, 5);
  assert.equal(isCurrentHomeSnapshot(built, baseScope, "2026-08-26"), true);
  assert.equal(isCurrentHomeSnapshot(built, baseScope, "2026-08-25"), false);
});

test("stale generatedAt cannot paint as live cache", () => {
  const fresh = snapshot();
  const stale = snapshot({
    generatedAt: "2026-08-24T08:00:00.000Z",
    freshness: {
      ...snapshot().freshness,
      generatedAt: "2026-08-24T08:00:00.000Z",
    },
  });
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  assert.equal(isFreshHomeSnapshot(fresh, SNAPSHOT_MAX_AGE_MS, now), true);
  assert.equal(isFreshHomeSnapshot(stale, SNAPSHOT_MAX_AGE_MS, now), false);
  assert.equal(usableCachedHomeSnapshot(fresh, baseScope, "2026-08-25", SNAPSHOT_MAX_AGE_MS, now), true);
  assert.equal(usableCachedHomeSnapshot(stale, baseScope, "2026-08-25", SNAPSHOT_MAX_AGE_MS, now), false);
  assert.ok(snapshotAgeMs(stale, now) > SNAPSHOT_MAX_AGE_MS);
});

test("Home uses one dashboard grid, persisted snapshot, and no entrance replay", () => {
  assert.match(home, /dashboard\.pageInset/);
  assert.match(home, /DashboardSurface/);
  assert.match(home, /belowFoldReady/);
  assert.match(home, /usableCachedHomeSnapshot\(cachedSnapshot, homeScope, todayStr\)/);
  assert.match(home, /usableCachedHomeSnapshot/);
  assert.doesNotMatch(home, /placeholderData: cachedSnapshot \?\? undefined/);
  assert.doesNotMatch(home, /FadeOnChange|adjustsFontSizeToFit|CARD_RADIUS|PAGE_PAD = 16/);
  assert.match(persist, /FINANCIAL_QUERY_ROOTS\.mobileOverview/);
  assert.match(persist, /stripObsoleteFinancialQueries/);
  assert.doesNotMatch(persist, /"mobile-overview"/);
  assert.match(tabs, /animation: "none"/);
  assert.doesNotMatch(tabs, /animation: "fade"/);
  assert.match(theme, /pageInset: 16/);
  assert.match(theme, /sectionGap: 14/);
  assert.match(theme, /cardPadding: 16/);
  assert.match(theme, /cardRadius: 20/);
  assert.match(theme, /metricChipRadius: 14/);
  assert.match(theme, /from "\.\/motion"/);
});
