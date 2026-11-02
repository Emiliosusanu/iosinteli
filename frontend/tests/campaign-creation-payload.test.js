import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAdGroupCreationBody,
  buildCampaignCreationBody,
  DEFAULT_AD_GROUP_CREATE_STATE,
  DEFAULT_ENABLE_AFTER_CREATE,
  parsePlacementPercent,
  placementPercentsFromText,
} from "../src/lib/campaignCreationPayload.ts";

const base = {
  profileId: "profile-1",
  advertisedAsin: "B00TESTASIN",
  targeting: "keywords",
  name: "Paperback search",
  adGroupName: "Main ad group",
  dailyBudget: 10,
  defaultBid: 0.75,
  requestId: "ios-campaign-payload-test",
};

test("placement percents accept 0–900 including comma decimals", () => {
  assert.equal(parsePlacementPercent("0"), 0);
  assert.equal(parsePlacementPercent("50"), 50);
  assert.equal(parsePlacementPercent("900"), 900);
  assert.equal(parsePlacementPercent("12,5"), 12.5);
  assert.equal(parsePlacementPercent("-1"), null);
  assert.equal(parsePlacementPercent("901"), null);
  assert.equal(parsePlacementPercent(""), 0);
  assert.deepEqual(
    placementPercentsFromText({
      topOfSearch: "25",
      productPages: "10",
      restOfSearch: "0",
    }),
    { topOfSearch: 25, productPages: 10, restOfSearch: 0 },
  );
});

test("create payload sends fixed, up and down, and down only with placement percents", () => {
  for (const [raw, code] of [
    ["MANUAL", "MANUAL"],
    ["fixed", "MANUAL"],
    ["AUTO_FOR_SALES", "AUTO_FOR_SALES"],
    ["up and down", "AUTO_FOR_SALES"],
    ["LEGACY_FOR_SALES", "LEGACY_FOR_SALES"],
    ["down only", "LEGACY_FOR_SALES"],
  ]) {
    const body = buildCampaignCreationBody({
      ...base,
      biddingStrategy: raw,
      placements: { topOfSearch: 40, productPages: 15, restOfSearch: 5 },
      enableAfterCreate: true,
    });
    const json = JSON.parse(JSON.stringify(body));
    assert.equal(json.biddingStrategy, code);
    assert.deepEqual(json.placements, {
      topOfSearch: 40,
      productPages: 15,
      restOfSearch: 5,
    });
    assert.equal(json.enableAfterCreate, true);
    assert.equal("state" in json, false);
    assert.equal("adGroupState" in json, false);
  }
});

test("omitted enable flag keeps the campaign paused until activation is explicit", () => {
  assert.equal(DEFAULT_ENABLE_AFTER_CREATE, false);
  const body = buildCampaignCreationBody({
    ...base,
    targeting: "auto",
    biddingStrategy: "MANUAL",
    placements: { topOfSearch: 0, productPages: 0, restOfSearch: 0 },
  });
  assert.equal(body.enableAfterCreate, false);
  assert.equal(body.biddingStrategy, "MANUAL");
});

test("explicit pause is still sent when the seller turns activation off", () => {
  const body = buildCampaignCreationBody({
    ...base,
    biddingStrategy: "AUTO_FOR_SALES",
    placements: { topOfSearch: 8, productPages: 0, restOfSearch: 0 },
    enableAfterCreate: false,
  });
  assert.equal(body.enableAfterCreate, false);
  assert.equal(body.placements.topOfSearch, 8);
});

test("ad group create defaults to paused and keeps targeting rows", () => {
  assert.equal(DEFAULT_AD_GROUP_CREATE_STATE, "paused");
  const body = buildAdGroupCreationBody({
    campaignId: "camp-1",
    name: "Main ad group",
    defaultBid: 0.75,
    targeting: "products",
    advertisedAsin: "B00TESTASIN",
    productTargets: [{ asin: "B00TARGET01", bid: 0.8, matchType: "exact", source: "custom" }],
  });
  assert.equal(body.state, "paused");
  assert.equal(body.productTargets.length, 1);
  assert.equal("biddingStrategy" in body, false);
  assert.equal("placements" in body, false);

  const paused = buildAdGroupCreationBody({
    campaignId: "camp-1",
    name: "Paused group",
    defaultBid: 0.5,
    targeting: "keywords",
    state: "paused",
  });
  assert.equal(paused.state, "paused");
});

test("create screens send strategy, placement percents, and explicit activation state", () => {
  const create = readFileSync(new URL("../app/campaign/create.tsx", import.meta.url), "utf8");
  const adGroup = readFileSync(new URL("../app/campaign/ad-group-create.tsx", import.meta.url), "utf8");
  assert.match(create, /buildCampaignCreationBody\(/);
  assert.match(create, /biddingStrategy: strategy/);
  assert.match(create, /placements,/);
  assert.match(create, /enableAfterCreate,/);
  assert.match(create, /testID="campaign-create-placement-top"/);
  assert.match(create, /testID="campaign-create-placement-product"/);
  assert.match(create, /testID="campaign-create-placement-rest"/);
  assert.match(create, /label="Fixed"/);
  assert.match(create, /label="Up & down"/);
  assert.match(create, /label="Down only"/);
  assert.match(create, /setEnableAfterCreate\] = useState\(false\)/);
  assert.match(adGroup, /buildAdGroupCreationBody\(/);
  assert.match(adGroup, /state: DEFAULT_AD_GROUP_CREATE_STATE/);
  assert.match(adGroup, /This ad group starts paused/);
});
