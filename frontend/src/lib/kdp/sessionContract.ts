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

/**
 * Merge two browser Cookie headers without dropping cookies that are scoped to
 * a sibling Amazon host. Values observed most recently win by cookie name.
 *
 * KDP reports and the print-pricing editor live on different subdomains. A
 * pricing-gate probe must not replace the reports cookie jar with the smaller
 * set visible to kdp.amazon.com, otherwise an otherwise valid reports session
 * is lost and the next helper run asks for the password again.
 */
export function mergeCookieHeaders(previous: string, observed: string): string {
  const jar = new Map<string, string>();
  const ingest = (header: string) => {
    for (const raw of String(header || "").split(";")) {
      const part = raw.trim();
      if (!part) continue;
      const equals = part.indexOf("=");
      if (equals <= 0) continue;
      const name = part.slice(0, equals).trim();
      if (!name) continue;
      jar.set(name, part.slice(equals + 1).trim());
    }
  };
  ingest(previous);
  ingest(observed);
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
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
