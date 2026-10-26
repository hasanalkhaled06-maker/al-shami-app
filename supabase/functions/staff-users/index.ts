const ALLOWED_ORIGINS = new Set([
  "https://alshamiapp.xyz",
  "https://www.alshamiapp.xyz",
]);

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type Action = "bootstrap_owner" | "login" | "list" | "create" | "set_active" | "reset_password";

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

function normalizedUsername(value: unknown): string | null {
  const username = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) ? username : null;
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

async function requestJson(url: string, headers: HeadersInit, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "Request failed.";
    throw new Error(message);
  }
  return body;
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
    return json({ error: "Staff login is not configured." }, 500, origin);
  }

  const authHeaders = (key: string, bearer = key) => ({
    apikey: key,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  });
  const adminHeaders = authHeaders(secretKey);
  const rest = `${supabaseUrl}/rest/v1`;
  const auth = `${supabaseUrl}/auth/v1`;

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400, origin);
  }
  const action = String(payload.action ?? "") as Action;

  try {
    if (action === "login") {
      const username = normalizedUsername(payload.username);
      const password = String(payload.password ?? "");
      if (!username || password.length < 1 || password.length > 128) {
        return json({ error: "Incorrect username or password." }, 401, origin);
      }

      const matches = await requestJson(
        `${rest}/staff_login_accounts?select=user_id,is_active&username=eq.${encodeURIComponent(username)}&limit=1`,
        adminHeaders,
      );
      const account = Array.isArray(matches) ? matches[0] : null;
      if (!account?.user_id || !account.is_active) {
        return json({ error: "Incorrect username or password, or this user is inactive." }, 401, origin);
      }

      const admins = await requestJson(
        `${rest}/admin_users?select=user_id&user_id=eq.${encodeURIComponent(account.user_id)}&limit=1`,
        adminHeaders,
      );
      const isOwner = Array.isArray(admins) && admins.length > 0;
      let role = "owner";
      let profile: Record<string, unknown> | null = null;

      if (!isOwner) {
        const profiles = await requestJson(
          `${rest}/staff_profiles?select=user_id,full_name,role,is_active,employment_status&user_id=eq.${encodeURIComponent(account.user_id)}&limit=1`,
          adminHeaders,
        );
        profile = Array.isArray(profiles) ? profiles[0] : null;
        if (!profile?.user_id || profile.is_active !== true || profile.employment_status !== "active" || !["cashier", "kitchen"].includes(String(profile.role))) {
          return json({ error: "Incorrect username or password, or this user is inactive." }, 401, origin);
        }
        role = String(profile.role);
      }

      const authUser = await requestJson(
        `${auth}/admin/users/${encodeURIComponent(account.user_id)}`,
        adminHeaders,
      );
      const email = String(authUser?.user?.email ?? authUser?.email ?? "");
      if (!email) return json({ error: "Incorrect username or password." }, 401, origin);

      const session = await requestJson(
        `${auth}/token?grant_type=password`,
        authHeaders(publicKey),
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      return json({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
        role,
        full_name: isOwner ? "AL SHAMI Admin" : String(profile?.full_name ?? username),
      }, 200, origin);
    }

    const bearer = req.headers.get("authorization") || "";
    if (!bearer.startsWith("Bearer ")) return json({ error: "Owner sign-in is required." }, 401, origin);
    const caller = await requestJson(`${auth}/user`, authHeaders(publicKey, bearer.slice(7)));
    const callerId = String(caller?.id ?? "");
    if (!callerId) return json({ error: "Your session is invalid or expired." }, 401, origin);

    const owners = await requestJson(
      `${rest}/admin_users?select=user_id&user_id=eq.${encodeURIComponent(callerId)}&limit=1`,
      adminHeaders,
    );
    if (!Array.isArray(owners) || owners.length === 0) return json({ error: "Owner access required." }, 403, origin);

    if (action === "bootstrap_owner") {
      const username = normalizedUsername(payload.username);
      if (!username) return json({ error: "Use 3–30 characters: letters, numbers, dot, underscore, or dash." }, 400, origin);
      const saved = await requestJson(
        `${rest}/staff_login_accounts?on_conflict=user_id`,
        { ...adminHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
        { method: "POST", body: JSON.stringify({ user_id: callerId, username, is_active: true, updated_at: new Date().toISOString() }) },
      );
      return json({ ok: true }, 200, origin);
    }

    if (action === "list") {
      const accounts = await requestJson(`${rest}/staff_login_accounts?select=user_id,username,is_active&order=username.asc`, adminHeaders);
      const profiles = await requestJson(`${rest}/staff_profiles?select=user_id,full_name,role,is_active,employment_status`, adminHeaders);
      const ownersList = await requestJson(`${rest}/admin_users?select=user_id`, adminHeaders);
      const profileById = new Map((Array.isArray(profiles) ? profiles : []).map((item: Record<string, unknown>) => [String(item.user_id), item]));
      const ownerIds = new Set((Array.isArray(ownersList) ? ownersList : []).map((item: Record<string, unknown>) => String(item.user_id)));
      const list = (Array.isArray(accounts) ? accounts : []).map((item: Record<string, unknown>) => {
        const id = String(item.user_id);
        const profile = profileById.get(id) as Record<string, unknown> | undefined;
        const isOwner = ownerIds.has(id);
        return {
          user_id: id,
          username: item.username,
          full_name: isOwner ? "AL SHAMI Admin" : profile?.full_name ?? "Staff user",
          role: isOwner ? "owner" : profile?.role ?? "staff",
          is_active: Boolean(item.is_active) && (isOwner || (profile?.is_active === true && profile?.employment_status === "active")),
        };
      });
      return json({ users: list }, 200, origin);
    }

    if (action === "create") {
      const username = normalizedUsername(payload.username);
      const fullName = String(payload.full_name ?? "").trim().slice(0, 120);
      const password = String(payload.password ?? "");
      const role = String(payload.role ?? "");
      if (!username || !fullName || role !== "cashier" || password.length < 6 || password.length > 128) {
        return json({ error: "Enter a valid username, name, role, and password of at least 6 characters." }, 400, origin);
      }
      const email = `${username}@staff.alshamiapp.xyz`;
      const created = await requestJson(`${auth}/admin/users`, adminHeaders, {
        method: "POST",
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { staff_username: username, full_name: fullName } }),
      });
      const userId = String(created?.user?.id ?? created?.id ?? "");
      if (!userId) return json({ error: "Could not create the staff account." }, 500, origin);
      try {
        await requestJson(`${rest}/staff_login_accounts`, { ...adminHeaders, Prefer: "return=minimal" }, {
          method: "POST",
          body: JSON.stringify({ user_id: userId, username, is_active: true }),
        });
        await requestJson(`${rest}/staff_profiles`, { ...adminHeaders, Prefer: "return=minimal" }, {
          method: "POST",
          body: JSON.stringify({ user_id: userId, full_name: fullName, email, role, is_active: true, employment_status: "active", position_title: role === "cashier" ? "Cashier" : "Kitchen" }),
        });
      } catch (error) {
        await fetch(`${auth}/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: adminHeaders });
        throw error;
      }
      return json({ ok: true, username, role }, 200, origin);
    }

    if (action === "set_active") {
      const userId = String(payload.user_id ?? "");
      const active = payload.is_active === true;
      if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === callerId) return json({ error: "Invalid staff account." }, 400, origin);
      const profiles = await requestJson(`${rest}/staff_profiles?select=user_id,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`, adminHeaders);
      if (!Array.isArray(profiles) || profiles.length === 0 || !["cashier", "kitchen"].includes(String(profiles[0].role))) {
        return json({ error: "Staff account not found." }, 404, origin);
      }
      await requestJson(`${rest}/staff_login_accounts?user_id=eq.${encodeURIComponent(userId)}`, { ...adminHeaders, Prefer: "return=minimal" }, {
        method: "PATCH", body: JSON.stringify({ is_active: active, updated_at: new Date().toISOString() }),
      });
      await requestJson(`${rest}/staff_profiles?user_id=eq.${encodeURIComponent(userId)}`, { ...adminHeaders, Prefer: "return=minimal" }, {
        method: "PATCH", body: JSON.stringify({ is_active: active, employment_status: active ? "active" : "suspended", updated_at: new Date().toISOString() }),
      });
      return json({ ok: true }, 200, origin);
    }

    if (action === "reset_password") {
      const userId = String(payload.user_id ?? "");
      const password = String(payload.password ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === callerId || password.length < 6 || password.length > 128) {
        return json({ error: "Choose a new password of at least 6 characters for a staff account." }, 400, origin);
      }
      const profiles = await requestJson(`${rest}/staff_profiles?select=user_id&user_id=eq.${encodeURIComponent(userId)}&limit=1`, adminHeaders);
      if (!Array.isArray(profiles) || profiles.length === 0) return json({ error: "Staff account not found." }, 404, origin);
      await requestJson(`${auth}/admin/users/${encodeURIComponent(userId)}`, adminHeaders, {
        method: "PUT", body: JSON.stringify({ password }),
      });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "Unknown action." }, 400, origin);
  } catch (error) {
    console.error("Staff user operation failed:", String(error));
    return json({ error: "The user operation could not be completed. Check the username, permissions, and account status." }, 400, origin);
  }
});
