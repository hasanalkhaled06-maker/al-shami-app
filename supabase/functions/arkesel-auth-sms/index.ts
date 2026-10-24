import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function canonicalPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (/^\+[1-9][0-9]{7,14}$/.test(raw)) return raw;
  if (/^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  const arkeselKey = Deno.env.get("ARKESEL_API_KEY");
  if (!secret || !arkeselKey) {
    console.error("Auth SMS hook is missing required configuration.");
    return json({ error: "SMS hook is not configured." }, 500);
  }

  const webhookId = req.headers.get("webhook-id");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const webhookSignature = req.headers.get("webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
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
    return json({ error: "Invalid webhook signature." }, 401);
  }

  const phone = canonicalPhone(data?.user?.phone);
  const otp = String(data?.sms?.otp ?? "").trim();
  if (!phone || !/^\d{4,10}$/.test(otp)) {
    return json({ error: "Invalid phone number or verification code." }, 400);
  }

  const sender = (Deno.env.get("ARKESEL_SENDER_ID") || "ALSHAMI").trim();
  const message = `AL SHAMI verification code: ${otp}. Do not share this code.`;

  try {
    const smsResponse = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": arkeselKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ sender, message, recipients: [phone] }),
    });

    let result: Record<string, unknown> = {};
    try {
      result = await smsResponse.json();
    } catch {
      // Do not expose provider response content.
    }
    if (!smsResponse.ok || String(result.status ?? "").toLowerCase() !== "success") {
      console.error("Arkesel rejected an auth verification SMS. HTTP", smsResponse.status);
      return json({ error: "Could not send verification SMS." }, 502);
    }
    return json({ sent: true });
  } catch (error) {
    console.error(
      "Auth verification SMS request failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "Could not send verification SMS." }, 502);
  }
});
