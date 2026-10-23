/* AL SHAMI delivery rider PWA.
 * The rider can view assigned orders and send their own GPS point only.
 * Order acceptance/rejection/status changes remain exclusively in the admin app.
 */
(() => {
  "use strict";
  const cfg = window.AL_SHAMI_CONFIG || {};
  const configReady = typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    cfg.SUPABASE_ANON_KEY.length > 10 &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const db = configReady && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          storageKey: "al-shami-rider-auth-v1",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      })
    : null;

  const $ = selector => document.querySelector(selector);
  const loginPanel = $("#login-panel");
  const dashboard = $("#rider-dashboard");
  const loginForm = $("#login-form");
  const loginButton = $("#login-button");
  const loginMessage = $("#login-message");
  const ordersNode = $("#delivery-list");
  const statusLabels = {
    accepted: "Accepted by restaurant",
    preparing: "Being prepared",
    ready: "Ready for pickup",
    out_for_delivery: "Out for delivery"
  };

  let currentSession = null;
  let orders = [];
  let initialOrderLoadDone = false;
  let refreshInProgress = false;
  let locationWatchId = null;
  let sharingLocation = false;
  let lastLocationSentAt = 0;
  let lastSentPoint = null;
  let lastKnownPoint = null;
  let pollTimer = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function money(value) {
    const number = Number(value || 0);
    return "GH₵ " + (Number.isFinite(number) ? number.toFixed(2) : "0.00");
  }
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Time not available"
      : date.toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" });
  }
  function setConnectionState(isOnline, label) {
    const pill = $("#connection-pill");
    if (!pill) return;
    pill.classList.toggle("is-online", Boolean(isOnline));
    pill.classList.toggle("is-offline", !isOnline);
    pill.innerHTML = '<span class="connection-dot"></span>' + escapeHtml(label || (isOnline ? "Connected" : "Offline"));
  }
  function showMessage(message, type = "info") {
    const node = $("#dashboard-message");
    if (!node) return;
    node.textContent = message || "";
    node.className = "dashboard-message " + type;
    node.hidden = !message;
  }
  function setLoginMessage(message, isError = false) {
    if (!loginMessage) return;
    loginMessage.textContent = message || "";
    loginMessage.className = "form-message" + (isError ? " error" : "");
  }
  function setSignedInView(signedIn) {
    if (loginPanel) loginPanel.hidden = signedIn;
    if (dashboard) dashboard.hidden = !signedIn;
    if ($("#signout-button")) $("#signout-button").hidden = !signedIn;
  }
  function getOrderStatusLabel(status) {
    return statusLabels[String(status || "").toLowerCase()] || String(status || "Status unavailable").replace(/_/g, " ");
  }
  function destinationLink(order) {
    const lat = Number(order.delivery_latitude);
    const lng = Number(order.delivery_longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return "https://www.google.com/maps/dir/?api=1&destination=" +
        encodeURIComponent(lat + "," + lng) + "&travelmode=driving";
    }
    return "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(String(order.delivery_address || "") + ", Accra, Ghana");
  }
  function renderEmptyState(message, detail = "") {
    if (!ordersNode) return;
    ordersNode.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌖</span><strong>' +
      escapeHtml(message) + '</strong>' + (detail ? '<span>' + escapeHtml(detail) + '</span>' : "") + '</div>';
  }

  function renderOrders() {
    if (!ordersNode) return;
    const activeOrders = Array.isArray(orders) ? orders : [];
    $("#active-count").textContent = String(activeOrders.length);
    const locationButton = $("#location-toggle");
    if (locationButton) locationButton.disabled = activeOrders.length === 0 || !db;

    if (!activeOrders.length) {
      renderEmptyState("No active deliveries assigned",
        "When restaurant management accepts and dispatches a delivery order, it will appear here automatically.");
      return;
    }

    ordersNode.innerHTML = activeOrders.map(order => {
      const orderNumber = order.order_number || String(order.id || "").slice(0, 8);
      const items = Array.isArray(order.items) ? order.items : [];
      const lines = items.map(item =>
        '<li><span>' + escapeHtml(item.quantity) + ' × ' + escapeHtml(item.name || "Menu item") +
        '</span><strong>' + money(item.line_total ?? Number(item.quantity || 0) * Number(item.unit_price || 0)) +
        '</strong></li>'
      ).join("");
      const address = String(order.delivery_address || "").trim();
      const lat = Number(order.delivery_latitude);
      const lng = Number(order.delivery_longitude);
      const mapAvailable = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
      const navLabel = mapAvailable ? "Open directions in Google Maps" : "Find address in Google Maps";
      return '<article class="delivery-card" data-delivery-order="' + escapeHtml(order.id) + '">' +
        '<div class="delivery-card-head">' +
          '<div><div class="order-kicker">AL SHAMI · DELIVERY ORDER</div>' +
          '<h3 class="order-number">Order #' + escapeHtml(orderNumber) + '</h3>' +
          '<div class="order-time">Placed ' + escapeHtml(dateLabel(order.created_at)) + '</div></div>' +
          '<span class="status-badge status-' + escapeHtml(String(order.status || "").replace(/[^a-z_]/g, "")) + '">' +
            escapeHtml(getOrderStatusLabel(order.status)) + '</span>' +
        '</div>' +
        '<div class="delivery-card-body">' +
          '<section class="detail-section"><p class="detail-label">Customer</p>' +
            '<p class="customer-name">' + escapeHtml(order.customer_name || "Customer") + '</p>' +
            (order.customer_phone ? '<a class="customer-phone" href="tel:' + escapeHtml(order.customer_phone) + '">' +
              escapeHtml(order.customer_phone) + '</a>' : '<span class="muted">No phone number provided</span>') +
          '</section>' +
          '<section class="detail-section"><p class="detail-label">Delivery destination</p>' +
            '<p class="delivery-address">' + escapeHtml(address || "No address entered") + '</p>' +
            (mapAvailable ? '<p class="delivery-notes">Map pin saved by the customer at checkout.</p>' : '<p class="delivery-notes">No map pin saved. Use the address and landmark below.</p>') +
            (order.notes ? '<p class="delivery-notes"><strong>Order notes:</strong> ' + escapeHtml(order.notes) + '</p>' : '') +
          '</section>' +
          '<section class="detail-section"><p class="detail-label">Items in this order</p>' +
            (lines ? '<ul class="order-items">' + lines + '</ul>' : '<p class="delivery-notes">Items are not available in this summary.</p>') +
            '<div class="total-row"><span>Order total · cash</span><strong>' + money(order.total) + '</strong></div>' +
          '</section>' +
          '<section class="detail-section"><p class="detail-label">Delivery status</p>' +
            '<p class="delivery-address">' + escapeHtml(getOrderStatusLabel(order.status)) + '</p>' +
            '<p class="delivery-notes">Status is controlled by restaurant management and updates automatically here.</p>' +
          '</section>' +
          '<div class="delivery-actions"><a class="navigation-button" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(destinationLink(order)) + '">' +
            '<span aria-hidden="true">↗</span> ' + escapeHtml(navLabel) + '</a>' +
            (order.customer_phone ? '<a class="navigation-button secondary" href="tel:' + escapeHtml(order.customer_phone) + '"><span aria-hidden="true">☎</span> Call customer</a>' : '') +
          '</div>' +
          '<p class="card-footer-note">This card is read-only. Only the restaurant team can accept, reject, or change an order’s status.</p>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  async function refreshOrders(options = {}) {
    if (!db || !currentSession?.user || !navigator.onLine || refreshInProgress) {
      if (!navigator.onLine) setConnectionState(false, "Offline");
      return;
    }
    refreshInProgress = true;
    try {
      const { data, error } = await db.rpc("get_my_delivery_orders");
      if (error) throw error;
      const nextOrders = Array.isArray(data) ? data : [];
      if (initialOrderLoadDone) {
        const oldIds = new Set(orders.map(order => order.id));
        const added = nextOrders.filter(order => !oldIds.has(order.id));
        if (added.length) {
          showMessage("New delivery assigned: order #" + (added[0].order_number || String(added[0].id).slice(0, 8)), "success");
          try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (_) {}
        }
      }
      orders = nextOrders;
      initialOrderLoadDone = true;
      $("#refresh-label").textContent = "Synced " + new Date().toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
      setConnectionState(true, "Connected");
      renderOrders();
      if (sharingLocation && !orders.length) stopLocationSharing("No active deliveries are assigned. Location sharing has stopped.");
      if (sharingLocation && orders.length) setLocationStatus("Sharing GPS location securely for your active deliveries.", false);
      if (options.quiet !== true && !nextOrders.length) showMessage("", "info");
    } catch (error) {
      console.error("Could not load rider deliveries:", error);
      setConnectionState(navigator.onLine, navigator.onLine ? "Sync issue" : "Offline");
      if (!orders.length) {
        const detail = /active AL SHAMI delivery rider|delivery rider/i.test(String(error?.message || ""))
          ? "Ask restaurant management to link your login to an active Delivery Rider staff profile."
          : "Check your connection, then refresh. If the problem continues, contact the restaurant administrator.";
        renderEmptyState("Could not load assigned deliveries", detail);
      }
      showMessage(error?.message || "Could not refresh assigned deliveries.", "error");
    } finally {
      refreshInProgress = false;
    }
  }

  function setLocationStatus(message, isError = false) {
    const node = $("#location-status");
    if (node) {
      node.textContent = message || "";
      node.style.color = isError ? "#a12b2b" : "";
    }
    const summary = $("#location-summary-value");
    const note = $("#location-summary-note");
    if (summary) summary.textContent = sharingLocation ? "Live" : "Off";
    if (note) note.textContent = sharingLocation ? "GPS updates enabled" : "Start sharing while on delivery";
    const button = $("#location-toggle");
    if (button) {
      button.textContent = sharingLocation ? "Stop location sharing" : "Start location sharing";
      button.classList.toggle("is-sharing", sharingLocation);
    }
  }

  function pointDistanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const radians = value => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const lat1 = radians(a.lat);
    const lat2 = radians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  async function sendLocation(position, force = false) {
    const coords = position?.coords;
    if (!sharingLocation || !coords || !db) return;
    const point = {
      lat: Number(coords.latitude),
      lng: Number(coords.longitude),
      accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
      heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
      speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null
    };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    lastKnownPoint = point;
    const now = Date.now();
    const moved = pointDistanceMeters(lastSentPoint, point);
    if (!force && now - lastLocationSentAt < 5000 && moved < 20) return;
    try {
      const { error } = await db.rpc("update_my_delivery_location", {
        p_latitude: point.lat,
        p_longitude: point.lng,
        p_accuracy_m: point.accuracy,
        p_heading_deg: point.heading,
        p_speed_mps: point.speed
      });
      if (error) throw error;
      lastLocationSentAt = Date.now();
      lastSentPoint = point;
      setLocationStatus("Location shared · updated " + new Date(lastLocationSentAt).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), false);
      setConnectionState(true, "Connected");
    } catch (error) {
      console.error("Location update failed:", error);
      setLocationStatus(error?.message || "Could not share GPS location. Check internet and permissions.", true);
    }
  }

  function startLocationSharing() {
    if (!navigator.geolocation) {
      setLocationStatus("This browser does not support GPS location sharing.", true);
      return;
    }
    if (!orders.length) {
      setLocationStatus("Location sharing becomes available when a delivery is assigned to you.", true);
      return;
    }
    if (sharingLocation) return;
    sharingLocation = true;
    lastLocationSentAt = 0;
    lastSentPoint = null;
    setLocationStatus("Allow location access when your phone asks. The customer will see your location only while their order is Out for delivery.", false);
    locationWatchId = navigator.geolocation.watchPosition(
      position => { void sendLocation(position, lastLocationSentAt === 0); },
      error => {
        const messages = {
          1: "Location permission was denied. Allow location access in iPhone Settings or Safari site settings.",
          2: "Your current location is unavailable. Move to an open area and try again.",
          3: "GPS timed out. Keep the app open and try again."
        };
        setLocationStatus(messages[error?.code] || "Could not read GPS location.", true);
        if (error?.code === 1) stopLocationSharing(messages[1]);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    const button = $("#location-toggle");
    if (button) {
      button.textContent = "Stop location sharing";
      button.classList.add("is-sharing");
    }
    if ($("#location-summary-value")) $("#location-summary-value").textContent = "Starting…";
    if ($("#location-summary-note")) $("#location-summary-note").textContent = "Waiting for GPS fix";
  }

  function stopLocationSharing(message = "Location sharing is off.") {
    sharingLocation = false;
    if (locationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    lastSentPoint = null;
    lastLocationSentAt = 0;
    setLocationStatus(message, false);
  }

  async function handleSession(session) {
    currentSession = session || null;
    const signedIn = Boolean(currentSession?.user);
    setSignedInView(signedIn);
    if (!signedIn) {
      stopLocationSharing();
      orders = [];
      initialOrderLoadDone = false;
      return;
    }
    const email = currentSession.user.email || "";
    $("#rider-name-suffix").textContent = email ? ", " + email.split("@")[0] : "";
    await refreshOrders({ quiet: true });
    if (pollTimer === null) {
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void refreshOrders({ quiet: true });
      }, 8000);
    }
  }

  if (!db) {
    setLoginMessage("The ordering system is not configured. Contact AL SHAMI administration.", true);
    if (loginButton) loginButton.disabled = true;
    setConnectionState(false, "Not configured");
  } else {
    loginForm?.addEventListener("submit", async event => {
      event.preventDefault();
      loginButton.disabled = true;
      setLoginMessage("Signing in…");
      const form = event.currentTarget;
      try {
        const { data, error } = await db.auth.signInWithPassword({
          email: String(form.elements.email.value || "").trim(),
          password: String(form.elements.password.value || "")
        });
        if (error) throw error;
        setLoginMessage("Signed in. Loading your assigned deliveries…");
        await handleSession(data.session);
        setLoginMessage("");
      } catch (error) {
        setLoginMessage(error?.message || "Sign-in failed. Check your email and password.", true);
      } finally {
        loginButton.disabled = false;
      }
    });

    $("#signout-button")?.addEventListener("click", async () => {
      stopLocationSharing("Signed out. Location sharing stopped.");
      try { await db.auth.signOut(); } catch (error) { console.warn("Rider sign out failed:", error); }
      currentSession = null;
      setSignedInView(false);
      setLoginMessage("You have signed out.");
    });

    $("#location-toggle")?.addEventListener("click", () => {
      if (sharingLocation) stopLocationSharing();
      else startLocationSharing();
    });
    $("#refresh-button")?.addEventListener("click", () => { void refreshOrders(); });
    db.auth.onAuthStateChange((event, session) => {
      currentSession = session || null;
      window.setTimeout(() => { void handleSession(currentSession); }, 0);
    });
    db.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      return handleSession(data.session);
    }).catch(error => {
      console.error("Unable to restore rider session:", error);
      setLoginMessage("Could not restore sign-in. Please sign in again.", true);
    });
  }

  window.addEventListener("online", () => {
    setConnectionState(true, "Connected");
    if (currentSession?.user) void refreshOrders({ quiet: true });
  });
  window.addEventListener("offline", () => setConnectionState(false, "Offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentSession?.user) void refreshOrders({ quiet: true });
  });
  setConnectionState(navigator.onLine, navigator.onLine ? "Ready" : "Offline");
})();