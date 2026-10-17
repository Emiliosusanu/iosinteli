import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { ensureFreshSupabaseSession, supabase } from "../lib/supabase";
import { storage } from "@/src/utils/storage";
import { nestLogin, nestLogout } from "@/src/lib/rulesApi";
import { ADMIN_FILTER_KEY } from "@/src/lib/queries";
import { clearPersistedQueryCache } from "@/src/lib/queryPersist";
import { clearNotificationIdentity } from "@/src/lib/notifications";
import { markPerf } from "@/src/lib/perf";
import { debugIngest } from "@/src/lib/debugIngest";
import { userLookupProvesSessionInvalid } from "@/src/lib/authRestore";
import { isPermanentSessionError } from "@/src/lib/sessionRefresh";
import { supabaseSessionIsUsable } from "@/src/lib/supabaseSession";
import { withQueryTimeout } from "@/src/lib/queryTimeout";

type AuthState = "loading" | "authenticated" | "unauthenticated";

interface AuthContextType {
  state: AuthState;
  session: Session | null;
  user: User | null;
  guestMode: boolean;
  restoreError: boolean;
  retryRestore: () => void;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  enterGuestMode: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const GUEST_KEY = "inteliads.guestMode";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [guestMode, setGuestMode] = useState<boolean>(false);
  const guestModeRef = useRef(false);
  const restoreGeneration = useRef(0);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreError, setRestoreError] = useState(false);
  const retryRestore = useCallback(() => {
    restoreGeneration.current++;
    setRestoreError(false);
    setState("loading");
    setRestoreAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    let restoreSettled = false;
    const generation = ++restoreGeneration.current;
    const current = () => mounted && restoreGeneration.current === generation;

    const clearStaleAuthCaches = async () => {
      queryClient.clear();
      await clearPersistedQueryCache();
    };

    const fallbackId = setTimeout(() => {
      if (!current() || restoreSettled) return;
      // A deadline proves only that verification is delayed, not a logout.
      setRestoreError(true);
    }, 8000);

    (async () => {
      try {
        markPerf("auth.restore.start");
        const authT0 = Date.now();
        // #region agent log
        debugIngest("AuthContext.tsx:restore", "auth restore start", {}, "B");
        // #endregion
        // Hydrate guest mode flag first
        const guest = await storage.getItem<boolean>(GUEST_KEY, false);
        const isGuest = guest === true;
        const { data: { session: s }, error: sessionError } = await supabase.auth.getSession();
        if (!current()) return;
        // #region agent log
        debugIngest("AuthContext.tsx:getSession", "auth getSession done", { ms: Date.now() - authT0, hasSession: !!s, sessionError: !!sessionError }, "B");
        // #endregion
        let session = s ?? null;
        if (sessionError && !isPermanentSessionError(sessionError)) throw sessionError;
        if ((sessionError && !session) || (session && !session.refresh_token)) {
          await supabase.auth.signOut({ scope: "local" });
          session = null;
          await clearStaleAuthCaches();
        } else if (session) {
          // Share the same guarded refresh used by API callers. A temporary
          // refresh outage keeps a still-usable access token instead of
          // destroying the persisted mobile session.
          session = await ensureFreshSupabaseSession() ?? session;
          if (!current()) return;
          if (!supabaseSessionIsUsable(session)) throw new Error("Session recovery pending");
          const { data: { user: liveUser }, error: userError } = await withQueryTimeout(
            supabase.auth.getUser(), 4_000,
          ).catch(error => ({ data: { user: null }, error }));
          if (!current()) return;
          // #region agent log
          debugIngest("AuthContext.tsx:getUser", "auth getUser done", { ms: Date.now() - authT0, hasLiveUser: !!liveUser, userError: !!userError }, "B");
          // #endregion
          if (userLookupProvesSessionInvalid(userError, !!liveUser)) {
            await supabase.auth.signOut({ scope: "local" });
            session = null;
            await clearStaleAuthCaches();
          } else if (userError) {
            console.warn("[auth] User verification is temporarily unavailable; keeping the valid local session");
          }
        }

        if (!current()) return;
        restoreSettled = true;
        clearTimeout(fallbackId);
        setRestoreError(false);
        guestModeRef.current = isGuest && !session;
        setGuestMode(isGuest && !session);
        setSession(session);
        setUser(session?.user ?? null);
        setState(session || isGuest ? "authenticated" : "unauthenticated");
        markPerf("auth.restore.end");
        // #region agent log
        debugIngest("AuthContext.tsx:restoreEnd", "auth restore end", { ms: Date.now() - authT0, authenticated: !!(session || isGuest), isGuest }, "B");
        // #endregion
      } catch (error) {
        if (!current()) return;
        restoreSettled = true;
        clearTimeout(fallbackId);
        if (isPermanentSessionError(error)) {
          setSession(null);
          setUser(null);
          setState("unauthenticated");
          setRestoreError(false);
        } else {
          setRestoreError(true);
        }
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "INITIAL_SESSION") return;
      if (s && !supabaseSessionIsUsable(s)) return;
      // A live auth event supersedes every result from startup verification.
      restoreGeneration.current++;
      restoreSettled = true;
      clearTimeout(fallbackId);
      setRestoreError(false);
      setSession(s);
      setUser(s?.user ?? null);
      if (s) {
        guestModeRef.current = false;
        setGuestMode(false);
        void storage.setItem(GUEST_KEY, false);
        setState("authenticated");
        return;
      }
      setState(guestModeRef.current ? "authenticated" : "unauthenticated");
    });

    return () => {
      mounted = false;
      clearTimeout(fallbackId);
      listener.subscription.unsubscribe();
    };
  }, [restoreAttempt, queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    guestModeRef.current = false;
    setGuestMode(false);
    await storage.setItem(GUEST_KEY, false);

    let nestOk = await nestLogin(email, password);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // Nest write session is required for campaign/bid/target mutations on the
    // live API (JwtAuthGuard is Nest-JWT). Retry once if the first Nest login
    // raced or failed while Supabase succeeded — and fail closed if still missing
    // so we never leave a "signed in but can't save" session.
    if (!nestOk) nestOk = await nestLogin(email, password);
    if (!nestOk) {
      console.warn("[auth] Supabase signed in but Nest write session is missing");
      await supabase.auth.signOut({ scope: "local" });
      await nestLogout();
      setSession(null);
      setUser(null);
      setState("unauthenticated");
      return {
        error:
          "Couldn't start a write session. Use Continue with Amazon, or check your email and password.",
      };
    }

    await queryClient.invalidateQueries({ queryKey: ["nest-token"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    await queryClient.invalidateQueries({ queryKey: ["amazon-profiles"] });
    return {};
  }, [queryClient]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    restoreGeneration.current++;
    guestModeRef.current = false;
    setGuestMode(false);
    await storage.setItem(GUEST_KEY, false);
    await storage.removeItem(ADMIN_FILTER_KEY);
    await clearNotificationIdentity();
    await nestLogout();
    let remoteSignOutFailed = false;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        remoteSignOutFailed = true;
        await supabase.auth.signOut({ scope: "local" });
      }
    } catch {
      remoteSignOutFailed = true;
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Continue clearing app-visible state even if Supabase storage is unavailable.
      }
    }
    queryClient.clear();
    await clearPersistedQueryCache();
    setSession(null);
    setUser(null);
    setState("unauthenticated");
    if (remoteSignOutFailed) {
      console.warn("[auth] Remote sign out failed; local account state was cleared");
    }
  }, [queryClient]);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "https://dashboard.inteliads.io/reset-password",
    });
    if (error) return { error: error.message };
    return {};
  }, []);

  const enterGuestMode = useCallback(() => {
    restoreGeneration.current++;
    setRestoreError(false);
    guestModeRef.current = true;
    setGuestMode(true);
    void storage.setItem(GUEST_KEY, true);
    setState("authenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ state, session, user, guestMode, restoreError, retryRestore, signIn, signUp, signOut, resetPassword, enterGuestMode }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
