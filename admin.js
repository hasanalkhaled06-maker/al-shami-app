(() => {
  const cfg = window.AL_SHAMI_CONFIG || {};
  const DEVICE_SETUP_KEY = "al-shami-admin-device-setup-v1:" + String(cfg.SUPABASE_URL || "site");
  const isDeviceSetupComplete = () => localStorage.getItem(DEVICE_SETUP_KEY) === "ready";

  const ready =
    cfg.SUPABASE_URL?.startsWith("https://") &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  const staffDb = ready
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY,
        {
          auth: {
            // Keep management sessions isolated from customer and rider sessions.
            storageKey: "al-shami-admin-auth-v1",
            // Keep the signed-in cashier account on this device until explicit sign-out.
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    : null;
  const ownerDb = ready
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: {
          // Keep owner access isolated from cashier and customer sessions, and restore it on this device.
          storageKey: "al-shami-owner-auth-v1",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      })
    : null;
  let selectedDb = staffDb;
  let accessMode = "signed-out";
  const db = new Proxy({}, {
    get(_target, property) {
      const value = selectedDb?.[property];
      return typeof value === "function" ? value.bind(selectedDb) : value;
    }
  });
  window.AL_SHAMI_ADMIN_DB = db;

  const $ = selector => document.querySelector(selector);

  function showUserPicker() {
    $("#login-panel")?.classList.add("hidden");
    $("#owner-user-bootstrap")?.classList.add("hidden");
    $("#password-recovery-panel")?.classList.add("hidden");
    $("#dashboard")?.classList.add("hidden");
    $("#user-picker-panel")?.classList.remove("hidden");
    $("#role-login-form")?.classList.add("hidden");
    $("#role-login-message").textContent = "";
    document.querySelectorAll("[data-user-role]").forEach(button => button.setAttribute("aria-pressed", "false"));
  }

  function showOwnerUserBootstrap() {
    $("#login-panel")?.classList.add("hidden");
    $("#user-picker-panel")?.classList.add("hidden");
    $("#dashboard")?.classList.add("hidden");
    $("#owner-user-bootstrap")?.classList.remove("hidden");
    $("#owner-user-bootstrap-message").textContent = "";
  }

  async function invokeStaffUsers(client, body) {
    const { data, error } = await client.functions.invoke("staff-users", { body });
    if (error) throw new Error(data?.error || error.message || "User request failed.");
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  let currentUser = null;
  let currentRole = null;
  let recoveryReturnToDashboard = false;
  let orders = [];
  let products = [];
  let menuFeatureColumnsAvailable = false;
  let scheduleSettingsAvailable = false;
  let deliveryRiderDirectory = [];
  let lastRiderDirectoryFetchAt = 0;
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
  let liveOrdersChannel = null;
  let liveOrdersClient = null;
  let dashboardStartedAt = null;
  const incomingOrderQueue = [];
  let activeIncomingOrderId = null;
  let incomingRingTimer = null;
  let incomingDecisionInProgress = false;

  const NEW_ORDER_ATTENTION_MS = 5 * 60 * 1000;
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

  async function loadDeliveryRiderDirectory(force = false) {
    if (!selectedDb || (!force && Date.now() - lastRiderDirectoryFetchAt < 60000)) return;
    const { data, error } = await db
      .from("staff_profiles")
      .select("user_id,full_name,role")
      .eq("role", "delivery_rider");
    if (error) throw error;
    deliveryRiderDirectory = data || [];
    lastRiderDirectoryFetchAt = Date.now();
  }

  function deliveryRiderAssignmentMarkup(order) {
    if (order?.order_type !== "delivery" || order.status === "rejected") return "";
    const rider = deliveryRiderDirectory.find(person => person.user_id && person.user_id === order.assigned_rider_user_id);
    let label = rider?.full_name || (order.assigned_rider_user_id ? "Assigned rider account" : "");
    let noteClass = "order-rider-note";
    if (!order.assigned_rider_user_id) {
      label = order.status === "new"
        ? "Waiting for acceptance — rider assignment happens automatically after acceptance."
        : "No rider linked yet. Set an active Delivery Rider profile in Operations → Employee management.";
      noteClass += " is-unassigned";
    }
    return '<div class="' + noteClass + '"><span class="order-rider-note-label">Delivery rider</span><strong>' + esc(label) + '</strong></div>';
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

  const ADMIN_PANEL_NAMES = ["orders", "history", "menu", "offers", "settings", "operations", "users"];
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
    if (accessMode === "staff") {
      hideAdminSections();
      $("#staff-owner-lock")?.classList.remove("hidden");
      $("#tab-orders")?.classList.remove("hidden");
      return;
    }
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
    if (accessMode !== "owner") {
      toast("Owner password is required to open management.");
      return;
    }
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
    if (accessMode === "staff" && name !== "orders") {
      toast("Owner password is required to open management.");
      return;
    }
    if (name === "settings-hub") {
      showSettingsHub();
      return;
    }
    if (!["orders", "history", "menu", "offers", "settings", "users"].includes(name)) return;
    const dashboard = $("#dashboard");
    if (!dashboard) return;
    hideAdminSections();
    dashboard.classList.remove("hub-home");
    const panel = $("#tab-" + name);
    if (panel) panel.classList.remove("hidden");
    if (name === "users") void loadStaffUsers();
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
    if (accessMode !== "owner") {
      toast("Owner password is required to open management.");
      return;
    }
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
    if (!currentUser || !selectedDb) return false;

    const { data, error } = await db.rpc("is_current_user_admin");

    if (error) throw error;

    return Boolean(data);
  }

  async function currentStaffRole() {
    if (!currentUser || !selectedDb) return null;
    const { data, error } = await db.rpc("get_my_staff_role");
    if (error) throw error;
    return data || null;
  }

  async function loadStaffUsers() {
    if (accessMode !== "owner" || !selectedDb) {
      toast("Owner access is required to manage users.");
      return;
    }
    const list = $("#staff-user-list");
    list.innerHTML = '<p class="muted">Loading team accounts…</p>';
    try {
      const result = await invokeStaffUsers(selectedDb, { action: "list" });
      const users = Array.isArray(result.users) ? result.users : [];
      if (!users.length) {
        list.innerHTML = '<p class="muted">No username accounts are registered yet.</p>';
        return;
      }
      list.innerHTML = users.map(user => {
        const owner = user.role === "owner";
        const active = Boolean(user.is_active);
        const statusLabel = active ? "Active" : "Disabled";
        const roleLabel = owner ? "Administration" : user.role === "cashier" ? "Cashier" : "Inactive legacy role";
        const actions = owner
          ? '<span class="muted">Owner account</span>'
          : '<div class="user-access-actions">' +
            '<button class="btn btn-light" type="button" data-staff-user-action="reset" data-user-id="' + esc(user.user_id) + '">Change password</button>' +
            '<button class="btn btn-light" type="button" data-staff-user-action="toggle" data-user-id="' + esc(user.user_id) + '" data-active="' + String(active) + '">' + (active ? "Disable" : "Enable") + '</button>' +
            '</div>';
        return '<article class="user-access-row"><div><strong>' + esc(user.full_name) + '</strong><small>@' +
          esc(user.username) + ' · ' + esc(roleLabel) + ' · ' + esc(statusLabel) +
          '</small></div>' + actions + '</article>';
      }).join("");
    } catch (error) {
      console.error("Could not load staff users:", error);
      list.innerHTML = '<p class="status-message error">' + esc(error.message || "Could not load users.") + '</p>';
    }
  }

  $("#staff-user-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (accessMode !== "owner") return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#staff-user-message");
    const username = String(form.elements.username.value || "").trim().toLowerCase();
    const fullName = String(form.elements.full_name.value || "").trim();
    const password = String(form.elements.password.value || "");
    const role = form.elements.role.value;
    if (password.length < 6) {
      message.textContent = "Use a password with at least 6 characters.";
      message.className = "status-message error";
      return;
    }
    button.disabled = true;
    message.textContent = "Creating the staff account…";
    message.className = "status-message";
    try {
      await invokeStaffUsers(selectedDb, { action: "create", username, full_name: fullName, password, role });
      form.reset();
      message.textContent = "Staff account created. Give the username and temporary password directly to that employee.";
      message.className = "status-message success";
      await loadStaffUsers();
    } catch (error) {
      console.error("Staff account creation failed:", error);
      message.textContent = error.message || "Could not create the staff account.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  $("#refresh-staff-users")?.addEventListener("click", () => void loadStaffUsers());

  $("#staff-user-list")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-staff-user-action]");
    if (!button || accessMode !== "owner") return;
    const userId = button.dataset.userId;
    if (button.dataset.staffUserAction === "reset") {
      const form = $("#staff-password-form");
      form.classList.remove("hidden");
      form.elements.user_id.value = userId;
      form.elements.password.value = "";
      form.elements.confirm_password.value = "";
      $("#staff-password-message").textContent = "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.elements.password.focus();
      return;
    }
    const active = button.dataset.active === "true";
    if (!window.confirm(active ? "Disable this staff account?" : "Enable this staff account?")) return;
    button.disabled = true;
    try {
      await invokeStaffUsers(selectedDb, { action: "set_active", user_id: userId, is_active: !active });
      await loadStaffUsers();
      toast(active ? "Staff account disabled." : "Staff account enabled.");
    } catch (error) {
      console.error("Staff account access update failed:", error);
      toast(error.message || "Could not update the staff account.");
      button.disabled = false;
    }
  });

  $("#staff-password-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (accessMode !== "owner") return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const password = String(form.elements.password.value || "");
    const message = $("#staff-password-message");
    if (password.length < 6) {
      message.textContent = "Use a password with at least 6 characters.";
      message.className = "status-message error";
      return;
    }
    if (password !== form.elements.confirm_password.value) {
      message.textContent = "The passwords do not match.";
      message.className = "status-message error";
      return;
    }
    button.disabled = true;
    message.textContent = "Saving password…";
    message.className = "status-message";
    try {
      await invokeStaffUsers(selectedDb, { action: "reset_password", user_id: form.elements.user_id.value, password });
      form.reset();
      form.classList.add("hidden");
      toast("Staff password updated.");
    } catch (error) {
      console.error("Staff password update failed:", error);
      message.textContent = error.message || "Could not update the password.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  $("#cancel-staff-password")?.addEventListener("click", () => {
    $("#staff-password-form")?.reset();
    $("#staff-password-form")?.classList.add("hidden");
  });

  function showPasswordRecoveryRequest(email = "", returnToDashboard = false) {
    recoveryReturnToDashboard = returnToDashboard;
    $("#login-panel")?.classList.add("hidden");
    $("#dashboard")?.classList.add("hidden");
    $("#password-recovery-panel")?.classList.remove("hidden");
    $("#password-recovery-request-form")?.classList.remove("hidden");
    $("#password-recovery-set-form")?.classList.add("hidden");
    $("#password-recovery-request-form").elements.email.value = email;
    $("#password-recovery-message").textContent = "";
    $("#password-recovery-message").className = "status-message";
    $("#password-recovery-title").textContent = "Reset password";
    $("#password-recovery-description").textContent =
      "Enter the email for the account. If it exists, we’ll send a secure reset link.";
  }

  function showPasswordRecoverySet() {
    recoveryReturnToDashboard = false;
    $("#login-panel")?.classList.add("hidden");
    $("#dashboard")?.classList.add("hidden");
    $("#password-recovery-panel")?.classList.remove("hidden");
    $("#password-recovery-request-form")?.classList.add("hidden");
    $("#password-recovery-set-form")?.classList.remove("hidden");
    $("#password-recovery-message").textContent = "";
    $("#password-recovery-title").textContent = "Choose a new password";
    $("#password-recovery-description").textContent =
      "Use at least 8 characters. This updates only the account that requested the reset.";
    history.replaceState({}, document.title, window.location.pathname);
  }

  document.querySelectorAll("[data-open-password-recovery]").forEach(button => {
    button.addEventListener("click", () => {
      const email = button.closest("form")?.elements.email?.value || "";
      showPasswordRecoveryRequest(email, Boolean(currentUser && accessMode === "staff"));
    });
  });

  $("#password-recovery-back")?.addEventListener("click", () => {
    $("#password-recovery-panel")?.classList.add("hidden");
    if (recoveryReturnToDashboard && currentUser) {
      $("#dashboard")?.classList.remove("hidden");
      setAccessMode("staff");
      hideAdminSections();
      $("#tab-orders")?.classList.remove("hidden");
    } else {
      $("#login-panel")?.classList.remove("hidden");
    }
  });

  $("#password-recovery-request-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#password-recovery-message");
    button.disabled = true;
    message.textContent = "Sending reset link…";
    message.className = "status-message";
    const redirectTo = new URL(window.location.pathname, window.location.origin);
    redirectTo.searchParams.set("password_recovery", "1");
    try {
      const { error } = await staffDb.auth.resetPasswordForEmail(form.elements.email.value.trim(), {
        redirectTo: redirectTo.toString()
      });
      if (error) throw error;
      message.textContent = "If an account uses that email, a reset link has been sent.";
      message.className = "status-message success";
    } catch (error) {
      message.textContent = error.message || "Could not send the reset link.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  $("#password-recovery-set-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#password-recovery-message");
    const password = form.elements.password.value;
    if (password !== form.elements.confirm_password.value) {
      message.textContent = "The passwords do not match.";
      message.className = "status-message error";
      return;
    }
    button.disabled = true;
    message.textContent = "Saving password…";
    message.className = "status-message";
    try {
      const { error } = await staffDb.auth.updateUser({ password });
      if (error) throw error;
      await staffDb.auth.signOut();
      form.reset();
      $("#password-recovery-panel")?.classList.add("hidden");
      $("#login-panel")?.classList.remove("hidden");
      $("#login-message").textContent = "Password updated. Sign in with your new password.";
      $("#login-message").className = "status-message success";
    } catch (error) {
      message.textContent = error.message || "Could not update the password.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  function setAccessMode(mode) {
    accessMode = mode;
    document.body.dataset.accessMode = mode;
    $("#staff-owner-lock")?.classList.toggle("hidden", mode !== "staff");
    const lockButton = $("#lock-admin");
    if (lockButton) lockButton.classList.toggle("hidden", mode !== "owner");
    const header = $("#dashboard .dashboard-heading");
    const heading = header?.querySelector("h1");
    const subtitle = header?.querySelector(".muted");
    if (mode === "staff") {
      if (heading) heading.textContent = "Active orders";
      if (subtitle) subtitle.textContent = "Orders currently being prepared or delivered.";
      hideAdminSections();
      $("#tab-orders")?.classList.remove("hidden");
      $("#receipt-confirm-form")?.classList.add("hidden");
      $("#export-orders")?.classList.add("hidden");
      $("#order-filter option[value=\"rejected\"]")?.remove();
    } else if (mode === "owner") {
      if (heading) heading.textContent = "Restaurant overview";
      if (subtitle) subtitle.textContent = "Live orders, menu and restaurant operations.";
      $("#receipt-confirm-form")?.classList.remove("hidden");
      $("#export-orders")?.classList.remove("hidden");
      if (!$("#order-filter option[value=\"rejected\"]")) {
        const option = document.createElement("option");
        option.value = "rejected";
        option.textContent = "Rejected";
        $("#order-filter")?.append(option);
      }
      showAdminHome();
    }
  }

  async function showDashboard() {
    const authorized = await isAdmin();

    if (authorized) {
      // An owner session must only exist in the non-persistent owner client.
      if (selectedDb === staffDb) {
        await staffDb.auth.signOut();
        currentUser = null;
        $("#login-message").textContent = "Owner session cleared. Sign in again to unlock management.";
        $("#login-message").className = "status-message";
        return;
      }
      accessMode = "owner";
    } else {
      const role = await currentStaffRole();
      if (role !== "cashier") {
        await selectedDb.auth.signOut();
        currentUser = null;
        $("#login-message").textContent = "This account is not enabled for active order access.";
        $("#login-message").className = "status-message error";
        return;
      }
      currentRole = role;
      accessMode = "staff";
    }

    $("#login-panel").classList.add("hidden");
    $("#user-picker-panel")?.classList.add("hidden");
    $("#owner-user-bootstrap")?.classList.add("hidden");
    $("#password-recovery-panel")?.classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    setAccessMode(accessMode);
    if (accessMode === "staff") {
      hideAdminSections();
      $("#tab-orders")?.classList.remove("hidden");
    }
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
        if (!selectedDb || !currentUser) return;
        try {
          await loadOrders();
        } catch (error) {
          console.warn("Incoming-order polling failed:", error);
        }
      }, 5000);
    }
  }

  async function start() {
    if (!selectedDb) {
      setConnection("Setup required");
      $("#login-message").textContent =
        "Check the Supabase URL and public key in config.js.";
      return;
    }

    try {
      if (new URLSearchParams(window.location.search).get("password_recovery") === "1") {
        const { data: recoverySession } = await staffDb.auth.getSession();
        if (recoverySession?.session) {
          showPasswordRecoverySet();
          return;
        }
      }

      // Restore the last signed-in role first. The two profiles use isolated
      // storage keys, so an owner session cannot be mistaken for a cashier.
      const { data: ownerData, error: ownerError } = await ownerDb.auth.getSession();
      if (ownerError) throw ownerError;
      if (ownerData.session) {
        selectedDb = ownerDb;
        currentUser = ownerData.session.user;
        currentRole = "owner";
        await showDashboard();
        if (accessMode === "owner") return;
      }

      const { data: staffData, error: staffError } = await staffDb.auth.getSession();
      if (staffError) throw staffError;
      if (staffData.session) {
        selectedDb = staffDb;
        currentUser = staffData.session.user;
        currentRole = null;
        await showDashboard();
        if (accessMode === "staff") return;
      }

      selectedDb = staffDb;
      currentUser = null;
      currentRole = null;
      if (isDeviceSetupComplete()) {
        setConnection("Choose a user");
        showUserPicker();
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

    if (!selectedDb) {
      toast("Supabase is not connected.");
      return;
    }

    // Prepare audio during the sign-in gesture; notification permission is requested after admin access is confirmed.
    initializeOrderAlerts(true);

    const loginForm = event.currentTarget;
    const form = new FormData(loginForm);

    const credentials = {
      email: form.get("email"),
      password: form.get("password")
    };
    const { data, error } = await staffDb.auth.signInWithPassword(credentials);

    if (error) {
      status(error.message, "#login-message", true);
      return;
    }

    currentUser = data.user;

    try {
      const { data: adminFlag, error: adminError } = await staffDb.rpc("is_current_user_admin");
      if (adminError) throw adminError;
      if (adminFlag) {
        await staffDb.auth.signOut();
        const { data: ownerData, error: ownerError } = await ownerDb.auth.signInWithPassword(credentials);
        if (ownerError) throw ownerError;
        selectedDb = ownerDb;
        currentUser = ownerData.user;
        loginForm.reset();
        if (isDeviceSetupComplete()) {
          // Keep the owner's persisted session and enter the dashboard directly.
          await showDashboard();
        } else {
          showOwnerUserBootstrap();
        }
        return;
      } else {
        selectedDb = staffDb;
      }
      loginForm.reset();
      await showDashboard();
    } catch (error) {
      console.error("Login error:", error);
      status(error.message, "#login-message", true);
    }
  };

  $("#owner-user-bootstrap-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#owner-user-bootstrap-message");
    const username = String(form.elements.username.value || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
      message.textContent = "Use 3–30 characters: letters, numbers, dot, underscore, or dash.";
      message.className = "status-message error";
      return;
    }
    button.disabled = true;
    message.textContent = "Saving your admin username…";
    message.className = "status-message";
    try {
      await invokeStaffUsers(ownerDb, { action: "bootstrap_owner", username });
      await ownerDb.auth.signOut();
      await staffDb.auth.signOut();
      localStorage.setItem(DEVICE_SETUP_KEY, "ready");
      currentUser = null;
      currentRole = null;
      selectedDb = staffDb;
      setConnection("Choose a user");
      showUserPicker();
    } catch (error) {
      console.error("Admin username setup failed:", error);
      message.textContent = error.message || "Could not save the admin username.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-user-role]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-user-role]").forEach(item => item.setAttribute("aria-pressed", "false"));
      button.setAttribute("aria-pressed", "true");
      const form = $("#role-login-form");
      form.elements.role_type.value = button.dataset.userRole;
      form.classList.remove("hidden");
      $("#role-login-message").textContent = "";
      form.elements.username.focus();
    });
  });

  $("#role-login-back")?.addEventListener("click", () => {
    $("#role-login-form")?.classList.add("hidden");
    $("#role-login-form")?.reset();
    document.querySelectorAll("[data-user-role]").forEach(item => item.setAttribute("aria-pressed", "false"));
  });

  $("#role-login-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#role-login-message");
    const requestedRole = form.elements.role_type.value;
    const username = String(form.elements.username.value || "").trim().toLowerCase();
    const password = String(form.elements.password.value || "");
    button.disabled = true;
    message.textContent = "Checking user access…";
    message.className = "status-message";
    try {
      const result = await invokeStaffUsers(staffDb, { action: "login", username, password });
      const isOwnerLogin = result.role === "owner";
      if ((requestedRole === "owner") !== isOwnerLogin) {
        throw new Error("That account does not match the selected user type.");
      }
      const roleDb = isOwnerLogin ? ownerDb : staffDb;
      const otherDb = isOwnerLogin ? staffDb : ownerDb;
      await otherDb.auth.signOut();
      const { data, error } = await roleDb.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token
      });
      if (error) throw error;
      selectedDb = roleDb;
      currentUser = data.user;
      currentRole = isOwnerLogin ? "owner" : result.role;
      form.elements.password.value = "";
      await showDashboard();
    } catch (error) {
      console.error("User sign-in failed:", error);
      message.textContent = error.message || "Could not sign in to this user.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  $("#signout").onclick = async () => {
    if (selectedDb) await selectedDb.auth.signOut();
    location.reload();
  };

  $("#owner-unlock-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (accessMode !== "staff") return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#owner-unlock-message");
    const credentials = {
      email: form.elements.email.value.trim(),
      password: form.elements.password.value
    };
    button.disabled = true;
    message.textContent = "Checking owner access…";
    message.className = "status-message full";
    try {
      const { data, error } = await ownerDb.auth.signInWithPassword(credentials);
      form.elements.password.value = "";
      if (error) throw error;
      const { data: adminFlag, error: roleError } = await ownerDb.rpc("is_current_user_admin");
      if (roleError) throw roleError;
      if (!adminFlag) throw new Error("This account is not registered as the owner.");
      selectedDb = ownerDb;
      currentUser = data.user;
      currentRole = "owner";
      setAccessMode("owner");
      message.textContent = "";
      $("#staff-owner-lock")?.classList.add("hidden");
      $("#login-panel")?.classList.add("hidden");
      await refreshAll();
      toast("Owner management unlocked.");
    } catch (error) {
      await ownerDb.auth.signOut();
      selectedDb = staffDb;
      const { data: staffSession } = await staffDb.auth.getUser();
      currentUser = staffSession.user;
      currentRole = currentUser ? await currentStaffRole() : null;
      setAccessMode(currentUser ? "staff" : "signed-out");
      if (currentUser) {
        hideAdminSections();
        $("#tab-orders")?.classList.remove("hidden");
      }
      message.textContent = error.message || "Could not unlock management.";
      message.className = "status-message full error";
    } finally {
      button.disabled = false;
    }
  });

  $("#lock-admin")?.addEventListener("click", async () => {
    if (accessMode !== "owner") return;
    await ownerDb.auth.signOut();
    const { data } = await staffDb.auth.getUser();
    if (!data.user) {
      location.reload();
      return;
    }
    selectedDb = staffDb;
    currentUser = data.user;
    currentRole = await currentStaffRole();
    setAccessMode("staff");
    hideAdminSections();
    $("#tab-orders")?.classList.remove("hidden");
    await refreshAll();
    toast("Management locked. Active orders are available to staff.");
  });

  // Refresh button: loading state, error handling, and recovery.
  $("#refresh").onclick = async () => {
    const button = $("#refresh");

    if (!selectedDb) {
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
  $("#order-type-filter")?.addEventListener("change", renderOrders);
  $("#clear-order-filters")?.addEventListener("click", () => {
    if ($("#order-filter")) $("#order-filter").value = "all";
    if ($("#order-type-filter")) $("#order-type-filter").value = "all";
    if ($("#order-search")) $("#order-search").value = "";
    renderOrders();
    $("#order-search")?.focus();
  });
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
    if (!selectedDb) throw new Error("Supabase is not connected.");

    if (accessMode === "staff") {
      await loadOrders();
      return;
    }

    const results = await Promise.allSettled([
      loadOrders(),
      loadProducts(),
      loadOffers(),
      loadSettings(),
      loadMenuReviews(),
      loadDeliveryZones()
    ]);

    const failed = results
      .map((result, index) => ({
        result,
        name: ["orders", "menu", "offers", "settings", "reviews", "delivery zones"][index]
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
    try {
      await loadDeliveryRiderDirectory();
    } catch (riderDirectoryError) {
      // Rider names are supplementary; never block the core order dashboard on this lookup.
      console.warn("Could not load rider directory:", riderDirectoryError);
      deliveryRiderDirectory = [];
    }

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
    const typeFilter = $("#order-type-filter")?.value || "all";
    const query = String($("#order-search")?.value || "").trim().toLowerCase();

    return orders.filter(order => {
      const matchesStatus = filter === "all" || order.status === filter;
      const matchesType = typeFilter === "all" || order.order_type === typeFilter;
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
      return matchesStatus && matchesType && (!query || searchable.includes(query));
    });
  }

  function compareQueuePriority(a, b) {
    const aIsNew = a.status === "new", bIsNew = b.status === "new";
    if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;
    const aCreated = Date.parse(a.created_at || "") || 0;
    const bCreated = Date.parse(b.created_at || "") || 0;
    return aIsNew ? aCreated - bCreated : bCreated - aCreated;
  }

  function formatOrderAge(elapsedMs) {
    const minutes = Math.floor(Math.max(0, elapsedMs) / 60000);
    if (minutes < 60) return minutes + "m";
    return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  }

  function formatGhanaDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Accra"
    }).format(date);
  }


  function updateOrderWaitBadges() {
    const now = Date.now();
    document.querySelectorAll("[data-order-created-at]").forEach(badge => {
      const createdAt = Date.parse(badge.dataset.orderCreatedAt || "");
      if (!Number.isFinite(createdAt)) {
        badge.textContent = "Time unavailable";
        return;
      }
      const elapsedMs = Math.max(0, now - createdAt);
      const isNew = badge.closest(".order-card")?.classList.contains("is-new");
      const overdue = Boolean(isNew && elapsedMs >= NEW_ORDER_ATTENTION_MS);
      const ageText = formatOrderAge(elapsedMs);
      badge.textContent = (isNew ? "Waiting " : "Age ") + ageText;
      badge.classList.toggle("is-overdue", overdue);
      badge.closest(".order-card")?.classList.toggle("is-overdue", overdue);
      badge.setAttribute("aria-label", overdue ? "Waiting " + ageText + "; needs attention" : (isNew ? "Waiting " : "Order age ") + ageText);
    });
  }

  function primaryOrderAction(order) {
    const allowed = (window.AL_SHAMI_ORDER_WORKFLOW?.nextStatuses(order) || []).filter(value =>
      accessMode === "owner" ||
      (currentRole === "cashier" && ["accepted", "rejected", "preparing", "ready"].includes(value))
    );
    return ["accepted", "preparing", "ready", "out_for_delivery", "completed", "rejected"].find(value => allowed.includes(value)) || "";
  }

  window.setInterval(updateOrderWaitBadges, 15000);

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

  function printOrderReceipt(order) {
    const popup = window.open("", "_blank", "popup,width=440,height=760");
    if (!popup) {
      toast("Allow pop-ups to print the order receipt.");
      return;
    }
    const rows = (order.order_items || []).map(item => {
      const name = item.item_name || item.menu_items?.name || "Menu item";
      const amount = Number(item.unit_price) * Number(item.quantity);
      return "<tr><td>" + Number(item.quantity) + " × " + esc(name) +
        (item.item_note ? "<small>" + esc(item.item_note) + "</small>" : "") +
        "</td><td>" + money(amount) + "</td></tr>";
    }).join("");
    const type = order.order_type === "delivery" ? "Delivery" : "Pickup";
    const statusLabel = window.AL_SHAMI_ORDER_WORKFLOW?.label(order.status) || order.status;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AL SHAMI Order #${esc(order.order_number || order.id.slice(0,8))}</title><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;color:#21191a;font:14px/1.45 Arial,sans-serif}.receipt{max-width:390px;margin:auto}.brand{text-align:center;border-bottom:2px solid #641622;padding-bottom:14px}.brand h1{margin:0;color:#641622;font-size:24px}.brand p{margin:4px 0;color:#5c5555}.meta{display:grid;gap:5px;padding:13px 0;border-bottom:1px solid #ddd}.meta strong{color:#641622}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:9px 2px;border-bottom:1px solid #e7e2dc;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}td small{display:block;color:#655;font-size:12px}.totals{border-top:2px solid #641622;padding-top:9px}.totals div{display:flex;justify-content:space-between;padding:3px 0}.totals .grand{font-size:18px;font-weight:800}.foot{margin-top:18px;text-align:center;color:#655;font-size:12px}@media print{body{padding:0}.receipt{max-width:none}}
    </style></head><body><main class="receipt"><header class="brand"><h1>AL SHAMI RESTAURANT</h1><p>Darkuman Circle Station, Accra</p><strong>ORDER RECEIPT</strong></header><section class="meta"><div>Order: <strong>#${esc(order.order_number || order.id.slice(0,8))}</strong></div><div>Received: ${esc(formatGhanaDateTime(order.created_at))}</div><div>Customer: ${esc(order.customer_name || "—")}</div><div>Phone: ${esc(order.customer_phone || "—")}</div><div>Type: ${type}</div><div>Status: ${esc(statusLabel)}</div>${order.delivery_address ? "<div>Address: " + esc(order.delivery_address) + "</div>" : ""}${order.notes ? "<div>Notes: " + esc(order.notes) + "</div>" : ""}</section><table><tbody>${rows}</tbody></table><section class="totals"><div><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div><span>Delivery</span><span>${money(order.delivery_fee)}</span></div><div class="grand"><span>Total</span><span>${money(order.total)}</span></div></section><footer class="foot">Cash payment at ${type === "Delivery" ? "delivery" : "pickup"}. Thank you for choosing AL SHAMI.</footer></main></body></html>`);
    popup.document.close();
    popup.addEventListener("afterprint", () => popup.close(), { once: true });
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  }

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest("[data-print-order]") : null;
    if (!button) return;
    const order = orders.find(item => String(item.id) === String(button.dataset.printOrder));
    if (order) printOrderReceipt(order);
  });

  function renderOrders() {
    const selectedOrderFilter = $("#order-filter")?.value || "all";
    const filteredOrders = visibleOrders().filter(order =>
      order.status !== "completed" && (order.status !== "rejected" || selectedOrderFilter === "rejected")
    ).sort(compareQueuePriority);
    const activeOrderCount = orders.filter(order => !["completed", "rejected"].includes(order.status)).length;
    const resultsCount = $("#order-results-count");
    if (resultsCount) resultsCount.textContent = "Showing " + filteredOrders.length + " " + (filteredOrders.length === 1 ? "order" : "orders") + " · " + activeOrderCount + " active overall";

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
                ${formatGhanaDateTime(order.created_at)}
                · ${esc(order.customer_name)}
                · ${esc(order.customer_phone)}${order.updated_at ? " · Updated " + esc(formatGhanaDateTime(order.updated_at)) : ""}
                · <span class="order-wait-badge" data-order-created-at="${esc(order.created_at)}"></span>
              </div>
            </div>

            <span class="order-status">${esc(window.AL_SHAMI_ORDER_WORKFLOW?.label(order.status) || order.status)}</span>
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
            ${order.requested_for ? "<br>Scheduled: " + esc(formatGhanaDateTime(order.requested_for)) : ""}
            ${order.estimated_ready_at ? "<br>Estimated ready/delivery: " + esc(formatGhanaDateTime(order.estimated_ready_at)) : ""}
            ${order.delivery_zone_id ? "<br>Zone: " + esc(deliveryZones.find(zone => zone.id === order.delivery_zone_id)?.name || "") : ""}
            ${deliveryMapLink(order) ? "<br>" + deliveryMapLink(order) : ""}
          </p>
          ${deliveryRiderAssignmentMarkup(order)}

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
                  ${item.item_note ? '<small class="order-item-note">Note: ' + esc(item.item_note) + '</small>' : ""}
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
              <select data-status="${order.id}"
                aria-label="Next action for order ${esc(order.order_number || order.id.slice(0, 8))}">
                <option value="">Choose next step…</option>
                ${(window.AL_SHAMI_ORDER_WORKFLOW?.nextStatuses(order) || [])
                  .filter(value => accessMode === "owner" || (currentRole === "cashier" && ["accepted","rejected","preparing","ready"].includes(value)))
                  .map(value => `
                  <option value="${value}">${esc(window.AL_SHAMI_ORDER_WORKFLOW.actionLabel(value))}</option>
                `).join("")}
              </select>

              ${primaryOrderAction(order) ? `<button class="btn btn-primary order-quick-action" data-quick-order="${esc(order.id)}" data-quick-status="${esc(primaryOrderAction(order))}" type="button">${esc(window.AL_SHAMI_ORDER_WORKFLOW.actionLabel(primaryOrderAction(order)))}</button>` : ""}
              <button class="btn btn-light" data-copy="${order.id}">
                Copy details
              </button>
              <button class="btn btn-light" data-print-order="${esc(order.id)}" type="button">Print receipt</button>
              ${accessMode === "owner" ? `<button class="btn delete-order-btn" data-delete-order="${order.id}" type="button">Delete order</button>` : ""}
            </div>
          </div>
        </article>
      `).join("")
      : '<p class="muted">No orders in this view.</p>';

    updateOrderWaitBadges();
    $("#orders-list")
      .querySelectorAll("[data-status]")
      .forEach(select => {
        select.onchange = () => {
          const nextStatus = select.value;
          if (!nextStatus) return;
          if (nextStatus === "rejected" && !window.confirm("Reject this new order? The customer will be notified.")) {
            select.value = "";
            return;
          }
          select.disabled = true;
          void updateStatus(select.dataset.status, nextStatus).finally(() => {
            if (select.isConnected) select.disabled = false;
          });
        };
      });

    $("#orders-list").querySelectorAll("[data-quick-order]").forEach(button => {
      button.onclick = () => {
        const nextStatus = button.dataset.quickStatus;
        if (!nextStatus) return;
        if (nextStatus === "rejected" && !window.confirm("Reject this new order? The customer will be notified.")) return;
        button.disabled = true;
        void updateStatus(button.dataset.quickOrder, nextStatus).finally(() => {
          if (button.isConnected) button.disabled = false;
        });
      };
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
        <div class="order-header"><div><h3>Order #${esc(order.order_number || order.id.slice(0, 8))}</h3><div class="order-meta">${formatGhanaDateTime(order.created_at)} · ${esc(order.customer_name)} · ${esc(order.customer_phone)}${order.updated_at ? " · Updated " + esc(formatGhanaDateTime(order.updated_at)) : ""}</div></div><span class="order-status">${esc(order.status === "rejected" ? "Rejected" : "Completed")}</span></div>
        <p><strong>${order.order_type === "delivery" ? "Delivery" : "Pickup"}</strong>${order.delivery_address ? " · " + esc(order.delivery_address) : ""}${order.notes ? "<br>Notes: " + esc(order.notes) : ""}</p>
        <ul class="order-lines">${(order.order_items || []).map(item => `<li><span>${Number(item.quantity)} × ${esc(item.item_name || item.menu_items?.name || "Menu item")}</span><strong>${money(Number(item.unit_price) * Number(item.quantity))}</strong></li>`).join("")}</ul>
        <div class="order-footer"><div><strong>${money(order.total)}</strong><div class="order-meta">Subtotal ${money(order.subtotal)} · Delivery ${money(order.delivery_fee)}</div></div><div class="order-actions"><button class="btn btn-light" data-history-copy="${order.id}">Copy details</button><button class="btn btn-light" data-print-order="${esc(order.id)}" type="button">Print receipt</button><button class="btn delete-order-btn" data-delete-order="${order.id}" type="button">Delete order</button></div></div>
      </article>`).join("") : '<p class="muted">No completed or rejected orders in history yet.</p>';
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
    if (currentUser && selectedDb) {
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
      field("Time received", formatGhanaDateTime(order.created_at)) +
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
      toast(
        updated.smsFailed
          ? (status === "accepted" ? "Order accepted, but the customer SMS failed." : "Order rejected, but the customer SMS failed.")
          : updated.smsSent
            ? (status === "accepted" ? "Order accepted and customer SMS sent." : "Order rejected and customer SMS sent.")
            : (status === "accepted" ? "Order accepted." : "Order rejected.")
      );
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

      let receiptSmsFailed = false;
      try {
        const { error: smsError } = await db.functions.invoke("notify-order-status", {
          body: { orderNumber, status: "completed" }
        });
        if (smsError) throw smsError;
      } catch (smsError) {
        receiptSmsFailed = true;
        console.warn("Receipt was confirmed, but its SMS notification failed:", smsError);
      }


      try {
        const { error: pushError } = await db.functions.invoke("customer-push", {
          body: { action: "order-status", orderNumber, status: "completed" }
        });
        if (pushError) throw pushError;
      } catch (pushError) {
        console.warn("Receipt was confirmed, but the customer push notification failed:", pushError);
      }

      if (message) {
        message.textContent = receiptSmsFailed
          ? "Receipt confirmed and moved to History, but the customer SMS could not be sent."
          : "Receipt confirmed. Customer notified by SMS; order moved to History.";
        message.className = "status-message success";
      }
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
      const previousStatus = orders.find(item => item.id === id)?.status;
      let error;
      if (accessMode === "owner") {
        ({ error } = await db.rpc("admin_transition_order_status", {
          p_order_id: id,
          p_status: newStatus
        }));
      } else {
        if (currentRole === "cashier" && ["accepted", "rejected", "preparing", "ready"].includes(newStatus)) {
          const reason = newStatus === "rejected" ? window.prompt("Reason for rejecting this order:") : (newStatus === "accepted" ? "Accepted by staff" : "Status updated by cashier");
          if (reason === null) return false;
          ({ error } = await db.rpc("cashier_set_order_status", {
            p_order_id: id,
            p_status: newStatus,
            p_reason: reason
          }));
        } else {
          throw new Error("Ask the owner to complete this order step.");
        }
      }

      if (error) throw error;

      let smsSent = false;
      let smsFailed = false;
      const smsStatuses = ["accepted", "preparing", "ready", "out_for_delivery", "rejected"];
      if (previousStatus !== newStatus && smsStatuses.includes(newStatus)) {
        try {
          const { error: smsError } = await db.functions.invoke("notify-order-status", {
            body: { orderId: id, status: newStatus }
          });
          if (smsError) throw smsError;
          smsSent = true;
        } catch (smsError) {
          smsFailed = true;
          console.warn("Order status saved, but customer SMS failed:", smsError);
        }
      }


      let pushFailed = false;
      if (previousStatus !== newStatus && smsStatuses.includes(newStatus)) {
        try {
          const { error: pushError } = await db.functions.invoke("customer-push", {
            body: { action: "order-status", orderId: id, status: newStatus }
          });
          if (pushError) throw pushError;
        } catch (pushError) {
          pushFailed = true;
          console.warn("Order status saved, but customer push notification failed:", pushError);
        }
      }

      toast(
        smsFailed
          ? "Order status updated, but the customer SMS could not be sent."
          : smsSent
            ? "Order status updated and customer SMS sent."
            : "Order status updated."
      );
      await loadOrders();
      if (!options.fromIncomingDialog && id === activeIncomingOrderId && ["accepted","rejected"].includes(newStatus)) {
        incomingOrderQueue.splice(0, incomingOrderQueue.length, ...incomingOrderQueue.filter(itemId => itemId !== id));
        closeIncomingOrderDialog();
        showNextIncomingOrder();
      }
      return { ok: true, smsSent, smsFailed };
    } catch (error) {
      console.error("Status update failed:", error);
      toast("Could not update status: " + (error.message || "Unknown error"));
      return false;
    }
  }

  function subscribe() {
    if (!selectedDb) return;
    if (liveOrdersChannel && liveOrdersClient === selectedDb) return;
    if (liveOrdersChannel && liveOrdersClient) {
      const previousChannel = liveOrdersChannel;
      const previousClient = liveOrdersClient;
      liveOrdersChannel = null;
      liveOrdersClient = null;
      void previousClient.removeChannel(previousChannel).catch(error => {
        console.warn("Could not close the previous live orders subscription:", error);
      });
    }

    const client = selectedDb;
    const channel = client.channel("al-shami-live-orders")
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
      );
    liveOrdersChannel = channel;
    liveOrdersClient = client;
    try {
      channel.subscribe(state => {
        if (liveOrdersChannel !== channel) return;
        if (["CLOSED", "CHANNEL_ERROR", "TIMED_OUT"].includes(state)) {
          liveOrdersChannel = null;
          liveOrdersClient = null;
        }
        setConnection(
          state === "SUBSCRIBED"
            ? "Live · Realtime connected"
            : "Live connection: " + state
        );
      });
    } catch (error) {
      liveOrdersChannel = null;
      liveOrdersClient = null;
      console.error("Could not start live order updates:", error);
      setConnection("Live updates unavailable · checking every 5 seconds");
    }
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

    const featureCheck = await db.from("menu_items")
      .select("prep_minutes,ingredients,portion_info,spice_level,allergens")
      .limit(1);
    menuFeatureColumnsAvailable = !featureCheck.error;
    ["ingredients", "portion_info", "prep_minutes", "spice_level", "allergens"].forEach(name => {
      const field = $("#product-form")?.elements?.[name];
      if (field) field.disabled = !menuFeatureColumnsAvailable;
    });
    products = data || [];
    refreshOfferProductOptions();

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
            ${product.prep_minutes ? " · " + esc(product.prep_minutes) + " min prep" : ""}
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
            ingredients: product.ingredients || "",
            portion_info: product.portion_info || "",
            prep_minutes: product.prep_minutes || "",
            spice_level: product.spice_level == null ? "" : String(product.spice_level),
            allergens: Array.isArray(product.allergens) ? product.allergens.join(", ") : "",
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
    if (menuFeatureColumnsAvailable) {
      data.ingredients = form.elements.ingredients.value.trim() || null;
      data.portion_info = form.elements.portion_info.value.trim() || null;
      data.prep_minutes = form.elements.prep_minutes.value ? Number(form.elements.prep_minutes.value) : null;
      data.spice_level = form.elements.spice_level.value === "" ? null : Number(form.elements.spice_level.value);
      data.allergens = form.elements.allergens.value.split(",").map(value => value.trim()).filter(Boolean);
    }

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

  function refreshOfferProductOptions() {
    const select = $("#offer-menu-items");
    if (!select) return;
    const selectedIds = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
    select.replaceChildren();
    products.forEach(product => {
      const option = document.createElement("option");
      option.value = String(product.id);
      option.textContent = String(product.name || "Menu item") + " · " + money(product.price);
      option.selected = selectedIds.has(option.value);
      select.append(option);
    });
  }

  function offerDateInputValue(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) return "";
    const date = new Date(value);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

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
            ${offer.starts_at ? "Starts " + esc(offerDateInputValue(offer.starts_at)) : "Start date not set"} ·
            ${offer.ends_at ? "Ends " + esc(offerDateInputValue(offer.ends_at)) : "End date not set"} ·
            ${offer.price != null ? "Price " + esc(money(Number(offer.price))) : "Price not set"} ·
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
          form.elements.price.value = offer.price == null ? "" : String(offer.price);
          form.elements.starts_at.value = offerDateInputValue(offer.starts_at);
          form.elements.ends_at.value = offerDateInputValue(offer.ends_at);
          const includedItems = new Set((offer.menu_item_ids || []).map(String));
          Array.from(form.elements.menu_item_ids.options).forEach(option => {
            option.selected = includedItems.has(option.value);
          });
          form.elements.is_active.checked = offer.is_active;
          form.dataset.offerWasActive = offer.is_active ? "true" : "false";
          form.dataset.offerEditing = "true";
          $("#offer-form-title").textContent = "Edit offer: " + offer.title;
          form.querySelector('button[type="submit"]').textContent = "Update offer";
          status("Offer loaded. Change the fields, then tap Update offer.", "#offer-message");
          form.scrollIntoView({ behavior: "smooth", block: "start" });
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
            if (!offer.is_active) {
              try { await db.functions.invoke("customer-push", { body: { action: "offer", offerId: offer.id } }); }
              catch (pushError) { console.warn("Offer activated, but customer push notification failed:", pushError); }
            }
            await loadOffers();
          }
        };
      });
  }

  $("#customer-announcement-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (accessMode !== "owner") return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = $("#customer-announcement-message");
    button.disabled = true;
    message.textContent = "Sending announcement…";
    message.className = "status-message";
    try {
      const { data, error } = await db.functions.invoke("customer-push", {
        body: { action: "announcement", title: form.elements.title.value.trim(), body: form.elements.body.value.trim() }
      });
      if (error) throw new Error(data?.error || error.message);
      if (data?.error) throw new Error(data.error);
      message.textContent = data?.sent ? "Announcement sent to " + data.sent + " device(s)." : "No customer devices have enabled promotion notifications yet.";
      message.className = "status-message success";
      form.reset();
    } catch (error) {
      message.textContent = error.message || "Could not send announcement.";
      message.className = "status-message error";
    } finally {
      button.disabled = false;
    }
  });

  $("#offer-form").onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const rawPrice = String(form.elements.price.value || "").trim();
    const offerPrice = Number(rawPrice);
    if (!rawPrice || !Number.isFinite(offerPrice) || offerPrice <= 0) {
      status("Enter an offer price greater than zero.", "#offer-message", true);
      form.elements.price.focus();
      return;
    }
    const startsOn = String(form.elements.starts_at.value || "").trim();
    const endsOn = String(form.elements.ends_at.value || "").trim();
    if (startsOn && endsOn && endsOn < startsOn) {
      status("The offer end date must be on or after its start date.", "#offer-message", true);
      return;
    }
    const selectedMenuItems = Array.from(form.elements.menu_item_ids.selectedOptions || []).map(option => option.value);
    const data = {
      title: form.elements.title.value.trim(),
      details: form.elements.details.value.trim() || null,
      price: Math.round(offerPrice * 100) / 100,
      is_active: form.elements.is_active.checked,
      starts_at: startsOn ? new Date(startsOn + "T00:00:00").toISOString() : null,
      ends_at: endsOn ? new Date(endsOn + "T23:59:59").toISOString() : null,
      menu_item_ids: selectedMenuItems
    };

    const id = form.elements.id.value;

    const wasActive = id ? form.dataset.offerWasActive === "true" : false;
    const result = id
      ? await db.from("offers").update(data).eq("id", id).select("id").maybeSingle()
      : await db.from("offers").insert(data).select("id").single();

    if (result.error) {
      status(result.error.message, "#offer-message", true);
      return;
    }

    if (data.is_active && (!id || !wasActive) && result.data?.id) {
      try {
        await db.functions.invoke("customer-push", { body: { action: "offer", offerId: result.data.id } });
      } catch (pushError) {
        console.warn("Offer saved, but customer push notification failed:", pushError);
      }
    }
    status("Offer saved.", "#offer-message");

    form.reset();
    form.elements.id.value = "";
    form.elements.is_active.checked = true;
    delete form.dataset.offerWasActive;
    delete form.dataset.offerEditing;
    $("#offer-form-title").textContent = "Create an offer";
    form.querySelector('button[type="submit"]').textContent = "Save offer";

    await loadOffers();
  };

  $("#cancel-offer").onclick = () => {
    const form = $("#offer-form");
    form.reset();
    form.elements.id.value = "";
    delete form.dataset.offerWasActive;
    delete form.dataset.offerEditing;
    $("#offer-form-title").textContent = "Create an offer";
    form.querySelector('button[type="submit"]').textContent = "Save offer";
    $("#offer-message").textContent = "";
    $("#offer-message").className = "status-message full";
  };

  let deliveryZones = [];

  async function loadDeliveryZones() {
    const list = $("#delivery-zones-list");
    if (!list) return;
    const { data, error } = await db.from("delivery_zones")
      .select("*")
      .order("radius_km");
    if (error) {
      deliveryZones = [];
      list.innerHTML = '<p class="muted">Zone editing becomes available after the optional database upgrade is applied.</p>';
      return;
    }
    deliveryZones = data || [];
    list.innerHTML = deliveryZones.length ? deliveryZones.map(zone => `
      <article class="admin-menu-row">
        <div class="grow">
          <strong>${esc(zone.name)} · ${money(zone.delivery_fee)}</strong>
          <small>Centre ${Number(zone.center_latitude).toFixed(5)}, ${Number(zone.center_longitude).toFixed(5)} · radius ${esc(zone.radius_km)} km · ${esc(zone.estimated_delivery_minutes || "—")} min travel · ${zone.is_active ? "Active" : "Inactive"}</small>
        </div>
        <button class="btn btn-light" data-edit-delivery-zone="${esc(zone.id)}">Edit</button>
      </article>
    `).join("") : '<p class="muted">No delivery zones configured; the existing single delivery fee is still used.</p>';
    list.querySelectorAll("[data-edit-delivery-zone]").forEach(button => {
      button.onclick = () => {
        const zone = deliveryZones.find(item => item.id === button.dataset.editDeliveryZone);
        if (!zone) return;
        const form = $("#delivery-zone-form");
        Object.entries(zone).forEach(([key, value]) => {
          const field = form.elements[key];
          if (!field) return;
          if (field.type === "checkbox") field.checked = Boolean(value);
          else field.value = value == null ? "" : value;
        });
        form.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
  }

  $("#delivery-zone-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = {
      name: form.elements.name.value.trim(),
      center_latitude: Number(form.elements.center_latitude.value),
      center_longitude: Number(form.elements.center_longitude.value),
      radius_km: Number(form.elements.radius_km.value),
      delivery_fee: Number(form.elements.delivery_fee.value),
      estimated_delivery_minutes: form.elements.estimated_delivery_minutes.value
        ? Number(form.elements.estimated_delivery_minutes.value) : null,
      is_active: form.elements.is_active.checked,
      updated_at: new Date().toISOString()
    };
    const id = form.elements.id.value;
    const result = id
      ? await db.from("delivery_zones").update(data).eq("id", id)
      : await db.from("delivery_zones").insert(data);
    if (result.error) {
      status(result.error.message, "#delivery-zone-message", true);
      return;
    }
    status("Delivery zone saved.", "#delivery-zone-message");
    form.reset();
    form.elements.id.value = "";
    form.elements.is_active.checked = true;
    await loadDeliveryZones();
  });

  $("#cancel-delivery-zone")?.addEventListener("click", () => {
    const form = $("#delivery-zone-form");
    form.reset();
    form.elements.id.value = "";
    form.elements.is_active.checked = true;
  });

  async function loadMenuReviews() {
    const list = $("#menu-reviews-list");
    if (list) {
      const { data, error } = await db.from("menu_reviews")
        .select("id,order_id,menu_item_id,rating,review_text,photo_url,status,created_at,menu_items(name),orders(order_number)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        list.innerHTML = '<p class="muted">Could not load menu reviews. Check database access or refresh the page.</p>';
      } else {
        const reviews = data || [];
        list.innerHTML = reviews.length ? reviews.map(review => `
          <article class="admin-menu-row">
            <div class="grow">
              <strong>${esc(review.menu_items?.name || "Menu item")} · ${"★".repeat(Number(review.rating || 0))}</strong>
              <small>Order #${esc(review.orders?.order_number || review.order_id)} · ${esc(review.status)} · ${esc(review.review_text || "")}</small>
              ${review.photo_url ? `<p><img src="${esc(review.photo_url)}" alt="Customer review photo" loading="lazy" style="max-width:180px;max-height:140px;border-radius:8px"></p>` : ""}
              ${review.status === "pending" ? `<button class="btn btn-primary" data-review-state="approved" data-review-id="${esc(review.id)}">Approve</button> <button class="btn btn-light" data-review-state="rejected" data-review-id="${esc(review.id)}">Reject</button>` : ""}
            </div>
          </article>
        `).join("") : '<p class="muted">No customer reviews yet.</p>';
        list.querySelectorAll("[data-review-id]").forEach(button => {
          button.onclick = async () => {
            const { error: updateError } = await db.from("menu_reviews")
              .update({ status: button.dataset.reviewState })
              .eq("id", button.dataset.reviewId);
            if (updateError) {
              toast(updateError.message);
              return;
            }
            await loadMenuReviews();
          };
        });
      }
    }

    const serviceList = $("#customer-service-reviews-list");
    if (!serviceList) return;
    const { data: serviceReviews, error: serviceError } = await db.from("customer_service_reviews")
      .select("id,order_id,rating,review_text,status,created_at,orders(order_number,customer_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (serviceError) {
      serviceList.innerHTML = '<p class="muted">Could not load restaurant and service reviews. Check database access or refresh the page.</p>';
      return;
    }
    serviceList.innerHTML = serviceReviews?.length ? serviceReviews.map(review => `
      <article class="admin-menu-row">
        <div class="grow">
          <strong>Order #${esc(review.orders?.order_number || review.order_id)} · ${"★".repeat(Number(review.rating || 0))}</strong>
          <small>${esc(review.orders?.customer_name || "Customer")} · ${esc(review.status)} · ${esc(formatGhanaDateTime(review.created_at))}</small>
          ${review.review_text ? `<p>${esc(review.review_text)}</p>` : ""}
        </div>
      </article>
    `).join("") : '<p class="muted">No restaurant or service ratings yet.</p>';
  }

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
    scheduleSettingsAvailable = Object.prototype.hasOwnProperty.call(data, "allow_scheduled_orders");
    ["allow_scheduled_orders", "schedule_min_notice_minutes", "schedule_max_days", "default_prep_minutes", "default_delivery_minutes"].forEach(name => {
      const field = $("#settings-form").elements[name];
      if (field) field.disabled = !scheduleSettingsAvailable;
    });
    if (scheduleSettingsAvailable) {
      $("#settings-form").elements.allow_scheduled_orders.checked = Boolean(data.allow_scheduled_orders);
      $("#settings-form").elements.schedule_min_notice_minutes.value = data.schedule_min_notice_minutes;
      $("#settings-form").elements.schedule_max_days.value = data.schedule_max_days;
      $("#settings-form").elements.default_prep_minutes.value = data.default_prep_minutes ?? "";
      $("#settings-form").elements.default_delivery_minutes.value = data.default_delivery_minutes ?? "";
    }
  }

  $("#settings-form").onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;

    const data = {
      delivery_fee: Number(form.elements.delivery_fee.value),
      minimum_order: Number(form.elements.minimum_order.value),
      updated_at: new Date().toISOString()
    };
    if (scheduleSettingsAvailable) {
      data.allow_scheduled_orders = form.elements.allow_scheduled_orders.checked;
      data.schedule_min_notice_minutes = Number(form.elements.schedule_min_notice_minutes.value);
      data.schedule_max_days = Number(form.elements.schedule_max_days.value);
      data.default_prep_minutes = form.elements.default_prep_minutes.value ? Number(form.elements.default_prep_minutes.value) : null;
      data.default_delivery_minutes = form.elements.default_delivery_minutes.value ? Number(form.elements.default_delivery_minutes.value) : null;
    }

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
    if (!selectedDb || !currentUser) {
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

  staffDb?.auth.onAuthStateChange(event => {
    if (event === "PASSWORD_RECOVERY") showPasswordRecoverySet();
  });

  start();
})();
