import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HOME_PERIOD_QUERY_CACHE,
  LIST_PERIOD_QUERY_CACHE,
  STABLE_SCOPED_CACHE,
  financialPeriodQueryKey,
  noPeriodPlaceholder,
  periodFinancePending,
  periodQueryKey,
  periodQueryPending,
  periodQueryRefreshing,
  sameScopeWarmPlaceholder,
  sortedProfileIds,
} from "../src/lib/periodQuery.ts";
import { syncChrome } from "../src/lib/motion.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const campaigns = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
const products = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const glass = readFileSync(new URL("../src/components/GlassPanel.tsx", import.meta.url), "utf8");
const tabBar = readFileSync(new URL("../src/components/FloatingTabBar.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/components/OverviewHeaderV3.tsx", import.meta.url), "utf8");
const snapshotLib = readFileSync(new URL("../src/lib/mobileHomeSnapshot.ts", import.meta.url), "utf8");

test("period query cache blocks cross-key placeholders", () => {
  assert.equal(typeof HOME_PERIOD_QUERY_CACHE.placeholderData, "function");
  assert.equal(noPeriodPlaceholder(), undefined);
  assert.equal(HOME_PERIOD_QUERY_CACHE.refetchOnMount, "always");
  assert.equal(HOME_PERIOD_QUERY_CACHE.staleTime, 30_000);
  assert.equal(LIST_PERIOD_QUERY_CACHE.refetchOnMount, "always");
  assert.equal(LIST_PERIOD_QUERY_CACHE.staleTime, 45_000);
  assert.equal(STABLE_SCOPED_CACHE.placeholderData, noPeriodPlaceholder);
});

test("sameScopeWarmPlaceholder never invents rows", () => {
  assert.equal(sameScopeWarmPlaceholder(undefined), undefined);
  assert.equal(sameScopeWarmPlaceholder(null), undefined);
  assert.deepEqual(sameScopeWarmPlaceholder([{ id: "1" }]), [{ id: "1" }]);
});

test("sortedProfileIds stabilizes cache identity", () => {
  assert.deepEqual(sortedProfileIds(["b", "a", ""]), ["a", "b"]);
  assert.equal(
    periodQueryKey({ start: "2026-08-01", end: "2026-08-27" }, ["b", "a"]),
    "2026-08-01|2026-08-27|a,b",
  );
});

test("periodQueryPending treats placeholder rows as loading", () => {
  assert.equal(
    periodQueryPending({ isPending: false, isError: false, data: [{ id: 1 }], isPlaceholderData: true }),
    true,
  );
  assert.equal(
    periodQueryPending({ isPending: true, isError: false, data: null }),
    true,
  );
  assert.equal(
    periodQueryPending({ isPending: false, isError: false, data: [{ id: 1 }] }),
    false,
  );
});

test("periodFinancePending waits for both metrics and royalties", () => {
  const ready = { isPending: false, isError: false, data: [] };
  const waiting = { isPending: true, isError: false, data: null };
  assert.equal(periodFinancePending(ready, ready), false);
  assert.equal(periodFinancePending(waiting, ready), true);
  assert.equal(periodFinancePending(ready, waiting), true);
});

test("periodQueryRefreshing is true only for settled background refetch", () => {
  assert.equal(
    periodQueryRefreshing({ isFetching: true, isFetched: true, isError: false }),
    true,
  );
  assert.equal(
    periodQueryRefreshing({ isFetching: true, isFetched: false, isError: false, isPlaceholderData: true }),
    false,
  );
});

test("sync chrome separates dashboard refresh from Amazon sync", () => {
  assert.equal(
    syncChrome({ failedRefresh: false, refreshing: false, syncing: true, stale: false, warning: false }).compact,
    "Syncing",
  );
  assert.equal(
    syncChrome({ failedRefresh: false, refreshing: true, syncing: true, stale: false, warning: false }).compact,
    "Refreshing",
  );
});

test("global QueryClient does not keep previous query rows as placeholders", () => {
  assert.doesNotMatch(layout, /from "@tanstack\/react-query".*keepPreviousData|keepPreviousData,/);
  assert.doesNotMatch(layout, /placeholderData:\s*keepPreviousData/);
});

test("Campaigns and Books never reuse a previous period's list", () => {
  assert.doesNotMatch(campaigns, /placeholderData:\s*\(previous\)/);
  assert.match(campaigns, /sameScopeWarmPlaceholder/);
  assert.match(campaigns, /LIST_PERIOD_QUERY_CACHE/);
  assert.match(products, /sameScopeWarmPlaceholder/);
  assert.match(products, /LIST_PERIOD_QUERY_CACHE/);
  assert.match(products, /sortedProfileIds/);
});

test("Home wires period isolation, motion, and live refetch", () => {
  assert.match(home, /from "@\/src\/lib\/periodQuery"/);
  assert.match(home, /periodFinancePending/);
  assert.match(home, /financialPeriodQueryKey/);
  assert.match(home, /HorizonPane watchKey=\{activePeriodKey\}/);
  assert.match(home, /Updating…/);
  assert.match(home, /syncing: syncActive/);
  assert.match(home, /sortedProfileIds/);
  assert.match(home, /LIST_PERIOD_QUERY_CACHE/);
  assert.doesNotMatch(home, /placeholderData: undefined/);
  assert.match(home, /usableCachedHomeSnapshot\(cachedSnapshot, homeScope, todayStr\)/);
});

test("financialPeriodQueryKey includes sorted profiles period and currency", () => {
  assert.equal(
    financialPeriodQueryKey({ start: "2026-08-01", end: "2026-08-27" }, ["b", "a"], "eur"),
    "2026-08-01|2026-08-27|a,b|EUR",
  );
  assert.notEqual(
    financialPeriodQueryKey({ start: "2026-08-01", end: "2026-08-27" }, ["a"], "USD"),
    financialPeriodQueryKey({ start: "2026-08-01", end: "2026-08-27" }, ["a"], "GBP"),
  );
  assert.equal(periodQueryKey({ start: "2026-08-01", end: "2026-08-27" }, ["b", "a"]), "2026-08-01|2026-08-27|a,b");
});

test("Overview financial query keys bind sorted profiles and currency", () => {
  assert.match(home, /campaignMetrics, scopeProfiles, dateRange\.start, dateRange\.end, primaryCurrency/);
  assert.match(home, /kdpRoyalties, royaltyProfiles, dateRange\.start, dateRange\.end, primaryCurrency/);
  assert.match(campaigns, /dateRange\.end,\s*primaryCurrency/);
  assert.match(products, /dateRange\.end,\s*primaryCurrency/);
  assert.match(targeting, /financialPeriodQueryKey\(dateRange, scopeProfiles, primaryCurrency\)/);
});

test("list screens tune FlatList virtualization windows", () => {
  assert.match(campaigns, /initialNumToRender=\{16\}/);
  assert.match(campaigns, /windowSize=\{7\}/);
  assert.match(products, /maxToRenderPerBatch=\{20\}/);
  assert.match(targeting, /TargetingListSeparator/);
});

test("chrome keeps one live blur; scroll cards and tab bar do not stack BlurViews", () => {
  assert.match(glass, /strength === "chrome"/);
  assert.doesNotMatch(tabBar, /BlurView/);
  assert.match(header, /withRepeat/);
  assert.match(header, /cancelAnimation/);
  assert.match(snapshotLib, /snapCurrency !== scopeCurrency/);
});
