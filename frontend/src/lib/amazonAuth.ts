/**
 * Amazon Login / Connect handoff for iOS.
 *
 * Mirrors the web OAuthCallback: Nest redirects to
 * https://dashboard.inteliads.io/auth/amazon/callback#accessToken=…&refreshToken=…
 * We capture that return URL with ASWebAuthenticationSession, store Nest JWTs,
 * then mint a Supabase session so RLS reads work the same as email sign-in.
 */
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { AMAZON_OAUTH_RETURN_URL, parseAmazonOAuthCallback } from "./amazonAuthContract";
import { fetchAmazonConnectUrl, fetchAmazonLoginUrl } from "./mutations";
import { nestLogout, storeNestSession } from "./rulesApi";
import { supabase } from "./supabase";

export { AMAZON_OAUTH_RETURN_URL, parseAmazonOAuthCallback } from "./amazonAuthContract";

WebBrowser.maybeCompleteAuthSession();

export type AmazonAuthResult =
  | { ok: true; mode: "login" | "connect" }
  | { ok: false; cancelled?: boolean; error: string };

async function mintSupabaseSessionFromNest(accessToken: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke("amazon-mobile-session", {
    body: { accessToken },
  });
  if (error) return { error: error.message || "Couldn't finish Amazon sign-in." };
  const payload = (data ?? {}) as {
    error?: string;
    token_hash?: string;
    email?: string;
  };
  if (payload.error || !payload.token_hash) {
    return { error: "Couldn't finish Amazon sign-in. Try again." };
  }
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: payload.token_hash,
  });
  if (otpError) return { error: otpError.message || "Couldn't open your InteliAds session." };
  return {};
}

async function completeFromReturnUrl(returnUrl: string): Promise<AmazonAuthResult> {
  const parsed = parseAmazonOAuthCallback(returnUrl);
  if (parsed.error) return { ok: false, error: decodeURIComponent(parsed.error) };
  if (!parsed.accessToken || !parsed.refreshToken) {
    return { ok: false, error: "Amazon didn't return a session. Try again." };
  }
  const stored = await storeNestSession(parsed.accessToken, parsed.refreshToken);
  if (!stored) return { ok: false, error: "Couldn't save your Amazon session on this iPhone." };

  if (parsed.mode === "login") {
    const minted = await mintSupabaseSessionFromNest(parsed.accessToken);
    if (minted.error) return { ok: false, error: minted.error };
  }
  return { ok: true, mode: parsed.mode };
}

async function runAmazonAuthSession(startUrl: string): Promise<AmazonAuthResult> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.href = startUrl;
    return { ok: false, cancelled: true, error: "Continue in the browser." };
  }

  const result = await WebBrowser.openAuthSessionAsync(startUrl, AMAZON_OAUTH_RETURN_URL, {
    preferEphemeralSession: false,
    showInRecents: true,
  });

  if (result.type === "cancel" || result.type === "dismiss") {
    return { ok: false, cancelled: true, error: "Amazon sign-in was cancelled." };
  }
  if (result.type !== "success" || !("url" in result) || !result.url) {
    return { ok: false, error: "Couldn't complete Amazon sign-in." };
  }
  return completeFromReturnUrl(result.url);
}

/** Seller Login with Amazon — same Nest OAuth as the web dashboard. */
export async function startAmazonLogin(): Promise<AmazonAuthResult> {
  await nestLogout();
  try {
    const { url } = await fetchAmazonLoginUrl();
    if (!url) return { ok: false, error: "Couldn't start Amazon login." };
    return runAmazonAuthSession(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't start Amazon login.";
    return { ok: false, error: message };
  }
}

/** Connect another Amazon Ads account while already signed in. */
export async function startAmazonConnect(): Promise<AmazonAuthResult> {
  try {
    const { url } = await fetchAmazonConnectUrl();
    if (!url) return { ok: false, error: "Couldn't start Amazon connect." };
    return runAmazonAuthSession(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't start Amazon connect.";
    return { ok: false, error: message };
  }
}
