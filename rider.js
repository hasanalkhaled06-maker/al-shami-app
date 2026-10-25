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
  window.AL_SHAMI_RIDER_DB = db;

  const $ = selector => document.querySelector(selector);
  const loginPanel = $("#login-panel");
  const dashboard = $("#rider-dashboard");
  const loginForm = $("#login-form");
  const loginButton = $("#login-button");
  const loginMessage = $("#login-message");
  const approvalPanel = $("#approval-panel");
  const approvalTitle = $("#approval-title");
  const approvalMessage = $("#approval-message");
  const approvalStatusLabel = $("#approval-status-label");
  const approvalRefreshButton = $("#approval-refresh-button");
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
  let locationHeartbeatTimer = null;
  let sharingLocation = false;
  let locationPermissionDenied = false;
  let lastLocationSentAt = 0;
  let lastSentPoint = null;
  let lastKnownPoint = null;
  let pollTimer = null;
  let accessCheckPromise = null;
  let accessCheckUserId = null;
  let accessCheckGeneration = 0;

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

  let authMode = "signin";
  const nameInput = $("#rider-name");
  const nameLabel = $("#rider-name-label");
  const signInModeButton = $("#show-signin");
  const signUpModeButton = $("#show-signup");

  function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "signin";
    const isSignUp = authMode === "signup";
    if (nameInput) {
      nameInput.hidden = !isSignUp;
      nameInput.required = isSignUp;
    }
    if (nameLabel) nameLabel.hidden = !isSignUp;
    if ($("#rider-password")) {
      $("#rider-password").autocomplete = isSignUp ? "new-password" : "current-password";
      $("#rider-password").placeholder = isSignUp ? "At least 8 characters" : "Your password";
    }
    if (loginButton) loginButton.innerHTML = isSignUp
      ? 'Request rider account <span aria-hidden="true">→</span>'
      : 'Sign in securely <span aria-hidden="true">→</span>';
    if (signInModeButton) {
      signInModeButton.classList.toggle("is-active", !isSignUp);
      signInModeButton.setAttribute("aria-pressed", String(!isSignUp));
    }
    if (signUpModeButton) {
      signUpModeButton.classList.toggle("is-active", isSignUp);
      signUpModeButton.setAttribute("aria-pressed", String(isSignUp));
    }
    setLoginMessage(isSignUp
      ? "Create your account request. Restaurant management must approve and link it before you can see deliveries."
      : "");
  }
  function setSignedInView(state) {
    const view = typeof state === "boolean" ? (state ? "dashboard" : "login") : state;
    const signedIn = view !== "login";
    if (loginPanel) loginPanel.hidden = view !== "login";
    if (approvalPanel) approvalPanel.hidden = !["checking", "pending", "error"].includes(view);
    if (dashboard) dashboard.hidden = view !== "dashboard";
    if ($("#signout-button")) $("#signout-button").hidden = !signedIn;
  }

  function setApprovalScreen(state, customMessage = "") {
    const details = {
      checking: {
        title: "Checking your rider access…",
        message: "Please wait while we verify your account with AL SHAMI management.",
        label: "Checking approval"
      },
      pending: {
        title: "Your account is awaiting approval",
        message: "Your account is registered, but delivery access is still locked. AL SHAMI management must link this login to an active Delivery Rider employee profile. Once they approve it, tap Check approval again.",
        label: "Pending management approval"
      },
      error: {
        title: "We couldn't verify your access",
        message: "Your delivery details remain hidden until your rider access can be verified. Check your internet connection, then try again.",
        label: "Verification unavailable"
      }
    };
    const detail = details[state] || details.error;
    if (approvalTitle) approvalTitle.textContent = detail.title;
    if (approvalMessage) approvalMessage.textContent = customMessage || detail.message;
    if (approvalStatusLabel) approvalStatusLabel.textContent = detail.label;
    if (approvalPanel) {
      approvalPanel.classList.toggle("is-error", state === "error");
      approvalPanel.classList.toggle("is-approved", state === "approved");
    }
    if (approvalRefreshButton) {
      approvalRefreshButton.disabled = state === "checking";
      approvalRefreshButton.textContent = state === "checking" ? "Checking approval…" :
        (state === "error" ? "Retry access check ↻" : "Check approval again ↻");
    }
    setSignedInView(state);
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
    const canShareLocation = activeOrders.some(order =>
      order.order_type === "delivery" && String(order.status || "").toLowerCase() === "out_for_delivery"
    );
    if (locationButton) {
      locationButton.disabled = !canShareLocation || !db || sharingLocation;
      locationButton.textContent = sharingLocation ? "Location sharing active" :
        (canShareLocation ? (locationPermissionDenied ? "Try location again" : "Auto-share location") :
          "Auto-share when Out for delivery");
    }

    if (!activeOrders.length) {
      renderEmptyState("No deliveries yet",
        "New assigned deliveries will appear here.");
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
          '<div><h3 class="order-number">Order #' + escapeHtml(orderNumber) + '</h3>' +
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
            (mapAvailable ? '' : '<p class="delivery-notes">No map pin — use the address and landmark.</p>') +
            (order.notes ? '<p class="delivery-notes"><strong>Order notes:</strong> ' + escapeHtml(order.notes) + '</p>' : '') +
          '</section>' +
          '<section class="detail-section"><p class="detail-label">Items in this order</p>' +
            (lines ? '<ul class="order-items">' + lines + '</ul>' : '<p class="delivery-notes">Items are not available in this summary.</p>') +
            '<div class="total-row"><span>Order total · cash</span><strong>' + money(order.total) + '</strong></div>' +
          '</section>' +
          '<div class="delivery-actions"><a class="navigation-button" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(destinationLink(order)) + '">' +
            '<span aria-hidden="true">↗</span> ' + escapeHtml(navLabel) + '</a>' +
            (order.customer_phone ? '<a class="navigation-button secondary" href="tel:' + escapeHtml(order.customer_phone) + '"><span aria-hidden="true">☎</span> Call customer</a>' : '') +
          '</div>' +
        '</div>' +
      '</article>';
    }).join("");
  }

  async function refreshOrders(options = {}) {
    if (!db || !currentSession?.user) return "error";
    if (!navigator.onLine) {
      setConnectionState(false, "Offline");
      return "offline";
    }
    if (refreshInProgress) return "busy";
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
      syncAutomaticLocationSharing();
      if (sharingLocation && lastLocationSentAt > 0) {
        setLocationStatus("Location sharing is active for your Out for delivery order.", false);
      }
      if (options.quiet !== true && !nextOrders.length) showMessage("", "info");
      return "approved";
    } catch (error) {
      console.error("Could not load rider deliveries:", error);
      const errorText = String(error?.message || "");
      const approvalRequired = /this account is not an active al shami delivery rider/i.test(errorText);
      if (approvalRequired) {
        orders = [];
        initialOrderLoadDone = false;
        if (sharingLocation) stopLocationSharing("Rider approval is no longer active. GPS sharing has stopped.", true);
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        setConnectionState(navigator.onLine, navigator.onLine ? "Connected" : "Offline");
        // If access is revoked during a session, hide the dashboard immediately.
        if (dashboard && !dashboard.hidden) setApprovalScreen("pending");
        return "pending";
      }
      setConnectionState(navigator.onLine, navigator.onLine ? "Sync issue" : "Offline");
      if (!orders.length) {
        const detail = !navigator.onLine
          ? "Reconnect to the internet, then try again."
          : "Check your connection, then refresh. If the problem continues, contact the restaurant administrator.";
        renderEmptyState("Could not load assigned deliveries", detail);
      }
      showMessage(errorText || "Could not refresh assigned deliveries.", "error");
      return navigator.onLine ? "error" : "offline";
    } finally {
      refreshInProgress = false;
    }
  }

  function hasOutForDeliveryOrder() {
    return orders.some(order =>
      order.order_type === "delivery" && String(order.status || "").toLowerCase() === "out_for_delivery"
    );
  }

  function syncAutomaticLocationSharing() {
    if (!hasOutForDeliveryOrder()) {
      if (sharingLocation) {
        stopLocationSharing("Location sharing stopped automatically because no assigned delivery is Out for delivery.");
      } else {
        setLocationStatus("Location sharing starts automatically when an assigned delivery is Out for delivery.", false);
      }
      return;
    }
    if (!sharingLocation && !locationPermissionDenied) startLocationSharing();
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
    const canShareLocation = hasOutForDeliveryOrder();
    if (note) note.textContent = sharingLocation ? "Automatic sharing is active during delivery" :
      (canShareLocation && locationPermissionDenied ? "Allow location access, then tap Try location again" :
        "Sharing starts automatically when a delivery is Out for delivery");
    const button = $("#location-toggle");
    if (button) {
      button.disabled = !canShareLocation || !db || sharingLocation;
      button.textContent = sharingLocation ? "Location sharing active" :
        (canShareLocation ? (locationPermissionDenied ? "Try location again" : "Auto-share location") :
          "Auto-share when Out for delivery");
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
    if (!sharingLocation || !hasOutForDeliveryOrder() || !coords || !db) return;
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
    if (!hasOutForDeliveryOrder()) {
      setLocationStatus("Location sharing starts automatically when a delivery is marked Out for delivery.", false);
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
        if (error?.code === 1) {
          locationPermissionDenied = true;
          stopLocationSharing(messages[1], true);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );

    // A fresh location request also runs while the rider is stationary. The
    // database timestamp therefore reflects recent GPS readings, not just movement.
    if (locationHeartbeatTimer !== null) window.clearInterval(locationHeartbeatTimer);
    locationHeartbeatTimer = window.setInterval(() => {
      if (!sharingLocation || !hasOutForDeliveryOrder() || document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        position => { void sendLocation(position, true); },
        error => {
          if (error?.code === 1) stopLocationSharing("Location permission was denied. Allow location access to continue sharing.", true);
          else setLocationStatus("Waiting for a fresh GPS reading. Keep the app open and check your signal.", true);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
      );
    }, 20000);

    const button = $("#location-toggle");
    if (button) {
      button.textContent = "Location sharing active";
      button.disabled = true;
      button.classList.add("is-sharing");
    }
    if ($("#location-summary-value")) $("#location-summary-value").textContent = "Starting…";
    if ($("#location-summary-note")) $("#location-summary-note").textContent = "Waiting for GPS fix";
  }

  function stopLocationSharing(message = "Location sharing is off.", isError = false) {
    sharingLocation = false;
    if (locationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    if (locationHeartbeatTimer !== null) window.clearInterval(locationHeartbeatTimer);
    locationHeartbeatTimer = null;
    lastSentPoint = null;
    lastLocationSentAt = 0;
    setLocationStatus(message, isError);
  }

  function verifyRiderAccess() {
    const userId = currentSession?.user?.id;
    if (!userId) return Promise.resolve("signed_out");
    if (accessCheckPromise && accessCheckUserId === userId) return accessCheckPromise;

    const generation = ++accessCheckGeneration;
    accessCheckUserId = userId;
    let trackedPromise;
    trackedPromise = (async () => {
      setApprovalScreen("checking");
      const result = await refreshOrders({ quiet: true });
      // Ignore late replies for an account that has already signed out or changed.
      if (generation !== accessCheckGeneration || currentSession?.user?.id !== userId) return "stale";

      if (result === "approved") {
        setSignedInView("dashboard");
        if (pollTimer === null) {
          pollTimer = window.setInterval(() => {
            if (document.visibilityState === "visible" && currentSession?.user) void refreshOrders({ quiet: true });
          }, 8000);
        }
        return "approved";
      }
      if (result === "pending") {
        setApprovalScreen("pending");
        return "pending";
      }
      setApprovalScreen("error", result === "offline"
        ? "Your phone is offline. Reconnect to the internet and tap Retry access check. Your orders will remain hidden until we verify approval."
        : "We couldn't verify your account with the restaurant system. Your orders remain hidden. Check your connection and tap Retry access check.");
      return result;
    })().finally(() => {
      if (accessCheckPromise === trackedPromise) {
        accessCheckPromise = null;
        accessCheckUserId = null;
      }
    });
    accessCheckPromise = trackedPromise;
    return trackedPromise;
  }

  async function handleSession(session) {
    currentSession = session || null;
    if (!currentSession?.user) {
      accessCheckGeneration++;
      accessCheckPromise = null;
      accessCheckUserId = null;
      setSignedInView("login");
      stopLocationSharing();
      orders = [];
      initialOrderLoadDone = false;
      if (ordersNode) ordersNode.replaceChildren();
      return "signed_out";
    }
    const email = currentSession.user.email || "";
    $("#rider-name-suffix").textContent = email ? ", " + email.split("@")[0] : "";
    return verifyRiderAccess();
  }

  if (!db) {
    setLoginMessage("The ordering system is not configured. Contact AL SHAMI administration.", true);
    if (loginButton) loginButton.disabled = true;
    setConnectionState(false, "Not configured");
  } else {
    signInModeButton?.addEventListener("click", () => setAuthMode("signin"));
    signUpModeButton?.addEventListener("click", () => setAuthMode("signup"));

    loginForm?.addEventListener("submit", async event => {
      event.preventDefault();
      loginButton.disabled = true;
      const form = event.currentTarget;
      const email = String(form.elements.email.value || "").trim();
      const password = String(form.elements.password.value || "");
      try {
        if (authMode === "signup") {
          const fullName = String(form.elements.fullName?.value || "").trim();
          if (fullName.length < 2) throw new Error("Enter your full name.");
          if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
          if (!email) throw new Error("Enter your email address.");

          setLoginMessage("Submitting your account request…");
          const { data, error } = await db.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName,
                requested_role: "delivery_rider",
                approval_status: "pending"
              },
              emailRedirectTo: window.location.origin + window.location.pathname
            }
          });
          if (error) throw error;

          // Never leave a newly registered account signed in before management
          // links its Auth UUID to an active Delivery Rider staff profile.
          if (data.session) {
            await db.auth.signOut();
          }
          setAuthMode("signin");
          form.reset();
          setLoginMessage(
            data.user?.identities?.length === 0
              ? "If this email is eligible, an account confirmation message will be sent. If you already registered, sign in instead."
              : "Account request submitted. Check your email for confirmation if requested. You must wait for AL SHAMI management to approve and link your account before you can access deliveries."
          );
          return;
        }

        setLoginMessage("Signing in…");
        const { data, error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setLoginMessage("Signed in. Checking rider approval…");
        await handleSession(data.session);
      } catch (error) {
        setLoginMessage(error?.message || (authMode === "signup"
          ? "Could not submit account request. Check the details and try again."
          : "Sign-in failed. Check your email and password."), true);
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
      if (sharingLocation) return;
      locationPermissionDenied = false;
      startLocationSharing();
    });
    $("#refresh-button")?.addEventListener("click", () => { void refreshOrders(); });
    approvalRefreshButton?.addEventListener("click", () => { void verifyRiderAccess(); });
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
    if (currentSession?.user) {
      if (dashboard && !dashboard.hidden) void refreshOrders({ quiet: true });
      else void verifyRiderAccess();
    }
  });
  window.addEventListener("offline", () => setConnectionState(false, "Offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentSession?.user) {
      if (dashboard && !dashboard.hidden) void refreshOrders({ quiet: true });
      else void verifyRiderAccess();
    }
  });
  setConnectionState(navigator.onLine, navigator.onLine ? "Ready" : "Offline");
})();