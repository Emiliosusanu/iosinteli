import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { storage } from "@/src/utils/storage";

type AuthState = "loading" | "authenticated" | "unauthenticated";

interface AuthContextType {
  state: AuthState;
  session: Session | null;
  user: User | null;
  guestMode: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  enterGuestMode: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const GUEST_KEY = "inteliads.guestMode";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [guestMode, setGuestMode] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      // Hydrate guest mode flag first
      const guest = await storage.getItem(GUEST_KEY, false);
      const isGuest = guest === true;
      setGuestMode(isGuest);

      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      setUser(s?.user ?? null);
      setState(s || isGuest ? "authenticated" : "unauthenticated");
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      // Real auth wins over guest mode
      if (s) {
        setGuestMode(false);
        void storage.setItem(GUEST_KEY, false);
        setState("authenticated");
      } else {
        // After explicit sign-out, drop guest too
        setState((prev) => (guestMode ? "authenticated" : "unauthenticated"));
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    setGuestMode(false);
    await storage.setItem(GUEST_KEY, false);
    await supabase.auth.signOut();
    setState("unauthenticated");
  }, []);

  const enterGuestMode = useCallback(() => {
    setGuestMode(true);
    void storage.setItem(GUEST_KEY, true);
    setState("authenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ state, session, user, guestMode, signIn, signUp, signOut, enterGuestMode }}
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
