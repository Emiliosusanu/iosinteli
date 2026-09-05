import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KDP_IPHONE_BOUNDARY,
  adsMetricFacts,
  adsSourcePresentation,
  coverageCountLabel,
  coverageStatusLabel,
  formatCoverageCount,
  formatCoverageMoney,
  hasMixedCurrencies,
  kdpMetricFacts,
  kdpSourcePresentation,
  rowsForScope,
} from "../src/lib/dataMap.ts";

const screen = readFileSync(new URL("../app/more/data-map.tsx", import.meta.url), "utf8");
const contract = readFileSync(new URL("../src/lib/dataMap.ts", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const moreRoot = readFileSync(new URL("../src/lib/moreRoot.ts", import.meta.url), "utf8");

function missingKdp() {
  return {
    status: "missing",
    linkedAccounts: 0,
    royalties: null,
    orders: null,
    latestDataDate: null,
  };
}

function emptyAds() {
  return {
    status: "empty",
    spend: 0,
    attributedSales: 0,
    attributedOrders: 0,
    clicks: 0,
    impressions: 0,
    acos: null,
    ctr: null,
    activityDays: 0,
    lastCompletedAt: null,
    syncStatus: "unknown",
  };
}

test("missing KDP is unavailable, never zero royalties", () => {
  assert.deepEqual(kdpSourcePresentation(missingKdp()), {
    statusLabel: "Not linked",
    tone: "warning",
    summary: "No KDP account is linked to the selected Amazon profiles.",
  });
  assert.deepEqual(
    kdpMetricFacts({ kdp: missingKdp(), currency: "USD", mixedCurrencies: false }),
    ["Imported KDP royalties —", "KDP orders —"],
  );
  assert.match(queries, /royalties: kdp\?\.hasKdpData \? kdp\.totalRoyalties : null/);
  assert.doesNotMatch(screen, /totals\?\.royalties \?\? 0|kdp\.royalties \?\? 0/);
});

test("Data Map no longer claims Net Profit or a fabricated health score", () => {
  assert.doesNotMatch(screen, /Net profit|net profit|Data health|coverageTag|okCount/);
  assert.doesNotMatch(screen, /metric_massive|adjustsFontSizeToFit/);
  assert.match(screen, /What InteliAds can use/);
});

test("Ads sales and orders stay ad-attributed, not generic revenue", () => {
  assert.equal(adsSourcePresentation(emptyAds()).statusLabel, "No activity in period");
  assert.deepEqual(
    adsMetricFacts({ ads: emptyAds(), currency: "USD", mixedCurrencies: false }),
    ["Amazon Ads spend $0.00", "Ad-attributed sales $0.00", "Ad-attributed orders 0"],
  );
  assert.match(contract, /Ad-attributed sales/);
  assert.match(contract, /Ad-attributed orders/);
  assert.match(contract, /Imported KDP royalties/);
  assert.match(contract, /KDP orders/);
  assert.match(screen, /adsMetricFacts/);
  assert.match(screen, /kdpMetricFacts/);
  assert.doesNotMatch(screen, /<Small label="Orders"|<Metric label="Ad Sales"/);
  assert.doesNotMatch(screen, /Royalties − spend|Royalties - spend/);
});

test("profile, customer, and date scope are explicit and isolated", () => {
  assert.match(screen, /user\?\.id \?\? "guest"/);
  assert.match(screen, /adminFilterUserId \?\? "self"/);
  assert.match(screen, /selectedProfileIds/);
  assert.match(screen, /dateRange\.start/);
  assert.match(screen, /dateRange\.end/);
  assert.match(screen, /placeholderData: undefined/);
  assert.match(screen, /Customer coverage unavailable/);
  assert.match(screen, /Setup counts are current/);
});

test("partial source errors remain distinct from missing", () => {
  assert.equal(
    coverageStatusLabel({
      key: "x",
      label: "Example",
      count: null,
      status: "error",
      scope: "current",
    }),
    "Couldn't check",
  );
  assert.equal(
    coverageStatusLabel({
      key: "x",
      label: "Example",
      count: 0,
      status: "missing",
      scope: "current",
    }),
    "Missing",
  );
  assert.equal(
    coverageCountLabel({
      key: "x",
      label: "Example",
      count: null,
      status: "error",
      scope: "current",
    }),
    "—",
  );
  assert.match(queries, /Promise\.allSettled/);
  assert.match(screen, /RetryState/);
});

test("verified empty counts are None, not Missing", () => {
  assert.equal(
    coverageStatusLabel({
      key: "negative_keywords",
      label: "Negative keywords",
      count: 0,
      status: "empty",
      scope: "current",
    }),
    "None",
  );
  assert.equal(
    coverageStatusLabel({
      key: "campaign_metrics",
      label: "Amazon Ads activity days",
      count: 0,
      status: "empty",
      scope: "period",
    }),
    "None in period",
  );
  assert.match(queries, /kind === "required" \? "missing" : "empty"/);
  assert.match(queries, /campaigns.length === 0/);
  assert.match(queries, /\? "missing"\s+: "empty"/);
});

test("coverage rows preserve current setup versus selected-period semantics", () => {
  const rows = [
    { key: "profiles", label: "Selected profiles", count: 2, status: "available", scope: "current" },
    { key: "ads", label: "Ads activity days", count: 3, status: "available", scope: "period" },
  ];
  assert.deepEqual(rowsForScope(rows, "current").map((row) => row.key), ["profiles"]);
  assert.deepEqual(rowsForScope(rows, "period").map((row) => row.key), ["ads"]);
  assert.match(screen, /Current setup/);
  assert.match(screen, /Selected period/);
});

test("diagnostic actions navigate to Accounts and Sync without direct mutations", () => {
  assert.match(screen, /router\.push\("\/more\/sync"\)/);
  assert.match(screen, /router\.push\("\/more\/accounts"\)/);
  assert.match(screen, /data-map-open-sync/);
  assert.match(screen, /data-map-open-accounts/);
  assert.match(screen, /Does not start a new sync/);
  assert.doesNotMatch(screen, /triggerSync|cancelSync|useMutation|unlink|toggleAmazon|save/);
});

test("freshness and KDP collection boundaries stay truthful", () => {
  assert.match(queries, /row\.status === "completed" && row\.completed_at/);
  assert.match(screen, /Last successful Ads sync/);
  assert.match(screen, /Royalty data present through/);
  assert.match(KDP_IPHONE_BOUNDARY, /Chrome extension or the iPhone helper/);
  assert.match(KDP_IPHONE_BOUNDARY, /refreshes linked KDP/);
  assert.doesNotMatch(screen, /KDP updated|iPhone collects|keeps KDP fresh/);
});

test("mixed currencies hide combined money and More names the real job", () => {
  assert.equal(hasMixedCurrencies(["USD", "USD"]), false);
  assert.equal(hasMixedCurrencies(["USD", "GBP"]), true);
  assert.equal(formatCoverageMoney(12, "USD", true), "—");
  assert.equal(formatCoverageMoney(null, "USD", false), "—");
  assert.equal(formatCoverageMoney(0, "USD", false), "$0.00");
  assert.equal(formatCoverageCount(null), "—");
  assert.match(screen, /This diagnostic does not combine them/);
  assert.match(moreRoot, /label: "Data coverage"/);
  assert.doesNotMatch(moreRoot, /subtitle: "Amazon Ads and KDP availability"/);
});
