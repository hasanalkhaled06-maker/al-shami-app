import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function emptySuccess(): Response {
  return json({});
}

function canonicalPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

async function deliveryToken(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(`alshami-arkesel-dlr:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

function messageIds(result: Record<string, unknown>): string[] {
  const data = result.data;
  const items = Array.isArray(data) ? data : [data];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(item => String(item.id ?? item.ID ?? "").trim())
    .filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id));
}

Deno.serve(async (req: Request): Promise<Response> => {
  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!secret) {
    console.error("Auth SMS hook is missing required configuration.");
    return json({ error: "SMS hook is not configured." }, 500);
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("mode") !== "delivery") return json({ error: "Use POST." }, 405);

    const suppliedToken = url.searchParams.get("token") ?? "";
    const expectedToken = await deliveryToken(secret);
    if (!suppliedToken || suppliedToken !== expectedToken) {
      return json({ error: "Unauthorized delivery callback." }, 401);
    }

    const smsId = (url.searchParams.get("sms_id") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim().toUpperCase();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(smsId) || !/^[A-Z_]{2,32}$/.test(status)) {
      return json({ error: "Invalid delivery report." }, 400);
    }

    console.log("Arkesel auth SMS delivery report:", JSON.stringify({ sms_id: smsId, status }));
    return json({ received: true });
  }

  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  console.log("Auth SMS hook received POST.");

  const arkeselKey = Deno.env.get("ARKESEL_API_KEY");
  if (!arkeselKey) {
    console.error("Auth SMS hook is missing required configuration.");
    return json({ error: "SMS hook is not configured." }, 500);
  }

  const webhookId = req.headers.get("webhook-id");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const webhookSignature = req.headers.get("webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.error(
      "Auth SMS hook rejected request: missing signature headers.",
      JSON.stringify({
        has_id: Boolean(webhookId),
        has_timestamp: Boolean(webhookTimestamp),
        has_signature: Boolean(webhookSignature),
      }),
    );
    return json({ error: "Missing webhook signature headers." }, 401);
  }

  let payload: string;
  try {
    payload = await req.text();
    if (payload.length > 32_768) return json({ error: "Payload too large." }, 413);
  } catch {
    return json({ error: "Could not read webhook payload." }, 400);
  }

  let data: { user?: { phone?: unknown }; sms?: { otp?: unknown } };
  try {
    const signingSecret = secret.startsWith("v1,whsec_")
      ? secret.slice("v1,whsec_".length)
      : secret;
    const verifier = new Webhook(signingSecret);
    data = verifier.verify(payload, {
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": webhookSignature,
    }) as typeof data;
  } catch {
    console.error("Auth SMS hook rejected request: signature verification failed.");
    return json({ error: "Invalid webhook signature." }, 401);
  }

  const phone = canonicalPhone(data?.user?.phone);
  const otp = String(data?.sms?.otp ?? "").trim();
  if (!phone || !/^\d{6}$/.test(otp)) {
    console.error(
      "Auth SMS hook rejected request: payload validation failed.",
      JSON.stringify({
        has_phone: Boolean(data?.user?.phone),
        valid_phone: Boolean(phone),
        has_otp: Boolean(otp),
        otp_length: otp.length,
      }),
    );
    return json({ error: "Invalid phone number or verification code." }, 400);
  }
  console.log("Auth SMS hook payload validated.");


  const sender = (Deno.env.get("ARKESEL_SENDER_ID") || "ALSHAMI").trim();
  const message = `AL SHAMI verification code: ${otp}. Do not share this code.`;
  const callbackUrl = new URL(
    "https://rxjfvuxzseuybfmfyjvs.supabase.co/functions/v1/arkesel-auth-sms",
  );
  callbackUrl.searchParams.set("mode", "delivery");
  callbackUrl.searchParams.set("token", await deliveryToken(secret));

  try {
    const smsResponse = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": arkeselKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender,
        message,
        recipients: [phone],
        callback_url: callbackUrl.toString(),
      }),
    });

    let result: Record<string, unknown> = {};
    try {
      const parsed: unknown = await smsResponse.json();
      if (parsed && typeof parsed === "object") result = parsed as Record<string, unknown>;
    } catch {
      // Do not expose provider response content.
    }

    const providerStatus = String(result.status ?? "").toLowerCase();
    if (!smsResponse.ok || providerStatus !== "success") {
      console.error(
        "Arkesel rejected an auth verification SMS:",
        JSON.stringify({ http_status: smsResponse.status, provider_status: providerStatus || "missing" }),
      );
      return json({ error: "Could not send verification SMS." }, 502);
    }

    const ids = messageIds(result);
    console.log(
      "Arkesel accepted auth SMS:",
      JSON.stringify({
        message_ids: ids,
        credits_used: result.data && typeof result.data === "object"
          ? (result.data as Record<string, unknown>).credits_used ?? null
          : null,
      }),
    );
    return emptySuccess();
  } catch (error) {
    console.error(
      "Auth verification SMS request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Could not send verification SMS." }, 502);
  }
});
