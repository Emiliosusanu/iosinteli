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

test("TargetingModePills exposes five equal-width Amazon-style capsules", () => {
  assert.match(pills, /TARGETING_MODE_OPTIONS/);
  assert.match(pills, /key:\s*"keywords"/);
  assert.match(pills, /key:\s*"asins"/);
  assert.match(pills, /key:\s*"auto"/);
  assert.match(pills, /key:\s*"category"/);
  assert.match(pills, /key:\s*"placement"/);
  assert.match(pills, /testID:\s*"segment-keywords"/);
  assert.doesNotMatch(pills, /ScrollView/);
  assert.match(pills, /flex:\s*1/);
  assert.match(pills, /styles\.slot/);
  assert.match(pills, /borderRadius:\s*999/);
  assert.match(pills, /backgroundColor: active \? blue : idleBg/);
  assert.match(pills, /#FFFFFF/);
  assert.doesNotMatch(pills, /blue \+ "18"/);
  assert.doesNotMatch(pills, /auto_category/);
});

test("TargetingModePills uses brand-blue selection and SF Symbols", () => {
  assert.match(pills, /SFSymbol/);
  assert.match(pills, /key\.fill/);
  assert.match(pills, /cube\.fill/);
  assert.match(pills, /wand\.and\.stars/);
  assert.match(pills, /tag\.fill/);
  assert.match(pills, /square\.grid\.2x2\.fill/);
  assert.match(pills, /PressableScale/);
  assert.match(pills, /tone_primary/);
  assert.match(pills, /minHeight:\s*40/);
  assert.match(pills, /accessibilityState=\{\{\s*selected:\s*active/);
  assert.doesNotMatch(pills, /TouchableOpacity/);
  assert.doesNotMatch(pills, /chrome_selected/);
  // Selected label only — inactive stay icon-only.
  assert.match(pills, /\{active \? \(/);
  assert.match(pills, /option\.shortLabel/);
});

test("Targets tab: unbundled chrome; status in filter sheet; tertiary Select", () => {
  assert.match(targeting, /TargetingModePills/);
  assert.match(targeting, /from "@\/src\/components\/TargetingModePills"/);
  assert.doesNotMatch(targeting, /FilterChrome/);
  assert.match(targeting, /testID="targeting-state-filter"/);
  assert.match(targeting, /testID="targeting-select-btn"/);
  assert.match(targeting, /\{selectMode \? "Done" : "Select all"\}/);
  assert.match(targeting, /else selectAllVisible\(\)/);
  assert.doesNotMatch(
    targeting,
    /ActiveFilterChip\s*\n\s*testID="targeting-select-btn"/,
  );
  assert.match(targeting, /DenseMetricLine/);
  assert.match(targeting, /styles\.switchWell/);
  assert.doesNotMatch(targeting, /enableFooter/);
  assert.doesNotMatch(targeting, /TargetPrimaryMetrics/);
  // Status lives in FilterSheetFields, not under the search row.
  const sheetIdx = targeting.indexOf("function FilterSheetFields");
  assert.ok(sheetIdx > 0);
  assert.doesNotMatch(targeting.slice(0, sheetIdx), /testID="targeting-state-filter"/);
  assert.match(targeting.slice(sheetIdx), /testID="targeting-state-filter"/);
  assert.match(targeting, /targeting-filter-chip-state/);
});
