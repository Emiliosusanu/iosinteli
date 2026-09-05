import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ADS_SALES_LABEL,
  KDP_ROYALTIES_LABEL,
  NET_ROYALTIES_CAPTION,
  NET_ROYALTIES_LABEL,
  netRoyalties,
  netRoyaltiesKnown,
  netRoyaltiesVoiceOver,
  resolveBookNet,
  bookNetIsKnown,
} from "../src/lib/netRoyalties.ts";

const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const books = readFileSync(new URL("../app/(tabs)/products.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/product/[asin].tsx", import.meta.url), "utf8");
const assemble = readFileSync(new URL("../src/lib/kdpBooksRead.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/lib/dashboardApi.ts", import.meta.url), "utf8");

test("resolveBookNet uses royalties minus spend when net field is missing", () => {
  const row = {
    royalties: 120,
    spend: 45,
    net: null,
    ads_state: "ready",
    kdp_state: "partial",
  };
  assert.equal(resolveBookNet(row), 75);
  assert.equal(bookNetIsKnown(row), true);
});

test("net royalties is KDP royalties minus Ads spend", () => {
  assert.equal(netRoyalties({ kdpRoyalties: 100, adsSpend: 30 }), 70);
  assert.equal(netRoyaltiesKnown(100, 30), 70);
  assert.equal(netRoyalties({ kdpRoyalties: 30, adsSpend: 100 }), -70);
  assert.equal(netRoyalties({ kdpRoyalties: 0, adsSpend: 20 }), -20);
});

test("unavailable royalties never become adsSales minus spend", () => {
  assert.equal(netRoyalties({ kdpRoyalties: null, adsSpend: 20 }), null);
  assert.equal(netRoyalties({ kdpRoyalties: undefined, adsSpend: 20, adsSales: 500 }), null);
  assert.equal(netRoyalties({ kdpRoyalties: Number.NaN, adsSpend: 20 }), null);
});

test("ads sales cannot become the net royalties input", () => {
  assert.equal(netRoyalties({ kdpRoyalties: 100, adsSpend: 30, adsSales: 500 }), 70);
  assert.notEqual(netRoyalties({ kdpRoyalties: 100, adsSpend: 30, adsSales: 500 }), 500 - 30);
  assert.equal(NET_ROYALTIES_LABEL, "Net Royalties");
  assert.match(NET_ROYALTIES_CAPTION, /KDP royalties minus Amazon Ads spend/);
  assert.equal(KDP_ROYALTIES_LABEL, "KDP royalties");
  assert.equal(ADS_SALES_LABEL, "Amazon Ads sales");
});

test("VoiceOver names the three money domains", () => {
  assert.match(
    netRoyaltiesVoiceOver({
      kdpRoyalties: "116.71",
      adsSpend: "74.00",
      netRoyalties: "42.71",
      adsSales: "200.00",
    }),
    /KDP royalties, 116\.71.*Amazon Ads spend, 74\.00.*Net Royalties, 42\.71.*Amazon Ads sales, 200\.00/,
  );
});

test("live publisher-net surfaces use the contract helper and label", () => {
  assert.match(home, /NET_ROYALTIES_LABEL/);
  assert.match(home, /netRoyaltiesVoiceOver/);
  assert.match(books, /NET_ROYALTIES_LABEL/);
  assert.match(books, /resolveBookNet/);
  assert.match(detail, /resolveBookNet/);
  assert.match(detail, /netRoyaltiesVoiceOver/);
  assert.match(assemble, /netRoyaltiesKnown/);
  assert.match(dashboard, /netRoyaltiesKnown/);
  assert.match(home, /netRoyaltiesKnown/);
  assert.match(home, /"Net"/);
  assert.match(home, /NET_ROYALTIES_LABEL/);
  assert.doesNotMatch(books, /`Profit \$\{|label: "Profit"/);
  assert.doesNotMatch(detail, />Profit</);
});
