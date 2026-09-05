import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const native = readFileSync(new URL("../src/components/ios/Native.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../src/components/OverviewHeaderV3.tsx", import.meta.url), "utf8");

test("fallback segmented control uses tablist/tab roles and 44pt targets", () => {
  assert.match(native, /accessibilityRole="tablist"/);
  assert.match(native, /accessibilityRole="tab"/);
  assert.match(native, /TouchableOpacity/);
  assert.match(native, /minHeight: 44/);
  assert.match(native, /accessibilityState=\{\{ selected: active \}\}/);
});

test("Overview keeps Month/Week period control without Today/Yesterday/7D horizon", () => {
  assert.match(home, /OverviewHeaderV3/);
  assert.match(header, /home-period-month/);
  assert.match(header, /home-period-week/);
  assert.doesNotMatch(home, /home-horizon/);
  assert.doesNotMatch(home, /home-today-7d/);
  assert.match(home, /"Net"/);
  assert.match(home, /testID="home-net-royalties"/);
});
