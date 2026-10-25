import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const MONTHLY_ROUTE_CAP = 450;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function envValue(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function publishableKey(): string {
  const legacy = envValue("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(envValue("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return typeof keys.default === "string" ? keys.default : "";
  } catch {
    return "";
  }
}

function finiteCoordinate(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function secondsFromDuration(value: unknown): number | null {
  const match = typeof value === "string" ? value.match(/^([0-9]+(?:\.[0-9]+)?)s$/) : null;
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!bearerToken || bearerToken === authHeader) {
    return jsonResponse({ error: "AUTH_REQUIRED" }, 401, origin);
  }

  let body: { trackingToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400, origin);
  }
  const trackingToken = typeof body.trackingToken === "string" ? body.trackingToken : "";
  if (!uuidPattern.test(trackingToken)) return jsonResponse({ error: "INVALID_TRACKING_TOKEN" }, 400, origin);

  const supabaseUrl = envValue("SUPABASE_URL");
  const anonKey = publishableKey();
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "SUPABASE_FUNCTION_CONFIG_MISSING" }, 503, origin);
  }

  const userDb = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  try {
    const { data: userData, error: userError } = await userDb.auth.getUser(bearerToken);
    if (userError || !userData.user) return jsonResponse({ error: "AUTH_REQUIRED" }, 401, origin);

    const [{ data: order, error: orderError }, { data: rider, error: riderError }] = await Promise.all([
      userDb.rpc("get_customer_order_tracking", { p_tracking_token: trackingToken }),
      userDb.rpc("get_customer_rider_location", { p_tracking_token: trackingToken }),
    ]);
    if (orderError || !order) return jsonResponse({ error: "ORDER_NOT_FOUND" }, 404, origin);
    if (order.order_type !== "delivery" || order.status !== "out_for_delivery") {
      return jsonResponse({ error: "ORDER_NOT_IN_DELIVERY" }, 409, origin);
    }
    if (riderError || !rider) return jsonResponse({ error: "RIDER_LOCATION_UNAVAILABLE" }, 409, origin);

    const originLat = finiteCoordinate(rider.latitude, -90, 90);
    const originLng = finiteCoordinate(rider.longitude, -180, 180);
    const destinationLat = finiteCoordinate(order.delivery_latitude, -90, 90);
    const destinationLng = finiteCoordinate(order.delivery_longitude, -180, 180);
    const updatedAt = Date.parse(String(rider.updated_at || ""));
    const locationAgeMs = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Infinity;
    if (originLat === null || originLng === null || destinationLat === null || destinationLng === null) {
      return jsonResponse({ error: "ROUTE_COORDINATES_UNAVAILABLE" }, 409, origin);
    }
    if (rider.is_stale === true || locationAgeMs > 90_000 || locationAgeMs < -30_000) {
      return jsonResponse({ error: "RIDER_LOCATION_STALE" }, 409, origin);
    }

    const googleApiKey = envValue("GOOGLE_MAPS_API_KEY");
    if (!googleApiKey) return jsonResponse({ error: "GOOGLE_MAPS_API_KEY_NOT_CONFIGURED" }, 503, origin);

    const adminDb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: requestCount, error: quotaError } = await adminDb.rpc("consume_google_routes_eta_request");
    if (quotaError) {
      console.error("Google route quota counter unavailable:", quotaError.message);
      return jsonResponse({ error: "ROUTE_QUOTA_UNAVAILABLE" }, 503, origin);
    }
    if (requestCount === null || requestCount === undefined) {
      return jsonResponse({ error: "MONTHLY_GOOGLE_ROUTE_LIMIT_REACHED", monthlyLimit: MONTHLY_ROUTE_CAP }, 429, origin);
    }

    const routeResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
        destination: { location: { latLng: { latitude: destinationLat, longitude: destinationLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        trafficModel: "BEST_GUESS",
        departureTime: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!routeResponse.ok) {
      console.error("Google Routes API failed with status:", routeResponse.status);
      return jsonResponse({ error: "GOOGLE_ROUTE_REQUEST_FAILED" }, 502, origin);
    }

    const result = await routeResponse.json();
    const route = Array.isArray(result.routes) ? result.routes[0] : null;
    const durationSeconds = secondsFromDuration(route?.duration);
    const distanceMeters = Number(route?.distanceMeters);
    const encodedPolyline = route?.polyline?.encodedPolyline;
    if (!route || durationSeconds === null || !Number.isFinite(distanceMeters) ||
        typeof encodedPolyline !== "string" || !encodedPolyline.length) {
      return jsonResponse({ error: "GOOGLE_ROUTE_RESPONSE_INVALID" }, 502, origin);
    }

    return jsonResponse({
      source: "google",
      durationSeconds,
      distanceMeters,
      encodedPolyline,
      requestCount,
      monthlyLimit: MONTHLY_ROUTE_CAP,
      calculatedAt: new Date().toISOString(),
    }, 200, origin);
  } catch (error) {
    console.error("Google route ETA request failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "ROUTE_REQUEST_FAILED" }, 502, origin);
  }
});
