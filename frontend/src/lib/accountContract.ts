export const ACCOUNT_BILLING_URL = "https://dashboard.inteliads.io/billing";
export const ACCOUNT_PLAN_UNAVAILABLE = "Unavailable";
export const ACCOUNT_STATUS_UNAVAILABLE = "Unavailable";

export const ACCOUNT_VIEW_AS_NOTE =
  "You're viewing a customer's Amazon data. This page still shows your signed-in InteliAds account.";

export const ACCOUNT_BILLING_FOOTER =
  "This app does not receive authoritative subscription status. Billing is managed on the web.";

export const ACCOUNT_GUEST_NOTE =
  "Preview demo is active. No InteliAds account is signed in.";

type Metadata = Record<string, unknown> | null | undefined;

export type AccountPlanPresentation = {
  label: string;
  source: "user metadata" | "app metadata" | null;
  truth: "METADATA ONLY" | "UNKNOWN";
};

function metadataString(metadata: Metadata, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function accountPlanPresentation(params: {
  userMetadata?: Metadata;
  appMetadata?: Metadata;
}): AccountPlanPresentation {
  const userPlan = metadataString(params.userMetadata, "plan");
  if (userPlan) return { label: userPlan, source: "user metadata", truth: "METADATA ONLY" };

  const appPlan = metadataString(params.appMetadata, "plan");
  if (appPlan) return { label: appPlan, source: "app metadata", truth: "METADATA ONLY" };

  const userSubscription = metadataString(params.userMetadata, "subscription");
  if (userSubscription) {
    return { label: userSubscription, source: "user metadata", truth: "METADATA ONLY" };
  }

  return { label: ACCOUNT_PLAN_UNAVAILABLE, source: null, truth: "UNKNOWN" };
}

export function amazonProfileViewSummary(selectedCount: number, totalCount: number): string {
  const total = Math.max(0, Math.trunc(totalCount));
  const selected = Math.min(total, Math.max(0, Math.trunc(selectedCount)));
  if (total === 0) return "No profiles";
  return `${selected} of ${total}`;
}

export function signOutConfirmMessage(email?: string | null): string {
  const identity = email?.trim();
  return identity
    ? `${identity}\n\nYou'll return to Sign in on this iPhone.`
    : "You'll return to Sign in on this iPhone.";
}
