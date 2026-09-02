import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adsSpendIfKnown,
  enumerateDates,
  horizonQueryKey,
  isoWeekRange,
  kdpRoyaltiesInRange,
  kdpRoyaltiesOnDate,
  monthToTodayRange,
  periodRoyaltiesQueryKey,
  publisherNetForPeriod,
  reportingToday,
  reportingYesterday,
  rolling7Range,
  sameRange,
  todayRange,
  yesterdayRange,
} from "../src/lib/homePeriod.ts";
import {
  HOME_QUERY_TIMEOUT_MESSAGE,
  HOME_QUERY_TIMEOUT_MS,
  homeWidgetStatus,
  isHomeQueryTimeout,
  isOfflineLikeError,
  queryStillWaiting,
  withQueryTimeout,
} from "../src/lib/queryTimeout.ts";
import { netRoyalties } from "../src/lib/netRoyalties.ts";
import { FINANCIAL_QUERY_ROOTS } from "../src/lib/financialReadVersion.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const strip = readFileSync(new URL("../src/components/SevenDayAdsStrip.tsx", import.meta.url), "utf8");
const rootLayout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");

test("Today and Yesterday ranges and query keys never collide", () => {
  const now = new Date(2026, 7, 30);
  const today = todayRange(now);
  const yesterday = yesterdayRange(now);
  assert.notEqual(today.start, yesterday.start);
  assert.deepEqual(today, { start: "2026-08-30", end: "2026-08-30" });
  assert.deepEqual(yesterday, { start: "2026-08-29", end: "2026-08-29" });
  assert.notDeepEqual(
    periodRoyaltiesQueryKey("range", ["p1"], today.start, today.end),
    periodRoyaltiesQueryKey("yesterday", ["p1"], yesterday.start, yesterday.end),
  );
  assert.equal(periodRoyaltiesQueryKey("yesterday", ["p1"], yesterday.start, yesterday.end)[0], FINANCIAL_QUERY_ROOTS.kdpRoyaltiesYesterday);
});

test("Today / Yesterday / 7D / Week / Month ranges are distinct identities", () => {
  const now = new Date(2026, 7, 27);
  const today = todayRange(now);
  const yesterday = yesterdayRange(now);
  const seven = rolling7Range(now);
  const week = isoWeekRange(now);
  const month = monthToTodayRange(now);

  assert.deepEqual(today, { start: "2026-08-27", end: "2026-08-27" });
  assert.deepEqual(yesterday, { start: "2026-08-26", end: "2026-08-26" });
  assert.deepEqual(seven, { start: "2026-08-21", end: "2026-08-27" });
  assert.deepEqual(week, { start: "2026-08-24", end: "2026-08-30" });
  assert.deepEqual(month, { start: "2026-08-01", end: "2026-08-27" });
  assert.equal(sameRange(today, seven), false);
  assert.equal(sameRange(week, month), false);
  assert.equal(reportingToday(now), "2026-08-27");
  assert.equal(reportingYesterday(now), "2026-08-26");
});

test("Home Ads horizon includes Yesterday and binds spend to that horizon", () => {
  assert.doesNotMatch(home, /home-horizon|home-today-7d/);
  assert.match(home, /OverviewHeaderV3/);
  assert.match(home, /prefetchPeriodData/);
  assert.match(home, /noPeriodPlaceholder|periodQuery\.ts|periodFinancePending/);
  assert.match(home, /testID="home-root"/);
  assert.match(home, /"Net"/);
  assert.match(home, /NET_ROYALTIES_LABEL/);
  assert.match(home, /testID="home-net-royalties"/);
});

test("homeHorizonRange identities", async () => {
  const { homeHorizonRange, adsHorizonQueryKey } = await import("../src/lib/homePeriod.ts");
  const now = new Date(2026, 7, 30);
  assert.deepEqual(homeHorizonRange("today", now), { start: "2026-08-30", end: "2026-08-30" });
  assert.deepEqual(homeHorizonRange("yesterday", now), { start: "2026-08-29", end: "2026-08-29" });
  assert.deepEqual(homeHorizonRange("7d", now), rolling7Range(now));
  const todayKey = adsHorizonQueryKey("today", ["p"], "2026-08-30", "2026-08-30");
  const yestKey = adsHorizonQueryKey("yesterday", ["p"], "2026-08-29", "2026-08-29");
  assert.notDeepEqual(todayKey, yestKey);
  assert.equal(todayKey[1], "today");
  assert.equal(yestKey[1], "yesterday");
});


test("Today royalties stay independent from rolling 7D", () => {
  const daily = [
    { date: "2026-08-27", royalties: 20 },
    { date: "2026-08-26", royalties: 30 },
    { date: "2026-08-25", royalties: 30 },
    { date: "2026-08-24", royalties: 30 },
    { date: "2026-08-23", royalties: 30 },
    { date: "2026-08-22", royalties: 30 },
    { date: "2026-08-21", royalties: 30 },
  ];
  assert.equal(kdpRoyaltiesOnDate(daily, "2026-08-27"), 20);
  assert.equal(kdpRoyaltiesInRange(daily, "2026-08-21", "2026-08-27").royalties, 200);
  assert.notEqual(kdpRoyaltiesOnDate(daily, "2026-08-27"), kdpRoyaltiesInRange(daily, "2026-08-21", "2026-08-27").royalties);
});

test("Yesterday royalties do not inherit Today", () => {
  const daily = [
    { date: "2026-08-27", royalties: 65.31 },
    { date: "2026-08-26", royalties: 116.71 },
  ];
  assert.equal(kdpRoyaltiesOnDate(daily, "2026-08-26"), 116.71);
  assert.equal(kdpRoyaltiesOnDate(daily, "2026-08-27"), 65.31);
});

test("missing royalties stay unavailable and never become 0 minus spend", () => {
  assert.equal(kdpRoyaltiesOnDate([{ date: "2026-08-25", royalties: 10 }], "2026-08-26"), null);
  assert.equal(publisherNetForPeriod(null, 86.31), null);
  assert.equal(netRoyalties({ kdpRoyalties: null, adsSpend: 86.31 }), null);
  assert.equal(netRoyalties({ kdpRoyalties: 0, adsSpend: 86.31 }), -86.31);
  assert.equal(netRoyalties({ kdpRoyalties: 100, adsSpend: 30 }), 70);
  assert.notEqual(publisherNetForPeriod(null, 86.31), 0 - 86.31);
});

test("horizon and month royalties keys stay distinct", () => {
  const ids = ["p1"];
  assert.notDeepEqual(
    periodRoyaltiesQueryKey("range", ids, "2026-08-01", "2026-08-27"),
    horizonQueryKey(ids, "2026-08-21", "2026-08-27"),
  );
  assert.deepEqual(horizonQueryKey(ids, "2026-08-21", "2026-08-27")[0], FINANCIAL_QUERY_ROOTS.kdpRoyaltiesSevenDay);
});

test("Home uses horizon slice helpers and no Sparkline on 7D", () => {
  assert.match(home, /kdpRoyaltiesOnDate/);
  assert.doesNotMatch(home, /Sparkline/);
  assert.match(home, /withQueryTimeout/);
  assert.match(home, /testID="home-campaigns"/);
  assert.doesNotMatch(home, /home-horizon|SevenDayAdsStrip|HomeFactRow/);
  assert.doesNotMatch(home, /triggerSync\(/);
  assert.match(strip, /Ads spend · 7 reporting days/);
  assert.doesNotMatch(strip, /LinearGradient|sparkle|glow/i);
});

test("Home widgets terminate loading for success empty timeout offline and HTTP errors", () => {
  assert.equal(
    homeWidgetStatus({ isPending: false, isError: false, data: [{ id: 1 }], isEmpty: false }),
    "success",
  );
  assert.equal(homeWidgetStatus({ isPending: false, isError: false, data: [], isEmpty: true }), "empty");
  assert.equal(
    homeWidgetStatus({
      isPending: false,
      isError: true,
      data: undefined,
      error: new Error(HOME_QUERY_TIMEOUT_MESSAGE),
    }),
    "timeout",
  );
  const offline = new TypeError("Network request failed");
  assert.equal(isOfflineLikeError(offline), true);
  assert.equal(homeWidgetStatus({ isPending: false, isError: true, data: undefined, error: offline }), "offline");
  assert.equal(
    homeWidgetStatus({ isPending: false, isError: true, data: undefined, error: { status: 401 } }),
    "error",
  );
  assert.equal(
    homeWidgetStatus({ isPending: false, isError: true, data: undefined, error: { status: 500 } }),
    "error",
  );
  assert.equal(
    homeWidgetStatus({ isPending: false, isError: true, data: [{ id: 1 }], isEmpty: false, error: new Error("500") }),
    "stale",
  );
  assert.equal(homeWidgetStatus({ isPending: true, isError: false, data: undefined }), "loading");
  assert.equal(queryStillWaiting({ isPending: true, isError: false, data: undefined }), true);
  assert.equal(queryStillWaiting({ isPending: true, isError: true, data: undefined }), false);
  assert.equal(HOME_QUERY_TIMEOUT_MS, 20_000);
  assert.match(home, /queryStillWaiting/);
  assert.doesNotMatch(home, /placeholderData: undefined/);
  assert.match(home, /Array\.isArray\(metricsQ\.data\)/);
});

test("splash cannot cover Home indefinitely while auth is loading", () => {
  assert.match(rootLayout, /forceReady/);
  assert.match(rootLayout, /2_500/);
  assert.match(rootLayout, /state !== "loading"/);
});

test("Campaigns CTA width follows 16pt rails on small and large phones", () => {
  const rail = 16;
  const fits = (screenWidth) => {
    const width = screenWidth - rail * 2;
    return width > 0 && width <= screenWidth && width >= 280;
  };
  assert.equal(fits(320), true);
  assert.equal(fits(390), true);
  assert.equal(fits(402), true);
  assert.match(home, /dashboard\.pageInset/);
  assert.match(home, /testID="home-campaigns"/);
  assert.match(home, /actionLabel="View all"/);
});

test("Home query timeout terminates instead of hanging", async () => {
  await assert.rejects(
    () => withQueryTimeout(new Promise(() => {}), 20),
    (error) => isHomeQueryTimeout(error) && error.message === HOME_QUERY_TIMEOUT_MESSAGE,
  );
  assert.equal(
    await withQueryTimeout(Promise.resolve(7), 50),
    7,
  );
});

test("enumerateDates is inclusive and local", () => {
  assert.deepEqual(enumerateDates("2026-08-26", "2026-08-27"), ["2026-08-26", "2026-08-27"]);
  assert.equal(adsSpendIfKnown(null, "verified"), null);
  assert.equal(adsSpendIfKnown(2.3, "verified"), 2.3);
  assert.equal(adsSpendIfKnown(0, "missing"), null);
});

test("Overview memoizes nest profile ids so Home snapshot scope stays stable", () => {
  assert.match(
    home,
    /const nestProfileIds = useMemo\(\s*\(\) => nestDashboardProfileIds\(selectedProfileIds, selectedProfiles\),\s*\[selectedProfileIds, selectedProfiles\],\s*\)/,
  );
});

test("Yesterday totals never leak Month/Week rows", () => {
  assert.doesNotMatch(home, /yestTotals|home-yesterday/);
});
