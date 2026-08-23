export type NotificationPermissionState = "granted" | "denied" | "undetermined";

export const APPEARANCE_LABEL = "Appearance";
export const APPEARANCE_VALUE = "Follows system";

export const KDP_PROFIT_LABEL = "Profit source";
export const KDP_PROFIT_VALUE = "KDP royalties";
export const KDP_SECTION_FOOTER =
  "Imported KDP royalties are the profit source. This iPhone does not collect KDP. Use the Chrome helper at inteliads.io.";

export const ADS_SECTION_FOOTER =
  "BidBot Target ACoS and auto mode live on Bid bot. Account min/max shown there come from the web store, not from this screen. Campaign daily budgets are edited on each campaign. This iPhone does not cap Amazon bids here.";

export const BID_BOT_ROW_LABEL = "Bid bot";
export const BID_BOT_ROW_SUBTITLE = "Target ACoS and auto mode";

export const TEST_NOTIFICATION_LABEL = "Send a test on this iPhone";
export const TEST_NOTIFICATION_SENDING = "Sending…";
export const TEST_NOTIFICATION_SENT = "Test sent on this iPhone";
export const TEST_NOTIFICATION_BLOCKED = "Allow alerts in iOS Settings";
export const TEST_NOTIFICATION_GUEST = "Sign in to send a test";
export const TEST_NOTIFICATION_TITLE = "Test alert";
export const TEST_NOTIFICATION_BODY =
  "This is a local test on this iPhone. It does not confirm server push.";
export const TEST_NOTIFICATION_HINT = "Sends a local alert now. Does not test server push.";

export const VIEWING_CUSTOMER_SETTINGS_NOTE =
  "These preferences apply to your signed-in account, not the customer you're viewing.";

export const GUEST_SETTINGS_NOTE = "Preview demo keeps these choices on this iPhone only. Alerts need a signed-in account.";

export const IPHONE_ALERTS_LABEL = "iPhone alerts";
export const IPHONE_ALERTS_OFF = "Off";
export const IPHONE_ALERTS_SUBTITLE = "Allow notifications in iOS Settings";

export const SPEND_THRESHOLD_CAPTION =
  "Uses the sum of campaign daily budgets, not a number typed on this screen.";

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
  return `Alert when today's Ads spend is ${percent}% above the sum of campaign daily budgets.`;
}

export function spendThresholdAccessibilityLabel(percent: number): string {
  return `Overspend threshold, ${percent} percent above campaign daily budgets`;
}

export function notificationSwitchAccessibilityLabel(label: string, on: boolean): string {
  return `${label}, ${on ? "on" : "off"}`;
}

export function notificationFooter(input: {
  guestMode: boolean;
  permission: NotificationPermissionState;
  backgroundRegistered: boolean;
  anyEnabled: boolean;
}): string {
  if (input.guestMode) {
    return "Sign in to get alerts. Preview demo cannot send notifications.";
  }
  if (input.permission === "denied") {
    return "iPhone alerts are off in system Settings. These switches only choose what to check later. They cannot send alerts until you allow notifications.";
  }
  if (!input.anyEnabled) {
    return "Alerts stay off until you turn one on. Checks run on this iPhone while the app is open. Background checks are best-effort and are not remote push.";
  }
  if (input.permission === "granted") {
    return input.backgroundRegistered
      ? "Local alerts on this iPhone. Checks run while the app is open, and iOS may run them in the background. This is not remote push. New-order and overspend taps open Campaigns. Book taps open that book when the ASIN is known."
      : "Local alerts on this iPhone while the app is open. Background delivery is unavailable. This is not remote push. New-order and overspend taps open Campaigns. Book taps open that book when the ASIN is known.";
  }
  return "Alerts are selected. Allow notifications when you turn an alert on or send a test. Alerts are local to this iPhone, not remote push.";
}

export function testNotificationLabel(status: "idle" | "sending" | "sent" | "blocked" | "guest"): string {
  if (status === "sending") return TEST_NOTIFICATION_SENDING;
  if (status === "sent") return TEST_NOTIFICATION_SENT;
  if (status === "blocked") return TEST_NOTIFICATION_BLOCKED;
  if (status === "guest") return TEST_NOTIFICATION_GUEST;
  return TEST_NOTIFICATION_LABEL;
}
