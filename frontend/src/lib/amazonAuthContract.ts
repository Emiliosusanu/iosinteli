/** Pure Amazon OAuth callback parsing — shared by app + contract tests. */

/** Dashboard callback (web). Nest still uses this when returnTo is absent. */
export const AMAZON_OAUTH_WEB_RETURN_URL = "https://dashboard.inteliads.io/auth/amazon/callback";

/**
 * iOS ASWebAuthenticationSession return URL.
 * Nest must redirect here when login/connect is started with ?returnTo=…
 * (custom scheme — no Associated Domains required).
 */
export const AMAZON_OAUTH_RETURN_URL = "inteliads://auth/amazon/callback";

export function parseAmazonOAuthCallback(url: string): {
  accessToken: string | null;
  refreshToken: string | null;
  mode: "login" | "connect";
  error: string | null;
} {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    const frag = new URLSearchParams(hash);
    const query = parsed.searchParams;
    const get = (name: string) => frag.get(name) || query.get(name);
    const modeRaw = (get("mode") || "login").toLowerCase();
    return {
      accessToken: get("accessToken"),
      refreshToken: get("refreshToken"),
      mode: modeRaw === "connect" ? "connect" : "login",
      error: get("error"),
    };
  } catch {
    return { accessToken: null, refreshToken: null, mode: "login", error: "Couldn't read Amazon response." };
  }
}
