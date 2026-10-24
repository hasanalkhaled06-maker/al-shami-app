import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

type AuthSmsEvent = {
  user?: { phone?: string };
  sms?: { otp?: string };
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("ARKESEL_API_KEY");
  const sender = Deno.env.get("ARKESEL_SENDER_ID");
  const rawHookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET");

  if (!apiKey || !sender || !rawHookSecret) {
    console.error("Arkesel SMS hook is missing required secrets");
    return json({ error: "SMS provider is not configured" }, 500);
  }

  const hookSecret = rawHookSecret.replace(/^v1,whsec_/, "");
  const rawBody = await request.text();
  let event: AuthSmsEvent;

  try {
    const webhook = new Webhook(hookSecret);
    event = webhook.verify(rawBody, Object.fromEntries(request.headers)) as AuthSmsEvent;
  } catch {
    return json({ error: "Invalid signed auth hook request" }, 401);
  }

  const phone = String(event.user?.phone || "");
  const otp = String(event.sms?.otp || "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{4,10}$/.test(otp)) {
    return json({ error: "Auth hook payload is missing a valid phone or code" }, 400);
  }

  const message = `AL SHAMI verification code: ${otp}. Do not share this code with anyone.`;
  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({ sender, message, recipients: [phone] }),
      signal: AbortSignal.timeout(4500),
    });
  } catch (error) {
    console.error("Arkesel SMS request failed", error instanceof Error ? error.name : "unknown error");
    return json({ error: "SMS provider could not be reached" }, 502);
  }

  let providerResult: { status?: string } = {};
  try {
    providerResult = await providerResponse.json();
  } catch {
    // A non-JSON provider response is treated as a failed send below.
  }

  if (!providerResponse.ok || providerResult.status !== "success") {
    console.error("Arkesel rejected the SMS request", providerResponse.status);
    return json({ error: "SMS provider rejected the request" }, 502);
  }

  return json({});
});
