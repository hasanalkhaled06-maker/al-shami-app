const cors = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const allowedOrigins = new Set([
  "https://alshamiapp.xyz",
  "https://www.alshamiapp.xyz",
  "https://hasanalkhaled06-maker.github.io",
]);
function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
function readKey(value: string | undefined, field: string) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.[field] === "string" ? parsed[field] : undefined;
  } catch {
    return undefined;
  }
}
function envValue(primary: string | undefined, keySet: string | undefined) {
  return primary || readKey(keySet, "default");
}
function headers(key: string, bearer = key) {
  return { apikey: key, Authorization: "Bearer " + bearer, "Content-Type": "application/json" };
}
async function jsonRequest(url: string, requestHeaders: HeadersInit, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: requestHeaders });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "Request failed.";
    throw new Error(message);
  }
  return body;
}
function denied(origin: string) {
  return json({ error: "Only an authorised AL SHAMI administrator can create rider logins." }, 403, origin);
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...cors, ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, origin);

  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = envValue(Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const serviceKey = envValue(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SECRET_KEYS"));
  if (!bearer || !supabaseUrl || !publicKey || !serviceKey) {
    return json({ error: "Rider login management is not configured." }, 500, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400, origin);
  }
  const profileId = String(body.staff_profile_id || "").trim();
  const password = String(body.password || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId) ||
      password.length < 8 || password.length > 128) {
    return json({ error: "Choose a rider profile and a password between 8 and 128 characters." }, 400, origin);
  }

  const authBase = supabaseUrl + "/auth/v1";
  const restBase = supabaseUrl + "/rest/v1";
  try {
    // Verify the caller's signed-in identity and admin authorization before using the service key.
    await jsonRequest(authBase + "/user", headers(publicKey, bearer));
    const isAdmin = await jsonRequest(restBase + "/rpc/is_current_user_admin", headers(publicKey, bearer), { method: "POST", body: "{}" });
    if (isAdmin !== true) return denied(origin);

    const adminHeaders = headers(serviceKey);
    const rows = await jsonRequest(
      restBase + "/staff_profiles?select=id,full_name,role&id=eq." + encodeURIComponent(profileId) + "&limit=1",
      adminHeaders,
    );
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile || String(profile.role) !== "delivery_rider") {
      return json({ error: "Save this employee as a Delivery Rider before creating a rider login." }, 400, origin);
    }

    // Supabase password auth requires an email or phone identity. This private synthetic
    // address is confirmed at creation, never shown to the rider, and receives no email.
    const internalEmail = "rider-" + crypto.randomUUID() + "@auth.alshamiapp.xyz";
    const created = await jsonRequest(authBase + "/admin/users", adminHeaders, {
      method: "POST",
      body: JSON.stringify({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: String(profile.full_name || "Delivery Rider"),
          requested_role: "delivery_rider",
        },
      }),
    });
    const userId = String(created?.user?.id || created?.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      throw new Error("Auth did not return the new rider UUID.");
    }

    try {
      const response = await fetch(
        restBase + "/staff_profiles?id=eq." + encodeURIComponent(profileId),
        {
          method: "PATCH",
          headers: { ...adminHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ user_id: userId }),
        },
      );
      if (!response.ok) {
        await fetch(authBase + "/admin/users/" + encodeURIComponent(userId), {
          method: "DELETE",
          headers: adminHeaders,
        }).catch(() => undefined);
        throw new Error("Could not link the new rider login to its employee profile.");
      }
    } catch (error) {
      console.error("Could not link new rider login:", error);
      throw error;
    }

    return json({ user_id: userId }, 200, origin);
  } catch (error) {
    console.error("Rider account provisioning failed:", error);
    return json({ error: error instanceof Error ? error.message : "Could not create the rider login." }, 500, origin);
  }
});
