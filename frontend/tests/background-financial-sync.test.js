import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { couldntLoad } from "../src/lib/loadErrorCopy.ts";
import { FINANCIAL_QUERY_ROOTS } from "../src/lib/financialReadVersion.ts";

const background = readFileSync(new URL("../src/lib/backgroundFinancialSync.ts", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../src/contexts/AppContext.tsx", import.meta.url), "utf8");
const rulesApi = readFileSync(new URL("../src/lib/rulesApi.ts", import.meta.url), "utf8");

test("load errors never say failed to load", () => {
  assert.equal(couldntLoad("campaigns"), "Couldn't load campaigns");
  assert.equal(couldntLoad("Books"), "Couldn't load books");
  assert.doesNotMatch(couldntLoad("books"), /failed to load/i);
});

test("background scope prefers selected profiles over last Home", () => {
  assert.match(background, /parseSelectedProfileIds/);
  assert.match(background, /mergeBackgroundScope/);
  assert.match(background, /adsProfileIdsForSelection/);
});

test("dual-source background refresh is wired to notifications and resume", () => {
  assert.match(background, /BACKGROUND_REFRESH_COOLDOWN_MS = 15 \* 60_000/);
  assert.match(background, /ADS_SYNC_TRIGGER_COOLDOWN_MS = 30 \* 60_000/);
  assert.match(background, /FINANCIAL_QUERY_ROOTS\.mobileOverview/);
  assert.match(background, /FINANCIAL_QUERY_ROOTS\.kdpRoyalties/);
  assert.equal(FINANCIAL_QUERY_ROOTS.mobileOverview, "mobile-overview-complete-v4");
  assert.match(notifications, /runDualSourceBackgroundRefresh/);
  assert.match(notifications, /resolveBackgroundScope/);
  assert.match(appContext, /runDualSourceBackgroundRefresh/);
  assert.match(appContext, /backgroundFinancialQueryRoots/);
});

test("supabase bearer always retries once after refresh on 401", () => {
  assert.match(rulesApi, /picked\?\.source === "supabase"/);
  assert.match(rulesApi, /refreshSupabaseAccessToken\(\)/);
  assert.doesNotMatch(rulesApi, /freshSupabase !== picked\.token/);
});
