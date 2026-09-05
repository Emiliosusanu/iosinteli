export const ACCOUNT_BILLING_URL = "https://dashboard.inteliads.io/billing";
/** Web dashboard — Chrome extension install / KDP import lives here, not on iPhone. */
export const KDP_CHROME_HELPER_URL = "https://dashboard.inteliads.io";
export const ACCOUNT_PLAN_UNAVAILABLE = "Unavailable";
export const ACCOUNT_STATUS_UNAVAILABLE = "Unavailable";
export const ACCOUNT_PLAN_NONE = "No plan";
export const ACCOUNT_STATUS_NONE = "No plan";
export const ACCOUNT_STATUS_CHECKING = "Checking…";

export const ACCOUNT_VIEW_AS_NOTE =
  "Viewing a customer. This page still shows your InteliAds account.";

/** Shared web handoff — never claim App Store / Amazon billing. */
export const ACCOUNT_BILLING_FOOTER = "Billing is managed on the web.";

export const ACCOUNT_NEST_SUBSCRIPTION_FOOTER =
  `Plan from your InteliAds account. ${ACCOUNT_BILLING_FOOTER}`;

export const ACCOUNT_NO_PLAN_FOOTER =
  `No active plan. ${ACCOUNT_BILLING_FOOTER}`;

export const ACCOUNT_METADATA_PLAN_FOOTER =
  `From account metadata only. ${ACCOUNT_BILLING_FOOTER}`;

export const ACCOUNT_SUBSCRIPTION_LOAD_FAILED_FOOTER =
  `Couldn't load plan. ${ACCOUNT_BILLING_FOOTER}`;

export const ACCOUNT_GUEST_NOTE = "Preview demo — not signed in.";

type Metadata = Record<string, unknown> | null | undefined;

/** Mirrors Nest `UserPlanDto` from `GET /pricing-plans/current`. */
export type NestUserPlan = {
  planId: string;
  planName: string;
  planSlug: string;
  billingCycle?: string;
  price: number;
  expiresAt?: string;
  renewsAt?: string;
  isActive: boolean;
  isTrial?: boolean;
  trialEndsAt?: string;
  canceledAt?: string;
  cancelAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  paymentFailed?: boolean;
  effectivePlanId?: string;
  effectivePlanName?: string;
  effectivePlanSlug?: string;
  temporaryAccess?: {
    id: string;
    temporaryPlan: string;
    temporaryPlanName: string;
    startsAt: string;
    expiresAt: string;
  } | null;
};

/** Accept raw DTO or `{ data: DTO | null }` from Nest success envelopes. */
export function normalizeNestUserPlanPayload(raw: unknown): NestUserPlan | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const candidate =
    typeof obj.planId === "string" || typeof obj.planName === "string" || typeof obj.planSlug === "string"
      ? obj
      : obj.data === null
        ? null
        : obj.data && typeof obj.data === "object"
          ? (obj.data as Record<string, unknown>)
          : null;
  if (candidate == null) return null;
  if (
    typeof candidate.planId !== "string" &&
    typeof candidate.planName !== "string" &&
    typeof candidate.planSlug !== "string"
  ) {
    return null;
  }
  return candidate as unknown as NestUserPlan;
}

export type AccountPlanPresentation = {
  label: string;
  source: "user metadata" | "app metadata" | null;
  truth: "METADATA ONLY" | "UNKNOWN";
};

export type AccountSubscriptionPresentation = {
  planLabel: string;
  statusLabel: string;
  planSubtitle?: string;
  footer: string;
  truth: "NEST" | "METADATA ONLY" | "NO PLAN" | "UNKNOWN" | "LOADING";
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

function nestPaymentFailed(plan: NestUserPlan): boolean {
  return Boolean(
    plan.paymentFailed ||
      (!!plan.stripeSubscriptionId &&
        !plan.renewsAt &&
        !plan.isTrial &&
        !plan.canceledAt),
  );
}

/** Map Nest plan DTO fields to a short Settings-row status label. */
export function nestSubscriptionStatusLabel(plan: NestUserPlan): string {
  if (nestPaymentFailed(plan)) return "Payment failed";
  if (plan.canceledAt || plan.cancelAt) {
    return plan.isTrial ? "Trial canceled" : "Canceled";
  }
  if (plan.isTrial) return "Trial";
  if (plan.isActive) return "Active";
  return ACCOUNT_STATUS_UNAVAILABLE;
}

export function nestPlanDisplayName(plan: NestUserPlan): string {
  const effective = plan.effectivePlanName?.trim();
  if (effective) return effective;
  const name = plan.planName?.trim();
  if (name) return name;
  return ACCOUNT_PLAN_UNAVAILABLE;
}

/**
 * Prefer authoritative Nest `/pricing-plans/current`. Fall back to Supabase
 * metadata only when Nest fails to load — never invent Active/Pro.
 */
export function accountSubscriptionPresentation(params: {
  nestPlan?: NestUserPlan | null;
  nestStatus: "idle" | "loading" | "success" | "error";
  userMetadata?: Metadata;
  appMetadata?: Metadata;
}): AccountSubscriptionPresentation {
  const { nestPlan, nestStatus } = params;

  if (nestStatus === "loading" || nestStatus === "idle") {
    return {
      planLabel: ACCOUNT_STATUS_CHECKING,
      statusLabel: ACCOUNT_STATUS_CHECKING,
      footer: ACCOUNT_BILLING_FOOTER,
      truth: "LOADING",
    };
  }

  if (nestStatus === "success") {
    if (!nestPlan) {
      return {
        planLabel: ACCOUNT_PLAN_NONE,
        statusLabel: ACCOUNT_STATUS_NONE,
        footer: ACCOUNT_NO_PLAN_FOOTER,
        truth: "NO PLAN",
      };
    }
    const planLabel = nestPlanDisplayName(nestPlan);
    const temp = nestPlan.temporaryAccess?.temporaryPlanName?.trim();
    return {
      planLabel,
      statusLabel: nestSubscriptionStatusLabel(nestPlan),
      planSubtitle: temp && temp !== planLabel ? `Includes temporary ${temp}` : undefined,
      footer: ACCOUNT_NEST_SUBSCRIPTION_FOOTER,
      truth: "NEST",
    };
  }

  // Nest error / unavailable — honest metadata fallback only for plan name.
  const meta = accountPlanPresentation({
    userMetadata: params.userMetadata,
    appMetadata: params.appMetadata,
  });
  if (meta.source) {
    return {
      planLabel: meta.label,
      statusLabel: ACCOUNT_STATUS_UNAVAILABLE,
      planSubtitle: "Metadata only",
      footer: ACCOUNT_METADATA_PLAN_FOOTER,
      truth: "METADATA ONLY",
    };
  }
  return {
    planLabel: ACCOUNT_PLAN_UNAVAILABLE,
    statusLabel: ACCOUNT_STATUS_UNAVAILABLE,
    footer: ACCOUNT_SUBSCRIPTION_LOAD_FAILED_FOOTER,
    truth: "UNKNOWN",
  };
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
    ? `${identity}\n\nReturns to Sign in.`
    : "Returns to Sign in.";
}
