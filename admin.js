(() => {
  const cfg = window.AL_SHAMI_CONFIG || {};

  const ready =
    cfg.SUPABASE_URL?.startsWith("https://") &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  const db = ready
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    : null;

  const $ = selector => document.querySelector(selector);

  let currentUser = null;
  let orders = [];
  let products = [];
  // Order alerts stay enabled; browsers may require a user gesture to unlock audio.
  let soundOn = true;
  let notificationsOn = "Notification" in window && Notification.permission === "granted";
  let notificationPermissionPromise = null;
  let notificationPermissionRequested = false;
  const pendingOrderNotifications = new Map();
  let soundActivationHintShown = false;
  let knownOrderIds = new Set();
  let firstOrderLoad = true;
  let audioCtx = null;
  let audioKeepAliveOscillator = null;
  let audioActivationHintTimer = null;
  let audioSessionGestureRecoveryUsed = false;
  let lastBeepStartedAt = 0;
  let refreshInProgress = false;
  let ordersLoadPromise = null;
  let ordersReloadRequested = false;
  let dashboardStartedAt = null;
  const incomingOrderQueue = [];
  let activeIncomingOrderId = null;
  let incomingRingTimer = null;
  let incomingDecisionInProgress = false;

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  function deliveryMapLink(order) {
    if (order?.order_type !== "delivery" || order?.delivery_latitude == null || order?.delivery_longitude == null) return "";
    const lat = Number(order.delivery_latitude);
    const lng = Number(order.delivery_longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return "";
    // Google Maps URLs are free to use and do not require a Maps Platform API key.
    // Leave origin unspecified so Google Maps can use the driver's current location.
    const destination = encodeURIComponent(lat + "," + lng);
    const href = "https://www.google.com/maps/dir/?api=1&destination=" + destination + "&travelmode=driving&dir_action=navigate&utm_source=al_shami_restaurant&utm_campaign=delivery_navigation";
    return '<a class="admin-delivery-map-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">↗ Start navigation in Google Maps</a>';
  }

  function toast(message) {
    const element = $("#toast");
    if (!element) return;

    element.textContent = message;
    element.classList.remove("hidden");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      element.classList.add("hidden");
    }, 5000);
  }

  function status(message, selector = "#product-message", isError = false) {
    const element = $(selector);
    if (!element) return;

    element.textContent = message;
    element.className =
      "status-message " + (isError ? "error" : "success");
  }

  function setConnection(message) {
    const element = $("#connection-state");
    if (element) element.textContent = message;
  }

  const ADMIN_PANEL_NAMES = ["orders", "history", "menu", "offers", "settings", "operations"];
  let currentAdminView = "home";

  function setAdminView(view, backLabel) {
    currentAdminView = view;
    const dashboard = $("#dashboard");
    if (dashboard) dashboard.dataset.adminView = view;
    const backButton = $("#back-to-home");
    if (backButton) {
      backButton.textContent = backLabel || "← Home";
      backButton.classList.toggle("hidden", view === "home");
    }
  }

  function hideAdminSections() {
    ADMIN_PANEL_NAMES.forEach(name => {
      $("#tab-" + name)?.classList.add("hidden");
    });
    $("#admin-home")?.classList.add("hidden");
    $("#settings-hub")?.classList.add("hidden");
  }

  function showAdminHome() {
    const dashboard = $("#dashboard");
    if (!dashboard) return;
    hideAdminSections();
    dashboard.classList.add("hub-home");
    $("#admin-home")?.classList.remove("hidden");
    document.querySelectorAll(".legacy-main-tabs [data-tab]").forEach(tab => {
      tab.classList.remove("active");
    });
    setAdminView("home", "← Home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showSettingsHub() {
    const dashboard = $("#dashboard");
    if (!dashboard) return;
    hideAdminSections();
    dashboard.classList.remove("hub-home");
    $("#settings-hub")?.classList.remove("hidden");
    document.querySelectorAll(".legacy-main-tabs [data-tab]").forEach(tab => {
      tab.classList.remove("active");
    });
    setAdminView("settings-hub", "← Home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showAdminMainPanel(name) {
    if (name === "settings-hub") {
      showSettingsHub();
      return;
    }
    if (!["orders", "history", "menu", "offers", "settings"].includes(name)) return;
    const dashboard = $("#dashboard");
    if (!dashboard) return;
    hideAdminSections();
    dashboard.classList.remove("hub-home");
    const panel = $("#tab-" + name);
    if (panel) panel.classList.remove("hidden");
    document.querySelectorAll(".legacy-main-tabs [data-tab]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });
    setAdminView(name === "orders" ? "active-orders" : "settings-child",
      name === "orders" ? "← Home" : "← Settings");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.__alShamiNavigateMainPanel = showAdminMainPanel;
  window.__alShamiNavigateHome = showAdminHome;
  window.__alShamiNavigateSettings = showSettingsHub;
  window.__alShamiMarkSettingsChild = () => {
    hideAdminSections();
    $("#tab-operations")?.classList.remove("hidden");
    $("#dashboard")?.classList.remove("hub-home");
    setAdminView("settings-child", "← Settings");
  };

  document.querySelectorAll("[data-home-nav]").forEach(card => {
    card.addEventListener("click", () => {
      const destination = card.dataset.homeNav;
      if (destination === "settings-hub") {
        showSettingsHub();
        return;
      }
      showAdminMainPanel(destination);
    });
  });

  document.querySelectorAll("[data-settings-nav]").forEach(card => {
    card.addEventListener("click", () => {
      const destination = card.dataset.settingsNav;
      if (destination === "operations") {
        const operationsTab = document.querySelector('.legacy-main-tabs [data-tab="operations"]');
        if (operationsTab) operationsTab.click();
        else toast("Operations tools are loading. Please open Settings again in a moment.");
        return;
      }
      showAdminMainPanel(destination);
    });
  });

  $("#back-to-home")?.addEventListener("click", () => {
    if (currentAdminView === "settings-child") {
      showSettingsHub();
    } else {
      showAdminHome();
    }
  });

  async function isAdmin() {
    if (!currentUser || !db) return false;

    const { data, error } = await db.rpc("is_current_user_admin");

    if (error) throw error;

    return Boolean(data);
  }

  async function showDashboard() {
    const authorized = await isAdmin();

    if (!authorized) {
      await db.auth.signOut();

      $("#login-message").textContent =
        "This account is not authorised as a restaurant admin.";

      $("#login-message").className = "status-message error";
      return;
    }

    $("#login-panel").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    // Always land on the new three-card home after a successful admin sign-in.
    showAdminHome();
    $("#signout").classList.remove("hidden");
    initializeOrderAlerts();

    setConnection("Connected");

    // Capture startup before the first order query so orders arriving during that query are not silently baselined.
    if (dashboardStartedAt === null) dashboardStartedAt = Date.now();

    await refreshAll();
    subscribe();

    // Check for new orders every 5 seconds if realtime misses an event.
    if (!window.__alShamiOrderPoll) {
      window.__alShamiOrderPoll = window.setInterval(async () => {
        if (!db || !currentUser) return;
        try {
          await loadOrders();
        } catch (error) {
          console.warn("Incoming-order polling failed:", error);
        }
      }, 5000);
    }
  }

  async function start() {
    if (!db) {
      setConnection("Setup required");

      $("#login-message").textContent =
        "Check the Supabase URL and public key in config.js.";

      return;
    }

    try {
      const { data, error } = await db.auth.getSession();

      if (error) throw error;

      if (data.session) {
        currentUser = data.session.user;
        await showDashboard();
      } else {
        setConnection("Ready to sign in");
      }
    } catch (error) {
      console.error("Startup error:", error);
      setConnection("Connection error");
      status(error.message, "#login-message", true);
    }
  }

  $("#login-form").onsubmit = async event => {
    event.preventDefault();

    if (!db) {
      toast("Supabase is not connected.");
      return;
    }

    // Prepare audio during the sign-in gesture; notification permission is requested after admin access is confirmed.
    initializeOrderAlerts(true);

    const form = new FormData(event.currentTarget);

    const { data, error } = await db.auth.signInWithPassword({
      email: form.get("email"),
      password: form.get("password")
    });

    if (error) {
      status(error.message, "#login-message", true);
      return;
    }

    currentUser = data.user;

    try {
      await showDashboard();
    } catch (error) {
      console.error("Login error:", error);
      status(error.message, "#login-message", true);
    }
  };

  $("#signout").onclick = async () => {
    if (db) await db.auth.signOut();
    location.reload();
  };

  // Refresh button: loading state, error handling, and recovery.
  $("#refresh").onclick = async () => {
    const button = $("#refresh");

    if (!db) {
      toast("Supabase is not connected.");
      return;
    }

    if (refreshInProgress) return;

    refreshInProgress = true;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Refreshing...";

    try {
      await refreshAll();
      toast("Dashboard refreshed successfully.");
    } catch (error) {
      console.error("Refresh failed:", error);
      toast("Refresh failed: " + (error.message || "Unknown error"));
    } finally {
      refreshInProgress = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  };

  $("#order-filter").onchange = renderOrders;
  $("#order-search")?.addEventListener("input", renderOrders);
  $("#history-search")?.addEventListener("input", renderHistory);
  $("#export-orders")?.addEventListener("click", exportVisibleOrders);

  // Only wire the legacy main-navigation tabs here. Operations has its own
  // subtabs and must not be treated as orders/history/menu navigation.
  document.querySelectorAll(".legacy-main-tabs [data-tab]").forEach(button => {
    button.onclick = () => {
      const name = button.dataset.tab;
      if (!["orders", "history", "menu", "offers", "settings"].includes(name)) return;
      showAdminMainPanel(name);
    };
  });

  function showAudioActivationHint() {
    if (soundActivationHintShown) return;
    soundActivationHintShown = true;
    const hint = $("#incoming-order-sound-hint");
    if (hint) {
      hint.textContent = "Sound is waiting for the browser's audio session. Tap once anywhere in this dashboard to activate order alerts.";
    }
    toast("Order sound is not active yet. Tap once anywhere in the admin dashboard; check device volume and Silent mode.");
  }

  function setOrderAudioSession(recoverOutput = false) {
    // Safari on iOS exposes AudioSession. Playback mode prevents restaurant alerts
    // from being routed as silent ambient audio on supported devices.
    const session = navigator.audioSession;
    if (!session) return;

    try {
      if (recoverOutput) {
        // Some iOS versions can leave the route stuck while AudioContext reports "running".
        // Force a real category change, then return to playback mode.
        session.type = "ambient";
        window.setTimeout(() => {
          try { session.type = "playback"; } catch (error) {
            console.debug("Could not restore playback audio session:", error);
          }
        }, 0);
      } else if (session.type !== "playback") {
        session.type = "playback";
      }
    } catch (error) {
      console.debug("Audio session mode is not configurable in this browser:", error);
    }
  }

  function keepOrderAudioContextAwake() {
    if (!audioCtx || audioCtx.state !== "running" || audioKeepAliveOscillator) return;

    try {
      // Keep the audio graph active between orders instead of leaving it idle for long periods.
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(20, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.000001, audioCtx.currentTime);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      audioKeepAliveOscillator = oscillator;
    } catch (error) {
      console.debug("Could not keep the order audio graph active:", error);
    }
  }

  function initializeOrderAlerts(fromUserGesture = false) {
    soundOn = true;

    if (fromUserGesture && !audioSessionGestureRecoveryUsed) {
      audioSessionGestureRecoveryUsed = true;
      setOrderAudioSession(true);
    } else {
      setOrderAudioSession(false);
    }

    // iOS Safari can leave AudioContext "interrupted" after the app is backgrounded.
    // Recreate it instead of repeatedly trying to resume a broken context.
    if (audioCtx && (audioCtx.state === "closed" || audioCtx.state === "interrupted")) {
      const staleContext = audioCtx;
      audioCtx = null;
      audioKeepAliveOscillator = null;
      try { void staleContext.close(); } catch (_) {}
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx && AudioContextConstructor) {
      try {
        audioCtx = new AudioContextConstructor({ latencyHint: "interactive" });
      } catch (error) {
        console.warn("Order audio is unavailable in this browser:", error);
      }
    }

    if (!audioCtx) {
      showAudioActivationHint();
      return;
    }

    const contextAtResume = audioCtx;
    if (contextAtResume.state !== "running") {
      try {
        // When possible, resume synchronously in the real pointer/keyboard event handler.
        const resumePromise = contextAtResume.resume();
        if (resumePromise && typeof resumePromise.then === "function") {
          void resumePromise.then(() => {
            if (audioCtx !== contextAtResume || contextAtResume.state !== "running") return;
            soundActivationHintShown = false;
            clearTimeout(audioActivationHintTimer);
            keepOrderAudioContextAwake();
            if (activeIncomingOrderId) void beep();
          }).catch(error => {
            console.debug("Order audio is waiting for browser interaction:", error);
            if (fromUserGesture) showAudioActivationHint();
          });
        }
      } catch (error) {
        console.debug("Order audio could not be resumed yet:", error);
        if (fromUserGesture) showAudioActivationHint();
      }

      if (!fromUserGesture) {
        clearTimeout(audioActivationHintTimer);
        audioActivationHintTimer = window.setTimeout(() => {
          if (audioCtx && audioCtx.state !== "running") showAudioActivationHint();
        }, 1200);
      }
    } else {
      soundActivationHintShown = false;
      clearTimeout(audioActivationHintTimer);
      keepOrderAudioContextAwake();
    }

    if ("Notification" in window) notificationsOn = Notification.permission === "granted";
  }
  function showOrderNotification(order) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const number = order.order_number || String(order.id || "").slice(0, 8);
    const title = "AL SHAMI — NEW ORDER!";
    const body = "Order #" + number + " has arrived. Open the admin dashboard.";
    const options = {
      body,
      tag: "al-shami-order-" + order.id,
      renotify: true,
      icon: "./icons/al-shami-admin.svg",
      badge: "./icons/al-shami-admin.svg",
      data: { url: new URL("./admin.html", window.location.href).href }
    };

    const showFallbackNotification = () => {
      try {
        const notification = new Notification(title, options);
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch (error) {
        console.warn("System notification could not be shown:", error);
      }
    };

    if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === "function") {
      void navigator.serviceWorker.getRegistration()
        .then(registration => {
          if (registration && typeof registration.showNotification === "function") {
            return registration.showNotification(title, options);
          }
          showFallbackNotification();
          return undefined;
        })
        .catch(error => {
          console.warn("Service-worker order notification failed:", error);
        });
      return;
    }

    showFallbackNotification();
  }

  function flushPendingOrderNotifications() {
    if (!notificationsOn) {
      pendingOrderNotifications.clear();
      return;
    }

    const pending = Array.from(pendingOrderNotifications.values());
    pendingOrderNotifications.clear();
    pending.forEach(showOrderNotification);
  }

  function requestOrderNotificationPermission() {
    if (!("Notification" in window)) return Promise.resolve(false);

    if (Notification.permission === "granted") {
      notificationsOn = true;
      flushPendingOrderNotifications();
      return Promise.resolve(true);
    }

    if (Notification.permission !== "default" || notificationPermissionRequested) {
      return notificationPermissionPromise || Promise.resolve(false);
    }

    notificationPermissionRequested = true;
    try {
      notificationPermissionPromise = Promise.resolve(Notification.requestPermission())
        .then(permission => {
          notificationsOn = permission === "granted";
          if (notificationsOn) flushPendingOrderNotifications();
          else pendingOrderNotifications.clear();
          return notificationsOn;
        })
        .catch(error => {
          pendingOrderNotifications.clear();
          console.warn("Notifications unavailable:", error);
          return false;
        });
    } catch (error) {
      pendingOrderNotifications.clear();
      console.warn("Notification permission could not be requested:", error);
      notificationPermissionPromise = Promise.resolve(false);
    }

    return notificationPermissionPromise;
  }

  function notifyNewOrder(order) {
    const number = order.order_number || String(order.id || "").slice(0, 8);
    try {
      if (typeof navigator.vibrate === "function") {
        navigator.vibrate([250, 120, 250, 120, 400]);
      }
    } catch (_) {}

    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      notificationsOn = true;
      showOrderNotification(order);
    } else if (Notification.permission === "default") {
      pendingOrderNotifications.set(order.id || String(number), order);
    }
  }

  function handleOrderAlertGesture() {
    initializeOrderAlerts(true);
    if (currentUser) void requestOrderNotificationPermission();
    if (activeIncomingOrderId) void beep();
  }

  // Browser audio is unlocked automatically on the first real interaction; no sound toggle is shown.
  document.addEventListener("pointerdown", handleOrderAlertGesture, true);
  document.addEventListener("keydown", handleOrderAlertGesture, true);

  async function beep() {
    if (!soundOn) return false;

    if (audioCtx && (audioCtx.state === "closed" || audioCtx.state === "interrupted")) {
      initializeOrderAlerts(false);
    } else if (!audioCtx) {
      initializeOrderAlerts(false);
    }
    if (!audioCtx) {
      showAudioActivationHint();
      return false;
    }

    const context = audioCtx;
    try {
      if (context.state !== "running") {
        // iOS can leave resume() pending forever after an audio interruption.
        // Bound the wait so the manager gets a clear hint rather than a silent failure.
        try {
          await Promise.race([
            context.resume().catch(() => {}),
            new Promise(resolve => window.setTimeout(resolve, 700))
          ]);
        } catch (_) {}
        if (audioCtx !== context || context.state !== "running") {
          showAudioActivationHint();
          return false;
        }
      }

      keepOrderAudioContextAwake();
      soundActivationHintShown = false;
      clearTimeout(audioActivationHintTimer);
      if (Date.now() - lastBeepStartedAt < 450) return true;
      lastBeepStartedAt = Date.now();

      const startAt = context.currentTime + 0.03;
      [0, 0.28, 0.56, 0.84].forEach((delay, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(index % 2 ? 1180 : 880, startAt + delay);
        gain.gain.setValueAtTime(0.0001, startAt + delay);
        gain.gain.exponentialRampToValueAtTime(0.32, startAt + delay + 0.025);
        gain.gain.setValueAtTime(0.32, startAt + delay + 0.13);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + delay + 0.23);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt + delay);
        oscillator.stop(startAt + delay + 0.24);
      });
      return true;
    } catch (error) {
      console.warn("AL SHAMI sound alert failed:", error);
      showAudioActivationHint();
      return false;
    }
  }
  async function refreshAll() {
    if (!db) throw new Error("Supabase is not connected.");

    const results = await Promise.allSettled([
      loadOrders(),
      loadProducts(),
      loadOffers(),
      loadSettings()
    ]);

    const failed = results
      .map((result, index) => ({
        result,
        name: ["orders", "history", "menu", "offers", "settings"][index]
      }))
      .filter(item => item.result.status === "rejected");

    if (failed.length) {
      console.error("Dashboard refresh errors:", failed);

      throw new Error(
        failed.map(item =>
          item.name + ": " +
          (item.result.reason?.message || "Failed to load")
        ).join(" | ")
      );
    }
  }

  // Serialize order refreshes. If another event requests a refresh while one is running,
  // run one more pass instead of allowing an older response to overwrite newer orders.
  async function loadOrders() {
    if (ordersLoadPromise) {
      ordersReloadRequested = true;
      return ordersLoadPromise;
    }

    ordersLoadPromise = (async () => {
      do {
        ordersReloadRequested = false;
        await loadOrdersOnce();
      } while (ordersReloadRequested);
    })();

    try {
      await ordersLoadPromise;
    } finally {
      ordersLoadPromise = null;
    }
  }

  async function loadOrdersOnce() {
    const { data, error } = await db
      .from("orders")
      .select("*,order_items(*,menu_items(name))")
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) throw error;

    orders = data || [];

    if (firstOrderLoad) {
      // Baseline existing orders, but still alert on orders created during the initial page load.
      const startupCutoff = (dashboardStartedAt ?? Date.now()) - 15000;
      orders.forEach(order => {
        knownOrderIds.add(order.id);
        const createdAt = Date.parse(order.created_at || "");
        if (order.status === "new" && Number.isFinite(createdAt) && createdAt >= startupCutoff) {
          enqueueIncomingOrder(order.id);
          notifyNewOrder(order);
        }
      });
      firstOrderLoad = false;
    } else {
      // Fallback for realtime events missed by the browser connection.
      orders.forEach(order => {
        if (knownOrderIds.has(order.id)) return;
        knownOrderIds.add(order.id);
        if (order.status === "new") {
          enqueueIncomingOrder(order.id);
          notifyNewOrder(order);
        }
      });
    }

    $("#stat-new").textContent =
      orders.filter(order => order.status === "new").length;

    $("#stat-progress").textContent =
      orders.filter(order =>
        ["accepted", "preparing", "ready", "out_for_delivery"].includes(order.status)
      ).length;

    $("#new-count").textContent =
      orders.filter(order => order.status === "new").length;

    const activeCount = orders.filter(order => !["completed", "rejected"].includes(order.status)).length;
    const completedCount = orders.filter(order => ["completed", "rejected"].includes(order.status)).length;
    if ($("#hub-active-count")) $("#hub-active-count").textContent = activeCount;
    if ($("#hub-history-count")) $("#hub-history-count").textContent = completedCount;

    renderOrders();
    renderHistory();
    showNextIncomingOrder();
  }

  function visibleOrders() {
    const filter = $("#order-filter")?.value || "all";
    const query = String($("#order-search")?.value || "").trim().toLowerCase();

    return orders.filter(order => {
      const matchesStatus = filter === "all" || order.status === filter;
      const searchable = [
        order.order_number,
        order.id,
        order.customer_name,
        order.customer_phone,
        order.delivery_address,
        order.order_type,
        order.status,
        ...(order.order_items || []).map(item => item.item_name || item.menu_items?.name || "")
      ].join(" ").toLowerCase();
      return matchesStatus && (!query || searchable.includes(query));
    });
  }

  function exportVisibleOrders() {
    const selected = visibleOrders();
    if (!selected.length) {
      toast("No visible orders to export.");
      return;
    }

    const quote = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const rows = [
      ["Order number","Created at","Customer","Phone","Type","Address","Items","Subtotal","Delivery fee","Total","Status","Notes"],
      ...selected.map(order => [
        order.order_number || order.id,
        new Date(order.created_at).toISOString(),
        order.customer_name,
        order.customer_phone,
        order.order_type,
        order.delivery_address || "",
        (order.order_items || []).map(item =>
          Number(item.quantity) + " x " + (item.item_name || item.menu_items?.name || "Menu item")
        ).join("; "),
        order.subtotal,
        order.delivery_fee,
        order.total,
        order.status,
        order.notes || ""
      ])
    ];
    const csv = "\uFEFF" + rows.map(row => row.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "al-shami-orders-" + new Date().toISOString().slice(0,10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exported " + selected.length + " visible orders.");
  }

  function renderOrders() {
    const selectedOrderFilter = $("#order-filter")?.value || "all";
    const filteredOrders = visibleOrders().filter(order =>
      order.status !== "completed" && (order.status !== "rejected" || selectedOrderFilter === "rejected")
    );

    $("#orders-list").innerHTML = filteredOrders.length
      ? filteredOrders.map(order => `
        <article class="order-card ${
          order.status === "new" ? "is-new" : ""
        }">
          <div class="order-header">
            <div>
              <h3>Order #${esc(
                order.order_number || order.id.slice(0, 8)
              )}</h3>

              <div class="order-meta">
                ${new Date(order.created_at).toLocaleString()}
                · ${esc(order.customer_name)}
                · ${esc(order.customer_phone)}
              </div>
            </div>

            <span class="order-status">${esc(order.status)}</span>
          </div>

          <p>
            <strong>
              ${order.order_type === "delivery" ? "Delivery" : "Pickup"}
            </strong>
            ${order.delivery_address
              ? " · " + esc(order.delivery_address)
              : ""}
            ${order.notes
              ? "<br>Notes: " + esc(order.notes)
              : ""}
            ${deliveryMapLink(order) ? "<br>" + deliveryMapLink(order) : ""}
          </p>

          <ul class="order-lines">
            ${(order.order_items || []).map(item => `
              <li>
                <span>
                  ${Number(item.quantity)} ×
                  ${esc(
                    item.item_name ||
                    item.menu_items?.name ||
                    "Menu item"
                  )}
                </span>

                <strong>
                  ${money(Number(item.unit_price) * Number(item.quantity))}
                </strong>
              </li>
            `).join("")}
          </ul>

          <div class="order-footer">
            <div>
              <strong>${money(order.total)}</strong>

              <div class="order-meta">
                Subtotal ${money(order.subtotal)}
                · Delivery ${money(order.delivery_fee)}
              </div>
            </div>

            <div class="order-actions">
              <select
                data-status="${order.id}"
                aria-label="Change order status"
              >
                ${[
                  "new",
                  "accepted",
                  "preparing",
                  "ready",
                  ...(order.order_type === "delivery" ? ["out_for_delivery"] : []),
                  "rejected"
                ].map(value => `
                  <option
                    value="${value}"
                    ${order.status === value ? "selected" : ""}
                  >
                    ${value.split("_").map(part => part[0].toUpperCase() + part.slice(1)).join(" ")}
                  </option>
                `).join("")}
              </select>

              <button class="btn btn-light" data-copy="${order.id}">
                Copy details
              </button>
              <button class="btn delete-order-btn" data-delete-order="${order.id}" type="button">
                Delete order
              </button>
            </div>
          </div>
        </article>
      `).join("")
      : '<p class="muted">No orders in this view.</p>';

    $("#orders-list")
      .querySelectorAll("[data-status]")
      .forEach(select => {
        select.onchange = () =>
          updateStatus(select.dataset.status, select.value);
      });

    $("#orders-list")
      .querySelectorAll("[data-copy]")
      .forEach(button => {
        button.onclick = async () => {
          const order = orders.find(
            item => item.id === button.dataset.copy
          );

          if (!order) return;

          const details = `AL SHAMI ORDER #${
            order.order_number || order.id.slice(0, 8)
          }
${order.customer_name} - ${order.customer_phone}
${order.order_type} ${order.delivery_address || ""}
${(order.order_items || []).map(item =>
  `${item.quantity} x ${
    item.item_name || item.menu_items?.name || "Menu item"
  }`
).join("\n")}
TOTAL ${money(order.total)}
Status: ${order.status}`;

          try {
            await navigator.clipboard.writeText(details);
            toast("Order details copied.");
          } catch (error) {
            toast(details);
          }
        };
      });
  }



  function renderHistory() {
    const list = $("#history-list");
    if (!list) return;
    const query = String($("#history-search")?.value || "").trim().toLowerCase();
    const completed = orders.filter(order => {
      if (!["completed", "rejected"].includes(order.status)) return false;
      const searchable = [order.order_number, order.id, order.customer_name, order.customer_phone, order.delivery_address, order.order_type, ...(order.order_items || []).map(item => item.item_name || item.menu_items?.name || "")].join(" ").toLowerCase();
      return !query || searchable.includes(query);
    });
    list.innerHTML = completed.length ? completed.map(order => `
      <article class="order-card">
        <div class="order-header"><div><h3>Order #${esc(order.order_number || order.id.slice(0, 8))}</h3><div class="order-meta">${new Date(order.created_at).toLocaleString()} · ${esc(order.customer_name)} · ${esc(order.customer_phone)}</div></div><span class="order-status">${esc(order.status === "rejected" ? "Rejected" : "Completed")}</span></div>
        <p><strong>${order.order_type === "delivery" ? "Delivery" : "Pickup"}</strong>${order.delivery_address ? " · " + esc(order.delivery_address) : ""}${order.notes ? "<br>Notes: " + esc(order.notes) : ""}</p>
        <ul class="order-lines">${(order.order_items || []).map(item => `<li><span>${Number(item.quantity)} × ${esc(item.item_name || item.menu_items?.name || "Menu item")}</span><strong>${money(Number(item.unit_price) * Number(item.quantity))}</strong></li>`).join("")}</ul>
        <div class="order-footer"><div><strong>${money(order.total)}</strong><div class="order-meta">Subtotal ${money(order.subtotal)} · Delivery ${money(order.delivery_fee)}</div></div><div class="order-actions"><button class="btn btn-light" data-history-copy="${order.id}">Copy details</button><button class="btn delete-order-btn" data-delete-order="${order.id}" type="button">Delete order</button></div></div>
      </article>`).join("") : '<p class="muted">No completed orders in history yet.</p>';
    list.querySelectorAll("[data-history-copy]").forEach(button => {
      button.onclick = async () => {
        const order = orders.find(item => item.id === button.dataset.historyCopy);
        if (!order) return;
        const details = `AL SHAMI ORDER #${order.order_number || order.id.slice(0, 8)}\n${order.customer_name} - ${order.customer_phone}\n${order.order_type} ${order.delivery_address || ""}\n${(order.order_items || []).map(item => `${item.quantity} x ${item.item_name || item.menu_items?.name || "Menu item"}`).join("\n")}\nTOTAL ${money(order.total)}\nStatus: ${order.status}`;
        try { await navigator.clipboard.writeText(details); toast("Order details copied."); }
        catch (_) { toast(details); }
      };
    });
  }

  function stopIncomingOrderRinging() {
    if (incomingRingTimer !== null) { clearInterval(incomingRingTimer); incomingRingTimer = null; }
  }

  function startIncomingOrderRinging() {
    stopIncomingOrderRinging();
    if (!activeIncomingOrderId || !soundOn) return;

    // The first alert is played as soon as the order is detected.
    // Continue ringing while the order is waiting for a decision.
    incomingRingTimer = setInterval(() => {
      if (!activeIncomingOrderId || !soundOn) return;
      void beep();
    }, 1500);
  }

  // If the dashboard becomes visible again, immediately resume the active alert.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;

    // Reset iOS's audio output route after returning from the background.
    setOrderAudioSession(true);
    if (audioCtx && (audioCtx.state === "closed" || audioCtx.state === "interrupted")) {
      const staleContext = audioCtx;
      audioCtx = null;
      audioKeepAliveOscillator = null;
      try { void staleContext.close(); } catch (_) {}
    }
    initializeOrderAlerts(false);
    window.setTimeout(() => {
      if (activeIncomingOrderId && soundOn) void beep();
    }, 50);

    // iOS may suspend timers/network activity while backgrounded; reconcile immediately on return.
    if (currentUser && db) {
      void loadOrders().catch(error => console.warn("Order refresh on resume failed:", error));
    }
  });

  function closeIncomingOrderDialog() {
    stopIncomingOrderRinging();
    activeIncomingOrderId = null;
    incomingDecisionInProgress = false;
    const overlay = $("#incoming-order-overlay");
    if (overlay) overlay.hidden = true;
    document.body.classList.remove("incoming-order-open");
  }

  function enqueueIncomingOrder(orderId) {
    if (!orderId || incomingOrderQueue.includes(orderId) || activeIncomingOrderId === orderId) return;
    incomingOrderQueue.push(orderId);

    // Alert at detection time, before waiting for the follow-up orders query/render.
    // The incoming dialog will keep ringing until the order is accepted or rejected.
    void beep();
  }

  function showNextIncomingOrder() {
    const overlay = $("#incoming-order-overlay");
    if (!overlay) return;
    if (activeIncomingOrderId) {
      const current = orders.find(order => order.id === activeIncomingOrderId);
      // A transient/stale query must not dismiss an alert the manager has not decided on.
      if (!current) return;
      if (current.status === "new") { renderIncomingOrder(current); return; }
      closeIncomingOrderDialog();
    }
    while (incomingOrderQueue.length) {
      const nextId = incomingOrderQueue.shift();
      const nextOrder = orders.find(order => order.id === nextId);
      if (!nextOrder || nextOrder.status !== "new") continue;
      activeIncomingOrderId = nextId;
      incomingDecisionInProgress = false;
      overlay.hidden = false;
      document.body.classList.add("incoming-order-open");
      renderIncomingOrder(nextOrder);
      startIncomingOrderRinging();
      $("#incoming-order-reject")?.focus({ preventScroll:true });
      return;
    }
    overlay.hidden = true;
    document.body.classList.remove("incoming-order-open");
  }

  function renderIncomingOrder(order) {
    const details = $("#incoming-order-details");
    const title = $("#incoming-order-title");
    const hint = $("#incoming-order-sound-hint");
    if (!details || !order) return;
    title.textContent = "NEW ORDER #" + (order.order_number || String(order.id).slice(0,8));
    if (!audioCtx && !(window.AudioContext || window.webkitAudioContext)) {
      hint.textContent = "This browser does not support in-page ringing. Keep the admin dashboard open; device notifications depend on browser support and permission.";
    } else if (audioCtx && audioCtx.state !== "running") {
      hint.textContent = "The alert is automatic. Your browser needs one tap anywhere in this dashboard to unlock sound; after that, new orders ring automatically.";
    } else if ("Notification" in window && Notification.permission === "granted") {
      hint.textContent = "Automatic ringing and device notifications are active until you accept or reject this order.";
    } else {
      hint.textContent = "Automatic ringing continues until you accept or reject this order. Allow browser notifications when prompted for device alerts.";
    }
    const items = (order.order_items || []).map(item =>
      "<li><span>" + Number(item.quantity) + " × " +
      esc(item.item_name || item.menu_items?.name || "Menu item") +
      "</span><strong>" + money(Number(item.unit_price) * Number(item.quantity)) + "</strong></li>"
    ).join("");
    const field = (label, value) =>
      '<div class="incoming-order-field"><small>' + esc(label) + "</small><strong>" + esc(value || "—") + "</strong></div>";
    details.innerHTML =
      '<div class="incoming-order-grid">' +
      field("Customer", order.customer_name) +
      field("Phone", order.customer_phone) +
      field("Order type", order.order_type === "delivery" ? "Delivery" : "Pickup") +
      field("Time received", new Date(order.created_at).toLocaleString()) +
      (order.delivery_address ? field("Delivery address", order.delivery_address) : "") +
      '</div>' + (deliveryMapLink(order) ? '<p class="incoming-order-note">' + deliveryMapLink(order) + '</p>' : '') +
      '<ul class="incoming-order-items">' + (items || "<li>No item details loaded yet.</li>") + "</ul>" +
      (order.notes ? '<p class="incoming-order-note"><strong>Customer notes:</strong> ' + esc(order.notes) + "</p>" : "") +
      '<div class="incoming-order-total"><span>ORDER TOTAL</span><strong>' + money(order.total) + "</strong></div>";
    const accept = $("#incoming-order-accept");
    const reject = $("#incoming-order-reject");
    if (accept) { accept.disabled = incomingDecisionInProgress; accept.textContent = incomingDecisionInProgress ? "Saving…" : "✓ ACCEPT ORDER"; }
    if (reject) { reject.disabled = incomingDecisionInProgress; reject.textContent = incomingDecisionInProgress ? "Saving…" : "✕ REJECT ORDER"; }
  }

  function openOrdersTab() {
    showAdminMainPanel("orders");
    $("#tab-orders")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function decideIncomingOrder(status) {
    if (!activeIncomingOrderId || incomingDecisionInProgress) return;
    const id = activeIncomingOrderId;
    incomingDecisionInProgress = true;
    const order = orders.find(item => item.id === id);
    if (order) renderIncomingOrder(order);
    try {
      const updated = await updateStatus(id, status, { fromIncomingDialog:true });
      if (!updated) {
        incomingDecisionInProgress = false;
        const current = orders.find(item => item.id === id);
        if (current) renderIncomingOrder(current);
        return;
      }
      incomingOrderQueue.splice(0, incomingOrderQueue.length, ...incomingOrderQueue.filter(itemId => itemId !== id));
      if (activeIncomingOrderId === id) closeIncomingOrderDialog();
      toast(status === "accepted" ? "Order accepted." : "Order rejected.");
      openOrdersTab();
      showNextIncomingOrder();
    } catch (error) {
      console.error("Could not decide incoming order:", error);
      incomingDecisionInProgress = false;
      const current = orders.find(item => item.id === id);
      if (current) renderIncomingOrder(current);
      toast("Could not update this order. It will stay on screen; please try again.");
    }
  }

  $("#incoming-order-accept")?.addEventListener("click", () => { void decideIncomingOrder("accepted"); });
  $("#incoming-order-reject")?.addEventListener("click", () => { void decideIncomingOrder("rejected"); });
  $("#incoming-order-overlay")?.addEventListener("click", event => {
    if (event.target === $("#incoming-order-overlay")) event.preventDefault();
  });
  document.addEventListener("keydown", event => {
    if (!activeIncomingOrderId) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
  }, true);

  $("#receipt-confirm-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#receipt-confirm-message");
    const orderNumber = Number(form.elements.order_number.value);
    const receiptCode = String(form.elements.receipt_code.value || "").trim();
    if (!Number.isSafeInteger(orderNumber) || orderNumber < 1 || !/^[0-9]{6}$/.test(receiptCode)) {
      if (message) { message.textContent = "Enter a valid order number and 6-digit receipt code."; message.className = "status-message error"; }
      return;
    }
    button.disabled = true;
    if (message) { message.textContent = "Checking receipt code…"; message.className = "status-message"; }
    try {
      const { error } = await db.rpc("confirm_customer_receipt", {
        p_order_number: orderNumber,
        p_receipt_code: receiptCode
      });
      if (error) throw error;
      if (message) { message.textContent = "Receipt confirmed. Order moved to History."; message.className = "status-message success"; }
      form.reset();
      await loadOrders();
    } catch (error) {
      if (message) { message.textContent = error.message || "Could not confirm receipt."; message.className = "status-message error"; }
    } finally {
      button.disabled = false;
    }
  });

  async function updateStatus(id, newStatus, options = {}) {
    if (newStatus === "completed") {
      toast("Use Confirm receipt with the customer's 6-digit code.");
      await loadOrders();
      return false;
    }
    try {
      const { error } = await db
        .from("orders")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      toast("Order status updated.");
      await loadOrders();
      if (!options.fromIncomingDialog && id === activeIncomingOrderId && ["accepted","rejected"].includes(newStatus)) {
        incomingOrderQueue.splice(0, incomingOrderQueue.length, ...incomingOrderQueue.filter(itemId => itemId !== id));
        closeIncomingOrderDialog();
        showNextIncomingOrder();
      }
      return true;
    } catch (error) {
      console.error("Status update failed:", error);
      toast("Could not update status: " + (error.message || "Unknown error"));
      return false;
    }
  }

  function subscribe() {
    db.channel("al-shami-live-orders")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders"
        },
        async payload => {
          if (knownOrderIds.has(payload.new.id)) return;

          knownOrderIds.add(payload.new.id);

          enqueueIncomingOrder(payload.new.id);
          notifyNewOrder(payload.new);

          toast(
            "🔔 NEW ORDER! Order #" +
            (payload.new.order_number || payload.new.id.slice(0, 8)) +
            " has arrived."
          );

          try {
            await loadOrders();
            showNextIncomingOrder();
          } catch (error) {
            console.error("Could not reload new orders:", error);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders"
        },
        async payload => {
          try {
            await loadOrders();
            const changed = payload.new;
            if (changed && changed.id === activeIncomingOrderId && changed.status !== "new") {
              incomingOrderQueue.splice(0, incomingOrderQueue.length, ...incomingOrderQueue.filter(itemId => itemId !== changed.id));
              closeIncomingOrderDialog();
              showNextIncomingOrder();
            } else {
              showNextIncomingOrder();
            }
          } catch (error) {
            console.error("Could not reload updated orders:", error);
          }
        }
      )
      .subscribe(state => {
        setConnection(
          state === "SUBSCRIBED"
            ? "Live · Realtime connected"
            : "Live connection: " + state
        );
      });
  }

  function resetProduct() {
    const form = $("#product-form");

    form.reset();
    form.elements.id.value = "";
    form.elements.is_available.checked = true;
  }

  async function loadProducts() {
    const { data, error } = await db
      .from("menu_items")
      .select("*")
      .order("sort_order")
      .order("name");

    if (error) throw error;

    products = data || [];

    $("#stat-menu").textContent = products.length;

    $("#admin-menu-list").innerHTML = products.map(product => `
      <div class="admin-menu-row">
        ${product.image_url
          ? `<img src="${esc(product.image_url)}" alt="">`
          : '<div class="product-image" style="width:58px;height:58px;border-radius:8px;font-size:22px">🍽️</div>'
        }

        <div class="grow">
          <strong>
            ${esc(product.name)} · ${money(product.price)}
          </strong>

          <small>
            ${esc(product.category)} ·
            ${product.is_available ? "Available" : "Hidden"}
            ${product.description
              ? " · " + esc(product.description)
              : ""}
          </small>
        </div>

        <button
          class="btn btn-light"
          data-edit-product="${product.id}"
        >Edit</button>

        <button
          class="btn btn-light"
          data-toggle-product="${product.id}"
        >${product.is_available ? "Hide" : "Show"}</button>
      </div>
    `).join("") || '<p class="muted">No menu items yet.</p>';

    $("#admin-menu-list")
      .querySelectorAll("[data-edit-product]")
      .forEach(button => {
        button.onclick = () => {
          const product = products.find(
            item => item.id === button.dataset.editProduct
          );

          const form = $("#product-form");

          Object.entries({
            id: product.id,
            name: product.name,
            category: product.category,
            price: product.price,
            image_url: product.image_url || "",
            description: product.description || "",
            is_available: product.is_available
          }).forEach(([key, value]) => {
            if (form.elements[key].type === "checkbox") {
              form.elements[key].checked = value;
            } else {
              form.elements[key].value = value;
            }
          });

          window.scrollTo({
            top:
              $("#product-form").getBoundingClientRect().top +
              window.scrollY - 80,
            behavior: "smooth"
          });
        };
      });

    $("#admin-menu-list")
      .querySelectorAll("[data-toggle-product]")
      .forEach(button => {
        button.onclick = async () => {
          const product = products.find(
            item => item.id === button.dataset.toggleProduct
          );

          const { error } = await db
            .from("menu_items")
            .update({ is_available: !product.is_available })
            .eq("id", product.id);

          if (error) {
            toast(error.message);
          } else {
            await loadProducts();
          }
        };
      });
  }

  $("#product-form").onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const data = {
      name: form.elements.name.value.trim(),
      category: form.elements.category.value.trim(),
      price: Number(form.elements.price.value),
      image_url: form.elements.image_url.value.trim() || null,
      description: form.elements.description.value.trim() || null,
      is_available: form.elements.is_available.checked
    };

    if (!Number.isFinite(data.price) || data.price <= 0) {
      status("Price must be greater than zero.");
      return;
    }

    const id = form.elements.id.value;

    const result = id
      ? await db.from("menu_items").update(data).eq("id", id)
      : await db.from("menu_items").insert(data);

    if (result.error) {
      status(result.error.message, "#product-message", true);
      return;
    }

    status("Menu item saved.");
    resetProduct();
    await loadProducts();
  };

  $("#cancel-product").onclick = resetProduct;

  async function loadOffers() {
    const { data, error } = await db
      .from("offers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const offers = data || [];

    $("#offers-list").innerHTML = offers.map(offer => `
      <div class="admin-menu-row">
        <div class="grow">
          <strong>${esc(offer.title)}</strong>
          <small>
            ${esc(offer.details || "")} ·
            ${offer.is_active ? "Active" : "Inactive"}
          </small>
        </div>

        <button class="btn btn-light" data-edit-offer="${offer.id}">
          Edit
        </button>

        <button class="btn btn-light" data-toggle-offer="${offer.id}">
          ${offer.is_active ? "Disable" : "Enable"}
        </button>
      </div>
    `).join("") || '<p class="muted">No offers created yet.</p>';

    $("#offers-list")
      .querySelectorAll("[data-edit-offer]")
      .forEach(button => {
        button.onclick = () => {
          const offer = offers.find(
            item => item.id === button.dataset.editOffer
          );

          const form = $("#offer-form");

          form.elements.id.value = offer.id;
          form.elements.title.value = offer.title;
          form.elements.details.value = offer.details || "";
          form.elements.is_active.checked = offer.is_active;
        };
      });

    $("#offers-list")
      .querySelectorAll("[data-toggle-offer]")
      .forEach(button => {
        button.onclick = async () => {
          const offer = offers.find(
            item => item.id === button.dataset.toggleOffer
          );

          const { error } = await db
            .from("offers")
            .update({ is_active: !offer.is_active })
            .eq("id", offer.id);

          if (error) {
            toast(error.message);
          } else {
            await loadOffers();
          }
        };
      });
  }

  $("#offer-form").onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const data = {
      title: form.elements.title.value.trim(),
      details: form.elements.details.value.trim() || null,
      is_active: form.elements.is_active.checked
    };

    const id = form.elements.id.value;

    const result = id
      ? await db.from("offers").update(data).eq("id", id)
      : await db.from("offers").insert(data);

    if (result.error) {
      status(result.error.message, "#offer-message", true);
      return;
    }

    status("Offer saved.", "#offer-message");

    form.reset();
    form.elements.id.value = "";
    form.elements.is_active.checked = true;

    await loadOffers();
  };

  $("#cancel-offer").onclick = () => {
    $("#offer-form").reset();
    $("#offer-form").elements.id.value = "";
  };

  async function loadSettings() {
    const { data, error } = await db
      .from("restaurant_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;

    $("#settings-form").elements.delivery_fee.value =
      data.delivery_fee;

    $("#settings-form").elements.minimum_order.value =
      data.minimum_order;
  }

  $("#settings-form").onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const data = {
      delivery_fee: Number(form.elements.delivery_fee.value),
      minimum_order: Number(form.elements.minimum_order.value),
      updated_at: new Date().toISOString()
    };

    const { error } = await db
      .from("restaurant_settings")
      .update(data)
      .eq("id", 1);

    if (error) {
      status(error.message, "#settings-message", true);
      return;
    }

    status("Settings saved.", "#settings-message");
  };

  async function deleteSingleOrder(orderId, button) {
    const order = orders.find(item => item.id === orderId);
    if (!order) {
      toast("This order is no longer in the list. Refresh the dashboard.");
      return;
    }
    if (!db || !currentUser) {
      toast("Please sign in as an administrator first.");
      return;
    }

    const orderNumber = order.order_number || order.id.slice(0, 8);
    const confirmed = window.confirm(
      "Permanently delete order #" + orderNumber + "?\n\n" +
      "Customer: " + (order.customer_name || "Unknown") + "\n\n" +
      "Only this order and its items will be deleted. This cannot be undone."
    );
    if (!confirmed) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Deleting…";
    let deletionSucceeded = false;

    try {
      const { data, error } = await db.rpc("delete_order_for_admin", {
        p_order_id: orderId
      });
      if (error) throw error;
      deletionSucceeded = true;

      incomingOrderQueue.splice(
        0,
        incomingOrderQueue.length,
        ...incomingOrderQueue.filter(id => id !== orderId)
      );
      pendingOrderNotifications.delete(orderId);
      if (activeIncomingOrderId === orderId) closeIncomingOrderDialog();

      orders = orders.filter(item => item.id !== orderId);
      renderOrders();
      renderHistory();

      try {
        await loadOrders();
        toast("Order #" + (data || orderNumber) + " deleted permanently.");
      } catch (refreshError) {
        console.error("Order was deleted, but the list refresh failed:", refreshError);
        toast("Order #" + orderNumber + " was deleted. Refresh the dashboard to reload the list.");
      }
    } catch (error) {
      console.error("Single order deletion failed:", error);
      toast("Could not delete order #" + orderNumber + ": " + (error.message || "Unknown error"));
    } finally {
      if (!deletionSucceeded && button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  // A delete control is rendered inside each order card, so every click is scoped to one UUID.
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-delete-order]");
    if (!button || button.disabled) return;
    void deleteSingleOrder(button.dataset.deleteOrder, button);
  });

  start();
})();