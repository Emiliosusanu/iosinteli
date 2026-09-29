export type NotificationPermissionState = "granted" | "denied" | "undetermined";

export const APPEARANCE_LABEL = "Appearance";
/** @deprecated Prefer appearancePreferenceLabel(preference) for the live value. */
export const APPEARANCE_VALUE = "System";
export const APPEARANCE_PICKER_TITLE = "Appearance";
/** Labels are enough — no permanent Appearance footer. */
export const APPEARANCE_PICKER_FOOTER = "";

export const THEME_PREFERENCE_OPTIONS = ["system", "light", "dark"] as const;

export function appearancePreferenceLabel(
  preference: "system" | "light" | "dark",
): string {
  switch (preference) {
    case "light":
      return "Light";
    case "dark":
      return "Dark";
    default:
      return "System";
  }
}

/** Kept for callers/tests; Appearance UI no longer shows subtitles. */
export function appearancePreferenceSubtitle(
  preference: "system" | "light" | "dark",
): string {
  switch (preference) {
    case "light":
      return "White dock and light chrome";
    case "dark":
      return "Black dock and dark chrome";
    default:
      return "Match the iPhone appearance setting";
  }
}

export const KDP_PROFIT_LABEL = "Royalty source";
export const KDP_PROFIT_VALUE = "KDP royalties";
/** Removed verbose Keychain/schedule footer — Net formula lives on Overview. */
export const KDP_SECTION_FOOTER = "";

export const KDP_SOURCE_PICKER_TITLE = "Royalty source";
/** Detail moved out of permanent footer (How sync works tip later). */
export const KDP_SOURCE_PICKER_FOOTER = "";

export const KDP_ACCOUNTS_ROW_LABEL = "KDP accounts";
export const KDP_ACCOUNTS_ROW_SUBTITLE = "";
export const KDP_HELPER_ROW_LABEL = "iPhone KDP helper";
export const KDP_HELPER_ROW_SUBTITLE = "";
/** Used by More → KDP and Ads books (non-Settings chrome); keep for main WIP. */
export const KDP_LINK_PREVIEW_TITLE = "KDP and Ads books";
export const KDP_LINK_PREVIEW_FOOTER =
  "Shared ASINs confirm which helper KDP books match the selected Ads profiles.";

export const ACCOUNT_SECTION_TITLE = "Account";
export const SUBSCRIPTION_ROW_LABEL = "Subscription";
export const PLAN_ROW_LABEL = "Plan";
export const MANAGE_BILLING_ROW_LABEL = "Plans & billing";
export const MY_ACCOUNT_ROW_LABEL = "My account";

/** Rows already name Bid bot — no section footer. */
export const ADS_SECTION_FOOTER = "";
export const ADS_SECTION_TITLE = "Amazon Ads";
export const AMAZON_ACCOUNTS_ROW_LABEL = "Amazon accounts";

export const BID_BOT_ROW_LABEL = "Bid bot";
export const BID_BOT_ROW_SUBTITLE = "";

export const KDP_SECTION_TITLE = "KDP";
export const DATA_SECTION_TITLE = "Data & Sync";
export const SYNC_ROW_LABEL = "Sync";
export const DATA_COVERAGE_ROW_LABEL = "Data coverage";
export const APP_SECTION_TITLE = "App";
export const ABOUT_SECTION_TITLE = "About";
export const VERSION_ROW_LABEL = "Version";

export const TEST_NOTIFICATION_LABEL = "Send test";
export const TEST_NOTIFICATION_SENDING = "Sending…";
export const TEST_NOTIFICATION_SENT = "Test sent";
export const TEST_NOTIFICATION_SERVER_SENT = "Server test sent";
export const TEST_NOTIFICATION_BLOCKED = "Allow alerts in iOS Settings";
export const TEST_NOTIFICATION_GUEST = "Sign in to send a test";
export const TEST_NOTIFICATION_TITLE = "Test alert";
export const TEST_NOTIFICATION_BODY =
  "Local test on this iPhone — not a server push check.";
/** Removed permanent hint — sent/blocked states carry honesty. */
export const TEST_NOTIFICATION_HINT = "";

export const VIEWING_CUSTOMER_SETTINGS_NOTE =
  "These prefs are yours, not the customer’s.";

export const GUEST_SETTINGS_NOTE = "Sign in for alerts";

export const IPHONE_ALERTS_LABEL = "iPhone alerts";
export const IPHONE_ALERTS_OFF = "Off";
export const IPHONE_ALERTS_SUBTITLE = "Allow in iOS Settings";

/** Removed — slider label is enough. */
export const SPEND_THRESHOLD_CAPTION = "";

/** Same rule as `parseLocaleNumber`: a lone comma is the decimal mark. */
export function parseSettingsNumber(raw: string): number {
  const trimmed = String(raw ?? "").trim().replace(/\s/g, "");
  if (!trimmed) return Number.NaN;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  if (hasComma && !hasDot) return Number(trimmed.replace(",", "."));
  return Number(trimmed);
}

export function spendThresholdLabel(percent: number): string {
  void percent;
  return "Overspend vs daily budgets";
}

export function spendThresholdAccessibilityLabel(percent: number): string {
  return `Overspend threshold, ${percent} percent above campaign daily budgets`;
}

export function notificationSwitchAccessibilityLabel(label: string, on: boolean): string {
  return `${label}, ${on ? "on" : "off"}`;
}

export const KDP_NET_ALERTS_LABEL = "Include KDP net";
export const DAILY_DIGEST_LABEL = "Daily summary";
export const DAILY_DIGEST_FOOTER = "";

export const NOTIFICATIONS_ROW_LABEL = "Notifications";
export const KDP_STALE_LABEL = "KDP data stalled";
export const KDP_STALE_FOOTER = "When royalties stop updating for over an hour.";
export const KDP_INGEST_SECTION_TITLE = "KDP status";
export const KDP_INGEST_EMPTY = "No KDP account linked to the selected profiles.";
export const KDP_INGEST_UNAVAILABLE = "Couldn't load KDP status.";
export const KDP_HELPER_FOOTER_ENABLED =
  "Signs in once. Syncs recent royalties about every 15 minutes.";
export const KDP_HELPER_FOOTER_DISABLED = "Turn on Chrome + iPhone under Royalty source first.";
export const KDP_HELPER_SETUP_ROW = "Set up iPhone helper";

/** Footers only for blocked / empty states — never restates On/Off. */
export function notificationFooter(input: {
  guestMode: boolean;
  permission: NotificationPermissionState;
  backgroundRegistered: boolean;
  anyEnabled: boolean;
}): string {
  if (input.guestMode) {
    return "Sign in for alerts";
  }
  if (input.permission === "denied") {
    return "Allow alerts in iOS Settings";
  }
  if (!input.anyEnabled) {
    return "Turn an alert on";
  }
  if (input.permission === "granted") {
    return "";
  }
  return "Allow notifications to send alerts";
}

export function testNotificationLabel(status: "idle" | "sending" | "sent" | "server" | "blocked" | "guest"): string {
  if (status === "sending") return TEST_NOTIFICATION_SENDING;
  if (status === "server") return TEST_NOTIFICATION_SERVER_SENT;
  if (status === "sent") return TEST_NOTIFICATION_SENT;
  if (status === "blocked") return TEST_NOTIFICATION_BLOCKED;
  if (status === "guest") return TEST_NOTIFICATION_GUEST;
  return TEST_NOTIFICATION_LABEL;
}
