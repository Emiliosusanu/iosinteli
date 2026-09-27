/** Refresh if less than one 15-min metronome remains so the next wake is not expired. */
export const SUPABASE_REFRESH_SKEW_SECONDS = 15 * 60;

export type SupabaseSessionLike = {
  expires_at?: number | string | null;
  refresh_token?: string | null;
  access_token?: string | null;
  user?: { id?: string | null } | null;
} | null;

/** Unix seconds. Accepts seconds, milliseconds, numeric strings, or ISO dates. */
export function parseSupabaseExpiresAtSeconds(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw / 1000 : raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return n > 1e12 ? n / 1000 : n;
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return null;
}

/** True when getSession() is empty or the access token is expired / about to expire. */
export function supabaseSessionNeedsRefresh(session: SupabaseSessionLike): boolean {
  if (!session?.refresh_token) return true;
  const exp = parseSupabaseExpiresAtSeconds(session.expires_at);
  if (exp == null) return true;
  return exp <= Date.now() / 1000 + SUPABASE_REFRESH_SKEW_SECONDS;
}

/** False for a missing or already-expired JWT — callers must not keep using it. */
export function supabaseSessionIsUsable(session: SupabaseSessionLike): boolean {
  if (!session?.access_token) return false;
  const exp = parseSupabaseExpiresAtSeconds(session.expires_at);
  if (exp == null) return true;
  return exp > Date.now() / 1000 + 5;
}
