export type NotificationPermissionState = "granted" | "denied" | "undetermined";

export const APPEARANCE_LABEL = "Appearance";
export const APPEARANCE_VALUE = "Follows system";

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

export const ACCOUNT_SECTION_TITLE = "Account";
export const SUBSCRIPTION_ROW_LABEL = "Subscription";
export const PLAN_ROW_LABEL = "Plan";
export const MANAGE_BILLING_ROW_LABEL = "Manage billing on the web";

/** Rows already name Bid bot — no section footer. */
export const ADS_SECTION_FOOTER = "";

export const BID_BOT_ROW_LABEL = "Bid bot";
export const BID_BOT_ROW_SUBTITLE = "";

export const TEST_NOTIFICATION_LABEL = "Send a test on this iPhone";
export const TEST_NOTIFICATION_SENDING = "Sending…";
export const TEST_NOTIFICATION_SENT = "Test sent on this iPhone";
export const TEST_NOTIFICATION_SERVER_SENT = "Server test push sent";
export const TEST_NOTIFICATION_BLOCKED = "Allow alerts in iOS Settings";
export const TEST_NOTIFICATION_GUEST = "Sign in to send a test";
export const TEST_NOTIFICATION_TITLE = "Test alert";
export const TEST_NOTIFICATION_BODY =
  "This is a local test on this iPhone. It does not confirm server push.";
/** Removed permanent hint — sent/blocked states carry honesty. */
export const TEST_NOTIFICATION_HINT = "";

export const VIEWING_CUSTOMER_SETTINGS_NOTE =
  "Prefs are for your signed-in account, not the customer.";

export const GUEST_SETTINGS_NOTE = "Sign in for alerts";

export const IPHONE_ALERTS_LABEL = "iPhone alerts";
export const IPHONE_ALERTS_OFF = "Off";
export const IPHONE_ALERTS_SUBTITLE = "Allow notifications in iOS Settings";

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

export const KDP_NET_ALERTS_LABEL = "Include KDP net in alerts";
export const DAILY_DIGEST_LABEL = "Daily performance updates";
export const DAILY_DIGEST_FOOTER = "Daytime digests";

export const NOTIFICATIONS_ROW_LABEL = "Notifications";
export const KDP_STALE_LABEL = "KDP data stalled";
export const KDP_STALE_FOOTER =
  "Alert when a linked KDP account has not received royalty data for more than an hour — Chrome extension or iPhone helper.";
export const KDP_INGEST_SECTION_TITLE = "KDP ingest";
export const KDP_INGEST_EMPTY = "No KDP account is linked to the selected Amazon profiles.";
export const KDP_INGEST_UNAVAILABLE = "Couldn't load KDP ingest status.";

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
    return "Alerts on";
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
