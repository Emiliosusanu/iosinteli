// Auth + fetch helper for the InteliAds (robo_ads) Nest API.
//
// The Nest API issues its OWN JWTs (POST /auth/login → { accessToken, refreshToken }),
// separate from the Supabase session. So the app logs into the Nest API at sign-in,
// stores both tokens in the Keychain, and uses the accessToken as a Bearer for
// mutations — refreshing once via /auth/refresh on a 401.

import { storage } from "@/src/utils/storage";

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

async function nestSessionAllowed(): Promise<boolean> {
  if (nestSessionInvalidated) return false;
  return (await storage.getItem<boolean>(SESSION_VALID_KEY, true)) !== false;
}

export async function hasNestToken(): Promise<boolean> {
  if (!API_BASE) return false;
  if (!(await nestSessionAllowed())) return false;
  const token = await storage.secureGet<string>(ACCESS_KEY, "");
  return !!token;
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
    const accessSaved = data?.accessToken
      ? await storage.secureSet(ACCESS_KEY, String(data.accessToken))
      : false;
    const refreshSaved = data?.refreshToken
      ? await storage.secureSet(REFRESH_KEY, String(data.refreshToken))
      : true;
    if (!accessSaved || !refreshSaved) return false;
    await storage.setItem(SESSION_VALID_KEY, true);
    nestSessionInvalidated = false;
    return true;
  } catch {
    console.warn("[nest] login failed");
    return false;
  }
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

export async function nestApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!API_BASE) {
    throw new NestApiError("The InteliAds API isn't configured yet.", 500);
  }
  if (!(await nestSessionAllowed())) {
    throw new NestApiError(NEST_REAUTH_MESSAGE, 401);
  }
  const token = await storage.secureGet<string>(ACCESS_KEY, "");
  if (!token) {
    throw new NestApiError(NEST_REAUTH_MESSAGE, 401);
  }
  const send = (tk: string) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}), Authorization: `Bearer ${tk}` },
    });
  let res = await send(token);
  if (res.status === 401) {
    const fresh = await refreshNestToken();
    if (fresh) res = await send(fresh);
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
  }
  return new NestApiError(message, res.status, errorCode);
}

export async function nestApiJson<T>(path: string, init: RequestInit = {}, fallback = "Couldn't complete that request."): Promise<T> {
  const res = await nestApiFetch(path, init);
  if (!res.ok) throw await parseNestError(res, fallback);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
