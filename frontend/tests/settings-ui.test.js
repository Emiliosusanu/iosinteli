import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseLocaleNumber } from "../src/lib/format.ts";
import {
  ADS_SECTION_FOOTER,
  ADS_SECTION_TITLE,
  APPEARANCE_LABEL,
  appearancePreferenceLabel,
  appearancePreferenceSubtitle,
  DAILY_DIGEST_FOOTER,
  DAILY_DIGEST_LABEL,
  DATA_SECTION_TITLE,
  GUEST_SETTINGS_NOTE,
  KDP_PROFIT_LABEL,
  KDP_SECTION_FOOTER,
  KDP_SECTION_TITLE,
  KDP_SOURCE_PICKER_FOOTER,
  KDP_STALE_FOOTER,
  KDP_STALE_LABEL,
  NOTIFICATIONS_ROW_LABEL,
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
const appearancePage = readFileSync(new URL("../app/more/appearance.tsx", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
const rootLayout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const notificationsPage = readFileSync(new URL("../app/more/notifications.tsx", import.meta.url), "utf8");
const notifications = readFileSync(new URL("../src/lib/notifications.ts", import.meta.url), "utf8");
const bidBot = readFileSync(new URL("../app/more/bid-bot.tsx", import.meta.url), "utf8");
const primitives = readFileSync(
  new URL("../src/components/settings/SettingsPrimitives.tsx", import.meta.url),
  "utf8",
);

test("iPhone min/max are not labeled as BidBot engine caps", () => {
  assert.match(screen, /ADS_SECTION_FOOTER/);
  assert.equal(ADS_SECTION_FOOTER, "");
  assert.doesNotMatch(screen, /Bid guardrails|Min bid|Max bid|Cooldown|Daily budget|mobileSettings|min-bid-input|max-bid-input/);
  assert.doesNotMatch(screen, /BidBot min bid|BidBot max bid|saveUserSetting|fetchUserSettings|primaryCurrency/);
  assert.match(bidBot, /MIN_MAX_DISPLAY_CAPTION/);
});

test("Appearance opens Light/Dark/System picker and persists preference", () => {
  assert.equal(appearancePreferenceLabel("system"), "System");
  assert.equal(appearancePreferenceLabel("light"), "Light");
  assert.equal(appearancePreferenceLabel("dark"), "Dark");
  assert.match(appearancePreferenceSubtitle("light"), /White dock/);
  assert.match(appearancePreferenceSubtitle("dark"), /Black dock/);
  assert.match(screen, /APPEARANCE_LABEL/);
  assert.match(screen, /appearancePreferenceLabel/);
  assert.match(screen, /testID="settings-appearance"/);
  assert.match(screen, /more\/appearance/);
  assert.match(screen, /useThemePreference/);
  const appearanceBlock = screen.slice(screen.indexOf("settings-appearance"));
  assert.match(appearanceBlock.slice(0, 500), /onPress/);
  assert.match(appearancePage, /appearance-option-\$\{option\}/);
  assert.match(appearancePage, /THEME_PREFERENCE_OPTIONS/);
  assert.match(appearancePage, /setPreference/);
  assert.doesNotMatch(appearancePage, /appearancePreferenceSubtitle/);
  assert.match(theme, /inteliads\.appearance\.v1/);
  assert.match(theme, /Appearance\.setColorScheme/);
  assert.match(rootLayout, /more\/appearance/);
});

test("test notification is local and does not claim server push", () => {
  assert.equal(TEST_NOTIFICATION_LABEL, "Send test");
  assert.match(TEST_NOTIFICATION_BODY, /Local test/);
  assert.doesNotMatch(TEST_NOTIFICATION_BODY, /Notifications are working/);
  assert.equal(TEST_NOTIFICATION_HINT, "");
  assert.match(notifications, /requestServerTestPush/);
  assert.match(notifications, /scheduleLocalAlert/);
  assert.match(notifications, /Local first/);
  assert.match(notifications, /scheduleNotificationAsync/);
  assert.doesNotMatch(notifications, /Notifications are working/);
  assert.equal(testNotificationLabel("idle"), TEST_NOTIFICATION_LABEL);
  assert.equal(testNotificationLabel("guest"), "Sign in to send a test");
});

test("notification copy stays short without inventing schedule walls", () => {
  assert.equal(
    notificationFooter({
      guestMode: false,
      permission: "granted",
      backgroundRegistered: true,
      anyEnabled: true,
    }),
    "",
  );
  assert.doesNotMatch(
    notificationFooter({
      guestMode: false,
      permission: "granted",
      backgroundRegistered: true,
      anyEnabled: true,
    }),
    /throughout the day at 8am|10am, noon, 2pm|15-min|Keychain|Alerts on/,
  );
  assert.equal(
    notificationFooter({
      guestMode: false,
      permission: "denied",
      backgroundRegistered: false,
      anyEnabled: true,
    }),
    "Allow alerts in iOS Settings",
  );
  assert.equal(
    notificationFooter({
      guestMode: true,
      permission: "undetermined",
      backgroundRegistered: false,
      anyEnabled: true,
    }),
    "Sign in for alerts",
  );
  assert.equal(GUEST_SETTINGS_NOTE, "Sign in for alerts");
  assert.equal(DAILY_DIGEST_FOOTER, "");
  assert.equal(DAILY_DIGEST_LABEL, "Daily summary");
  assert.equal(notificationSwitchAccessibilityLabel("New orders", true), "New orders, on");
  assert.equal(spendThresholdLabel(25), "Overspend vs daily budgets");
  assert.doesNotMatch(spendThresholdLabel(25), /optional daily budget|typed on this screen/);
  assert.match(notificationsPage, /SPEND_THRESHOLD_CAPTION/);
  assert.equal(SPEND_THRESHOLD_CAPTION, "");
  assert.match(screen, /settings-notifications/);
  assert.match(screen, /more\/notifications/);
  assert.equal(NOTIFICATIONS_ROW_LABEL, "Notifications");
  assert.match(notificationsPage, /notif-daily-digest/);
  assert.match(notificationsPage, /notif-include-kdp-net/);
  assert.match(notificationsPage, /notif-kdp-data-stale/);
  assert.equal(KDP_STALE_LABEL, "KDP data stalled");
  assert.match(KDP_STALE_FOOTER, /over an hour/);
  assert.doesNotMatch(KDP_STALE_FOOTER, /Chrome extension or iPhone helper/);
  assert.doesNotMatch(notificationsPage, /44%/);
});

test("KDP royalty source is switchable between Chrome and iPhone", () => {
  assert.equal(KDP_PROFIT_LABEL, "Royalty source");
  assert.equal(KDP_SECTION_FOOTER, "");
  assert.equal(KDP_SOURCE_PICKER_FOOTER, "");
  assert.match(screen, /KDP_SECTION_FOOTER/);
  assert.match(screen, /settings-kdp-source/);
  assert.match(screen, /more\/kdp-source/);
  assert.match(screen, /kdpSourceValue/);
  assert.match(screen, /kdpRoyaltySourceValueLabel/);
  assert.match(screen, /settings-kdp-accounts/);
  assert.match(screen, /settings-kdp-helper/);
  assert.match(screen, /settings-plan/);
  assert.match(screen, /settings-subscription-status/);
  assert.doesNotMatch(screen, /royaltyRate|setRoyaltyRate|WebView|scraper/);
});

test("guest cannot look like a remote settings save, and view-as stays self-scoped", () => {
  assert.match(screen, /settings-guest/);
  assert.match(notificationsPage, /alertsLocked/);
  assert.match(screen, /VIEWING_CUSTOMER_SETTINGS_NOTE/);
  assert.match(notificationsPage, /VIEWING_CUSTOMER_SETTINGS_NOTE/);
  assert.match(VIEWING_CUSTOMER_SETTINGS_NOTE, /yours/);
  assert.match(VIEWING_CUSTOMER_SETTINGS_NOTE, /not the customer/);
  assert.doesNotMatch(screen, /saveUserSetting|Settings saved|Syncing settings/);
});

test("locale parser still treats a lone comma as the decimal mark", () => {
  assert.equal(parseSettingsNumber("0,10"), 0.1);
  assert.equal(parseLocaleNumber("0,65"), 0.65);
  assert.equal(parseSettingsNumber("1.25"), 1.25);
  assert.ok(Number.isNaN(parseSettingsNumber("")));
  assert.ok(Number.isNaN(parseSettingsNumber("abc")));
});

test("Settings home is an Apple-style hierarchy with native chrome", () => {
  assert.equal(ADS_SECTION_TITLE, "Amazon Ads");
  assert.equal(KDP_SECTION_TITLE, "KDP");
  assert.equal(DATA_SECTION_TITLE, "Data & Sync");
  assert.match(screen, /SettingsScreen/);
  assert.match(screen, /SettingsSection/);
  assert.match(screen, /settings-sync/);
  assert.match(screen, /settings-data-coverage/);
  assert.match(screen, /settings-version/);
  assert.match(screen, /settings-amazon-accounts/);
  assert.match(primitives, /export function SettingsScreen/);
  assert.match(primitives, /export function SettingsToggleRow/);
  assert.match(primitives, /export function SettingsNavigationRow/);
  assert.match(primitives, /headerShown: true/);
  assert.match(notificationsPage, /SettingsScreen/);
  assert.doesNotMatch(screen, /SubScreen/);
  assert.doesNotMatch(notificationsPage, /SubScreen/);
});
