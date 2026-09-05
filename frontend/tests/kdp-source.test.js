import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_KDP_ROYALTY_SOURCE,
  KDP_ROYALTY_SOURCES,
  isIosHelperEnabled,
  kdpRoyaltySourceOptionSubtitle,
  kdpRoyaltySourceOptionTitle,
  kdpRoyaltySourceValueLabel,
  normalizeKdpRoyaltySource,
} from "../src/lib/kdp/source.ts";

test("default source keeps Chrome-only behavior", () => {
  assert.equal(DEFAULT_KDP_ROYALTY_SOURCE, "extension");
  assert.equal(isIosHelperEnabled("extension"), false);
  assert.equal(isIosHelperEnabled("extension_ios"), true);
});

test("both switchable options exist", () => {
  assert.deepEqual([...KDP_ROYALTY_SOURCES], ["extension", "extension_ios"]);
});

test("normalize coerces unknown values to extension", () => {
  assert.equal(normalizeKdpRoyaltySource("extension_ios"), "extension_ios");
  assert.equal(normalizeKdpRoyaltySource("extension"), "extension");
  assert.equal(normalizeKdpRoyaltySource("nonsense"), "extension");
  assert.equal(normalizeKdpRoyaltySource(undefined), "extension");
  assert.equal(normalizeKdpRoyaltySource(null), "extension");
});

test("labels distinguish the two sources", () => {
  assert.equal(kdpRoyaltySourceValueLabel("extension"), "Chrome extension");
  assert.equal(kdpRoyaltySourceValueLabel("extension_ios"), "Chrome + iPhone");
  assert.match(kdpRoyaltySourceOptionTitle("extension_ios"), /iPhone/);
  assert.match(kdpRoyaltySourceOptionSubtitle("extension_ios"), /Chrome \+ this iPhone/);
  assert.match(kdpRoyaltySourceOptionSubtitle("extension"), /Chrome helper/);
});

test("settings picker can open the iPhone helper", () => {
  const picker = readFileSync(new URL("../app/more/kdp-source.tsx", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../app/more/kdp-helper.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  assert.match(picker, /more\/kdp-helper/);
  assert.match(picker, /Set up iPhone helper/);
  assert.match(helper, /runKdpIosHelperTick/);
  assert.match(layout, /more\/kdp-helper/);
  assert.match(layout, /KdpHelperHost/);
});

test("storage getter/setter are isolated from the pure contract", () => {
  const pure = readFileSync(new URL("../src/lib/kdp/source.ts", import.meta.url), "utf8");
  assert.doesNotMatch(pure, /utils\/storage/);
  const store = readFileSync(new URL("../src/lib/kdp/sourceStore.ts", import.meta.url), "utf8");
  assert.match(store, /getKdpRoyaltySource/);
  assert.match(store, /setKdpRoyaltySource/);
});
