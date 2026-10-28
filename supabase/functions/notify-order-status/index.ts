const ALLOWED_ORIGIN = "https://alshamiapp.xyz";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

function canonicalGhanaPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (/^\+233[0-9]{9}$/.test(raw)) return raw;
  if (/^233[0-9]{9}$/.test(digits)) return "+" + digits;
  if (/^0[0-9]{9}$/.test(digits)) return "+233" + digits.slice(1);
  return null;
}

const messages: Record<string, (number: string, reason?: string) => string> = {
  accepted: n => `AL SHAMI: Your order #${n} has been accepted and will be prepared shortly.`,
  preparing: n => `AL SHAMI: We are preparing your order #${n}.`,
  ready: n => `AL SHAMI: Your order #${n} is ready. Please contact us about delivery or pickup.`,
  out_for_delivery: n => `AL SHAMI: Your order #${n} is on the way to you.`,
  rejected: (n, reason) => `AL SHAMI: Sorry, we could not accept order #${n}.${reason ? " Reason: " + reason.slice(0, 120) : " Please contact the restaurant."}`,
  completed: n => `AL SHAMI: Order #${n} has been confirmed as received. Thank you!`
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) {
    return json({ error: "Origin not allowed." }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const arkeselKey = Deno.env.get("ARKESEL_API_KEY");
  const supabaseApiKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("authorization");

  if (!supabaseUrl || !arkeselKey || !supabaseApiKey) {
    return json({ error: "SMS integration is not fully configured." }, 500);
  }
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Sign in as an administrator first." }, 401);
  }

  const requestHeaders = {
    "apikey": supabaseApiKey,
    "Authorization": authorization,
    "Accept": "application/json"
  };

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: requestHeaders
    });
    if (!userResponse.ok) {
      return json({ error: "Your session is invalid or expired." }, 401);
    }
    const user = await userResponse.json();
    if (!user?.id) return json({ error: "Could not verify your account." }, 401);

    const adminUrl = new URL(`${supabaseUrl}/rest/v1/admin_users`);
    adminUrl.searchParams.set("select", "user_id");
    adminUrl.searchParams.set("user_id", `eq.${user.id}`);
    const adminResponse = await fetch(adminUrl, { headers: requestHeaders });
    if (!adminResponse.ok) {
      return json({ error: "Could not verify administrator access." }, 403);
    }
    const adminRows = await adminResponse.json();
    if (!Array.isArray(adminRows) || adminRows.length !== 1) {
      return json({ error: "Administrator access is required." }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const status = String(body.status ?? "");
    if (!messages[status]) return json({ error: "Unsupported order status." }, 400);

    const orderId = String(body.orderId ?? "").trim();
    const orderNumber = Number(body.orderNumber);
    if ((!orderId && !Number.isSafeInteger(orderNumber)) || (orderId && body.orderNumber != null)) {
      return json({ error: "Provide either orderId or orderNumber." }, 400);
    }

    const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    orderUrl.searchParams.set("select", "order_number,customer_phone,status,status_reason");
    if (orderId) {
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Invalid order ID." }, 400);
      orderUrl.searchParams.set("id", `eq.${orderId}`);
    } else {
      if (orderNumber < 1) return json({ error: "Invalid order number." }, 400);
      orderUrl.searchParams.set("order_number", `eq.${orderNumber}`);
    }

    const orderResponse = await fetch(orderUrl, { headers: requestHeaders });
    if (!orderResponse.ok) return json({ error: "Could not verify the order status." }, 502);
    const orders = await orderResponse.json();
    if (!Array.isArray(orders) || orders.length !== 1) {
      return json({ error: "Order not found." }, 404);
    }

    const order = orders[0];
    if (String(order.status || "").toLowerCase() !== status) {
      return json({ error: "Order status changed before notification could be sent." }, 409);
    }
    const phone = canonicalGhanaPhone(order.customer_phone);
    if (!phone) return json({ error: "The customer's Ghana phone number is invalid." }, 400);

    const sender = (Deno.env.get("ARKESEL_SENDER_ID") || "ALSHAMI").trim();
    const smsResponse = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": arkeselKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        sender,
        message: messages[status](
          String(order.order_number), status === "rejected" ? String(order.status_reason || "").trim() : ""
        ),
        recipients: [phone]
      })
    });

    let smsResult: Record<string, unknown> = {};
    try {
      smsResult = await smsResponse.json();
    } catch {
      // Keep provider response details out of logs and user-facing errors.
    }
    if (!smsResponse.ok || String(smsResult.status ?? "").toLowerCase() !== "success") {
      console.error("Arkesel rejected order-status SMS. HTTP", smsResponse.status);
      return json({ error: "Arkesel could not send the SMS. Check account credits and the approved sender ID." }, 502);
    }

    return json({ sent: true, orderNumber: order.order_number, status });
  } catch (error) {
    console.error("Order-status SMS failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Could not send the order-status SMS." }, 502);
  }
});
