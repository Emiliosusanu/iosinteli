import "react-native-url-polyfill/auto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY");
}

/** createClient throws on empty URL — never let a Release bake take down launch. */
const SAFE_SUPABASE_URL = supabaseUrl || "https://unavailable.supabase.co";
const SAFE_SUPABASE_ANON_KEY = supabaseAnonKey || "unavailable";

// Detect whether we're in SSR (no `window`, no `document`). During SSR we use a
// no-op storage so Supabase auth doesn't crash trying to read browser globals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const isSSR = typeof g.window === "undefined" && typeof g.document === "undefined";

const noopStorage = {
  getItem: async (_k: string) => null,
  setItem: async (_k: string, _v: string) => {},
  removeItem: async (_k: string) => {},
};

// Provide a `ws` transport when running in Node (no global WebSocket) so the
// Realtime client can construct without crashing during web pre-rendering.
const realtime: Record<string, unknown> = {};
if (typeof g.WebSocket === "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require("ws");
    realtime.transport = ws;
  } catch {
    // ignore - native runtime has WebSocket
  }
}

export const supabase: SupabaseClient = createClient(SAFE_SUPABASE_URL, SAFE_SUPABASE_ANON_KEY, {
  auth: {
    storage: isSSR ? (noopStorage as unknown as Storage) : (AsyncStorage as unknown as Storage),
    autoRefreshToken: !isSSR,
    persistSession: !isSSR,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
  realtime,
});
