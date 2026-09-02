/** Pure Amazon OAuth callback parsing — shared by app + contract tests. */

export const AMAZON_OAUTH_RETURN_URL = "https://dashboard.inteliads.io/auth/amazon/callback";

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
