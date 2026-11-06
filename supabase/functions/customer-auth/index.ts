const ALLOWED_ORIGINS = new Set(["https://alshamiapp.xyz", "https://www.alshamiapp.xyz"]);
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function envValue(primary?: string, keySet?: string) {
  if (primary) return primary;
  try { return JSON.parse(keySet || "{}").default as string | undefined; } catch { return undefined; }
}

function validUsername(value: unknown): string | null {
  const username = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) ? username : null;
}

async function requestJson(url: string, headers: HeadersInit, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.msg || body?.message || body?.error_description || body?.error || "Request failed."));
  return body;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = envValue(Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const secretKey = envValue(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!supabaseUrl || !publicKey || !secretKey) return json({ error: "Customer username sign-in is not configured." }, 500, origin);
  const auth = `${supabaseUrl}/auth/v1`;
  const rest = `${supabaseUrl}/rest/v1`;
  const adminHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };
  const publicHeaders = { apikey: publicKey, Authorization: `Bearer ${publicKey}`, "Content-Type": "application/json" };

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400, origin); }
  const action = String(body.action || "");
  const username = validUsername(body.username);
  const password = String(body.password ?? "");

  if (((action === "register" || action === "login") && !username) || password.length < 8 || password.length > 128) {
    return json({ error: "Enter a valid username and password." }, 400, origin);
  }

  try {
    if (action === "register") {
      const syntheticEmail = `${username}@username.alshamiapp.xyz`;
      const created = await requestJson(`${auth}/admin/users`, adminHeaders, {
        method: "POST",
        body: JSON.stringify({ email: syntheticEmail, password, email_confirm: true,
          user_metadata: { customer_account: "true", customer_username: username } }),
      });
      const userId = String(created?.user?.id ?? created?.id ?? "");
      if (!userId) return json({ error: "Could not create the account. Please try again." }, 400, origin);
      const session = await requestJson(`${auth}/token?grant_type=password`, publicHeaders, {
        method: "POST", body: JSON.stringify({ email: syntheticEmail, password }),
      });
      return json({ access_token: session.access_token, refresh_token: session.refresh_token,
        expires_in: session.expires_in, token_type: session.token_type }, 200, origin);
    }

    if (action === "login") {
      const matches = await requestJson(
        `${rest}/customer_login_accounts?select=user_id&username=eq.${encodeURIComponent(username)}&limit=1`, adminHeaders,
      );
      const userId = Array.isArray(matches) ? String(matches[0]?.user_id || "") : "";
      if (!userId) return json({ error: "Incorrect username or password." }, 401, origin);
      const authUser = await requestJson(`${auth}/admin/users/${encodeURIComponent(userId)}`, adminHeaders);
      const email = String(authUser?.user?.email ?? authUser?.email ?? "");
      if (!email) return json({ error: "Incorrect username or password." }, 401, origin);
      const session = await requestJson(`${auth}/token?grant_type=password`, publicHeaders, {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      return json({ access_token: session.access_token, refresh_token: session.refresh_token,
        expires_in: session.expires_in, token_type: session.token_type }, 200, origin);
    }
    return json({ error: "Unsupported action." }, 400, origin);
  } catch (error) {
    const message = String((error as Error)?.message || "");
    if (/duplicate|unique|already registered|phone number.*already|23505/i.test(message)) {
      return json({ error: "This username is already linked to an account. Sign in or contact AL SHAMI for help." }, 409, origin);
    }
    if (action === "login") return json({ error: "Incorrect username or password." }, 401, origin);
    console.error("Customer username registration failed:", message);
    return json({ error: "Could not create the account. Check the details and try again." }, 400, origin);
  }
});
