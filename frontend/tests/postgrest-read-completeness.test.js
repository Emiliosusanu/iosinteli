import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { acosFromSpendSales, aggregateAcos } from "../src/lib/acosContract.ts";

const queriesSrc = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const booksReadSrc = readFileSync(new URL("../src/lib/kdpBooksRead.ts", import.meta.url), "utf8");

const POSTGREST_MAX_ROWS = 1000;

class IncompleteReadError extends Error {
  constructor(message = "PostgREST read exceeded the safety page limit") {
    super(message);
    this.name = "IncompleteReadError";
    this.code = "INCOMPLETE_READ";
  }
}

/** Mirrors frontend/src/lib/queries.ts fetchAllPages. */
async function fetchAllPages(buildQuery, pageSize = POSTGREST_MAX_ROWS, opts = {}) {
  const maxPages = opts.maxPages ?? 2500;
  const rows = [];
  for (let page = 0, from = 0; ; page += 1, from += pageSize) {
    if (opts.signal?.aborted) throw new IncompleteReadError("PostgREST read aborted");
    if (page >= maxPages) throw new IncompleteReadError("PostgREST read exceeded the safety page limit");
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
}

function firstPageOnly(rows, pageSize = POSTGREST_MAX_ROWS) {
  return rows.slice(0, pageSize);
}

function makeMetricRows(count, spend, sales) {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    campaign_id: `c-${i % 67}`,
    date: "2026-08-01",
    spend,
    sales,
    orders: sales > 0 ? 1 : 0,
  }));
}

function buildPagedQuery(allRows, pageSize = POSTGREST_MAX_ROWS) {
  return async (from, to) => {
    assert.ok(to - from + 1 <= pageSize, "PostgREST cannot return more than max rows");
    return { data: allRows.slice(from, to + 1), error: null };
  };
}

test("fetchAllPages returns 999, 1000, 1001, and 2500 rows completely", async () => {
  for (const count of [999, 1000, 1001, 2500]) {
    const all = makeMetricRows(count, 1, 2);
    const got = await fetchAllPages(buildPagedQuery(all));
    assert.equal(got.length, count);
    assert.equal(got[0].id, "row-0");
    assert.equal(got[count - 1].id, `row-${count - 1}`);
  }
});

test("page boundaries do not duplicate or drop rows", async () => {
  const all = makeMetricRows(1001, 1, 2);
  const got = await fetchAllPages(buildPagedQuery(all));
  const ids = got.map((row) => row.id);
  assert.equal(new Set(ids).size, 1001);
  assert.equal(ids[999], "row-999");
  assert.equal(ids[1000], "row-1000");
});

test("same date plus many entities is not lost when order is date,campaign_id", async () => {
  const all = makeMetricRows(1064, 1, 1);
  const got = await fetchAllPages(buildPagedQuery(all));
  assert.equal(got.length, 1064);
  assert.equal(new Set(got.map((row) => row.date)).size, 1);
  assert.ok(new Set(got.map((row) => row.campaign_id)).size > 1);
});

test("1000-row cap cannot silently change a complete ACoS aggregate", async () => {
  const first1000 = makeMetricRows(1000, 2, 8);
  const remainder = makeMetricRows(64, 12.17828125, 0);
  remainder.forEach((row, i) => {
    row.id = `tail-${i}`;
  });
  const complete = [...first1000, ...remainder];
  assert.equal(complete.length, 1064);

  const truncated = aggregateAcos(firstPageOnly(complete));
  const full = aggregateAcos(await fetchAllPages(buildPagedQuery(complete)));
  const first1000Only = aggregateAcos(first1000);
  const tailOnly = aggregateAcos(remainder);

  assert.equal(truncated.spend, first1000Only.spend);
  assert.ok(tailOnly.spend > 0, "remainder must change the answer");
  assert.notEqual(truncated.spend, full.spend);
  assert.notEqual(truncated.acos, full.acos);
  assert.ok(Math.abs(full.spend - 2779.41) < 1e-6);
  assert.equal(full.sales, 8000);
  assert.equal(full.acos, acosFromSpendSales(full.spend, full.sales));
  assert.notEqual(full.acos, (first1000Only.acos + tailOnly.acos) / 2);
});

test("fetchAllPages throws instead of returning a silent partial page", async () => {
  await assert.rejects(
    () =>
      fetchAllPages(async (from) => {
        if (from === 0) return { data: makeMetricRows(1000, 1, 1), error: null };
        return { data: null, error: { message: "mid-page failed" } };
      }),
    (err) => err?.message === "mid-page failed",
  );
});

test("Home campaign_metrics range helper paginates every page", () => {
  const fn = queriesSrc.slice(
    queriesSrc.indexOf("export async function fetchCampaignMetricsRange"),
    queriesSrc.indexOf("export async function fetchCampaignMetricsForCampaign"),
  );
  assert.match(fn, /fetchAllPages/);
  assert.match(fn, /\.range\(from, to\)/);
  assert.match(fn, /chunkArray\(ids, 200\)/);
  assert.match(fn, /\.order\("date"/);
  assert.match(fn, /\.order\("campaign_id"/);
});

test("entity metric totals paginate and chunk .in() filters", () => {
  const fn = queriesSrc.slice(
    queriesSrc.indexOf("async function fetchMetricTotalsByEntity"),
    queriesSrc.indexOf("function applyMetricTotals"),
  );
  assert.match(fn, /chunkArray\(ids, 80\)/);
  assert.match(fn, /POSTGREST_PAGE_SIZE/);
  assert.match(fn, /\.range\(from, from \+ POSTGREST_PAGE_SIZE - 1\)/);
  assert.doesNotMatch(fn, /fetchAllPages/);
  assert.doesNotMatch(fn, /\.order\(/);
});

test("Books required reads paginate inside the selected-profile scope", () => {
  const fn = queriesSrc.slice(
    queriesSrc.indexOf("export async function fetchTopBooksRange"),
    queriesSrc.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.match(fn, /fetchRequiredPages/);
  assert.match(fn, /fetchAllPages/);
  assert.match(fn, /fetchOptionalInPages/);
  assert.match(queriesSrc, /const BOOKS_IN_CHUNK = 200/);
  assert.match(fn, /fetchLinkedKdpAccountIds\(profileIds\)/);
  assert.match(fn, /\.order\("date"/);
  assert.match(fn, /\.order\("asin"/);
  assert.match(booksReadSrc, /assembleLogicalBookRows/);
});

test("top and book campaign helpers paginate campaign_metrics", () => {
  const top = queriesSrc.slice(
    queriesSrc.indexOf("export async function fetchTopCampaignsRange"),
    queriesSrc.indexOf("export async function fetchBookCampaignsRange"),
  );
  const book = queriesSrc.slice(
    queriesSrc.indexOf("export async function fetchBookCampaignsRange"),
    queriesSrc.indexOf("export async function fetchTopKeywordsRange"),
  );

  assert.match(top, /fetchAllPages/);
  assert.match(top, /fetchCampaignMetricRows/);
  assert.match(book, /fetchAllPages/);
  assert.match(book, /fetchCampaignMetricRows/);
  assert.match(queriesSrc, /export class IncompleteReadError/);
  assert.match(queriesSrc, /POSTGREST_MAX_PAGES = 2500/);
});

test("fetchAllPages fails loud instead of returning a silent first-N page", async () => {
  const looping = async () => ({ data: makeMetricRows(1000, 1, 1), error: null });
  await assert.rejects(
    () => fetchAllPages(looping, 1000, { maxPages: 3 }),
    (err) => err?.name === "IncompleteReadError" && err?.code === "INCOMPLETE_READ",
  );
});

test("truncated campaign query keys are not the persisted keys", () => {
  const persistSrc = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
  assert.match(persistSrc, /top-campaigns-range-v2/);
  assert.match(persistSrc, /campaigns-list-range-v2/);
  assert.match(persistSrc, /targeting-placements-v2/);
  assert.equal(persistSrc.includes('"top-campaigns-range"'), false);
});
