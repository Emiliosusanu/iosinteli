import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildKdpHelperOverview } from "../src/lib/kdp/activityOverview.ts";
import { createInitialSyncState } from "../src/lib/kdp/planner.ts";
import { resolvePreferredReplayCurrency } from "../src/lib/kdp/currency.ts";

const syncScreen = readFileSync(new URL("../app/more/sync.tsx", import.meta.url), "utf8");
const importer = readFileSync(new URL("../src/lib/kdp/importer.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");

test("Sync screen shows KDP helper overview and activity", () => {
  assert.match(syncScreen, /KDP iPhone helper/);
  assert.match(syncScreen, /kdp-helper-sync-overview/);
  assert.match(syncScreen, /buildKdpHelperOverview/);
  assert.match(syncScreen, /staleTime: 30_000/);
});

test("Sync overview query avoids select(*) over wide log rows", () => {
  assert.match(queries, /PROFILE_SYNC_LOG_COLUMNS/);
  assert.match(queries, /SYNC_LOG_COLUMNS/);
  const overviewSlice = queries.slice(queries.indexOf("export async function fetchSyncOverview"));
  assert.doesNotMatch(overviewSlice.slice(0, 800), /\.select\("\*"\)/);
});

test("importer resolves currency with Ads profiles first and appends activity", () => {
  assert.match(importer, /resolvePreferredReplayCurrency/);
  assert.match(importer, /appendKdpActivity/);
  assert.match(importer, /Night backfill completed/);
  assert.match(importer, /Replay currency \$\{preferredCurrency\}/);
});

test("overview rows surface 15 min sync, nightly seal, and currency", () => {
  const nowMs = Date.parse("2026-09-03T10:00:00.000Z");
  const state = {
    ...createInitialSyncState(),
    onboardingDone: true,
    milestone30Done: true,
    lastSteadyAtMs: nowMs - 8 * 60_000,
    lastNightlyYmd: "2026-09-03",
  };
  const rows = buildKdpHelperOverview({
    state,
    deferredDays: [],
    currency: "USD",
    nowMs,
  });
  assert.equal(rows.find((r) => r.id === "currency")?.title, "Replay currency USD");
  assert.match(rows.find((r) => r.id === "steady")?.detail || "", /Completed/);
  assert.match(rows.find((r) => r.id === "nightly")?.title || "", /Night backfill completed/);
  assert.match(rows.find((r) => r.id === "nightly")?.detail || "", /30 days/);
});

test("Ads EUR profile wins over previously saved USD", () => {
  assert.equal(
    resolvePreferredReplayCurrency({
      profiles: [{ currency_code: "EUR" }],
      templates: {
        royalties: {
          url: "https://kdpreports.amazon.com/x?preferredCurrency=USD",
          requestBody: null,
        },
      },
      saved: "USD",
    }),
    "EUR",
  );
  assert.equal(
    resolvePreferredReplayCurrency({
      profiles: [{ currency_code: "USD" }],
      templates: {},
      saved: null,
    }),
    "USD",
  );
  assert.equal(
    resolvePreferredReplayCurrency({
      profiles: [],
      templates: {},
      saved: null,
    }),
    "USD",
  );
});
