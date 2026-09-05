export type NotificationPermissionState = "granted" | "denied" | "undetermined";

export const APPEARANCE_LABEL = "Appearance";
export const APPEARANCE_VALUE = "Follows system";

export const KDP_PROFIT_LABEL = "Royalty source";
export const KDP_PROFIT_VALUE = "KDP royalties";
export const KDP_SECTION_FOOTER =
  "Net Royalties = KDP royalties minus Amazon Ads spend. Manage KDP account links here or under Amazon Accounts. Chrome helper and this iPhone write the same schedule; the iPhone helper keeps a Keychain session (After First Unlock) for background replay.";

export const KDP_SOURCE_PICKER_TITLE = "Royalty source";
export const KDP_SOURCE_PICKER_FOOTER =
  "Choose where KDP royalties come from. The iPhone helper mirrors Royaltix + Chrome: short wakes pull today + yesterday every ~15 minutes, then continue leftover last-30 days; longer wakes run 30→90 day onboarding. A nightly last-30 correction starts after 2am and keeps retrying missed days until every day is imported. The phone backfill is skipped when the web app already imported history. Background replay uses the Keychain session (BG refresh / push). Both writers share the same tables.";

export const KDP_ACCOUNTS_ROW_LABEL = "KDP accounts";
export const KDP_ACCOUNTS_ROW_SUBTITLE = "Link and unlink Amazon Ads profiles";
export const KDP_HELPER_ROW_LABEL = "iPhone KDP helper";
export const KDP_HELPER_ROW_SUBTITLE = "Sign in once, then background import";

export const ACCOUNT_SECTION_TITLE = "Account";
export const SUBSCRIPTION_ROW_LABEL = "Subscription";
export const PLAN_ROW_LABEL = "Plan";
export const MANAGE_BILLING_ROW_LABEL = "Manage billing on the web";

export const ADS_SECTION_FOOTER =
  "BidBot Target ACoS and auto mode live on Bid bot. Account min/max shown there come from the web store, not from this screen. Campaign daily budgets are edited on each campaign. This iPhone does not cap Amazon bids here.";

export const BID_BOT_ROW_LABEL = "Bid bot";
export const BID_BOT_ROW_SUBTITLE = "Target ACoS and auto mode";

export const TEST_NOTIFICATION_LABEL = "Send a test on this iPhone";
export const TEST_NOTIFICATION_SENDING = "Sending…";
export const TEST_NOTIFICATION_SENT = "Test sent on this iPhone";
export const TEST_NOTIFICATION_SERVER_SENT = "Server test push sent";
export const TEST_NOTIFICATION_BLOCKED = "Allow alerts in iOS Settings";
export const TEST_NOTIFICATION_GUEST = "Sign in to send a test";
export const TEST_NOTIFICATION_TITLE = "Test alert";
export const TEST_NOTIFICATION_BODY =
  "This is a local test on this iPhone. It does not confirm server push.";
export const TEST_NOTIFICATION_HINT =
  "Sends a local alert on this iPhone, then tries a server push when available.";

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
  return `Alert when Ads spend for today or yesterday is ${percent}% above the sum of campaign daily budgets.`;
}

export function spendThresholdAccessibilityLabel(percent: number): string {
  return `Overspend threshold, ${percent} percent above campaign daily budgets`;
}

export function notificationSwitchAccessibilityLabel(label: string, on: boolean): string {
  return `${label}, ${on ? "on" : "off"}`;
}

export const KDP_NET_ALERTS_LABEL = "Include KDP net in alerts";
export const DAILY_DIGEST_LABEL = "Daily performance updates";
export const DAILY_DIGEST_FOOTER =
  "When enabled, this iPhone sends daytime digests at 10am, noon, 2pm, 4pm, 6pm, and 8pm. The morning (8am) yesterday summary comes from InteliAds when server push is on — not twice. Each alert includes ad spend, orders, and ACoS.";

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
    return "Alerts stay off until you turn one on. This iPhone evaluates alerts while open and during background refresh.";
  }
  if (input.permission === "granted") {
    return `${DAILY_DIGEST_FOOTER} Turn on KDP net to append royalties or net to the same alert. With alerts on, this iPhone refreshes Ads and linked KDP from InteliAds about every 15 minutes in the background and when a push wakes the app.`;
  }
  return "Alerts are selected. Allow notifications when you turn an alert on or send a test. This iPhone evaluates alerts while open and during background refresh.";
}

export function testNotificationLabel(status: "idle" | "sending" | "sent" | "server" | "blocked" | "guest"): string {
  if (status === "sending") return TEST_NOTIFICATION_SENDING;
  if (status === "server") return TEST_NOTIFICATION_SERVER_SENT;
  if (status === "sent") return TEST_NOTIFICATION_SENT;
  if (status === "blocked") return TEST_NOTIFICATION_BLOCKED;
  if (status === "guest") return TEST_NOTIFICATION_GUEST;
  return TEST_NOTIFICATION_LABEL;
}
