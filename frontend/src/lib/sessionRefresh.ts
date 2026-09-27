import { supabaseSessionIsUsable, supabaseSessionNeedsRefresh, type SupabaseSessionLike } from './supabaseSession.ts';

export function isPermanentSessionError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? '');
  return ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
    'session_expired', 'bad_jwt', 'user_not_found', 'user_banned'].includes(code);
}

export class SessionUnavailableError extends Error {
  readonly code = 'SESSION_UNAVAILABLE';
  constructor() { super('Your session is unavailable. Please try signing in again.'); }
}

type Result<S> = { data: { session: S | null }; error?: unknown };

/** One recovery shared by startup, foreground, notifications and API callers.
 * Never retry an invalid refresh token or return an expired access token.
 */
export function createSessionRefresh<S extends NonNullable<SupabaseSessionLike>>(auth: {
  getSession: () => Promise<Result<S>>;
  refreshSession: () => Promise<Result<S>>;
}, now = Date.now) {
  let pending: Promise<S | null> | null = null;
  let failure: unknown = null;
  let retryAt = 0;
  let generation = 0;

  return {
    reset() {
      generation++;
      pending = null;
      failure = null;
      retryAt = 0;
    },
    allowRetry() { failure = null; retryAt = 0; },
    ensure(): Promise<S | null> {
      if (pending) return pending;
      if (failure && now() < retryAt) return Promise.reject(failure);
      const started = generation;
      const work = (async () => {
        try {
          const current = await auth.getSession();
          if (current.error) throw current.error;
          if (started !== generation) throw new SessionUnavailableError();
          const live = current.data.session;
          if (!live) return null;
          if (!supabaseSessionNeedsRefresh(live) && supabaseSessionIsUsable(live)) return live;
          if (now() < retryAt && supabaseSessionIsUsable(live)) return live;
          if (!live.refresh_token) throw new SessionUnavailableError();
          // Let the SDK select the current refresh token under its own lock.
          // Passing a captured token can replay an obsolete token after another refresh.
          const refreshed = await auth.refreshSession();
          if (started !== generation) throw new SessionUnavailableError();
          if (refreshed.error) {
            // A proactive refresh failure need not discard a still-valid session.
            if (!isPermanentSessionError(refreshed.error) && supabaseSessionIsUsable(live)) {
              failure = null;
              retryAt = now() + 10_000;
              return live;
            }
            throw refreshed.error;
          }
          if (started !== generation || !supabaseSessionIsUsable(refreshed.data.session)) {
            throw new SessionUnavailableError();
          }
          failure = null;
          retryAt = 0;
          return refreshed.data.session;
        } catch (error) {
          if (started === generation) {
            failure = error;
            retryAt = isPermanentSessionError(error) ? Infinity : now() + 10_000;
          }
          throw error;
        }
      })();
      pending = work;
      void work.finally(() => { if (pending === work) pending = null; }).catch(() => {});
      return work;
    },
  };
}

/** SDK SIGNED_IN also occurs during hydration/foreground recovery. Only an
 * identity boundary invalidates requests already waiting on that recovery. */
export function createSessionIdentityBoundary() {
  let identity: string | null | undefined;
  return (event: string, session: SupabaseSessionLike): boolean => {
    if (event === 'SIGNED_OUT') { identity = null; return true; }
    const next = session?.user?.id;
    if (!next || !['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) return false;
    const changed = identity !== undefined && identity !== next;
    identity = next;
    return changed;
  };
}
