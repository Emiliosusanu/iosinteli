import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { enabledSpoken, matchTypeSpoken, targetingSpeech } from "../src/lib/targetingA11y.ts";

const targeting = readFileSync(new URL("../app/(tabs)/targeting.tsx", import.meta.url), "utf8");
const keyword = readFileSync(new URL("../app/keyword/[id].tsx", import.meta.url), "utf8");
const target = readFileSync(new URL("../app/target/[id].tsx", import.meta.url), "utf8");
const searchTerm = readFileSync(new URL("../app/search-term/[id].tsx", import.meta.url), "utf8");
const campaign = readFileSync(new URL("../app/campaign/[id].tsx", import.meta.url), "utf8");
const adGroup = readFileSync(new URL("../app/more/ad-group/[id].tsx", import.meta.url), "utf8");
const primitives = readFileSync(new URL("../src/components/Primitives.tsx", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../src/components/Mutations.tsx", import.meta.url), "utf8");

test("spoken match types stay human and do not invent metrics", () => {
  assert.equal(matchTypeSpoken("broad"), "Broad keyword");
  assert.equal(matchTypeSpoken("EXACT"), "Exact keyword");
  assert.equal(matchTypeSpoken("phrase"), "Phrase keyword");
  assert.equal(matchTypeSpoken(""), "Keyword");
  assert.equal(enabledSpoken(true), "Enabled");
  assert.equal(enabledSpoken(false), "Paused");
  assert.equal(enabledSpoken(null), null);
  assert.equal(
    targetingSpeech(["Japanese", "Broad keyword", "Spending without sales", "Enabled", "ACoS 42%", "Spend $18.00"]),
    "Japanese. Broad keyword. Spending without sales. Enabled. ACoS 42%. Spend $18.00",
  );
});

test("Targets rows combine identity without swallowing the pause switch", () => {
  assert.match(targeting, /accessibilityHint="Opens keyword details"/);
  assert.match(targeting, /accessibilityHint="Opens target details"/);
  assert.match(targeting, /accessibilityHint="Opens campaign details"/);
  assert.match(targeting, /accessibilityLabel=\{rowLabel\}/);
  assert.match(targeting, /accessibilityLabel=\{`Clear \$\{perfLabel\} filter`\}/);
  assert.match(targeting, /accessibilityLabel=\{`Clear sort\. Currently \$\{sortLabel\}`\}/);
  assert.match(targeting, /accessibilityHint="Closes filters and sort"/);
  const switchAfterNav = targeting.indexOf("Opens keyword details");
  const switchAt = targeting.indexOf('noun="keyword"');
  assert.ok(switchAfterNav >= 0 && switchAt > switchAfterNav);
});

test("mutation-sensitive details keep identity grouped and switches independent", () => {
  assert.match(keyword, /accessibilityRole="header"/);
  assert.match(keyword, /matchTypeSpoken\(item\.match_type\)/);
  assert.match(keyword, /<ParentLinks/);
  assert.ok(keyword.indexOf('accessibilityRole="header"') < keyword.indexOf("<ParentLinks"));
  assert.match(target, /Open book for \$\{displayTitle\}/);
  assert.match(target, /accessibilityElementsHidden/);
  assert.match(searchTerm, /Add \$\{term\} as a keyword/);
  assert.match(searchTerm, /Negate \$\{term\}/);
  assert.match(searchTerm, /Writes a keyword on Amazon Ads/);
  assert.match(searchTerm, /Adds a negative on Amazon Ads/);
  assert.match(campaign, /c\.state === "enabled" \? "Enabled" : "Paused"/);
  assert.match(adGroup, /Default bid \$\{defaultBid\}\. Read only\./);
  assert.match(adGroup, /groupState === "enabled" \? "Enabled" : "Paused"/);
});

test("shared decorative tone and bid tap stay labeled without swallowing siblings", () => {
  assert.match(primitives, /export function ToneDot/);
  assert.match(primitives, /accessibilityElementsHidden/);
  assert.match(mutations, /\$\{label\} \$\{value\}\. Edit \$\{label\.toLowerCase\(\)\}\./);
  assert.match(mutations, /\$\{noun\} is \$\{enabled \? "active" : "paused"\}/);
  assert.match(mutations, /Changing this writes Amazon Ads\./);
});
