export const ACCOUNT_BILLING_URL = "https://dashboard.inteliads.io/billing";
/** Web dashboard — Chrome extension install / KDP import lives here, not on iPhone. */
export const KDP_CHROME_HELPER_URL = "https://dashboard.inteliads.io";
export const ACCOUNT_PLAN_UNAVAILABLE = "Unavailable";
export const ACCOUNT_STATUS_UNAVAILABLE = "Unavailable";
export const ACCOUNT_PLAN_NONE = "No plan";
export const ACCOUNT_STATUS_NONE = "No plan";
export const ACCOUNT_STATUS_CHECKING = "Checking…";

export const ACCOUNT_VIEW_AS_NOTE =
  "Viewing a customer — still your InteliAds account.";

/** Account screens route subscription actions through the native billing screen. */
export const ACCOUNT_BILLING_FOOTER = "Manage your subscription in Plans & billing.";

/** Nest plan already shows on the row — no permanent footer. */
export const ACCOUNT_NEST_SUBSCRIPTION_FOOTER = "";

export const ACCOUNT_NO_PLAN_FOOTER = "No active plan. Choose a plan in Plans & billing.";

export const ACCOUNT_METADATA_PLAN_FOOTER = "From account metadata. Manage it in Plans & billing.";

export const ACCOUNT_SUBSCRIPTION_LOAD_FAILED_FOOTER = "Couldn't load plan. Try again in Plans & billing.";

export const ACCOUNT_GUEST_NOTE = "Preview — not signed in.";

export const BILLING_SCREEN_TITLE = "Plans & billing";
export const BILLING_SCREEN_FOOTER =
  "Subscriptions are purchased securely through your Apple ID.";
export const BILLING_CURRENT_PLAN_BADGE = "Current";
export const BILLING_MANAGE_PORTAL_LABEL = "Manage in Stripe";

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
  billingProvider?: "apple" | "stripe";
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

/** Mirrors Nest catalog row from `GET /pricing-plans` (web `PricingPlan`). */
export type NestPricingPlan = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  priceMonthly: number;
  priceYearly: number;
  billingCycle?: string;
  features?: string[];
  isPopular?: boolean;
  isActive?: boolean;
  sortOrder?: number;
  trialDays?: number;
  stripeProductId?: string;
  stripePriceId?: string;
};

export type BillingCyclePreference = "month" | "year";

export type NestPricingPlanGroup = {
  baseSlug: string;
  name: string;
  description?: string;
  isPopular: boolean;
  sortOrder: number;
  trialDays: number;
  monthlyPlan?: NestPricingPlan;
  yearlyPlan?: NestPricingPlan;
};

/** Dashboard billing URL with optional plan slug for iOS Safari handoff. */
export function buildAccountBillingUrl(opts?: {
  planSlug?: string | null;
  source?: string;
}): string {
  const url = new URL(ACCOUNT_BILLING_URL);
  const slug = opts?.planSlug?.trim();
  if (slug) url.searchParams.set("planSlug", slug);
  url.searchParams.set("source", opts?.source?.trim() || "ios");
  return url.toString();
}

export function nestPricingPlanCycle(plan: NestPricingPlan): BillingCyclePreference | null {
  const slug = plan.slug.toLowerCase();
  const cycle = (plan.billingCycle ?? "").toLowerCase();
  if (slug.endsWith("-year") || slug.endsWith("-annual") || cycle === "year" || cycle === "annual") {
    return "year";
  }
  if (slug.endsWith("-month") || slug.endsWith("-monthly") || cycle === "month" || cycle === "monthly") {
    return "month";
  }
  return null;
}

export function nestPricingPlanBaseSlug(slug: string): string {
  return slug.replace(/-(month|year|monthly|annual)$/i, "");
}

export function formatNestPricingPlanPrice(
  plan: NestPricingPlan,
  cycle: BillingCyclePreference,
): string {
  const amount = cycle === "year" ? plan.priceYearly : plan.priceMonthly;
  if (!Number.isFinite(amount) || amount < 0) return "—";
  // Nest catalog stores dollar amounts (same as web Pricing), not Stripe cents.
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  return cycle === "year" ? `${formatted}/yr` : `${formatted}/mo`;
}

export function groupNestPricingPlans(plans: NestPricingPlan[]): NestPricingPlanGroup[] {
  const grouped = new Map<string, NestPricingPlanGroup>();
  for (const plan of plans) {
    if (plan.isActive === false) continue;
    const baseSlug = nestPricingPlanBaseSlug(plan.slug);
    let group = grouped.get(baseSlug);
    if (!group) {
      group = {
        baseSlug,
        name: plan.name.replace(/\s*(Monthly|Annual|Yearly)\s*$/i, "").trim() || plan.name,
        description: plan.description,
        isPopular: Boolean(plan.isPopular),
        sortOrder: Number(plan.sortOrder ?? 0),
        trialDays: Number(plan.trialDays ?? 0),
      };
      grouped.set(baseSlug, group);
    }
    const cycle = nestPricingPlanCycle(plan);
    if (cycle === "year") group.yearlyPlan = plan;
    else if (cycle === "month") group.monthlyPlan = plan;
    else if (!group.monthlyPlan) group.monthlyPlan = plan;
    if (plan.isPopular) group.isPopular = true;
    if (typeof plan.sortOrder === "number") {
      group.sortOrder = Math.min(group.sortOrder, plan.sortOrder);
    }
    if (typeof plan.trialDays === "number" && plan.trialDays > group.trialDays) {
      group.trialDays = plan.trialDays;
    }
  }
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aPrice = a.monthlyPlan?.priceMonthly ?? a.yearlyPlan?.priceMonthly ?? 0;
    const bPrice = b.monthlyPlan?.priceMonthly ?? b.yearlyPlan?.priceMonthly ?? 0;
    return aPrice - bPrice;
  });
}

export function pickNestPricingPlanForCycle(
  group: NestPricingPlanGroup,
  cycle: BillingCyclePreference,
): NestPricingPlan | null {
  const preferred = cycle === "year" ? group.yearlyPlan : group.monthlyPlan;
  return preferred ?? group.monthlyPlan ?? group.yearlyPlan ?? null;
}

export function isNestPricingPlanCurrent(
  plan: NestPricingPlan,
  current: NestUserPlan | null | undefined,
): boolean {
  if (!current) return false;
  const currentSlug = (current.effectivePlanSlug || current.planSlug || "").trim();
  const currentPrice = (current.stripePriceId || "").trim();
  if (currentPrice && plan.stripePriceId && currentPrice === plan.stripePriceId) return true;
  if (currentSlug && currentSlug === plan.slug) return true;
  if (currentSlug && nestPricingPlanBaseSlug(currentSlug) === nestPricingPlanBaseSlug(plan.slug)) {
    return true;
  }
  return false;
}

/** Accept raw array or `{ data: [...] }` Nest success envelopes. */
export function normalizeNestPricingPlansPayload(raw: unknown): NestPricingPlan[] {
  if (raw == null) return [];
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
      ? ((raw as { data: unknown[] }).data)
      : [];
  const out: NestPricingPlan[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : null;
    const name = typeof row.name === "string" ? row.name : null;
    const slug = typeof row.slug === "string" ? row.slug : null;
    if (!id || !name || !slug) continue;
    out.push({
      id,
      name,
      slug,
      description: typeof row.description === "string" ? row.description : undefined,
      priceMonthly: Number(row.priceMonthly ?? 0),
      priceYearly: Number(row.priceYearly ?? 0),
      billingCycle: typeof row.billingCycle === "string" ? row.billingCycle : undefined,
      features: Array.isArray(row.features)
        ? row.features.filter((f): f is string => typeof f === "string")
        : undefined,
      isPopular: Boolean(row.isPopular),
      isActive: row.isActive === undefined ? true : Boolean(row.isActive),
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : undefined,
      trialDays: typeof row.trialDays === "number" ? row.trialDays : undefined,
      stripeProductId: typeof row.stripeProductId === "string" ? row.stripeProductId : undefined,
      stripePriceId: typeof row.stripePriceId === "string" ? row.stripePriceId : undefined,
    });
  }
  return out;
}

export function unwrapNestUrlPayload(raw: unknown): { url: string; sessionId?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const candidate =
    typeof obj.url === "string"
      ? obj
      : obj.data && typeof obj.data === "object"
        ? (obj.data as Record<string, unknown>)
        : null;
  if (!candidate || typeof candidate.url !== "string" || !candidate.url.trim()) return null;
  return {
    url: candidate.url.trim(),
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
  };
}

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
      footer: "",
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
