/**
 * Pure KDP WebView session header helpers (no SecureStore).
 * Persistence lives in session.ts.
 */
export type KdpWebSession = {
  cookies: string;
  userAgent: string;
  languages?: string;
  /** Extra auth headers (CSRF etc.) harvested from capture. */
  extraHeaders?: Record<string, string>;
  updatedAt: string;
};

/** Headers worth persisting for locked-screen replay (Royaltix parity). */
export const SESSION_EXTRA_HEADER_NAMES = [
  "anti-csrftoken",
  "x-csrf-token",
  "x-xsrf-token",
  "x-amz-sso_authn",
  "accept-language",
] as const;

export function headerLookup(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want && typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function pickSessionExtraHeaders(
  headers: Record<string, string> | undefined,
  prev?: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = { ...(prev ?? {}) };
  for (const name of SESSION_EXTRA_HEADER_NAMES) {
    const value = headerLookup(headers, name);
    if (value) next[name] = value;
  }
  return next;
}

/** Merge Keychain session into replay headers (Cookie / User-Agent / CSRF). */
export function applySessionToHeaders(
  headers: Record<string, string>,
  session: KdpWebSession | null,
): Record<string, string> {
  if (!session) return headers;
  const next = { ...headers };
  const keys = Object.keys(next).map((k) => k.toLowerCase());
  if (session.cookies && !keys.includes("cookie")) {
    next.Cookie = session.cookies;
  }
  if (session.userAgent && !keys.includes("user-agent")) {
    next["User-Agent"] = session.userAgent;
  }
  for (const [name, value] of Object.entries(session.extraHeaders ?? {})) {
    if (!value || keys.includes(name.toLowerCase())) continue;
    next[name] = value;
  }
  return next;
}
