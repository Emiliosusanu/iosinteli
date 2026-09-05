import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bookRowMatchesOpenedAsin,
  primaryAsinFromGroupKey,
} from "../src/lib/kdpBookIdentity.ts";
import {
  formatBreakEvenAcos,
  isOverBreakEven,
  pickCalculatorBreakEvenAcos,
} from "../src/lib/kdpTitlePresentation.ts";

const queriesSource = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const booksReadSource = readFileSync(new URL("../src/lib/kdpBooksRead.ts", import.meta.url), "utf8");
const persistSource = readFileSync(new URL("../src/lib/queryPersist.ts", import.meta.url), "utf8");
const productSource = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const booksSource = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");

const ALASKA_KINDLE = "B0F1G3QVF5";
const ALASKA_PAPERBACK = "B0GYW7XTXQ";
const ITALY = "B0FSSV2PRT";
const NOVA_KINDLE = "B0GX32L7YJ";
const NOVA_PAPERBACK = "B0HFKCDPVG";
const ALASKA_GROUP = "DIGITAL=B0F1G3QVF5:PRINT=B0GYW7XTXQ::";
const ITALY_GROUP = ":PRINT=B0FSSV2PRT::";
const NOVA_GROUP = "DIGITAL=B0GX32L7YJ:PRINT=B0HFKCDPVG::";
const SASH = "https://m.media-amazon.com/images/S/sash//sCxYoSS1zm8glOt.svg";
const ITALY_COVER = "https://images-na.ssl-images-amazon.com/images/P/B0FSSV2PRT._SY120_.jpg";
const ALASKA_COVER = "https://images-na.ssl-images-amazon.com/images/P/B0GYW7XTXQ._SY120_.jpg";

function emptyLogicalBook(asin) {
  return {
    asin,
    asins: new Set(),
    royalties: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    impressions: 0,
    clicks: 0,
    title: null,
    image_url: null,
    breakeven_candidates: [],
  };
}

function assembleLogicalBookRows(groups) {
  const rows = [];
  for (const [key, group] of groups) {
    try {
      if (!key || !group) continue;
      const asin = primaryAsinFromGroupKey(key, group.asins) || String(group.asin ?? "").trim().toUpperCase();
      if (!asin) continue;
      const title = typeof group.title === "string" && group.title.trim() ? group.title : null;
      const royalties = Number(group.royalties) || 0;
      const spend = Number(group.spend) || 0;
      const sales = Number(group.sales) || 0;
      rows.push({
        book_key: key,
        asin,
        sku: null,
        title,
        image_url: group.image_url,
        impressions: Number(group.impressions) || 0,
        clicks: Number(group.clicks) || 0,
        orders: Number(group.orders) || 0,
        spend,
        sales,
        royalties,
        acos: sales > 0 ? (spend / sales) * 100 : 0,
        roas: spend > 0 ? sales / spend : 0,
        net: royalties - spend,
        breakeven_acos: pickCalculatorBreakEvenAcos(group.breakeven_candidates),
      });
    } catch {
      // Skip the malformed book; keep the rest of the list.
    }
  }
  return rows;
}

function seedBook(asin, extras = {}) {
  const group = emptyLogicalBook(asin);
  group.asins.add(asin);
  Object.assign(group, extras);
  if (Array.isArray(extras.asins)) {
    group.asins = new Set(extras.asins);
  }
  return group;
}

test("production assemble stays on group_key and Kindle primary ASIN", () => {
  assert.equal(booksReadSource.includes("book_key: key"), true);
  assert.equal(booksReadSource.includes("primaryAsinFromGroupKey"), true);
  assert.equal(booksReadSource.includes("pickCalculatorBreakEvenAcos"), true);
  assert.equal(booksReadSource.includes("if (!asin) continue"), true);
});

test("leftover campaign groupKey cannot become every book's book_key", () => {
  const fetchFn = queriesSource.slice(
    queriesSource.indexOf("export async function fetchTopBooksRange"),
    queriesSource.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.equal(fetchFn.includes("book_key: groupKey"), false);
  assert.equal(fetchFn.includes("assembleLogicalBookRows"), true);
  assert.equal(fetchFn.includes("fetchAllPages"), true);
  assert.equal(fetchFn.includes("BooksReadError"), true);
  assert.equal(fetchFn.includes("onCoreRows"), true);
  assert.equal(fetchFn.includes('finalizeBook(row, "pending")'), true);
});

test("core Books query paginates and chunks large .in() filters", () => {
  assert.equal(queriesSource.includes("BOOKS_IN_CHUNK"), true);
  assert.equal(queriesSource.includes("fetchRequiredPages"), true);
  assert.equal(queriesSource.includes("fetchOptionalInPages"), true);
  assert.equal(queriesSource.includes('.order("date", { ascending: true })'), true);
});

test("Ads/cover/campaign enrichment cannot throw the whole Books list", () => {
  const fetchFn = queriesSource.slice(
    queriesSource.indexOf("export async function fetchTopBooksRange"),
    queriesSource.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.equal(fetchFn.includes('fetchOptionalInPages<any>("kdp_titles"'), true);
  assert.equal(fetchFn.includes('fetchOptionalInPages<any>("product_ads"'), true);
  assert.equal(fetchFn.includes('fetchOptionalInPages<any>("product_ad_metrics"'), true);
  assert.equal(fetchFn.includes('fetchOptionalInPages<any>("campaigns"'), true);
  assert.equal(fetchFn.includes('fetchOptionalInPages<any>("campaign_metrics"'), true);
  assert.equal(fetchFn.includes("if (titlesErr) throw titlesErr"), false);
  assert.equal(fetchFn.includes("if (adsErr) throw adsErr"), false);
  assert.equal(fetchFn.includes("if (metricsErr) throw metricsErr"), false);
});

test("selected Amazon profiles stay the Ads scope; KDP uses linked accounts", () => {
  const fetchFn = queriesSource.slice(
    queriesSource.indexOf("export async function fetchTopBooksRange"),
    queriesSource.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.equal(fetchFn.includes("fetchLinkedKdpAccountIds(profileIds)"), true);
  assert.equal(fetchFn.includes('.in("amazon_profile_id", chunk)'), true);
  assert.equal(fetchFn.includes("from(\"amazon_profiles\")"), false);
});

test("failed Books results are not persisted over a good v5 cache", () => {
  assert.equal(persistSource.includes("inteliads.queryCache.v5"), true);
  assert.equal(persistSource.includes('q.state.status === "success"'), true);
  assert.equal(persistSource.includes("FINANCIAL_QUERY_ROOTS.products"), true);
});

test("Ads-only books keep Ads metrics but do not invent KDP or Net", () => {
  assert.equal(queriesSource.includes("royalties: null"), true);
  assert.equal(queriesSource.includes('kdp_state: "missing"'), true);
  assert.equal(booksSource.includes('return { label: "Royalties unavailable"'), true);
  assert.equal(booksSource.includes("resolveBookNet"), true);
  assert.equal(productSource.includes("resolveBookNet"), true);
});

test("Italy and Alaska stay isolated with calculator BE and no invented royalties", () => {
  const groups = new Map();
  const italy = seedBook(ITALY, {
    asins: [ITALY],
    title: "Italy Travel Guide 2026: Solve Confusion With Clear Day-By-Day Plans",
    image_url: ITALY_COVER,
    royalties: 120,
    orders: 18,
    spend: 108,
    sales: 169,
    breakeven_candidates: [43.01596688350088],
  });
  const alaska = seedBook(ALASKA_PAPERBACK, {
    asins: [ALASKA_KINDLE, ALASKA_PAPERBACK],
    title: "Alaska Travel Guide 2026: Step-By-Step Road Trips",
    image_url: ALASKA_COVER,
    royalties: 400,
    orders: 40,
    spend: 475,
    sales: 1564,
    breakeven_candidates: [35.5097],
  });
  const nova = seedBook(NOVA_KINDLE, {
    asins: [NOVA_KINDLE, NOVA_PAPERBACK],
    title: "Nova Scotia Travel Guide",
    royalties: 80,
    orders: 10,
    spend: 213,
    sales: 574,
    breakeven_candidates: [],
  });
  const sash = seedBook("B0SASH0001", {
    asins: ["B0SASH0001"],
    title: { malformed: true },
    image_url: SASH,
    royalties: 1,
    orders: 1,
  });
  sash.title = { malformed: true };
  groups.set(ITALY_GROUP, italy);
  groups.set(ALASKA_GROUP, alaska);
  groups.set(NOVA_GROUP, nova);
  groups.set("B0SASH0001", sash);

  const rows = assembleLogicalBookRows(groups);
  const italyRow = rows.find((row) => row.book_key === ITALY_GROUP);
  const alaskaRow = rows.find((row) => row.book_key === ALASKA_GROUP);
  const novaRow = rows.find((row) => row.book_key === NOVA_GROUP);
  const sashRow = rows.find((row) => row.book_key === "B0SASH0001");

  assert.equal(italyRow?.title?.startsWith("Italy Travel Guide 2026"), true);
  assert.equal(italyRow?.image_url, ITALY_COVER);
  assert.equal(italyRow?.breakeven_acos, 43.02);
  assert.equal(formatBreakEvenAcos(italyRow?.breakeven_acos), "43.02%");
  assert.equal(isOverBreakEven(italyRow?.acos ?? 0, italyRow?.breakeven_acos), true);
  assert.equal(italyRow?.royalties, 120);
  assert.notEqual(italyRow?.image_url, ALASKA_COVER);

  assert.equal(alaskaRow?.asin, ALASKA_KINDLE);
  assert.equal(alaskaRow?.title?.startsWith("Alaska Travel Guide 2026"), true);
  assert.equal(alaskaRow?.breakeven_acos, 35.51);
  assert.equal(isOverBreakEven(alaskaRow?.acos ?? 0, alaskaRow?.breakeven_acos), false);
  assert.equal(bookRowMatchesOpenedAsin(alaskaRow, ALASKA_KINDLE), true);
  assert.equal(bookRowMatchesOpenedAsin(alaskaRow, ALASKA_PAPERBACK), true);
  assert.equal(bookRowMatchesOpenedAsin(alaskaRow, ITALY), false);

  assert.equal(novaRow?.breakeven_acos, 0);
  assert.equal(formatBreakEvenAcos(novaRow?.breakeven_acos), "—");
  assert.equal(isOverBreakEven(novaRow?.acos ?? 0, novaRow?.breakeven_acos), false);

  assert.equal(sashRow?.title, null);
  assert.equal(sashRow?.image_url, SASH);
});

test("one malformed book does not drop sibling Italy/Alaska rows", () => {
  const groups = new Map();
  const bad = seedBook("", { royalties: 9, orders: 1 });
  bad.asin = "";
  bad.asins = new Set();
  groups.set("", bad);
  groups.set(ITALY_GROUP, seedBook(ITALY, { asins: [ITALY], title: "Italy Travel Guide 2026", royalties: 10, orders: 1 }));
  const rows = assembleLogicalBookRows(groups);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asin, ITALY);
});

test("Ads-only fallback does not invent royalties from break-even", () => {
  const fetchFn = queriesSource.slice(
    queriesSource.indexOf("export async function fetchTopBooksRange"),
    queriesSource.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.equal(fetchFn.includes("r.sales * (r.breakeven_acos / 100)"), false);
  assert.equal(fetchFn.includes("effectiveRoyaltyRate"), false);
  assert.equal(fetchFn.includes("breakeven_acos: kdpTitle?.breakeven_acos ?? 0"), true);
});

test("Ads fallback keeps royalty-only books in the selected period", () => {
  const fetchFn = queriesSource.slice(
    queriesSource.indexOf("export async function fetchTopBooksRange"),
    queriesSource.indexOf("// ---------- Optimization Rules ----------"),
  );
  assert.equal(fetchFn.includes(".filter((r) => r.spend > 0 || r.sales > 0)"), false);
  assert.equal(fetchFn.includes(".filter(bookHasSignalInRange)"), true);
});

test("Book Detail restores title/BE from the Books row, including missing BE as em dash", () => {
  assert.equal(productSource.includes("bookRowMatchesOpenedAsin"), true);
  assert.equal(productSource.includes("formatBreakEvenAcos(book.breakeven_acos)"), true);
  assert.equal(productSource.includes("{book && book.acos > 0 ?"), false);
  assert.equal(booksSource.includes("BooksReadError"), true);
  assert.equal(booksSource.includes("Something went wrong loading your books"), true);
  assert.equal(booksSource.includes("error.stage"), false);
});
