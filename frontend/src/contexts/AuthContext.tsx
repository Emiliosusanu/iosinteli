import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { storage } from "@/src/utils/storage";
import { nestLogin, nestLogout } from "@/src/lib/rulesApi";
import { ADMIN_FILTER_KEY } from "@/src/lib/queries";
import { clearPersistedQueryCache } from "@/src/lib/queryPersist";
import { clearNotificationIdentity } from "@/src/lib/notifications";
import { markPerf } from "@/src/lib/perf";
import { debugIngest } from "@/src/lib/debugIngest";

type AuthState = "loading" | "authenticated" | "unauthenticated";

interface AuthContextType {
  state: AuthState;
  session: Session | null;
  user: User | null;
  guestMode: boolean;
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

  useEffect(() => {
    let mounted = true;
    let restoreSettled = false;

    const clearStaleAuthCaches = async () => {
      queryClient.clear();
      await clearPersistedQueryCache();
    };

    const fallbackId = setTimeout(() => {
      if (!mounted || restoreSettled) return;
      void (async () => {
        const guest = await storage.getItem<boolean>(GUEST_KEY, false);
        // Restore may have finished while we awaited storage.
        if (!mounted || restoreSettled) return;
        console.warn("[auth] Session hydration timed out; continuing without a live session");
        // #region agent log
        debugIngest("AuthContext.tsx:fallback", "auth hydration timeout", { guest: guest === true }, "B");
        // #endregion
        setSession(null);
        setUser(null);
        if (guest === true) {
          guestModeRef.current = true;
          setGuestMode(true);
          setState("authenticated");
        } else {
          setState("unauthenticated");
        }
      })();
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
        // #region agent log
        debugIngest("AuthContext.tsx:getSession", "auth getSession done", { ms: Date.now() - authT0, hasSession: !!s, sessionError: !!sessionError }, "B");
        // #endregion
        let session = s ?? null;
        if (sessionError || (session && !session.refresh_token)) {
          await supabase.auth.signOut({ scope: "local" });
          session = null;
          await clearStaleAuthCaches();
        } else if (session) {
          const { data: { user: liveUser }, error: userError } = await supabase.auth.getUser();
          // #region agent log
          debugIngest("AuthContext.tsx:getUser", "auth getUser done", { ms: Date.now() - authT0, hasLiveUser: !!liveUser, userError: !!userError }, "B");
          // #endregion
          if (userError || !liveUser) {
            await supabase.auth.signOut({ scope: "local" });
            session = null;
            await clearStaleAuthCaches();
          }
        }

        if (!mounted) return;
        restoreSettled = true;
        clearTimeout(fallbackId);
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
        if (!mounted) return;
        restoreSettled = true;
        clearTimeout(fallbackId);
        console.warn("[auth] Session hydration failed; continuing unauthenticated", error);
        guestModeRef.current = false;
        setGuestMode(false);
        setSession(null);
        setUser(null);
        setState("unauthenticated");
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s) {
        guestModeRef.current = false;
        setGuestMode(false);
        void storage.setItem(GUEST_KEY, false);
        setState("authenticated");
        return;
      }
      // INITIAL_SESSION(null) races guest hydration — let that IIFE decide.
      if (event === "INITIAL_SESSION") return;
      setState(guestModeRef.current ? "authenticated" : "unauthenticated");
    });

    return () => {
      mounted = false;
      clearTimeout(fallbackId);
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    guestModeRef.current = true;
    setGuestMode(true);
    void storage.setItem(GUEST_KEY, true);
    setState("authenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ state, session, user, guestMode, signIn, signUp, signOut, resetPassword, enterGuestMode }}
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
