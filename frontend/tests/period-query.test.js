import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HOME_PERIOD_QUERY_CACHE,
  noPeriodPlaceholder,
  periodFinancePending,
  periodQueryKey,
  periodQueryPending,
  periodQueryRefreshing,
} from "../src/lib/periodQuery.ts";
import { syncChrome } from "../src/lib/motion.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

test("period query cache blocks global keepPreviousData", () => {
  assert.equal(typeof HOME_PERIOD_QUERY_CACHE.placeholderData, "function");
  assert.equal(noPeriodPlaceholder(), undefined);
  assert.equal(HOME_PERIOD_QUERY_CACHE.refetchOnMount, "always");
  assert.equal(HOME_PERIOD_QUERY_CACHE.staleTime, 30_000);
});

test("periodQueryKey binds profile and date identity", () => {
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

test("Home wires period isolation, motion, and live refetch", () => {
  assert.match(home, /from "@\/src\/lib\/periodQuery"/);
  assert.match(home, /periodFinancePending/);
  assert.match(home, /periodQueryKey/);
  assert.match(home, /HorizonPane watchKey=\{activePeriodKey\}/);
  assert.match(home, /Updating…/);
  assert.match(home, /syncing: syncActive/);
  assert.doesNotMatch(home, /placeholderData: undefined/);
});
