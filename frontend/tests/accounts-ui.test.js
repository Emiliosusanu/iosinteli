import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DISABLE_CONFIRM_MESSAGE,
  KDP_SECTION_FOOTER,
  enabledStatusLabel,
  profileEnabled,
  profileInView,
  profileRowAccessibilityLabel,
  profileSwitchAccessibilityLabel,
  viewStatusLabel,
} from "../src/lib/accountsUi.ts";

const screen = readFileSync(new URL("../app/more/accounts.tsx", import.meta.url), "utf8");

test("enable switch is Enabled/Disabled, not Connected, and is not view selection", () => {
  assert.equal(enabledStatusLabel(true), "Enabled");
  assert.equal(enabledStatusLabel(false), "Disabled");
  assert.equal(viewStatusLabel(true), "In current view");
  assert.equal(profileEnabled({ is_enabled: undefined }), true);
  assert.equal(profileEnabled({ is_enabled: false }), false);
  assert.equal(profileInView({ id: "a" }, ["a"]), true);
  assert.equal(profileInView({ id: "a" }, ["b"]), false);
  assert.match(screen, /value=\{enabled\}/);
  assert.match(screen, /enabledStatusLabel/);
  assert.match(screen, /viewStatusLabel/);
  assert.doesNotMatch(screen, /Connected/);
  assert.doesNotMatch(screen, /disconnect Amazon account|Disconnect Amazon/i);
  assert.doesNotMatch(screen, /Synced/);
});

test("row speech includes name, enabled, and view without raw ids", () => {
  assert.equal(
    profileRowAccessibilityLabel({
      name: "UK Ads",
      marketplace: "United Kingdom",
      currency: "British Pounds",
      enabled: true,
      inView: false,
    }),
    "UK Ads. United Kingdom. British Pounds. Enabled. Not in current view",
  );
  assert.equal(profileSwitchAccessibilityLabel("UK Ads", false), "UK Ads. Disabled");
  assert.match(KDP_SECTION_FOOTER, /Chrome helper/);
  assert.match(KDP_SECTION_FOOTER, /iPhone KDP helper/);
  assert.doesNotMatch(KDP_SECTION_FOOTER, /iPhone collects KDP|Synced/);
  assert.match(DISABLE_CONFIRM_MESSAGE, /does not disconnect Amazon/);
});

test("distinct empty and error copy", () => {
  assert.match(screen, /No Amazon profiles/);
  assert.match(screen, /Couldn't load Amazon profiles/);
  assert.match(screen, /No KDP accounts/);
  assert.match(screen, /Couldn't load KDP accounts/);
  assert.match(screen, /Royalty source/);
  assert.doesNotMatch(screen, /iPhone does not collect KDP/);
  assert.doesNotMatch(screen, /No data/);
  assert.match(screen, /accounts-viewing-customer/);
  assert.match(screen, /accounts-guest/);
});
