// Auth + fetch helper for the InteliAds (robo_ads) Nest API.
//
// One mobile bearer: prefer a live Nest access JWT (email/password), else the
// Supabase session access token (Amazon login). Server derives identity from
// the verified bearer. Nest refresh runs only when the sent token was Nest.
// hasNestToken() stays Nest-JWT-only so seller reads keep using Supabase RLS.

import {
  nestSessionFlagAllowsWrites,
  nestTokenMatchesSupabaseUser,
  pickMobileApiToken,
  readJwtSub,
  shouldRefreshNestToken,
} from "./mobileAuthContract";
import { storage } from "../utils/storage";
import { supabase } from "./supabase";

const API_BASE = (process.env.EXPO_PUBLIC_RULES_API_URL ?? "").replace(/\/+$/, "");
const ACCESS_KEY = "inteliads.rulesApi.accessToken";
const REFRESH_KEY = "inteliads.rulesApi.refreshToken";
const SESSION_VALID_KEY = "inteliads.rulesApi.sessionValid";
let nestSessionInvalidated = false;

export const PLAN_MANAGE_MESSAGE = "Manage your plan at inteliads.io.";
export const SIGN_IN_TO_MUTATE_MESSAGE = "Sign in to change bids.";
export const NEST_REAUTH_MESSAGE = "Sign out and sign in again to make changes.";

export class NestApiError extends Error {
  status: number;
  errorCode?: string;

  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = "NestApiError";
    this.status = status;
    this.errorCode = errorCode;
  }

  get isPlanGated() {
    return this.status === 402 || this.errorCode === "NO_PLAN_ACCESS" || this.errorCode === "NO_SYNC_ACCESS";
  }
}

export function rulesApiConfigured(): boolean {
  return !!API_BASE;
}

export const nestApiConfigured = rulesApiConfigured;

export type NestRequestInit = RequestInit & { allowAnonymous?: boolean };

async function nestSessionAllowed(): Promise<boolean> {
  const flag = nestSessionFlagAllowsWrites(await storage.getItem<boolean>(SESSION_VALID_KEY, false));
  // Storage is source of truth after a successful storeNestSession. The in-memory
  // invalidate bit only blocks leftover JWTs until login marks the session live.
  if (flag) nestSessionInvalidated = false;
  if (nestSessionInvalidated) return false;
  return flag;
}

export async function hasNestToken(): Promise<boolean> {
  if (!API_BASE) return false;
  if (!(await nestSessionAllowed())) return false;
  const token = await storage.secureGet<string>(ACCESS_KEY, "");
  return !!token;
}

/** User id for KDP helper / background work when Supabase AS session is empty. */
export async function resolveHelperUserId(): Promise<string | null> {
  if (!(await nestSessionAllowed())) return null;
  const token = await storage.secureGet<string>(ACCESS_KEY, "");
  return readJwtSub(token);
}

export function assertCanMutate(guestMode: boolean) {
  if (guestMode) throw new NestApiError(SIGN_IN_TO_MUTATE_MESSAGE, 401);
}

export function userMessageForNestError(error: unknown, fallback = "Couldn't save that change."): string {
  if (error instanceof NestApiError) {
    if (error.isPlanGated) return PLAN_MANAGE_MESSAGE;
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function nestLogin(email: string, password: string): Promise<boolean> {
  nestSessionInvalidated = true;
  await storage.setItem(SESSION_VALID_KEY, false);
  if (!API_BASE) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      console.warn("[nest] login failed", res.status);
      return false;
    }
    const data = await res.json();
    return storeNestSession(
      data?.accessToken ? String(data.accessToken) : "",
      data?.refreshToken ? String(data.refreshToken) : "",
    );
  } catch {
    console.warn("[nest] login failed");
    return false;
  }
}

/** Persist Nest JWTs from email login or Amazon OAuth callback. */
export async function storeNestSession(accessToken: string, refreshToken: string): Promise<boolean> {
  nestSessionInvalidated = true;
  await storage.setItem(SESSION_VALID_KEY, false);
  const access = accessToken.trim();
  const refresh = refreshToken.trim();
  if (!access) return false;
  const accessSaved = await storage.secureSet(ACCESS_KEY, access);
  const refreshSaved = refresh ? await storage.secureSet(REFRESH_KEY, refresh) : true;
  if (!accessSaved || !refreshSaved) return false;
  await storage.setItem(SESSION_VALID_KEY, true);
  nestSessionInvalidated = false;
  return true;
}

export async function nestLogout(): Promise<boolean> {
  nestSessionInvalidated = true;
  await storage.setItem(SESSION_VALID_KEY, false);
  const accessRemoved = await storage.secureRemove(ACCESS_KEY);
  const refreshRemoved = await storage.secureRemove(REFRESH_KEY);
  return accessRemoved && refreshRemoved;
}

async function refreshNestToken(): Promise<string | null> {
  if (!API_BASE) return null;
  if (!(await nestSessionAllowed())) return null;
  const refreshToken = await storage.secureGet<string>(REFRESH_KEY, "");
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.accessToken) await storage.secureSet(ACCESS_KEY, String(data.accessToken));
    if (data?.refreshToken) await storage.secureSet(REFRESH_KEY, String(data.refreshToken));
    return data?.accessToken ? String(data.accessToken) : null;
  } catch {
    return null;
  }
}

async function readSupabaseSession(): Promise<{ accessToken: string | null; userId: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    accessToken: session?.access_token ?? null,
    userId: session?.user?.id ?? null,
  };
}

async function readSupabaseAccessToken(): Promise<string | null> {
  return (await readSupabaseSession()).accessToken;
}

async function refreshSupabaseAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function resolveMobileApiToken(): Promise<{ token: string; source: "nest" | "supabase" } | null> {
  const nestAllowed = await nestSessionAllowed();
  const nestAccessToken = nestAllowed ? await storage.secureGet<string>(ACCESS_KEY, "") : "";
  const liveSession = await readSupabaseSession();
  const nestMatches = nestTokenMatchesSupabaseUser({
    nestAccessToken,
    supabaseUserId: liveSession.userId,
  });
  // Prefer Nest when it matches this Supabase user. Do NOT nestLogout on mismatch —
  // that wiped write credentials after Amazon/email login and forced a fake
  // "sign out and sign in again" loop while the UI still looked signed in.
  const picked = pickMobileApiToken({
    nestSessionAllowed: nestAllowed && !!nestAccessToken && nestMatches,
    nestAccessToken,
    supabaseAccessToken: liveSession.accessToken,
  });
  return picked;
}

export async function nestApiFetch(path: string, init: NestRequestInit = {}): Promise<Response> {
  if (!API_BASE) {
    throw new NestApiError("The InteliAds API isn't configured yet.", 500);
  }
  const { allowAnonymous, ...request } = init;
  const picked = await resolveMobileApiToken();
  if (!picked && !allowAnonymous) {
    throw new NestApiError(NEST_REAUTH_MESSAGE, 401);
  }
  const send = (tk?: string) =>
    fetch(`${API_BASE}${path}`, {
      ...request,
      headers: {
        "Content-Type": "application/json",
        ...(request.headers ?? {}),
        ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
      },
    });
  let res = await send(picked?.token);
  if (res.status !== 401) return res;
  if (shouldRefreshNestToken(picked?.source)) {
    const freshNest = await refreshNestToken();
    if (freshNest) {
      res = await send(freshNest);
      if (res.status !== 401) return res;
    }
    // Fall back to Supabase for this request only. Do NOT nestLogout() here —
    // wiping Keychain Nest JWTs after one 401 left sellers signed in for reads
    // (Supabase RLS) but unable to mutate until a perfect re-login, and the
    // next background Nest call could wipe them again immediately.
    let supabaseToken = await readSupabaseAccessToken();
    if (supabaseToken) {
      res = await send(supabaseToken);
      if (res.status === 401) {
        const freshSupabase = await refreshSupabaseAccessToken();
        if (freshSupabase && freshSupabase !== supabaseToken) res = await send(freshSupabase);
      }
    }
    return res;
  }
  if (picked?.source === "supabase") {
    const freshSupabase = await refreshSupabaseAccessToken();
    if (freshSupabase) {
      res = await send(freshSupabase);
      if (res.status !== 401) return res;
    }
  }
  return res;
}

/** Back-compat alias used by existing rule CRUD in queries.ts */
export const rulesApiFetch = nestApiFetch;

export async function parseNestError(res: Response, fallback: string): Promise<NestApiError> {
  let message = fallback;
  let errorCode: string | undefined;
  try {
    const body = await res.json();
    const m = body?.message ?? body?.error;
    if (Array.isArray(m)) message = m.join("\n");
    else if (typeof m === "string" && m.trim()) message = m;
    if (typeof body?.errorCode === "string") errorCode = body.errorCode;
  } catch {
    // keep fallback
  }
  if (res.status === 402 || errorCode === "NO_PLAN_ACCESS" || errorCode === "NO_SYNC_ACCESS") {
    message = PLAN_MANAGE_MESSAGE;
  } else if (res.status === 401) {
    const trimmed = message.trim();
    if (/^unauthorized$/i.test(trimmed) || /invalid or expired token/i.test(trimmed) || /missing bearer/i.test(trimmed)) {
      message = NEST_REAUTH_MESSAGE;
    }
  }
  return new NestApiError(message, res.status, errorCode);
}

export async function nestApiJson<T>(path: string, init: NestRequestInit = {}, fallback = "Couldn't complete that request."): Promise<T> {
  const res = await nestApiFetch(path, init);
  if (!res.ok) throw await parseNestError(res, fallback);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
