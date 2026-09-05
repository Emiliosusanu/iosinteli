// InteliAds APNs sender (Supabase Edge Function).
//
// Sends remote push notifications to a user's registered iOS devices via Apple
// Push Notification service using token-based auth (APNs .p8 key, ES256 JWT).
//
// Called by the app: supabase.functions.invoke("send-push", { body: { test: true } })
//   - The signed-in user's JWT identifies the recipient (RLS-safe).
// Called by cron / server (service_role bearer): body may target { userId }.
//
// Required secrets (supabase secrets set ...):
//   APNS_KEY_ID       10-char Key ID of the APNs Auth Key
//   APNS_TEAM_ID      Apple Developer Team ID (e.g. AQ5FWX4K8Y)
//   APNS_PRIVATE_KEY  Contents of the AuthKey_XXXXXXXXXX.p8 (PEM, with header/footer)
//   APNS_BUNDLE_ID    optional, defaults to io.inteliads.app
// Auto-injected by the Edge runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "io.inteliads.app";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---------- APNs token (ES256 JWT) ----------

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { jwt: string; iat: number } | null = null;

async function apnsAuthToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // APNs tokens are valid up to 60 min; refresh well before that.
  if (cachedToken && now - cachedToken.iat < 45 * 60) return cachedToken.jwt;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(APNS_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(
    JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }),
  );
  const payload = base64UrlEncode(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
  cachedToken = { jwt, iat: now };
  return jwt;
}

function apnsHost(environment?: string | null): string {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

type SendResult = {
  token: string;
  ok: boolean;
  status: number;
  reason?: string;
};

async function sendToDevice(
  authToken: string,
  token: string,
  environment: string | null,
  payload: Record<string, unknown>,
  opts?: { silent?: boolean },
): Promise<SendResult> {
  const silent = !!opts?.silent;
  const res = await fetch(`${apnsHost(environment)}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${authToken}`,
      "apns-topic": APNS_BUNDLE_ID,
      "apns-push-type": silent ? "background" : "alert",
      "apns-priority": silent ? "5" : "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 200) {
    await res.body?.cancel();
    return { token, ok: true, status: 200 };
  }
  let reason: string | undefined;
  try {
    const parsed = await res.json();
    reason = parsed?.reason;
  } catch {
    // no-op
  }
  return { token, ok: false, status: res.status, reason };
}

// ---------- Handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    return json(
      {
        error: "apns_not_configured",
        message:
          "Set APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY with `supabase secrets set`.",
      },
      500,
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Prefer role claim over exact string match — injected service-role keys can
  // rotate relative to a caller-held copy while remaining valid JWTs.
  let jwtRole: string | null = null;
  try {
    const payloadPart = jwt.split(".")[1];
    if (payloadPart) {
      const padded = payloadPart + "=".repeat((4 - (payloadPart.length % 4)) % 4);
      const payload = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
      jwtRole = typeof payload?.role === "string" ? payload.role : null;
    }
  } catch {
    jwtRole = null;
  }
  const isService =
    jwt.length > 0 &&
    (jwtRole === "service_role" ||
      (SERVICE_ROLE_KEY.length > 0 && jwt === SERVICE_ROLE_KEY));

  let body: {
    userId?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    event?: string;
    test?: boolean;
    /** content-available background wake (no banner). Service-role cron / KDP helper. */
    silent?: boolean;
    wake?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Resolve the recipient: users can only push to themselves; the service role
  // may target an explicit userId (for cron / server-side alerts).
  let targetUserId: string | null = null;
  if (isService) {
    targetUserId = body.userId ?? null;
  } else if (jwt) {
    const { data } = await admin.auth.getUser(jwt);
    targetUserId = data.user?.id ?? null;
  }
  if (!targetUserId) return json({ error: "unauthorized" }, 401);

  // Silent / wake pushes are service-role only (cadence for KDP helper).
  const silent = !!(body.silent || body.wake);
  if (silent && !isService) {
    return json({ error: "silent_requires_service_role" }, 403);
  }

  const { data: tokens, error } = await admin
    .from("device_push_tokens")
    .select("token, environment, platform, disabled_at, invalidated_at")
    .eq("user_id", targetUserId);

  if (error) return json({ error: "token_lookup_failed", detail: error.message }, 500);

  const iosTokens = (tokens ?? []).filter(
    (t) =>
      (!t.platform || t.platform === "ios") &&
      !t.disabled_at &&
      !t.invalidated_at,
  );
  if (iosTokens.length === 0) {
    return json({ ok: true, sent: 0, failed: 0, results: [], note: "no_ios_tokens" });
  }

  const title = body.title ?? "InteliAds";
  const bodyText =
    body.body ??
    (body.test
      ? "Server push is live. This alert came from Apple's servers."
      : "You have a new InteliAds update.");
  const payload: Record<string, unknown> = silent
    ? {
        aps: { "content-available": 1 },
        ...(body.data ?? {}),
      }
    : {
        aps: { alert: { title, body: bodyText }, sound: "default" },
        ...(body.data ?? {}),
      };
  const event = body.event ?? (silent ? "kdp-wake" : body.test ? "test" : undefined);
  if (event) payload.event = event;
  payload.userId = targetUserId;
  if (silent) payload.silent = true;

  const authToken = await apnsAuthToken();
  const results: SendResult[] = [];
  const deadTokens: string[] = [];

  for (const row of iosTokens) {
    try {
      const result = await sendToDevice(
        authToken,
        row.token,
        row.environment,
        payload,
        { silent },
      );
      results.push(result);
      if (
        result.status === 410 ||
        result.reason === "Unregistered" ||
        result.reason === "BadDeviceToken"
      ) {
        deadTokens.push(row.token);
      }
    } catch (e) {
      results.push({
        token: row.token,
        ok: false,
        status: 0,
        reason: String(e),
      });
    }
  }

  // Soft-invalidate (Nest / kdp-wake parity) so re-register can clear the flags.
  if (deadTokens.length > 0) {
    await admin
      .from("device_push_tokens")
      .update({
        invalidated_at: new Date().toISOString(),
        disabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in("token", deadTokens);
  }

  const sent = results.filter((r) => r.ok).length;
  return json({
    ok: true,
    sent,
    failed: results.length - sent,
    pruned: deadTokens.length,
    results,
  });
});
