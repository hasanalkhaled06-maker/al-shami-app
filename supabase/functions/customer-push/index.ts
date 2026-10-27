import * as webpush from "@negrel/webpush";

const allowedOrigins = new Set(["https://alshamiapp.xyz", "https://www.alshamiapp.xyz"]);
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://alshamiapp.xyz",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
});
function reply(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });
}
function serviceHeaders(extra: Record<string, string> = {}) {
  return { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json", ...extra };
}
async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, { ...init, headers: serviceHeaders(Object.fromEntries(new Headers(init.headers).entries())) });
  const text = await response.text();
  if (!response.ok) throw new Error("Database request failed (" + response.status + "): " + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
function tableUrl(table: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return table + "?" + query.toString();
}
function safeEndpoint(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const allowedHosts = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
    if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.some(domain => host === domain || host.endsWith("." + domain))) return null;
    return url.href;
  } catch { return null; }
}
async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || !supabaseUrl || !anonKey || !serviceKey) return null;
  const response = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: anonKey, Authorization: authorization } });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? { id: String(user.id), authorization } : null;
}
async function isAdmin(userId: string) {
  const rows = await rest(tableUrl("admin_users", { select: "user_id", user_id: "eq." + userId, limit: "1" }));
  return Array.isArray(rows) && rows.length > 0;
}
async function isCashier(userId: string) {
  const rows = await rest(tableUrl("staff_profiles", { select: "user_id", user_id: "eq." + userId, role: "eq.cashier", limit: "1" }));
  return Array.isArray(rows) && rows.length > 0;
}
async function requireStaff(userId: string, adminOnly = false) {
  if (await isAdmin(userId)) return "admin";
  if (!adminOnly && await isCashier(userId)) return "cashier";
  return null;
}
let cachedAppServer: Promise<{ server: webpush.ApplicationServer; publicKey: string; exported: webpush.ExportedVapidKeys }> | null = null;
async function appServer() {
  if (!cachedAppServer) {
    cachedAppServer = (async () => {
      let rows = await rest(tableUrl("customer_push_vapid_keys", { select: "public_key,private_key,subject", id: "eq.true", limit: "1" }));
      if (!Array.isArray(rows) || !rows.length) {
        const keys = await webpush.generateVapidKeys({ extractable: true });
        const exported = await webpush.exportVapidKeys(keys);
        const subject = "mailto:hasanalkhaled06@gmail.com";
        try {
          rows = await rest(tableUrl("customer_push_vapid_keys", { on_conflict: "id" }), {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
            body: JSON.stringify({ id: true, public_key: exported.publicKey, private_key: exported.privateKey, subject })
          });
        } catch { rows = []; }
        if (!Array.isArray(rows) || !rows.length) {
          rows = await rest(tableUrl("customer_push_vapid_keys", { select: "public_key,private_key,subject", id: "eq.true", limit: "1" }));
        }
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error("VAPID key could not be initialized.");
      const row = rows[0];
      const exported = { publicKey: row.public_key, privateKey: row.private_key };
      const keys = await webpush.importVapidKeys(exported, { extractable: false });
      const server = await webpush.ApplicationServer.new({ contactInformation: row.subject, vapidKeys: keys });
      return { server, publicKey: await webpush.exportApplicationServerKey(keys), exported };
    })();
  }
  try { return await cachedAppServer; } catch (error) { cachedAppServer = null; throw error; }
}
function language(value: unknown) {
  const lang = String(value || "en").toLowerCase();
  return lang === "ar" || lang === "tw" ? lang : "en";
}
const orderMessages: Record<string, Record<string, (n: string) => { title: string; body: string }>> = {
  en: {
    accepted: n => ({ title: "Order accepted", body: "Your AL SHAMI order #" + n + " has been accepted." }),
    preparing: n => ({ title: "Order being prepared", body: "We are preparing your order #" + n + "." }),
    ready: n => ({ title: "Order ready", body: "Your order #" + n + " is ready." }),
    out_for_delivery: n => ({ title: "Order on the way", body: "Your order #" + n + " is on the way." }),
    rejected: n => ({ title: "Order update", body: "We could not accept order #" + n + ". Please contact AL SHAMI." }),
    completed: n => ({ title: "Order received", body: "Order #" + n + " was confirmed as received. Thank you!" })
  },
  ar: {
    accepted: n => ({ title: "تم قبول الطلب", body: "تم قبول طلبك رقم " + n + " من الشامي." }),
    preparing: n => ({ title: "طلبك قيد التحضير", body: "نحضّر طلبك رقم " + n + " الآن." }),
    ready: n => ({ title: "طلبك جاهز", body: "طلبك رقم " + n + " أصبح جاهزاً." }),
    out_for_delivery: n => ({ title: "طلبك في الطريق", body: "طلبك رقم " + n + " في طريقه إليك." }),
    rejected: n => ({ title: "تحديث الطلب", body: "تعذّر قبول طلبك رقم " + n + ". يرجى التواصل مع المطعم." }),
    completed: n => ({ title: "تم استلام الطلب", body: "تم تأكيد استلام الطلب رقم " + n + ". شكراً لك!" })
  },
  tw: {
    accepted: n => ({ title: "Yɛagye order no", body: "AL SHAMI agye wo order #" + n + "." }),
    preparing: n => ({ title: "Yɛreyɛ wo order", body: "Yɛreyɛ wo order #" + n +." }),
    ready: n => ({ title: "Wo order ayɛ krado", body: "Wo order #" + n + " ayɛ krado." }),
    out_for_delivery: n => ({ title: "Wo order reba", body: "Wo order #" + n + " wɔ kwan so reba wo nkyɛn." }),
    rejected: n => ({ title: "Order no ho nsɛm", body: "Yɛantumi annye order #" + n + ". Frɛ AL SHAMI." }),
    completed: n => ({ title: "Wo nsa aka order no", body: "Yɛagye sɛ wo nsa aka order #" + n + ". Medaase!" })
  }
};
async function sendToRows(rows: any[], build: (row: any) => Record<string, unknown>) {
  const { server } = await appServer();
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      const endpoint = safeEndpoint(row.endpoint);
      if (!endpoint) throw Object.assign(new Error("Invalid push endpoint"), { status: 410 });
      const subscriber = server.subscribe({ endpoint, keys: { p256dh: row.p256dh_key, auth: row.auth_key } });
      const content = build(row);
      await subscriber.pushTextMessage(JSON.stringify(content), { urgency: webpush.Urgency.High, ttl: 86400 });
      sent++;
    } catch (error) {
      failed++;
      const status = Number((error as any)?.response?.status || (error as any)?.status || 0);
      if (status === 404 || status === 410) {
        try { await rest(tableUrl("customer_push_subscriptions", { id: "eq." + row.id }), { method: "DELETE" }); } catch { /* best-effort stale subscription cleanup */ }
      }
    }
  }
  return { sent, failed, attempted: rows.length };
}
async function promoRows() {
  const prefs = await rest(tableUrl("customer_notification_preferences", { select: "customer_user_id", promotions: "eq.true", limit: "10000" }));
  const userIds = Array.isArray(prefs) ? Array.from(new Set(prefs.map((row: any) => String(row.customer_user_id)).filter(Boolean))) : [];
  const result: any[] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const ids = userIds.slice(i, i + 100);
    result.push(...await rest(tableUrl("customer_push_subscriptions", {
      select: "id,customer_user_id,endpoint,p256dh_key,auth_key,language",
      customer_user_id: "in.(" + ids.join(",") + ")",
      limit: "10000"
    })));
  }
  return result;
}
async function customerRowsForOrder(order: any) {
  if (!order.customer_user_id) return { rows: [], preference: null };
  const prefs = await rest(tableUrl("customer_notification_preferences", {
    select: "order_updates", customer_user_id: "eq." + order.customer_user_id, limit: "1"
  }));
  if (Array.isArray(prefs) && prefs[0]?.order_updates === false) return { rows: [], preference: false };
  const rows = await rest(tableUrl("customer_push_subscriptions", {
    select: "id,customer_user_id,endpoint,p256dh_key,auth_key,language",
    customer_user_id: "eq." + order.customer_user_id, limit: "100"
  }));
  return { rows: Array.isArray(rows) ? rows : [], preference: true };
}
async function sendOrderStatus(orderId: string | null, orderNumber: number | null, status: string) {
  const permitted = ["accepted", "preparing", "ready", "out_for_delivery", "rejected", "completed"];
  if (!permitted.includes(status)) throw new Error("Unsupported order status.");
  const params: Record<string, string> = { select: "id,order_number,customer_user_id,status", status: "eq." + status, limit: "1" };
  if (orderId) params.id = "eq." + orderId;
  else if (orderNumber) params.order_number = "eq." + orderNumber;
  else throw new Error("Provide an order ID or number.");
  const orders = await rest(tableUrl("orders", params));
  if (!Array.isArray(orders) || orders.length !== 1) throw new Error("Order not found at the requested status.");
  const order = orders[0];
  const { rows } = await customerRowsForOrder(order);
  const result = await sendToRows(rows, (row: any) => {
    const message = (orderMessages[language(row.language)] || orderMessages.en)[status](String(order.order_number));
    return { ...message, url: "./index.html?open=orders", tag: "al-shami-order-" + order.id, orderId: order.id, icon: "./icons/al-shami-pwa-192.png" };
  });
  return result;
}
async function sendOffer(offerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(offerId)) throw new Error("Invalid offer ID.");
  const rows = await rest(tableUrl("offers", { select: "id,title,details", id: "eq." + offerId, is_active: "eq.true", limit: "1" }));
  if (!Array.isArray(rows) || !rows.length) throw new Error("Active offer not found.");
  const offer = rows[0];
  return await sendToRows(await promoRows(), (row: any) => ({
    title: "AL SHAMI · " + String(offer.title || "New offer"),
    body: String(offer.details || "Open AL SHAMI to see this offer."),
    url: "./index.html#active-offers", tag: "al-shami-offer-" + offer.id, icon: "./icons/al-shami-pwa-192.png"
  }));
}
async function sendAnnouncement(title: string, body: string) {
  title = title.trim().slice(0, 100);
  body = body.trim().slice(0, 300);
  if (!title || !body) throw new Error("Enter an announcement title and message.");
  return await sendToRows(await promoRows(), (row: any) => ({
    title: "AL SHAMI · " + title, body, url: "./index.html", tag: "al-shami-announcement-" + Date.now(), icon: "./icons/al-shami-pwa-192.png"
  }));
}
Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return reply({ error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405, origin);
  try {
    const user = await authenticate(req);
    if (!user) return reply({ error: "Sign in to continue." }, 401, origin);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Invalid request body." }, 400, origin); }
    const action = String(body.action || "");
    if (action === "public-key") {
      const { publicKey } = await appServer();
      return reply({ publicKey }, 200, origin);
    }
    if (action === "subscribe") {
      const sub = body.subscription as any;
      const endpoint = safeEndpoint(sub?.endpoint);
      if (!endpoint || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") {
        return reply({ error: "Invalid push subscription." }, 400, origin);
      }
      const existing = await rest(tableUrl("customer_push_subscriptions", {
        select: "id,customer_user_id", endpoint: "eq." + endpoint, limit: "1"
      }));
      if (Array.isArray(existing) && existing[0] && existing[0].customer_user_id !== user.id) {
        return reply({ error: "This device subscription is already linked to another account." }, 409, origin);
      }
      await rest(tableUrl("customer_push_subscriptions", { on_conflict: "endpoint" }), {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          customer_user_id: user.id, endpoint, p256dh_key: sub.keys.p256dh, auth_key: sub.keys.auth,
          language: language(body.language), updated_at: new Date().toISOString()
        })
      });
      return reply({ ok: true }, 200, origin);
    }
    if (action === "unsubscribe") {
      const endpoint = safeEndpoint(body.endpoint);
      if (endpoint) await rest(tableUrl("customer_push_subscriptions", { endpoint: "eq." + endpoint, customer_user_id: "eq." + user.id }), { method: "DELETE" });
      return reply({ ok: true }, 200, origin);
    }
    if (action === "order-status") {
      if (!await requireStaff(user.id)) return reply({ error: "Cashier or administrator access is required." }, 403, origin);
      const status = String(body.status || "");
      const orderId = body.orderId ? String(body.orderId) : null;
      const orderNumber = body.orderNumber ? Number(body.orderNumber) : null;
      if (orderId && !/^[0-9a-f-]{36}$/i.test(orderId)) return reply({ error: "Invalid order ID." }, 400, origin);
      const result = await sendOrderStatus(orderId, orderNumber, status);
      return reply(result, 200, origin);
    }
    if (action === "offer") {
      if (!await requireStaff(user.id, true)) return reply({ error: "Administrator access is required." }, 403, origin);
      const result = await sendOffer(String(body.offerId || ""));
      return reply(result, 200, origin);
    }
    if (action === "announcement") {
      if (!await requireStaff(user.id, true)) return reply({ error: "Administrator access is required." }, 403, origin);
      const result = await sendAnnouncement(String(body.title || ""), String(body.body || ""));
      return reply(result, 200, origin);
    }
    return reply({ error: "Unknown action." }, 400, origin);
  } catch (error) {
    console.error("customer-push error:", error);
    return reply({ error: error instanceof Error ? error.message : "Notification request failed." }, 500, origin);
  }
});
