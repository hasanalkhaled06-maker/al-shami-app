const ALLOWED_ORIGINS = new Set([
  "https://alshamiapp.xyz",
  "https://www.alshamiapp.xyz",
]);

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function readKeySet(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.[name] === "string" ? parsed[name] : undefined;
  } catch {
    return undefined;
  }
}

function envValue(primary: string | undefined, keySet: string | undefined): string | undefined {
  return primary || readKeySet(keySet, "default");
}

function authHeaders(key: string, bearer = key) {
  return {
    apikey: key,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };
}

async function requestJson(url: string, headers: HeadersInit, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "Request failed.";
    throw new Error(message);
  }
  return body;
}

function invalidLogin(origin: string) {
  return json({ error: "UUID or password is incorrect, or rider access is inactive." }, 401, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) },
    });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = envValue(Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const secretKey = envValue(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!supabaseUrl || !publicKey || !secretKey) {
    return json({ error: "Rider sign-in is not configured." }, 500, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400, origin);
  }

  const userId = String(payload.rider_uuid ?? "").trim();
  const password = String(payload.password ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
      password.length < 1 || password.length > 128) {
    return invalidLogin(origin);
  }

  const adminHeaders = authHeaders(secretKey);
  const publicHeaders = authHeaders(publicKey);
  const rest = `${supabaseUrl}/rest/v1`;
  const auth = `${supabaseUrl}/auth/v1`;

  try {
    const profiles = await requestJson(
      `${rest}/staff_profiles?select=user_id,role,is_active,employment_status&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      adminHeaders,
    );
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile ||
        String(profile.user_id).toLowerCase() !== userId.toLowerCase() ||
        String(profile.role) !== "delivery_rider" ||
        profile.is_active !== true ||
        String(profile.employment_status).toLowerCase() !== "active") {
      return invalidLogin(origin);
    }

    const authUser = await requestJson(
      `${auth}/admin/users/${encodeURIComponent(userId)}`,
      adminHeaders,
    );
    const email = String(authUser?.user?.email ?? authUser?.email ?? "");
    if (!email) return invalidLogin(origin);

    let session: Record<string, unknown>;
    try {
      session = await requestJson(
        `${auth}/token?grant_type=password`,
        publicHeaders,
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
    } catch {
      return invalidLogin(origin);
    }

    const signedInId = String((session as any)?.user?.id ?? "");
    if (!session.access_token || !session.refresh_token ||
        (signedInId && signedInId.toLowerCase() !== userId.toLowerCase())) {
      return invalidLogin(origin);
    }

    return json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    }, 200, origin);
  } catch (error) {
    console.error("Rider login verification failed:", error);
    return json({ error: "Could not verify rider access. Check the connection and try again." }, 500, origin);
  }
});
