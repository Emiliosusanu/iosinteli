import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseLocaleNumber } from "../src/lib/format.ts";
import {
  ADS_SECTION_FOOTER,
  APPEARANCE_LABEL,
  APPEARANCE_VALUE,
  KDP_PROFIT_LABEL,
  KDP_PROFIT_VALUE,
  KDP_SECTION_FOOTER,
  SPEND_THRESHOLD_CAPTION,
  TEST_NOTIFICATION_BODY,
  TEST_NOTIFICATION_HINT,
  TEST_NOTIFICATION_LABEL,
  VIEWING_CUSTOMER_SETTINGS_NOTE,
  notificationFooter,
  notificationSwitchAccessibilityLabel,
  parseSettingsNumber,
  spendThresholdLabel,
  testNotificationLabel,
} from "../src/lib/settingsContract.ts";

const screen = readFileSync(new URL("../app/more/settings.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const bidBot = readFileSync(new URL("../app/more/bid-bot.tsx", import.meta.url), "utf8");

test("iPhone min/max are not labeled as BidBot engine caps", () => {
  assert.match(screen, /ADS_SECTION_FOOTER/);
  assert.match(ADS_SECTION_FOOTER, /not from this screen/);
  assert.match(ADS_SECTION_FOOTER, /does not cap Amazon bids/);
  assert.doesNotMatch(screen, /Bid guardrails|Min bid|Max bid|Cooldown|Daily budget|mobileSettings|min-bid-input|max-bid-input/);
  assert.doesNotMatch(screen, /BidBot min bid|BidBot max bid|saveUserSetting|fetchUserSettings|primaryCurrency/);
  assert.match(bidBot, /MIN_MAX_DISPLAY_CAPTION/);
});

test("Appearance is display-only Follows system, not a fake selector", () => {
  assert.equal(APPEARANCE_VALUE, "Follows system");
  assert.match(screen, /APPEARANCE_LABEL/);
  assert.match(screen, /APPEARANCE_VALUE/);
  assert.match(screen, /testID="settings-appearance"/);
  assert.doesNotMatch(screen, /Light\/Dark|user_settings.*appearance|setColorScheme/);
  const appearanceBlock = screen.slice(screen.indexOf("settings-appearance"));
  assert.doesNotMatch(appearanceBlock.slice(0, 400), /onPress/);
});

test("test notification is local and does not claim server push", () => {
  assert.equal(TEST_NOTIFICATION_LABEL, "Send a test on this iPhone");
  assert.match(TEST_NOTIFICATION_BODY, /local test/);
  assert.doesNotMatch(TEST_NOTIFICATION_BODY, /Notifications are working/);
  assert.match(TEST_NOTIFICATION_HINT, /local alert on this iPhone/);
  assert.match(notifications, /requestServerTestPush/);
  assert.match(notifications, /scheduleLocalAlert/);
  assert.match(notifications, /Local first/);
  assert.match(notifications, /scheduleNotificationAsync/);
  assert.doesNotMatch(notifications, /Notifications are working/);
  assert.equal(testNotificationLabel("idle"), TEST_NOTIFICATION_LABEL);
  assert.equal(testNotificationLabel("guest"), "Sign in to send a test");
});

test("notification copy describes on-device digest alerts", () => {
  assert.match(
    notificationFooter({
      guestMode: false,
      permission: "granted",
      backgroundRegistered: true,
      anyEnabled: true,
    }),
    /ad spend, orders, and ACoS/,
  );
  assert.match(
    notificationFooter({
      guestMode: false,
      permission: "granted",
      backgroundRegistered: true,
      anyEnabled: true,
    }),
    /KDP net/,
  );
  assert.match(
    notificationFooter({
      guestMode: false,
      permission: "denied",
      backgroundRegistered: false,
      anyEnabled: true,
    }),
    /cannot send alerts until you allow/,
  );
  assert.match(
    notificationFooter({
      guestMode: true,
      permission: "undetermined",
      backgroundRegistered: false,
      anyEnabled: true,
    }),
    /cannot send notifications/,
  );
  assert.equal(notificationSwitchAccessibilityLabel("New orders", true), "New orders, on");
  assert.match(spendThresholdLabel(25), /campaign daily budgets/);
  assert.doesNotMatch(spendThresholdLabel(25), /optional daily budget|typed on this screen/);
  assert.match(screen, /SPEND_THRESHOLD_CAPTION/);
  assert.match(SPEND_THRESHOLD_CAPTION, /not a number typed on this screen/);
  assert.match(screen, /notif-daily-digest/);
  assert.match(screen, /notif-include-kdp-net/);
});

test("KDP royalty source is switchable between Chrome and iPhone", () => {
  assert.equal(KDP_PROFIT_LABEL, "Royalty source");
  assert.match(KDP_SECTION_FOOTER, /Chrome helper/);
  assert.match(KDP_SECTION_FOOTER, /this iPhone/);
  assert.match(KDP_SECTION_FOOTER, /same schedule/);
  assert.match(KDP_SECTION_FOOTER, /Keychain/);
  assert.match(KDP_SECTION_FOOTER, /Net Royalties = KDP royalties minus Amazon Ads spend/);
  assert.match(screen, /KDP_SECTION_FOOTER/);
  // The row now navigates to the picker and shows the live source value.
  assert.match(screen, /settings-kdp-source/);
  assert.match(screen, /more\/kdp-source/);
  assert.match(screen, /kdpSourceValue/);
  assert.match(screen, /kdpRoyaltySourceValueLabel/);
  assert.match(screen, /settings-kdp-accounts/);
  assert.match(screen, /settings-kdp-helper/);
  assert.match(screen, /settings-plan/);
  assert.match(screen, /settings-subscription-status/);
  // Settings screen itself must stay clean of importer internals.
  assert.doesNotMatch(screen, /royaltyRate|setRoyaltyRate|WebView|scraper/);
});

test("guest cannot look like a remote settings save, and view-as stays self-scoped", () => {
  assert.match(screen, /settings-guest/);
  assert.match(screen, /alertsLocked/);
  assert.match(screen, /VIEWING_CUSTOMER_SETTINGS_NOTE/);
  assert.match(VIEWING_CUSTOMER_SETTINGS_NOTE, /signed-in account/);
  assert.doesNotMatch(screen, /saveUserSetting|Settings saved|Syncing settings/);
});

test("locale parser still treats a lone comma as the decimal mark", () => {
  assert.equal(parseSettingsNumber("0,10"), 0.1);
  assert.equal(parseLocaleNumber("0,65"), 0.65);
  assert.equal(parseSettingsNumber("1.25"), 1.25);
  assert.ok(Number.isNaN(parseSettingsNumber("")));
  assert.ok(Number.isNaN(parseSettingsNumber("abc")));
});
