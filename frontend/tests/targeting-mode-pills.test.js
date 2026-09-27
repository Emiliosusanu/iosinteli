import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pills = readFileSync(
  new URL("../src/components/TargetingModePills.tsx", import.meta.url),
  "utf8",
);
const targeting = readFileSync(
  new URL("../app/(tabs)/targeting.tsx", import.meta.url),
  "utf8",
);

test("TargetingModePills exposes five icon modes in a single horizontal row", () => {
  assert.match(pills, /TARGETING_MODE_OPTIONS/);
  assert.match(pills, /key:\s*"keywords"/);
  assert.match(pills, /key:\s*"asins"/);
  assert.match(pills, /key:\s*"auto"/);
  assert.match(pills, /key:\s*"category"/);
  assert.match(pills, /key:\s*"placement"/);
  assert.match(pills, /testID:\s*"segment-keywords"/);
  assert.match(pills, /ScrollView/);
  assert.match(pills, /horizontal/);
  assert.match(pills, /flexWrap:\s*"nowrap"/);
  assert.doesNotMatch(pills, /flexWrap:\s*"wrap"/);
  assert.doesNotMatch(pills, /styles\.tray/);
  assert.doesNotMatch(pills, /auto_category/);
});

test("TargetingModePills uses SF Symbols — active label, idle icon-only", () => {
  assert.match(pills, /SFSymbol/);
  assert.match(pills, /key\.fill/);
  assert.match(pills, /symbol:\s*"cube"/);
  assert.match(pills, /wand\.and\.stars/);
  assert.match(pills, /symbol:\s*"tag"/);
  assert.match(pills, /square\.grid\.2x2/);
  assert.match(pills, /PressableScale/);
  assert.match(pills, /tone_primary/);
  assert.match(pills, /activeBg/);
  assert.match(pills, /idleBg/);
  assert.match(pills, /\{active \? \(/);
  assert.match(pills, /\{option\.label\}/);
  assert.doesNotMatch(pills, /TouchableOpacity/);
  assert.doesNotMatch(pills, /chrome_selected/);
});

test("Targets tab wires TargetingModePills", () => {
  assert.match(targeting, /TargetingModePills/);
  assert.match(targeting, /from "@\/src\/components\/TargetingModePills"/);
  assert.match(targeting, /type TargetingModeKey/);
  assert.doesNotMatch(targeting, /styles\.segmentChip/);
  assert.match(targeting, /key:\s*"auto"/);
  assert.match(targeting, /key:\s*"category"/);
  assert.match(targeting, /key:\s*"placement"/);
});
