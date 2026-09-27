import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isScopeBoundQueryKey,
  shouldRevalidateHomeOnVisit,
  SCOPE_BOUND_QUERY_PREFIXES,
} from "../src/lib/scopeRefresh.ts";
import { FINANCIAL_QUERY_ROOTS } from "../src/lib/financialReadVersion.ts";
import { HOME_PERIOD_QUERY_CACHE } from "../src/lib/periodQuery.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const create = readFileSync(new URL("../app/campaign/create.tsx", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const background = readFileSync(new URL("../src/lib/backgroundFinancialSync.ts", import.meta.url), "utf8");

test("scope-bound prefixes cover Gross, Create, and filter roots", () => {
  assert.ok(SCOPE_BOUND_QUERY_PREFIXES.includes(FINANCIAL_QUERY_ROOTS.campaignMetrics));
  assert.ok(SCOPE_BOUND_QUERY_PREFIXES.includes(FINANCIAL_QUERY_ROOTS.kdpRoyalties));
  assert.ok(isScopeBoundQueryKey("campaign-creation-books"));
  assert.ok(isScopeBoundQueryKey("campaign-creation-marketplaces"));
  assert.ok(isScopeBoundQueryKey("mobile-targeting-page-v1"));
  assert.equal(isScopeBoundQueryKey("nest-token"), false);
});

test("home revisit revalidates after the period stale window", () => {
  const now = 1_000_000;
  assert.equal(shouldRevalidateHomeOnVisit(now - 1_000, now, HOME_PERIOD_QUERY_CACHE.staleTime), false);
  assert.equal(
    shouldRevalidateHomeOnVisit(now - HOME_PERIOD_QUERY_CACHE.staleTime, now, HOME_PERIOD_QUERY_CACHE.staleTime),
    true,
  );
});

test("Overview refetches on tab focus and softens Updating… to partial pending", () => {
  assert.match(home, /shouldRevalidateHomeOnVisit/);
  assert.match(home, /periodFinancePartialPending/);
  assert.match(home, /wasHomeVisibleRef/);
});

test("profile chip and date range invalidate scope-bound queries", () => {
  const scopeRefresh = readFileSync(new URL("../src/lib/scopeRefresh.ts", import.meta.url), "utf8");
  assert.match(scopeRefresh, /export function invalidateScopeBoundQueries/);
  assert.match(appContext, /setSelectedProfileIds/);
  assert.match(appContext, /invalidateQueries|scopeRefresh|SCOPE_BOUND|queryClient/);
});

test("resume invalidates period campaign metrics not only today", () => {
  assert.match(background, /FINANCIAL_QUERY_ROOTS\.campaignMetrics/);
  assert.match(background, /FINANCIAL_QUERY_ROOTS\.kdpRoyalties/);
});

test("Create clears suggestion meta on book/marketplace change and refetches on focus", () => {
  assert.match(create, /suggestionMetaGenRef/);
  assert.match(create, /setSuggestionMetaByAsin\(\{\}\)/);
  assert.match(create, /useFocusEffect/);
  assert.match(create, /gen !== suggestionMetaGenRef\.current/);
  assert.match(create, /setLiveStockByAsin\(\{\}\)/);
});

test("home snapshot remount always revalidates", () => {
  assert.match(home, /refetchOnMount:\s*"always"/);
});
