/**
 * KDP WebView session for locked-screen / background replay.
 *
 * Mirrors Royaltix: keep cookie + UA in Keychain (AfterFirstUnlock) so a
 * background tick can attach Cookie / User-Agent to reconstructed requests
 * even when WKWebView cookie access is flaky.
 *
 * Cookies are harvested from captured XHR/fetch request headers (includes
 * HttpOnly values the page JS cannot read via document.cookie).
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  applySessionToHeaders,
  headerLookup,
  pickSessionExtraHeaders,
  type KdpWebSession,
} from "./sessionContract.ts";

export type { KdpWebSession };
export { applySessionToHeaders, headerLookup, pickSessionExtraHeaders };

const SESSION_KEY = "inteliads.kdpHelper.webSession.v1";

const ACCESSIBLE =
  Platform.OS === "ios"
    ? SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    : SecureStore.AFTER_FIRST_UNLOCK;

export async function loadKdpWebSession(): Promise<KdpWebSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY, {
      keychainAccessible: ACCESSIBLE,
    });
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KdpWebSession;
    if (!parsed || typeof parsed !== "object") return null;
    const extra =
      parsed.extraHeaders && typeof parsed.extraHeaders === "object"
        ? Object.fromEntries(
            Object.entries(parsed.extraHeaders).filter(
              ([, v]) => typeof v === "string" && v.trim(),
            ) as [string, string][],
          )
        : undefined;
    return {
      cookies: typeof parsed.cookies === "string" ? parsed.cookies : "",
      userAgent: typeof parsed.userAgent === "string" ? parsed.userAgent : "",
      languages: typeof parsed.languages === "string" ? parsed.languages : undefined,
      extraHeaders: extra && Object.keys(extra).length ? extra : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export async function saveKdpWebSession(session: KdpWebSession): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: ACCESSIBLE,
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearKdpWebSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY, {
      keychainAccessible: ACCESSIBLE,
    });
  } catch {
    /* best-effort */
  }
}

export async function mergeSessionFromCaptureHeaders(
  headers: Record<string, string> | undefined,
): Promise<KdpWebSession | null> {
  const prev = await loadKdpWebSession();
  const cookies = headerLookup(headers, "cookie") ?? prev?.cookies ?? "";
  const userAgent = headerLookup(headers, "user-agent") ?? prev?.userAgent ?? "";
  if (!cookies && !userAgent) return prev;
  const next: KdpWebSession = {
    cookies,
    userAgent,
    languages: prev?.languages,
    extraHeaders: pickSessionExtraHeaders(headers, prev?.extraHeaders),
    updatedAt: new Date().toISOString(),
  };
  await saveKdpWebSession(next);
  return next;
}

export async function mergeSessionMeta(meta: {
  userAgent?: string;
  languages?: string;
}): Promise<void> {
  const prev = await loadKdpWebSession();
  const next: KdpWebSession = {
    cookies: prev?.cookies ?? "",
    userAgent: meta.userAgent?.trim() || prev?.userAgent || "",
    languages: meta.languages?.trim() || prev?.languages,
    updatedAt: new Date().toISOString(),
  };
  if (!next.cookies && !next.userAgent) return;
  await saveKdpWebSession(next);
}
