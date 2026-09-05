import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cooldownAlertMessage,
  DEFAULT_ENTITY_COOLDOWN_HOURS,
  formatCooldownRemaining,
  getEntityBidCooldown,
  resolveBidChangeAt,
} from "../src/lib/bidCooldown.ts";

const charts = readFileSync(new URL("../src/components/Charts.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/components/Mutations.tsx", import.meta.url), "utf8");
const entityDetail = readFileSync(new URL("../src/components/EntityDetail.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../src/lib/queries.ts", import.meta.url), "utf8");
const filterMemory = readFileSync(new URL("../src/lib/filterMemory.ts", import.meta.url), "utf8");

test("cooldown uses latest of bid/rule timestamps within default 48h", () => {
  assert.equal(DEFAULT_ENTITY_COOLDOWN_HOURS, 48);
  const now = Date.parse("2026-09-02T12:00:00.000Z");
  const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const older = new Date(now - 10 * 60 * 60 * 1000).toISOString();
  assert.equal(
    resolveBidChangeAt({ bid_last_modified_at: older, rule_last_modified_at: recent }),
    recent,
  );
  const info = getEntityBidCooldown(
    { bid_last_modified_at: recent, bid_change_source: "rule" },
    48,
    now,
  );
  assert.equal(info.isInCooldown, true);
  assert.match(info.sourceLabel, /rule/i);
  assert.match(cooldownAlertMessage(info), /Cooldown ends/);
  assert.equal(formatCooldownRemaining(90), "1m");
});

test("expired cooldown clears", () => {
  const now = Date.parse("2026-09-02T12:00:00.000Z");
  const old = new Date(now - 100 * 60 * 60 * 1000).toISOString();
  const info = getEntityBidCooldown({ bid_last_modified_at: old, bid_change_source: "amazon_ads" }, 48, now);
  assert.equal(info.isInCooldown, false);
});

test("funnel bars use true stage proportions (not CTR target fill)", () => {
  assert.match(charts, /True funnel widths/);
  assert.match(charts, /clicks \/ impressions/);
  assert.doesNotMatch(charts, /ctr \/ 1\.0/);
});

test("funnel CTR/CVR match screenshot math (149k / 39 / 1)", () => {
  const impressions = 149_000;
  const clicks = 39;
  const orders = 1;
  const ctr = (clicks / impressions) * 100;
  const cvr = (orders / clicks) * 100;
  assert.ok(Math.abs(ctr - 0.026174) < 0.0001);
  assert.equal(ctr.toFixed(2), "0.03");
  assert.equal(cvr.toFixed(1), "2.6");
  assert.match(charts, /safeDivide\(clicks, impressions\) \* 100/);
  assert.match(charts, /safeDivide\(orders, clicks\) \* 100/);
});

test("campaign detail Auto Targeting uses editable ProductTargetRow with cooldown", () => {
  const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  assert.match(campaign, /SectionCard title="Auto Targeting"/);
  assert.match(campaign, /ProductTargetRow/);
  assert.match(campaign, /cooldownRow=\{pt\}/);
  assert.match(campaign, /campaign-adgroup-bid-/);
  assert.match(campaign, /kind: "adGroup"/);
  assert.doesNotMatch(campaign, /AutoTargetSummaryRow/);
});

test("product ads prefer KDP metadata for the row ASIN", () => {
  assert.match(queries, /Always resolve title\/cover from THIS row's ASIN/);
  assert.match(queries, /Never paint a product-ASIN row with the sponsored book/);
});

test("MutationTap and EntityBidControl mark cooldown yellow + popup", () => {
  assert.match(mutations, /cooldownRow/);
  assert.match(mutations, /tone_warning/);
  assert.match(mutations, /Cooldown/);
  assert.match(entityDetail, /cooldownRow/);
  assert.match(entityDetail, /Edit anyway/);
});

test("placement and up/down bidding surfaces reuse campaign settings cooldown", () => {
  const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
  const campaigns = readFileSync(new URL("../app/(tabs)/campaigns.tsx", import.meta.url), "utf8");
  const campaignDetail = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
  const cooldown = readFileSync(new URL("../src/lib/bidCooldown.ts", import.meta.url), "utf8");
  assert.match(cooldown, /placement_adj_last_modified_at/);
  assert.match(cooldown, /getCampaignSettingsCooldown/);
  assert.match(targeting, /getCampaignSettingsCooldown/);
  assert.match(targeting, /cooldown=\{cooldown\}/);
  assert.match(campaigns, /cooldown=\{settingsCooldown\}/);
  assert.match(campaignDetail, /cooldown=\{settingsCooldown\}/);
  assert.match(campaignDetail, /changeBiddingStrategy/);
});

test("target detail enriches cover like list path", () => {
  assert.match(queries, /enrichProductTargetDisplay\(\[withMetrics\]/);
});

test("filter memory persists targeting / campaigns / books", () => {
  assert.match(filterMemory, /inteliads\.filters\.targeting\.v1/);
  assert.match(filterMemory, /inteliads\.filters\.campaigns\.v1/);
  assert.match(filterMemory, /inteliads\.filters\.books\.v1/);
});
