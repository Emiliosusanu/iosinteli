import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AMAZON_LOGIN_HINT,
  CHECKING_SESSION_LABEL,
  FORGOT_SUCCESS,
  FORGOT_SUBTITLE,
  GUEST_CTA,
  GUEST_HINT,
  LOGIN_SUBTITLE,
  MIN_PASSWORD_LENGTH,
  RESET_WEB_COPY,
  SIGNUP_CONFIRM_COPY,
  SIGNUP_CREATED_COPY,
  SIGNUP_PASSWORD_RULE,
  authRedirectTarget,
  humanizeAuthError,
  isLikelyNetworkAuthError,
  passwordVisibilityLabel,
  signupOutcomeCopy,
} from "../src/lib/authContract.ts";

const login = readFileSync(new URL("../app/auth/login.tsx", import.meta.url), "utf8");
const signup = readFileSync(new URL("../app/auth/signup.tsx", import.meta.url), "utf8");
const forgot = readFileSync(new URL("../app/auth/forgot.tsx", import.meta.url), "utf8");
const reset = readFileSync(new URL("../app/auth/reset.tsx", import.meta.url), "utf8");
const welcome = readFileSync(new URL("../app/auth/welcome.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");

test("RouteGuard keeps loading parked, sends guests of auth to login, and bounces authenticated users off auth", () => {
  assert.equal(authRedirectTarget("loading", ["auth", "login"]), null);
  assert.equal(authRedirectTarget("unauthenticated", ["(tabs)"]), "/auth/login");
  assert.equal(authRedirectTarget("unauthenticated", ["auth", "login"]), null);
  assert.equal(authRedirectTarget("unauthenticated", ["auth", "reset"]), null);
  assert.equal(authRedirectTarget("authenticated", ["auth", "login"]), "/(tabs)");
  assert.equal(authRedirectTarget("authenticated", ["auth", "reset"]), "/(tabs)");
  assert.equal(authRedirectTarget("authenticated", ["index"]), "/(tabs)");
  assert.equal(authRedirectTarget("authenticated", ["(tabs)"]), null);
  assert.match(layout, /authRedirectTarget/);
});

test("login pending and errors stay generic and keep the form", () => {
  assert.equal(humanizeAuthError("Invalid login credentials", "login"), "Couldn't sign in with that email and password.");
  assert.equal(humanizeAuthError("Failed to fetch", "login"), "Couldn't reach InteliAds. Check your connection and try again.");
  assert.ok(isLikelyNetworkAuthError("Network request failed"));
  assert.doesNotMatch(humanizeAuthError("Invalid login credentials", "login"), /Wrong password/);
  assert.match(login, /humanizeAuthError/);
  assert.match(login, /if \(loading\) return/);
  assert.doesNotMatch(login, /setPassword\(""\)/);
  assert.match(login, /LOGIN_SUBTITLE/);
  assert.match(login, /textContentType="username"/);
  assert.match(login, /autoComplete="username"/);
  assert.equal(LOGIN_SUBTITLE, "Continue with Amazon, or use your InteliAds email.");
});

test("signup validation matches the 6-character provider rule and does not invent extra rules", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 6);
  assert.equal(SIGNUP_PASSWORD_RULE, "Use at least 6 characters.");
  assert.equal(signupOutcomeCopy(true), SIGNUP_CONFIRM_COPY);
  assert.equal(signupOutcomeCopy(false), SIGNUP_CREATED_COPY);
  assert.doesNotMatch(SIGNUP_CREATED_COPY, /signed in/i);
  assert.doesNotMatch(SIGNUP_PASSWORD_RULE, /uppercase|12 characters/);
  assert.doesNotMatch(signup, /uppercase|12 characters/);
  assert.match(signup, /humanizeAuthError/);
  assert.match(signup, /signupOutcomeCopy/);
});

test("forgot password success is generic and finishes on the web", () => {
  assert.match(FORGOT_SUCCESS, /If an account exists/);
  assert.match(FORGOT_SUCCESS, /on the web/);
  assert.match(FORGOT_SUBTITLE, /on the web/);
  assert.match(forgot, /FORGOT_SUCCESS/);
  assert.match(RESET_WEB_COPY, /on the web/);
  assert.match(reset, /RESET_WEB_COPY/);
  assert.match(reset, /canReset = !!session/);
  assert.equal((reset.match(/RESET_WEB_COPY/g) || []).length, 2);
});

test("guest preview is explicit and is not sample Amazon data", () => {
  assert.equal(GUEST_CTA, "Preview demo");
  assert.match(GUEST_HINT, /without an account/);
  assert.doesNotMatch(GUEST_HINT, /sample data|fixtures/);
  assert.match(login, /GUEST_CTA/);
  assert.match(login, /enterGuestMode/);
});

test("password visibility and Amazon auth-session handoff stay labeled", () => {
  assert.equal(passwordVisibilityLabel(false), "Show password");
  assert.equal(passwordVisibilityLabel(true), "Hide password");
  assert.match(AMAZON_LOGIN_HINT, /Amazon Ads/);
  assert.match(login, /AMAZON_LOGIN_HINT/);
  assert.match(login, /startAmazonLogin/);
  assert.match(login, /AuthAmazon/);
  assert.doesNotMatch(login, /amazonLoginHidden|setAmazonLoginHidden/);
  assert.match(welcome, /welcome-sign-in/);
  assert.match(welcome, /Profit by book/);
  assert.doesNotMatch(welcome, /Ionicons/);
  assert.equal(CHECKING_SESSION_LABEL, "Checking session");
});

test("Sign in CTAs are plain RN touchables (no Reanimated transform wrappers)", () => {
  const chrome = readFileSync(new URL("../src/components/auth/AuthChrome.tsx", import.meta.url), "utf8");
  assert.match(chrome, /export function AuthPrimary/);
  assert.match(chrome, /testID={testID}/);
  assert.match(chrome, /TouchableOpacity/);
  // Nested scale wrappers ate presses on physical Sign in.
  assert.doesNotMatch(chrome, /usePressScale|withSpring|useSharedValue/);
  assert.doesNotMatch(chrome, /FadeInUp/);
  assert.match(login, /login-submit-btn/);
  assert.match(login, /AuthPrimary/);
});
