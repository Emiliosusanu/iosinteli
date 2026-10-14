/** Stored cookies are a replay candidate, not proof of current Amazon authentication. */
export function kdpSessionPresentation(input: {
  loggedIn: boolean;
  savedSession: boolean;
  sessionChecked: boolean;
  currentUrl?: string | null;
}): { label: string; verified: boolean } {
  let signInPage = false;
  try {
    const url = new URL(input.currentUrl || "");
    signInPage = /(^|\.)amazon\./i.test(url.hostname)
      && /^\/ap\/(signin|mfa|cvf|register)(\/|$)/i.test(url.pathname);
  } catch { /* Unknown location does not verify a saved session. */ }
  if (signInPage) return { label: "Amazon sign-in required", verified: false };
  if (input.loggedIn) return { label: "Signed in", verified: true };
  if (!input.sessionChecked) return { label: "Checking saved session…", verified: false };
  if (input.savedSession) return { label: "Saved session · check required", verified: false };
  return { label: "Sign in required", verified: false };
}
