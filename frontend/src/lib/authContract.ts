export const MIN_PASSWORD_LENGTH = 6;

export const LOGIN_TITLE = "Sign in";
export const LOGIN_SUBTITLE = "Use your InteliAds email and password.";

export const SIGNUP_TITLE = "Create account";
export const SIGNUP_PASSWORD_RULE = "Use at least 6 characters.";
export const SIGNUP_CONFIRM_COPY = "Check your email, then sign in.";
export const SIGNUP_CREATED_COPY = "Account created.";

export const FORGOT_TITLE = "Forgot password";
export const FORGOT_SUBTITLE = "We'll email a reset link. Finish the reset on the web.";
export const FORGOT_SUCCESS =
  "If an account exists, check your email. Finish the reset on the web.";

export const RESET_TITLE = "New password";
export const RESET_WEB_COPY = "Open the reset link from your email on the web.";
export const RESET_UPDATED_COPY = "Password updated. You can sign in with it now.";

export const GUEST_CTA = "Preview demo";
export const GUEST_HINT = "Look around without an account. Amazon Ads won't change.";

export const AMAZON_LOGIN_LABEL = "Login with Amazon";
export const AMAZON_LOGIN_BUSY = "Opening Amazon…";
export const AMAZON_LOGIN_HINT = "Opens Amazon in the browser.";

export const CHECKING_SESSION_LABEL = "Checking session";

export type AuthKind = "login" | "signup" | "forgot" | "reset";

export function isLikelyNetworkAuthError(message: string): boolean {
  const m = String(message ?? "").toLowerCase();
  return /network|offline|fetch|timeout|timed out|failed to fetch|internet|connection|unreachable/.test(m);
}

export function passwordVisibilityLabel(visible: boolean): string {
  return visible ? "Hide password" : "Show password";
}

export function humanizeAuthError(raw: string | undefined, kind: AuthKind): string {
  const message = String(raw ?? "").trim();
  if (!message) return fallbackFor(kind);
  if (isLikelyNetworkAuthError(message)) {
    return "Couldn't reach InteliAds. Check your connection and try again.";
  }
  if (/email not confirmed|email_not_confirmed/i.test(message)) {
    return SIGNUP_CONFIRM_COPY;
  }
  if (/invalid login credentials|invalid_credentials|invalid email or password/i.test(message)) {
    return "Couldn't sign in with that email and password.";
  }
  if (/user already registered|already registered|already exists/i.test(message)) {
    return "Couldn't create this account. Try signing in, or use a different email.";
  }
  if (/rate limit|too many|over_email_send_rate_limit/i.test(message)) {
    return "Too many attempts. Try again in a moment.";
  }
  if (/jwt|refresh.token|rls|postgres|supabase|stack|authorization/i.test(message)) {
    return fallbackFor(kind);
  }
  return fallbackFor(kind);
}

function fallbackFor(kind: AuthKind): string {
  if (kind === "login") return "Couldn't sign in. Try again.";
  if (kind === "signup") return "Couldn't create the account. Try again.";
  if (kind === "forgot") return "Couldn't send the reset email. Try again.";
  return "Couldn't update the password. Try again.";
}

/** Mirrors RouteGuard. Do not send authenticated users into auth screens. */
export function authRedirectTarget(
  state: "loading" | "authenticated" | "unauthenticated",
  segments: string[],
): "/auth/login" | "/(tabs)" | null {
  if (state === "loading") return null;
  const root = segments[0];
  const inAuthGroup = root === "auth";
  const onIndex = segments.length === 0 || root === "index";
  if (state === "unauthenticated" && !inAuthGroup) return "/auth/login";
  if (state === "authenticated" && (inAuthGroup || onIndex)) return "/(tabs)";
  return null;
}

export function signupOutcomeCopy(needsConfirmation: boolean | undefined): string {
  return needsConfirmation ? SIGNUP_CONFIRM_COPY : SIGNUP_CREATED_COPY;
}
