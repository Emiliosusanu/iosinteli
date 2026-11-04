import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const billing = readFileSync(new URL("../app/more/billing.tsx", import.meta.url), "utf8");

test("Apple checkout does not advertise a web price or web trial when StoreKit has no product", () => {
  assert.doesNotMatch(billing, /formatNestPricingPlanPrice|group\.trialDays|group\.description/);
  assert.match(billing, /storeProduct\?\.description/);
});

test("StoreKit errors have their own retry and remain distinct from an empty product catalog", () => {
  assert.match(billing, /billing-store-error/);
  assert.match(billing, /billing-store-empty/);
  assert.match(billing, /storeProductsQ\.refetch/);
});

test("an unknown or refreshing current plan blocks checkout", () => {
  assert.match(billing, /currentPlanQ\.isFetching/);
  assert.match(billing, /currentPlanQ\.isError/);
  assert.match(billing, /currentPlanQ\.refetch\(\)/);
});
