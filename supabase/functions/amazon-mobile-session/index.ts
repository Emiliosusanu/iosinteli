// Mint a short-lived Supabase magic-link session after Amazon OAuth on iOS.
//
// Body: { accessToken: <Nest JWT from Amazon callback> }
// Verifies the Nest bearer via GET /auth/me, then returns a token_hash the
// app can pass to supabase.auth.verifyOtp({ type: "magiclink", token_hash }).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const NEST_API_BASE = (Deno.env.get("NEST_API_BASE") ?? "https://api.inteliads.io/api").replace(/\/+$/, "");

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { accessToken?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (!accessToken) return json({ error: "missing_access_token" }, 400);

  const meRes = await fetch(`${NEST_API_BASE}/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!meRes.ok) {
    return json({ error: "invalid_amazon_session" }, 401);
  }
  const me = await meRes.json();
  const email = typeof me?.email === "string" ? me.email.trim() : "";
  if (!email) return json({ error: "missing_email" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    return json({ error: error?.message ?? "generate_link_failed" }, 500);
  }

  return json({
    ok: true,
    email,
    token_hash: data.properties.hashed_token,
  });
});
