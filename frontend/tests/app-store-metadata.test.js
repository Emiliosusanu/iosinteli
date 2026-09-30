import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metadata = JSON.parse(
  readFileSync(new URL("../store/en-US/metadata.json", import.meta.url), "utf8"),
);

test("App Store search metadata stays within Apple's field limits", () => {
  assert.ok(metadata.name.length > 0 && metadata.name.length <= 30);
  assert.ok(metadata.subtitle.length > 0 && metadata.subtitle.length <= 30);
  assert.ok(metadata.promotional_text.length > 0 && metadata.promotional_text.length <= 170);
  assert.ok(metadata.keywords.length > 0 && metadata.keywords.length <= 100);
});

test("App Store copy describes the actual KDP and Amazon Ads product", () => {
  assert.match(metadata.subtitle, /KDP/);
  assert.match(metadata.subtitle, /Amazon Ads/);
  assert.match(metadata.description, /net royalties minus ad spend/i);
  assert.match(metadata.description, /Chrome helper/);
  assert.match(metadata.keywords, /KDP/);
  assert.match(metadata.keywords, /ACoS/);
});
