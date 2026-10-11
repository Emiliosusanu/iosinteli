export const APPLE_PRODUCT_BY_PLAN_SLUG: Readonly<Record<string, string>> = Object.freeze({
  "starter-month": "io.inteliads.app.starter.month",
  "starter-year": "io.inteliads.app.starter.year",
  "pro-month": "io.inteliads.app.pro.month",
  "pro-year": "io.inteliads.app.pro.year",
  "unlimited-month": "io.inteliads.app.publisher.month",
  "unlimited-year": "io.inteliads.app.publisher.year",
});

export function appleProductIdForPlanSlug(planSlug: string): string | null {
  return APPLE_PRODUCT_BY_PLAN_SLUG[planSlug] ?? null;
}
