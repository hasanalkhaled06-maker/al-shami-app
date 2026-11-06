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

function normalizeGhanaPhone(value: unknown): string | null {
  let phone = String(value ?? "").trim().replace(/[^0-9+]/g, "");
  if (/^0[0-9]{9}$/.test(phone)) phone = "+233" + phone.slice(1);
  else if (/^233[0-9]{9}$/.test(phone)) phone = "+" + phone;
  return /^\+233[0-9]{9}$/.test(phone) ? phone : null;
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
    if (action === "correct-pending-email") {
      const phone = normalizeGhanaPhone(body.contact_phone);
      const newEmail = String(body.new_email ?? "").trim().toLowerCase();
      const genericFailure = () => json({ error: "We couldn't verify an unfinished signup for that phone. Check the phone and original password, or contact AL SHAMI for help." }, 400, origin);
      if (!phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254
        || password.length < 8 || password.length > 128) return genericFailure();

      const profiles = await requestJson(
        `${rest}/customer_profiles?select=user_id&phone_e164=eq.${encodeURIComponent(phone)}&limit=1`, adminHeaders,
      );
      const userId = Array.isArray(profiles) ? String(profiles[0]?.user_id || "") : "";
      if (!userId) return genericFailure();

      const authResult = await requestJson(`${auth}/admin/users/${encodeURIComponent(userId)}`, adminHeaders);
      const user = authResult?.user ?? authResult;
      const metadata = user?.user_metadata ?? {};
      const savedPhone = normalizeGhanaPhone(metadata.contact_phone);
      const currentEmail = String(user?.email ?? "").trim().toLowerCase();
      if (!currentEmail || user?.email_confirmed_at || metadata.customer_account !== "true"
        || currentEmail.endsWith("@username.alshamiapp.xyz") || savedPhone !== phone) return genericFailure();

      const passwordResponse = await fetch(`${auth}/token?grant_type=password`, {
        method: "POST", headers: publicHeaders, body: JSON.stringify({ email: currentEmail, password }),
      });
      const passwordResult = await passwordResponse.json().catch(() => ({}));
      const authCode = String(passwordResult?.error_code || passwordResult?.code || "").toLowerCase();
      const authMessage = String(passwordResult?.msg || passwordResult?.message || "").toLowerCase();
      if (passwordResponse.ok || (authCode !== "email_not_confirmed" && !authMessage.includes("email not confirmed"))) return genericFailure();

      await requestJson(`${auth}/admin/users/${encodeURIComponent(userId)}`, adminHeaders, {
        method: "PUT", body: JSON.stringify({ email: newEmail, email_confirm: false }),
      });

      let confirmationSent = false;
      try {
        const resend = await fetch(`${auth}/resend?redirect_to=${encodeURIComponent("https://alshamiapp.xyz/")}`, {
          method: "POST", headers: publicHeaders,
          body: JSON.stringify({ type: "signup", email: newEmail }),
        });
        confirmationSent = resend.ok;
      } catch { confirmationSent = false; }
      return json({ ok: true, confirmation_sent: confirmationSent }, 200, origin);
    }

    if (action === "register") {
      const phone = String(body.contact_phone ?? "").trim();
      const fullName = String(body.full_name ?? "").trim().slice(0, 120);
      if (fullName.length < 2 || phone.length < 7 || phone.length > 30) {
        return json({ error: "Enter your name and contact phone number." }, 400, origin);
      }
      const syntheticEmail = `${username}@username.alshamiapp.xyz`;
      const created = await requestJson(`${auth}/admin/users`, adminHeaders, {
        method: "POST",
        body: JSON.stringify({ email: syntheticEmail, password, email_confirm: true,
          user_metadata: { customer_account: "true", customer_username: username, contact_phone: phone, full_name: fullName } }),
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
      return json({ error: "This username or contact phone is already linked to an account. Sign in or contact AL SHAMI for help." }, 409, origin);
    }
    if (action === "login") return json({ error: "Incorrect username or password." }, 401, origin);
    console.error("Customer username registration failed:", message);
    return json({ error: "Could not create the account. Check the details and try again." }, 400, origin);
  }
});
