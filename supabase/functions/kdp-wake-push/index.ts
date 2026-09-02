// InteliAds silent KDP wake metronome (Supabase Edge Function).
//
// Fans out content-available APNs pushes to every registered iOS device so the
// app can run runKdpIosHelperTick while backgrounded / locked (after first unlock).
// No Amazon cookies leave the device — the server only holds opaque APNs tokens.
//
// Auth (either):
//   - Authorization: Bearer <service_role JWT>
//   - X-InteliAds-Wake-Secret: <KDP_WAKE_SECRET>
//
// Required secrets: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID
// Optional: KDP_WAKE_SECRET (required when not using service_role)
//
// Invoked by pg_cron every ~15 minutes (see schedule_kdp_wake_cron.sql).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "io.inteliads.app";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KDP_WAKE_SECRET = Deno.env.get("KDP_WAKE_SECRET") ?? "";

const MIN_INTERVAL_SECONDS = 14 * 60;
const APNS_COLLAPSE_SLOT_SECONDS = 15 * 60;
const APNS_EXPIRATION_SECONDS = 18 * 60;
const TOKEN_PAGE = 500;
const CONCURRENCY = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-inteliads-wake-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
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
  if (cachedToken && now - cachedToken.iat < 45 * 60) return cachedToken.jwt;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(APNS_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
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

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const lhs = new Uint8Array(a);
  const rhs = new Uint8Array(b);
  let mismatch = 0;
  for (let i = 0; i < lhs.length; i++) mismatch |= lhs[i] ^ rhs[i];
  return mismatch === 0;
}

function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

type TokenRow = { token: string; environment: string | null; platform: string | null };

async function loadTokens(admin: ReturnType<typeof createClient>): Promise<TokenRow[]> {
  const rows: TokenRow[] = [];
  for (let from = 0; ; from += TOKEN_PAGE) {
    const { data, error } = await admin
      .from("device_push_tokens")
      .select("token, environment, platform")
      .range(from, from + TOKEN_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as TokenRow[];
    rows.push(...page);
    if (page.length < TOKEN_PAGE) break;
  }
  return rows.filter((r) => !r.platform || r.platform === "ios");
}

async function runBounded<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    return json({ error: "apns_not_configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  const wakeSecret = req.headers.get("X-InteliAds-Wake-Secret") ?? "";
  const role = jwtRole(jwt);
  const isService =
    role === "service_role" ||
    (SERVICE_ROLE_KEY.length > 0 && jwt === SERVICE_ROLE_KEY);
  const secretOk = await secretsMatch(wakeSecret, KDP_WAKE_SECRET);
  if (!isService && !secretOk) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Rate-limit fleet wakes (~15m) via single-row lease table.
  const { data: claim, error: claimError } = await admin.rpc("claim_kdp_wake_dispatch", {
    minimum_interval_seconds: MIN_INTERVAL_SECONDS,
  });
  if (claimError) {
    // Table/RPC missing → still send once (dev / first deploy), but report.
    console.warn("claim_kdp_wake_dispatch unavailable", claimError.message);
  } else if (claim === false || claim === null) {
    return json(
      { accepted: false, reason: "rate_limited" },
      202,
      { "retry-after": String(MIN_INTERVAL_SECONDS) },
    );
  }

  let tokens: TokenRow[];
  try {
    tokens = await loadTokens(admin);
  } catch (e) {
    return json({ error: "token_lookup_failed", detail: String(e) }, 500);
  }
  if (tokens.length === 0) {
    return json({ ok: true, sent: 0, failed: 0, pruned: 0, note: "no_ios_tokens" });
  }

  const wakeSlot = Math.floor(Date.now() / 1000 / APNS_COLLAPSE_SLOT_SECONDS);
  const collapseId = `inteliads-kdp-${wakeSlot}`;
  const expiration = String(Math.floor(Date.now() / 1000) + APNS_EXPIRATION_SECONDS);
  const payload = JSON.stringify({
    aps: { "content-available": 1 },
    event: "kdp-wake",
    silent: true,
    inteliads_wake: wakeSlot,
  });

  const authToken = await apnsAuthToken();
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  const failureSamples: string[] = [];

  await runBounded(tokens, CONCURRENCY, async (row) => {
    const tryEnvs = [row.environment === "sandbox" ? "sandbox" : "production"];
    // Production-only .p8 keys reject sandbox; also heal mislabeled tokens.
    if (tryEnvs[0] === "sandbox") tryEnvs.push("production");
    else tryEnvs.push("sandbox");

    let delivered = false;
    for (const env of tryEnvs) {
      try {
        const res = await fetch(`${apnsHost(env)}/3/device/${row.token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${authToken}`,
            "apns-topic": APNS_BUNDLE_ID,
            "apns-push-type": "background",
            "apns-priority": "5",
            "apns-collapse-id": collapseId,
            "apns-expiration": expiration,
            "content-type": "application/json",
          },
          body: payload,
        });
        if (res.status === 200) {
          await res.body?.cancel();
          sent += 1;
          delivered = true;
          if (env !== row.environment) {
            await admin
              .from("device_push_tokens")
              .update({ environment: env, updated_at: new Date().toISOString() })
              .eq("token", row.token);
          }
          break;
        }
        let reason = "";
        try {
          const parsed = await res.json();
          reason = parsed?.reason ?? "";
        } catch {
          /* ignore */
        }
        const sample = `${res.status}:${reason || "unknown"}:${env}`;
        if (failureSamples.length < 5) failureSamples.push(sample);
        if (res.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
          dead.push(row.token);
          break;
        }
        if (reason !== "BadEnvironmentKeyInToken") {
          // other permanent/transient errors — stop trying alternate env
          failed += 1;
          break;
        }
        // else try next environment
      } catch (e) {
        if (failureSamples.length < 5) failureSamples.push(`0:${String(e).slice(0, 80)}`);
        failed += 1;
        break;
      }
    }
    if (!delivered && !dead.includes(row.token)) {
      // exhausted env retries after BadEnvironmentKeyInToken
      failed += 1;
    }
  });

  if (dead.length > 0) {
    await admin.from("device_push_tokens").delete().in("token", dead);
  }

  return json({
    ok: true,
    sent,
    failed,
    pruned: dead.length,
    tokens: tokens.length,
    collapseId,
    failureSamples,
  });
});
