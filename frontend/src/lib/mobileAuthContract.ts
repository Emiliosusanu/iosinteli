/**
 * One mobile API bearer contract.
 *
 * Prefer a valid Nest access JWT when the email/password Nest session is
 * live. Otherwise send the verified Supabase access token (Amazon login).
 * The server derives caller identity from that bearer. The client never
 * sends a trusted userId.
 */

export type MobileApiTokenSource = "nest" | "supabase";

export type PickedMobileApiToken = {
  token: string;
  source: MobileApiTokenSource;
};

export function pickMobileApiToken(input: {
  nestSessionAllowed: boolean;
  nestAccessToken?: string | null;
  supabaseAccessToken?: string | null;
}): PickedMobileApiToken | null {
  const nest =
    input.nestSessionAllowed && typeof input.nestAccessToken === "string"
      ? input.nestAccessToken.trim()
      : "";
  if (nest) return { token: nest, source: "nest" };
  const supabase =
    typeof input.supabaseAccessToken === "string" ? input.supabaseAccessToken.trim() : "";
  if (supabase) return { token: supabase, source: "supabase" };
  return null;
}

export function shouldRefreshNestToken(source: MobileApiTokenSource | null | undefined): boolean {
  return source === "nest";
}

export function nestSessionFlagAllowsWrites(sessionValid: boolean | null | undefined): boolean {
  return sessionValid === true;
}

export function canRetryMobileRequestAfter401(_method: string | null | undefined): boolean {
  return true;
}

function decodeJwtPayload(token: string): { sub?: unknown } | null {
  const parts = token.trim().split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof globalThis.atob === "function"
        ? globalThis.atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as { sub?: unknown };
  } catch {
    return null;
  }
}

export function readJwtSub(token?: string | null): string | null {
  if (typeof token !== "string" || !token.trim()) return null;
  const sub = decodeJwtPayload(token)?.sub;
  return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

export function nestTokenMatchesSupabaseUser(input: {
  nestAccessToken?: string | null;
  supabaseUserId?: string | null;
}): boolean {
  const nestSub = readJwtSub(input.nestAccessToken);
  const supabaseUserId =
    typeof input.supabaseUserId === "string" ? input.supabaseUserId.trim() : "";
  if (!nestSub || !supabaseUserId) return true;
  return nestSub === supabaseUserId;
}

export function mobileSellerMaySendFilterUserId(input: {
  hasNestAdminSession: boolean;
  adminFilterUserId?: string | null;
}): boolean {
  return (
    input.hasNestAdminSession === true &&
    typeof input.adminFilterUserId === "string" &&
    input.adminFilterUserId.length > 0
  );
}

export function mobileGuestMayMutate(guestMode: boolean): boolean {
  return guestMode !== true;
}
