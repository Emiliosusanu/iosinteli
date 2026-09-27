import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  aggregateBookDailyToAccountDays,
  buildQuarantineEntries,
  detectCrossAccountAsins,
  filterRowsExcludingQuarantine,
  fullyQuarantinedAccountIds,
  isQuarantined,
  makeQuarantineDoc,
  parseQuarantineDoc,
  pickCanonicalOwner,
  quarantineEntriesEqual,
} from "../src/lib/kdp/shelfHeal.ts";

const EMI = "cd8a3da4-emi-account";
const VP1 = "vp-test-1-account";
const VP2 = "vp-2-account";
const ASIN_A = "B0F8QGHL3P";
const ASIN_B = "B0FW468FBB";
const ASIN_MARY = "B0MARY0001";

test("detectCrossAccountAsins finds ASIN holders with len ≥ 2", () => {
  const map = detectCrossAccountAsins([
    { account_id: EMI, asin: ASIN_A },
    { account_id: VP1, asin: ASIN_A },
    { account_id: VP2, asin: ASIN_A },
    { account_id: EMI, asin: ASIN_B },
    { account_id: EMI, asin: ASIN_MARY },
  ]);
  assert.deepEqual(map.get(ASIN_A), [EMI, VP1, VP2].sort());
  assert.equal(map.has(ASIN_B), false);
  assert.equal(map.has(ASIN_MARY), false);
});

test("Ads overlap wins canonical — losers quarantined", () => {
  const titles = [
    { account_id: EMI, asin: ASIN_A, updated_at: "2026-01-10T00:00:00Z" },
    { account_id: VP1, asin: ASIN_A, updated_at: "2026-01-01T00:00:00Z" },
    { account_id: VP2, asin: ASIN_A, updated_at: "2026-01-02T00:00:00Z" },
    { account_id: EMI, asin: ASIN_B, updated_at: "2026-01-10T00:00:00Z" },
    { account_id: VP1, asin: ASIN_B, updated_at: "2026-01-01T00:00:00Z" },
  ];
  const entries = buildQuarantineEntries({
    titles,
    adsOverlapByAsin: {
      [ASIN_A]: [EMI],
      [ASIN_B]: [EMI],
    },
    earliestAdsProofByAccountId: { [EMI]: "2025-12-01T00:00:00Z" },
    liveHelperAccountId: VP1,
    liveHelperCatalogAsins: [ASIN_A, ASIN_B],
  });

  assert.equal(entries.length, 3);
  assert.ok(entries.every((e) => e.canonical_account_id === EMI));
  assert.ok(entries.every((e) => e.rule === "ads_overlap"));
  assert.ok(entries.every((e) => e.reason === "cross_account_duplicate"));
  assert.ok(isQuarantined(VP1, ASIN_A, entries));
  assert.ok(isQuarantined(VP2, ASIN_A, entries));
  assert.ok(isQuarantined(VP1, ASIN_B, entries));
  assert.equal(isQuarantined(EMI, ASIN_A, entries), false);
});

test("live_helper wins when no Ads overlap", () => {
  const picked = pickCanonicalOwner({
    asin: ASIN_A,
    holderAccountIds: [VP1, EMI],
    adsOverlapAccountIds: [],
    liveHelperAccountId: EMI,
    titleUpdatedAtByAccountId: {
      [VP1]: "2026-01-01T00:00:00Z",
      [EMI]: "2026-02-01T00:00:00Z",
    },
  });
  assert.equal(picked?.canonicalAccountId, EMI);
  assert.equal(picked?.rule, "live_helper");
});

test("first_ads_proof / earliest updated_at tie-break", () => {
  const picked = pickCanonicalOwner({
    asin: ASIN_A,
    holderAccountIds: [VP1, VP2],
    adsOverlapAccountIds: [],
    titleUpdatedAtByAccountId: {
      [VP2]: "2026-01-01T00:00:00Z",
      [VP1]: "2026-02-01T00:00:00Z",
    },
  });
  assert.equal(picked?.canonicalAccountId, VP2);
  assert.equal(picked?.rule, "first_ads_proof");
});

test("Overview filter math: book-daily exclude quarantine then account-day sum", () => {
  const entries = buildQuarantineEntries({
    titles: [
      { account_id: EMI, asin: ASIN_A },
      { account_id: VP1, asin: ASIN_A },
    ],
    adsOverlapByAsin: { [ASIN_A]: [EMI] },
  });
  const bookDays = [
    { account_id: EMI, date: "2026-09-01", asin: ASIN_A, royalties: 10, orders: 1 },
    { account_id: VP1, date: "2026-09-01", asin: ASIN_A, royalties: 10, orders: 1 },
    { account_id: VP1, date: "2026-09-01", asin: ASIN_MARY, royalties: 5, orders: 1 },
  ];
  const kept = filterRowsExcludingQuarantine(bookDays, entries);
  assert.equal(kept.length, 2);
  const accountDays = aggregateBookDailyToAccountDays(kept);
  const day = accountDays.find((r) => r.account_id === EMI && r.date === "2026-09-01");
  const vpDay = accountDays.find((r) => r.account_id === VP1 && r.date === "2026-09-01");
  assert.equal(day?.royalties, 10);
  assert.equal(vpDay?.royalties, 5);
  assert.equal(
    accountDays.reduce((s, r) => s + r.royalties, 0),
    15,
    "poisoned VP copy of ASIN_A must not double-count",
  );
});

test("idempotent rebuild: same entries compare equal ignoring updated_at", () => {
  const titles = [
    { account_id: EMI, asin: ASIN_A },
    { account_id: VP1, asin: ASIN_A },
  ];
  const a = buildQuarantineEntries({
    titles,
    adsOverlapByAsin: { [ASIN_A]: [EMI] },
  });
  const b = buildQuarantineEntries({
    titles,
    adsOverlapByAsin: { [ASIN_A]: [EMI] },
  });
  assert.ok(quarantineEntriesEqual(a, b));
  const docA = makeQuarantineDoc(a, "2026-09-01T00:00:00Z");
  const docB = makeQuarantineDoc(b, "2026-09-10T00:00:00Z");
  assert.ok(quarantineEntriesEqual(docA.entries, docB.entries));
  const parsed = parseQuarantineDoc(docA);
  assert.equal(parsed?.version, 1);
  assert.equal(parsed?.entries.length, 1);
});

test("fully quarantined shelf identified for optional Ads pause", () => {
  const titles = [
    { account_id: EMI, asin: ASIN_A },
    { account_id: VP1, asin: ASIN_A },
    { account_id: VP1, asin: ASIN_B },
    { account_id: EMI, asin: ASIN_B },
  ];
  const entries = buildQuarantineEntries({
    titles,
    adsOverlapByAsin: { [ASIN_A]: [EMI], [ASIN_B]: [EMI] },
  });
  const poisoned = fullyQuarantinedAccountIds({
    titles,
    entries,
    protectAccountIds: [EMI],
  });
  assert.deepEqual(poisoned, [VP1]);
});

test("never uses title strings — only ASIN keys in heal module", () => {
  const heal = readFileSync(new URL("../src/lib/kdp/shelfHeal.ts", import.meta.url), "utf8");
  assert.doesNotMatch(heal, /titleName|book_title|title\s*===|title\.localeCompare/);
  assert.match(heal, /normalizeAsin|uniqueNormalizedAsins/);
});

test("shelf heal helper exists; queries exclude quarantine", () => {
  const runHeal = readFileSync(new URL("../src/lib/kdp/runShelfHeal.ts", import.meta.url), "utf8");
  const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/lib/kdp/shelfHealStore.ts", import.meta.url), "utf8");
  assert.match(runHeal, /export function runShelfHealBestEffort/);
  assert.match(runHeal, /export async function runShelfHeal/);
  assert.match(queries, /loadShelfHealQuarantineEntries|kdp\/shelfHeal/);
  assert.match(queries, /filterRowsExcludingQuarantine/);
  assert.match(queries, /aggregateBookDailyToAccountDays/);
  assert.match(queries, /kdp_book_daily_data_quarantine/);
  assert.match(store, /kdp_asin_quarantine/);
  assert.match(store, /saveUserSetting/);
  assert.doesNotMatch(runHeal, /\.from\(["']kdp_(?:titles|daily_data|book_daily_data)["']\)\s*\.delete/);
});
