import { isPermanentSessionError } from "./sessionRefresh.ts";

/**
 * A failed user lookup is not automatically proof that the persisted session
 * is invalid. Mobile cold starts can race connectivity and Supabase restarts;
 * clearing storage in those cases turns a temporary outage into a logout.
 */
export function userLookupProvesSessionInvalid(error: unknown, hasUser: boolean): boolean {
  if (hasUser) return false;
  if (!error) return true;
  if (isPermanentSessionError(error)) return true;

  const status = Number((error as { status?: number } | null)?.status);
  return status === 401;
}
