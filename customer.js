Warning: truncated output (original token count: 45879)
Total output lines: 3638


(() => {
  "use strict";

  const cfg = window.AL_SHAMI_CONFIG || {};

  const ready =
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    cfg.SUPABASE_ANON_KEY.length > 0 &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  const db = ready && window.supabase
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY,
        {
          auth: {
            // Customer and history share one session; admin and rider use separate keys.
            storageKey: "al-shami-customer-auth-v1",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    : null;
  window.AL_SHAMI_CUSTOMER_DB = db;

  const $ = selector => document.querySelector(selector);
  const CUSTOMER_PUBLIC_URL = "https://alshamiapp.xyz/";
  const getCustomerAuthRedirectUrl = () => {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return CUSTOMER_PUBLIC_URL;
    }
    return window.location.origin + window.location.pathname;
  };
  const isHistoryPage = /(?:^|\/)history\.html$/i.test(window.location.pathname);
  const checkoutForm = $("#checkout-form");
  const orderButton = $("#place-order");
  const floatingCartButton = $("#floating-cart-button");
  const floatingCartCount = $("#floating-cart-count");
  const floatingCartTotal = $("#floating-cart-total");


  let deliveryMapInstance = null;
  let deliveryMapMarker = null;
  let pendingDeliveryLocation = null;
  let lastGeocodingRequestAt = 0;
  const customerRiderMapInstances = new Map();

  function currentDeliveryCoordinates() {
    const latitudeValue = $("#delivery-latitude")?.value;
    const longitudeValue = $("#delivery-longitude")?.value;
    if (latitudeValue === "" || latitudeValue == null || longitudeValue === "" || longitudeValue == null) return null;
    const lat = Number(latitudeValue);
    const lng = Number(longitudeValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function setMapMessage(message, isError = false) {
    const node = $("#delivery-map-message");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", Boolean(isError));
    node.hidden = !message;
  }

  function locationLabel() {
    const node = $("#delivery-map-selection");
    if (node) node.textContent = tr("locationSelected");
  }

  function setPendingDeliveryLocation(lat, lng, address = "") {
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const previousAddress = pendingDeliveryLocation?.address || "";
    pendingDeliveryLocation = { lat, lng, address: address || previousAddress };
    if (deliveryMapInstance) {
      if (!deliveryMapMarker) {
        deliveryMapMarker = L.marker([lat, lng], { draggable: true, title: tr("chooseLocation") }).addTo(deliveryMapInstance);
        deliveryMapMarker.on("dragend", () => {
          if (!deliveryMapMarker) return;
          const position = deliveryMapMarker.getLatLng();
          if (pendingDeliveryLocation) pendingDeliveryLocation = { ...pendingDeliveryLocation, address: "" };
          setPendingDeliveryLocation(position.lat, position.lng);
        });
      } else {
        deliveryMapMarker.setLatLng([lat, lng]);
      }
      deliveryMapInstance.panTo([lat, lng]);
    }
    locationLabel(lat, lng, pendingDeliveryLocation.address);
    const confirm = $("#delivery-map-confirm");
    if (confirm) confirm.disabled = false;
    setMapMessage("");
  }

  function loadLeafletApi() {
    if (window.L && typeof window.L.map === "function") return Promise.resolve();
    return Promise.reject(new Error(tr("mapsLoadError")));
  }

  function initializeDeliveryMap() {
    const canvas = $("#delivery-map-canvas");
    if (!canvas || !window.L) throw new Error(tr("mapsLoadError"));
    const saved = currentDeliveryCoordinates();
    const active = pendingDeliveryLocation || saved;
    const center = active || { lat: 5.6037, lng: -0.1870 }; // Accra, Ghana

    if (!deliveryMapInstance) {
      deliveryMapInstance = L.map(canvas, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: true
      }).setView([center.lat, center.lng], active ? 16 : 12);

      const tileUrl = String(cfg.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
      }).addTo(deliveryMapInstance);

      deliveryMapInstance.on("click", event => {
        if (!event?.latlng) return;
        if (pendingDeliveryLocation) pendingDeliveryLocation = { ...pendingDeliveryLocation, address: "" };
        setPendingDeliveryLocation(event.latlng.lat, event.latlng.lng);
      });
    } else {
      deliveryMapInstance.setView([center.lat, center.lng], active ? 16 : 12);
      deliveryMapInstance.invalidateSize({ pan: false });
    }

    if (active) {
      setPendingDeliveryLocation(active.lat, active.lng, pendingDeliveryLocation?.address || "");
    } else {
      if (deliveryMapMarker) {
        deliveryMapInstance.removeLayer(deliveryMapMarker);
        deliveryMapMarker = null;
      }
      pendingDeliveryLocation = null;
      const confirm = $("#delivery-map-confirm");
      if (confirm) confirm.disabled = true;
      const selection = $("#delivery-map-selection");
      if (selection) selection.textContent = "";
    }
  }

  async function searchDeliveryAddress(event) {
    event.preventDefault();
    const input = $("#delivery-map-search-input");
    const button = $("#delivery-map-search-button");
    const results = $("#delivery-map-search-results");
    const query = String(input?.value || "").trim();
    if (!query || query.length < 3) {
      setMapMessage(localized("Enter a place name or a longer address to search.", "اكتب اسم مكان أو عنواناً أطول للبحث.", "Kyerɛw beae bi din anaa address tenten kakra na hwehwɛ."), true);
      return;
    }
    if (!results || !button) return;

    button.disabled = true;
    results.hidden = true;
    results.replaceChildren();
    setMapMessage("");
    try {
      // The public Nominatim endpoint is for deliberate, user-triggered searches only.
      // The brief client-side pause prevents rapid repeat searches in this browser tab.
      const wait = Math.max(0, 1100 - (Date.now() - lastGeocodingRequestAt));
      if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
      lastGeocodingRequestAt = Date.now();

      const searchUrl = new URL(String(cfg.GEOCODING_SEARCH_URL || "https://nominatim.openstreetmap.org/search"));
      searchUrl.searchParams.set("format", "jsonv2");
      searchUrl.searchParams.set("limit", "5");
      searchUrl.searchParams.set("countrycodes", "gh");
      searchUrl.searchParams.set("q", query);
      const response = await fetch(searchUrl.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" },
        credentials: "omit"
      });
      if (!response.ok) throw new Error("Address search service returned HTTP " + response.status);
      const places = await response.json();
      if (!Array.isArray(places) || places.length === 0) {
        setMapMessage(tr("mapSearchNoResults"), true);
        return;
      }

      const heading = document.createElement("p");
      heading.className = "delivery-map-search-results-heading";
      heading.textContent = localized("Choose a result to move the map:", "اختر نتيجة للانتقال إليها:", "Paw nea ɛfata na map no akɔ hɔ:");
      results.appendChild(heading);
      places.slice(0, 5).forEach(place => {
        const lat = Number(place.lat);
        const lng = Number(place.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "delivery-map-search-result";
        item.textContent = String(place.display_name || query);
        item.addEventListener("click", () => {
          setPendingDeliveryLocation(lat, lng, String(place.display_name || ""));
          if (deliveryMapInstance) deliveryMapInstance.flyTo([lat, lng], 17);
          results.hidden = true;
          results.replaceChildren();
        });
        results.appendChild(item);
      });
      results.hidden = results.children.length === 0;
      if (results.hidden) setMapMessage(tr("mapSearchNoResults"), true);
    } catch (error) {
      console.warn("OpenStreetMap address search failed:", error);
      setMapMessage(tr("mapSearchError"), true);
    } finally {
      button.disabled = false;
    }
  }

  async function reverseGeocodeDeliveryLocation(lat, lng) {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodingRequestAt));
    if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
    lastGeocodingRequestAt = Date.now();

    const reverseUrl = new URL(String(cfg.GEOCODING_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse"));
    reverseUrl.searchParams.set("format", "jsonv2");
    reverseUrl.searchParams.set("lat", String(lat));
    reverseUrl.searchParams.set("lon", String(lng));
    reverseUrl.searchParams.set("zoom", "18");
    reverseUrl.searchParams.set("addressdetails", "1");
    const response = await fetch(reverseUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" },
      credentials: "omit"
    });
    if (!response.ok) throw new Error("Address lookup returned HTTP " + response.status);
    const result = await response.json();
    return String(result?.display_name || "").trim().slice(0, 250);
  }

  async function openDeliveryMapPicker() {
    const modal = $("#delivery-map-modal");
    if (!modal) return;
    const saved = currentDeliveryCoordinates();
    pendingDeliveryLocation = saved
      ? { ...saved, address: checkoutForm?.elements?.delivery_address?.value || "" }
      : null;
    modal.hidden = false;
    document.body.classList.add("delivery-map-open");
    setMapMessage("");
    const confirm = $("#delivery-map-confirm");
    if (confirm) confirm.disabled = !pendingDeliveryLocation;
    const searchInput = $("#delivery-map-search-input");
    if (searchInput) {
      searchInput.placeholder = tr("mapSearchPlaceholder");
      searchInput.value = "";
    }
    const results = $("#delivery-map-search-results");
    if (results) {
      results.hidden = true;
      results.replaceChildren();
    }
    try {
      await loadLeafletApi();
      initializeDeliveryMap();
      window.setTimeout(() => {
        if (deliveryMapInstance) deliveryMapInstance.invalidateSize({ pan: false });
      }, 100);
    } catch (error) {
      setMapMessage(error?.message || tr("mapsLoadError"), true);
      console.warn("OpenStreetMap delivery picker is not ready:", error);
    }
  }

  function closeDeliveryMapPicker() {
    const modal = $("#delivery-map-modal");
    if (modal) modal.hidden = true;
    document.body.classList.remove("delivery-map-open");
  }

  function clearDeliveryLocationSelection() {
    if ($("#delivery-latitude")) $("#delivery-latitude").value = "";
    if ($("#delivery-longitude")) $("#delivery-longitude").value = "";
    pendingDeliveryLocation = null;
    if (deliveryMapMarker && deliveryMapInstance) {
      deliveryMapInstance.removeLayer(deliveryMapMarker);
      deliveryMapMarker = null;
    }
    const status = $("#delivery-location-status");
    if (status) {
      status.textContent = tr("locationNotSelected");
      status.classList.remove("has-location");
    }
    const clearButton = $("#clear-delivery-location");
    if (clearButton) clearButton.hidden = true;
    const confirm = $("#delivery-map-confirm");
    if (confirm) confirm.disabled = true;
  }

  async function confirmDeliveryLocation() {
    if (!pendingDeliveryLocation) return;
    const lat = Number(pendingDeliveryLocation.lat);
    const lng = Number(pendingDeliveryLocation.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const confirmButton = $("#delivery-map-confirm");
    if (confirmButton) confirmButton.disabled = true;
    setMapMessage(tr("findingAddress"));

    let selectedAddress = String(pendingDeliveryLocation.address || "").trim();
    if (!selectedAddress) {
      try {
        selectedAddress = await reverseGeocodeDeliveryLocation(lat, lng);
      } catch (error) {
        console.warn("Delivery pin address lookup failed:", error);
      }
    }

    if ($("#delivery-latitude")) $("#delivery-latitude").value = String(lat);
    if ($("#delivery-longitude")) $("#delivery-longitude").value = String(lng);
    const addressInput = checkoutForm?.elements?.delivery_address;
    if (addressInput) {
      const existingAddress = String(addressInput.value || "").trim();
      const mapAddress = selectedAddress || localized(
        "Delivery location selected on map",
        "تم تحديد موقع التوصيل على الخريطة",
        "Wɔapaw delivery beae wɔ map no so"
      );
      const alreadyIncluded = existingAddress && (
        mapAddress.toLowerCase().includes(existingAddress.toLowerCase()) ||
        existingAddress.toLowerCase().includes(mapAddress.toLowerCase())
      );
      addressInput.value = (existingAddress && !alreadyIncluded
        ? existingAddress + ", " + mapAddress
        : mapAddress).slice(0, 250);
    }
    const status = $("#delivery-location-status");
    if (status) {
      status.textContent = tr("locationConfirmed");
      status.classList.add("has-location");
    }
    const clearButton = $("#clear-delivery-location");
    if (clearButton) clearButton.hidden = false;
    closeDeliveryMapPicker();
    renderCart();
  }

  let authSession = null;
  let authMethod = "email";
  let authRecoveryMode = null;
  let customerPhoneValidatedUserId = null;
  let phoneProfileValidation = null;
  let inPasswordRecovery = false;

  function authMessage(message, error = false) {
    const node = $("#auth-message");
    if (!node) return;
    node.textContent = message || "";
    node.className = "status-message" + (error ? " error" : " success");
  }

  function lockCustomerApp(message = "") {
    document.body.classList.add("customer-auth-required", "auth-dialog-open");
    const gate = $("#customer-auth");
    if (gate) gate.hidden = false;
    showAuthDialog();
    if (message) authMessage(message, true);
  }

  function unlockCustomerApp(userId) {
    if (!authSession?.user || authSession.user.id !== userId) return;
    customerPhoneValidatedUserId = userId;
    // Do not dismiss the mandatory gate while a password-recovery session is active.
    if (inPasswordRecovery) return;
    document.body.classList.remove("customer-auth-required", "auth-dialog-open");
    const gate = $("#customer-auth");
    if (gate) gate.hidden = true;
    void loadMenuAndSettings();
    void refreshCustomerOrderHistory();
  }

  async function ensureCustomerPhoneProfile(session) {
    const user = session?.user;
    if (!user || !db) return;
    if (customerPhoneValidatedUserId === user.id) {
      unlockCustomerApp(user.id);
      return;
    }
    if (phoneProfileValidation?.userId === user.id) {
      await phoneProfileValidation.promise;
      return;
    }

    const promise = (async () => {
      const meta = user.user_metadata || {};
      const phone = meta.contact_phone || meta.phone_e164 || meta.phone || user.phone || "";
      // The database trigger reserves a number at signup. This check protects older account records.
      if (!phone) {
        unlockCustomerApp(user.id);
        return;
      }

      let canonicalPhone;
      try {
        canonicalPhone = normalizeGhanaPhone(phone);
      } catch (_) {
        throw new Error("The phone number saved on this account is invalid. Contact AL SHAMI for help.");
      }

      const { data: existing, error: lookupError } = await db
        .from("customer_profiles")
        .select("user_id,phone_e164")
        .eq("user_id", user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;

      if (existing) {
        if (existing.phone_e164 !== canonicalPhone) {
          throw new Error("The phone number saved on this account does not match its profile. Contact AL SHAMI for help.");
        }
      } else {
        const { error: insertError } = await db.from("customer_profiles").insert({
          user_id: user.id,
          phone_e164: canonicalPhone,
          full_name: String(meta.full_name || "Customer").trim() || "Customer"
        });
        if (insertError) {
          if (insertError.code === "23505" || /duplicate key|unique constraint/i.test(insertError.message || "")) {
            throw new Error("This phone number is already linked to another customer account. Sign in to the existing account or use a different number.");
          }
          throw insertError;
        }
      }
      unlockCustomerApp(user.id);
    })();

    phoneProfileValidation = { userId: user.id, promise };
    try {
      await promise;
    } catch (error) {
      console.error("Customer phone uniqueness check failed:", error);
      if (authSession?.user?.id === user.id && /already linked|does not match|invalid/i.test(String(error?.message || ""))) {
        await db.auth.signOut();
        authSession = null;
      }
      lockCustomerApp(error?.message || "Could not verify this customer account. Please try again.");
    } finally {
      if (phoneProfileValidation?.userId === user.id && phoneProfileValidation.promise === promise) phoneProfileValidation = null;
    }
  }

  function applyAuthState(session) {
    authSession = session || null;
    const signedIn = Boolean(authSession?.user);
    const openButton = $("#customer-auth-open");
    const account = $("#customer-account");
    if (openButton) openButton.hidden = signedIn;
    if (account) account.hidden = !signedIn;

    if (!signedIn) {
      customerPhoneValidatedUserId = null;
      phoneProfileValidation = null;
      lockCustomerApp("Please sign in or create an account to continue.");
      return;
    }

    const user = authSession.user;
    const meta = user.user_metadata || {};
    const label = $("#customer-account-label");
    if (label) label.textContent = "Signed in as " + (user.email || user.phone || "customer");
    const phone = meta.phone_e164 || meta.phone || user.phone || "";
    if (checkoutForm?.elements?.customer_phone && phone && !checkoutForm.elements.customer_phone.value) checkoutForm.elements.customer_phone.value = phone;
    if (checkoutForm?.elements?.customer_name && meta.full_name && !checkoutForm.elements.customer_name.value) checkoutForm.elements.customer_name.value = meta.full_name;

    // Keep the mandatory gate closed until the unique phone profile is confirmed.
    lockCustomerApp("Checking your account…");
    void ensureCustomerPhoneProfile(authSession);
  }

  function setAuthMode(mode) {
    const signup = mode === "signup";
    const form = $("#customer-auth-form");
    if (!form) return;
    form.dataset.mode = signup ? "signup" : "signin";
    const title = $("#customer-auth-title");
    const help = $("#customer-auth-help");
    const nameField = $("#auth-name-field");
    const nameInput = $("#auth-name");
    const confirmField = $("#auth-confirm-field");
    const confirmInput = $("#auth-confirm-password");
    const password = $("#auth-password");
    const submit = $("#auth-submit");
    const signinButton = $("#auth-mode-signin");
    const signupButton = $("#auth-mode-signup");
    const forgot = $("#auth-forgot-password");
    const methodSwitch = $("#auth-method-switch");
    if (title) title.textContent = signup ? "Create your AL SHAMI account" : "Sign in to your account";
    if (help) {
      if (signup) help.textContent = "Create an account with email or username, password, and a unique contact phone number.";
      else help.textContent = authMethod === "username" ? "Use your username and password." : "Use the email address and password you registered with.";
    }
    if (methodSwitch) methodSwitch.hidden = Boolean(authRecoveryMode);
    if (nameField) nameField.hidden = !signup;
    if (nameInput) nameInput.required = signup;
    const contactField = $("#auth-contact-phone-field");
    const contactInput = $("#auth-contact-phone");
    if (contactField) contactField.hidden = !signup;
    if (contactInput) contactInput.required = signup;
    if (confirmField) confirmField.hidden = !signup;
    if (confirmInput) confirmInput.required = signup;
    if (password) password.autocomplete = signup ? "new-password" : "current-password";
    if (submit) submit.textContent = signup ? "Create account" : "Sign in";
    if (forgot) forgot.hidden = signup || Boolean(authRecoveryMode);
    if (signinButton) { signinButton.classList.toggle("active", !signup); signinButton.setAttribute("aria-pressed", String(!signup)); }
    if (signupButton) { signupButton.classList.toggle("active", signup); signupButton.setAttribute("aria-pressed", String(signup)); }
    authMessage("");
  }

  function setAuthMethod(method) {
    authMethod = method === "email" ? "email" : "username";
    const label = $("#auth-identifier-label");
    const field = $("#auth-identifier");
    const usernameButton = $("#auth-method-username");
    const emailButton = $("#auth-method-email");
    if (label) label.textContent = authMethod === "username" ? "Username" : "Email address";
    if (field) {
      field.type = authMethod === "username" ? "text" : "email";
      field.inputMode = authMethod === "username" ? "text" : "email";
      field.autocomplete = authMethod === "username" ? "username" : "email";
      field.placeholder = authMethod === "username" ? "yourname" : "you@example.com";
      field.value = "";
    }
    if (usernameButton) { usernameButton.classList.toggle("active", authMethod === "username"); usernameButton.setAttribute("aria-pressed", String(authMethod === "username")); }
    if (emailButton) { emailButton.classList.toggle("active", authMethod === "email"); emailButton.setAttribute("aria-pressed", String(authMethod === "email")); }
    setAuthMode($("#customer-auth-form")?.dataset?.mode || "signin");
  }

  function showAuthDialog() {
    const gate = $("#customer-auth");
    if (!gate) return;
    authRecoveryMode = null;
    $("#auth-recovery-panel").hidden = true;
    $("#customer-auth-form").hidden = false;
    $("#auth-mode-switch").hidden = false;
    $("#auth-forgot-password").hidden = false;
    $("#auth-recovery-back").hidden = false;
    gate.hidden = false;
    document.body.classList.add("auth-dialog-open");
    setAuthMode("signin");
    window.requestAnimationFrame(() => $("#auth-identifier")?.focus());
  }

  function closeAuthDialog() {
    const gate = $("#customer-auth");
    const user = authSession?.user;
    const hasSavedPhone = Boolean(user?.user_metadata?.contact_phone || user?.user_metadata?.phone_e164 || user?.user_metadata?.phone);
    const phoneValidationPending = Boolean(user && hasSavedPhone && customerPhoneValidatedUserId !== user.id);
    if (!user || phoneValidationPending || inPasswordRecovery) {
      // Keep the mandatory gate until auth and the unique phone reservation both pass.
      document.body.classList.add("customer-auth-required", "auth-dialog-open");
      if (gate) gate.hidden = false;
      return;
    }
    if (gate) gate.hidden = true;
    document.body.classList.remove("auth-dialog-open", "customer-auth-required");
  }

  function showPasswordRecovery(mode) {
    inPasswordRecovery = true;
    authRecoveryMode = mode;
    const gate = $("#customer-auth");
    if (gate) gate.hidden = false;
    document.body.classList.add("auth-dialog-open");
    $("#customer-auth-title").textContent = "Reset your password";
    $("#customer-auth-help").textContent = "Your recovery link was accepted. Choose a new password.";
    $("#auth-mode-switch").hidden = true;
    $("#auth-method-switch").hidden = true;
    $("#customer-auth-form").hidden = true;
    $("#auth-forgot-password").hidden = true;
    $("#auth-recovery-panel").hidden = false;
    $("#auth-recovery-title").textContent = "Set a new password";
    $("#auth-recovery-help").textContent = "Use at least 8 characters and keep it private.";
    $("#auth-recovery-send-area").hidden = true;
    $("#auth-recovery-password-area").hidden = false;
    $("#auth-recovery-back").hidden = true;
    authMessage("");
    window.requestAnimationFrame(() => $("#auth-recovery-new-password")?.focus());
  }

  async function initializeCustomerAuth() {
    if (!db) {
      document.body.classList.add("customer-auth-required");
      showAuthDialog();
      authMessage("Account service is unavailable. Please try again after the app configuration is restored.", true);
      return;
    }
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      if (window.location.hash.includes("type=recovery")) inPasswordRecovery = true;
      applyAuthState(data.session);
      db.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") inPasswordRecovery = true;
        applyAuthState(session);
        if (event === "PASSWORD_RECOVERY") showPasswordRecovery("email");
      });
      if (window.location.hash.includes("type=recovery")) showPasswordRecovery("email");
    } catch (error) {
      console.error("Customer auth initialization failed:", error);
      document.body.classList.add("customer-auth-required");
      showAuthDialog();
      authMessage(error.message || "Could not check your sign-in status. Please sign in to continue.", true);
    }
  }

  async function refreshCustomerSessionOnResume() {
    if (!db || document.visibilityState === "hidden") return;
    try {
      // Installed PWAs can be suspended in the background. Refresh the saved
      // Supabase session when the customer returns to the app.
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      applyAuthState(data.session);
    } catch (error) {
      // Do not force a sign-in screen for a temporary network interruption.
      console.warn("Customer session restore on resume failed:", error);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshCustomerSessionOnResume();
  });
  window.addEventListener("pageshow", () => void refreshCustomerSessionOnResume());

  $("#customer-auth-open")?.addEventListener("click", showAuthDialog);
  document.addEventListener("click", event => {
    const trigger = event.target?.closest?.("#customer-auth-open");
    if (trigger) { event.preventDefault(); showAuthDialog(); }
  }, true);
  $("#auth-close")?.addEventListener("click", closeAuthDialog);
  $("#auth-recovery-back")?.addEventListener("click", () => {
    authRecoveryMode = null;
    $("#auth-recovery-panel").hidden = true;
    $("#customer-auth-form").hidden = false;
    $("#auth-mode-switch").hidden = false;
    $("#auth-forgot-password").hidden = false;
    setAuthMode("signin");
    authMessage("");
  });
  $("#customer-auth")?.addEventListener("click", event => {
    if (event.target === $("#customer-auth") && !authRecoveryMode && authSession?.user) closeAuthDialog();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("#customer-auth") && !$("#customer-auth").hidden && !authRecoveryMode && authSession?.user) closeAuthDialog();
  });
  $("#auth-mode-signin")?.addEventListener("click", () => setAuthMode("signin"));
  $("#auth-mode-signup")?.addEventListener("click", () => setAuthMode("signup"));
  $("#auth-method-email")?.addEventListener("click", () => setAuthMethod("email"));
  $("#auth-method-username")?.addEventListener("click", () => setAuthMethod("username"));
  setAuthMethod("email");

  $("#customer-auth-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("#auth-submit");
    if (!db) { authMessage("Account sign-in is unavailable because app configuration is missing.", true); return; }
    const password = String($("#auth-password")?.value || "");
    const mode = form.dataset.mode === "signup" ? "signup" : "signin";
    const fullName = String($("#auth-name")?.value || "").trim();
    let identity = String($("#auth-identifier")?.value || "").trim();
    let contactPhone = "";
    try {
      if (authMethod === "email") {
        identity = identity.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) throw new Error("Enter a valid email address.");
      } else {
        identity = identity.toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(identity)) throw new Error("Use 3–30 characters for your username: letters, numbers, dot, underscore, or dash.");
      }
      if (password.length < 8 || password.length > 128) throw new Error("Use a password with 8–128 characters.");
      if (mode === "signup") {
        if (fullName.length < 2) throw new Error("Enter your name to create an account.");
        if (password !== String($("#auth-confirm-password")?.value || "")) throw new Error("The passwords do not match.");
        try { contactPhone = normalizeGhanaPhone(String($("#auth-contact-phone")?.value || "")); }
        catch (_) { throw new Error("Enter a valid Ghana contact phone number."); }
      }
      if (submit) { submit.disabled = true; submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…"; }
      authMessage(mode === "signup" ? "Creating your account…" : "Signing in…");
      let session;
      if (authMethod === "username") {
        const response = await fetch(`${cfg.SUPABASE_URL}/functions/v1/customer-auth`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY },
          body: JSON.stringify({ action: mode === "signup" ? "register" : "login", username: identity, password,
            ...(mode === "signup" ? { full_name: fullName, contact_phone: contactPhone } : {}) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Account action failed. Please try again.");
        const { data, error } = await db.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
        if (error) throw error;
        session = data.session;
      } else if (mode === "signup") {
        const { data, error } = await db.auth.signUp({
          email: identity, password,
          options: { emailRedirectTo: getCustomerAuthRedirectUrl(), data: {
            customer_account: "true", contact_phone: contactPhone, full_name: fullName
          } }
        });
        if (error) throw error;
        if (data.session) session = data.session;
        else if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) throw new Error("This email is already registered. Sign in or use password recovery.");
        else {
          authMessage("Account request received. Open the confirmation link sent to your email before signing in.");
          return;
        }
      } else {
        const { data, error } = await db.auth.signInWithPassword({ email: identity, password });
        if (error) throw error;
        session = data.session;
      }
      if (session) { applyAuthState(session); closeAuthDialog(); authMessage(""); }
    } catch (error) {
      console.error("Customer account action failed:", error);
      const detail = String(error?.message || "");
      if (/email address not authorized|not authorized|confirmation email|SMTP|email provider/i.test(detail)) {
        authMessage("Email delivery is not configured for public customers yet. Configure a custom SMTP sender before email signup and password recovery.", true);
      } else if (/duplicate key|unique constraint|23505|already linked|already registered/i.test(detail)) {
        authMessage("This username, email, or contact phone is already linked to an account. Sign in or contact AL SHAMI for help.", true);
      } else authMessage(detail || "Account action failed. Please try again.", true);
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = form.dataset.mode === "signup" ? "Create account" : "Sign in"; }
    }
  });

  $("#auth-forgot-password")?.addEventListener("click", async () => {
    if (!db) { authMessage("Password recovery is unavailable because app configuration is missing.", true); return; }
    if (authMethod === "username") { authMessage("Username accounts without an email cannot reset passwords online yet. Contact AL SHAMI for account help.", true); return; }
    const email = String($("#auth-identifier")?.value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      authMessage("Enter your email address first.", true);
      $("#auth-identifier")?.focus();
      return;
    }
    const button = $("#auth-forgot-password");
    if (button) button.disabled = true;
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: getCustomerAuthRedirectUrl() });
      if (error) throw error;
      authMessage("If the account supports email recovery, a reset link will be sent. Check your inbox.");
    } catch (error) {
      authMessage(error.message || "Could not request a password reset.", true);
    } finally { if (button) button.disabled = false; }
  });

  $("#auth-recovery-save")?.addEventListener("click", async () => {
    const password = String($("#auth-recovery-new-password")?.value || "");
    const confirmation = String($("#auth-recovery-confirm-password")?.value || "");
    if (password.length < 8) { authMessage("Use a password with at least 8 characters.", true); return; }
    if (password !== confirmation) { authMessage("The passwords do not match.", true); return; }
    if (!authSession) {
      authMessage("Open your email recovery link before changing the password.", true);
      return;
    }
    const button = $("#auth-recovery-save");
    if (button) { button.disabled = true; button.textContent = "Saving password…"; }
    try {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      authRecoveryMode = null;
      inPasswordRecovery = false;
      $("#auth-recovery-panel").hidden = true;
      $("#customer-auth-form").hidden = false;
      $("#auth-mode-switch").hidden = false;
      $("#auth-forgot-password").hidden = false;
      $("#auth-password").value = "";
      $("#auth-recovery-new-password").value = "";
      $("#auth-recovery-confirm-password").value = "";
      setAuthMode("signin");
      applyAuthState(authSession);
      authMessage("Password updated successfully. You can continue using AL SHAMI.");
      closeAuthDialog();
    } catch (error) {
      console.error("Password recovery update failed:", error);
      authMessage(error.message || "Could not update your password. Verify the recovery step and try again.", true);
    } finally { if (button) { button.disabled = false; button.textContent = "Save new password"; } }
  });

  $("#customer-sign-out")?.addEventListener("click", async () => {
    if (!db) return;
    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      applyAuthState(null);
      closeAuthDialog();
    } catch (error) {
      console.error("Customer sign-out failed:", error);
      authMessage(error.message || "Could not sign out.", true);
    }
  });


  let products = [];
  let menuFeatureDetailsAvailable = false;
  let approvedMenuReviewsByItem = new Map();
  let offers = [];
  let offerAvailabilitySignature = "";
  let popularityByMenuItem = new Map();
  const CUSTOMER_CATALOG_REFRESH_INTERVAL_MS = 30000;
  let customerCatalogRefreshTimer = null;
  let customerCatalogRefreshInProgress = false;
  let customerCatalogLastRefreshAt = 0;
  let cart = {};
  let category = "All";
  let sortMode = "default";
  const CART_KEY = "alShamiCartV1";
  const CART_ITEM_NOTES_KEY = "alShamiCartItemNotesV1";
  let cartItemNotes = {};
  const CUSTOMER_KEY = "alShamiCustomerV1";
  const ORDER_HISTORY_KEY = "alShamiOrderHistoryV1";
  const TRACKING_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CUSTOMER_ORDER_STATUS_POLL_INTERVAL_MS = 5000;
  let trackedOrdersLoading = false;
  let trackedOrdersRefreshQueued = false;
  let trackedOrderRemovalTokens = new Map();
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function persistCart() { storageSet(CART_KEY, JSON.stringify(cart)); }
  function persistCartItemNotes() { storageSet(CART_ITEM_NOTES_KEY, JSON.stringify(cartItemNotes)); }
  function restoreCartItemNotes() {
    try {
      const saved = JSON.parse(storageGet(CART_ITEM_NOTES_KEY) || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) cartItemNotes = Object.fromEntries(Object.entries(saved).filter(([id, note]) => typeof note === "string").map(([id, note]) => [id, note.slice(0, 500)]));
    } catch (_) { cartItemNotes = {}; }
  }
  function restoreCart() {
    try {
      const saved = JSON.parse(storageGet(CART_KEY) || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        cart = Object.fromEntries(Object.entries(saved).filter(([id, qty]) => Number.isInteger(Number(qty)) && Number(qty) > 0 && Number(qty) <= 50).map(([id, qty]) => [id, Number(qty)]));
      }
    } catch (_) { cart = {}; }
  }
  function normalizeGhanaPhone(value) {
    const raw = String(value || "").trim();
    const validCharacters = /^\+?[0-9().\s-]+$/.test(raw);
    const digits = raw.replace(/\D/g, "");
    let national = digits;
    if (national.startsWith("00233")) national = national.slice(5);
    else if (national.startsWith("233")) national = national.slice(3);
    else if (national.startsWith("0")) national = national.slice(1);
    if (!validCharacters || !/^[0-9]{9}$/.test(national)) {
      throw new Error(localized("Enter a valid Ghana phone number, e.g. 0241234567.", "أدخل رقم غاني صحيح، مثال 0241234567.", "Kyerɛw Ghana telefon nɔma a ɛyɛ nokware, sɛ nhwɛso 0241234567."));
    }
    return "+233" + national;
  }
  function restoreCustomerDetails() {
    try {
      const saved = JSON.parse(storageGet(CUSTOMER_KEY) || "null");
      if (!saved || saved.consent !== true) return;
      if (checkoutForm?.elements?.customer_name) checkoutForm.elements.customer_name.value = saved.name || "";
      if (checkoutForm?.elements?.customer_phone) checkoutForm.elements.customer_phone.value = saved.phone || "";
      const consent = $("#remember-customer");
      if (consent) consent.checked = true;
    } catch (_) {}
  }

  function saveRememberedCustomerFromForm() {
    if (!$("#remember-customer")?.checked || !checkoutForm) return;
    const name = String(checkoutForm.elements?.customer_name?.value || "").trim();
    const phone = String(checkoutForm.elements?.customer_phone?.value || "").trim();
    storageSet(CUSTOMER_KEY, JSON.stringify({ consent: true, name, phone }));
  }
  let lang = "en";
  let deliveryFee = 0;
  let activeDeliveryZones = [];
  let deliveryZoneLookupAvailable = false;
  let schedulingEnabled = false;
  let scheduleMinNoticeMinutes = 60;
  let scheduleMaxDays = 14;
  let defaultPrepMinutes = null;
  let defaultDeliveryMinutes = null;
  let minimumOrder = 0;
  let submitting = false;
  let menuLoading = false;

  const translations = {
    en: {
      hero: "Fresh favourites, made for you.",
      orderNote: "Order online",
      orderNote2: "Your order goes directly to our restaurant ordering system.",
      customerActionsTitle: "How can we help you today?",
      customerActionsDesc: "Order your favourites, review past orders, or chat with our team.",
      backToHome: "← Back to home",
      placeOrderCard: "Place an order",
      placeOrderCardDesc: "Explore our menu, choose your favourites and order for delivery or pickup.",
      placeOrderCardCta: "Browse the menu",
      activeOrdersCard: "Active orders",
      activeOrdersCardDesc: "Follow accepted orders while they are being prepared or delivered.",
      activeOrdersCardCta: "Check order status",
      historyCard: "Your orders",
      historyCardDesc: "Track orders in progress and review previous orders.",
      historyCardCta: "Track your orders",
      helpCard: "Help",
      helpCardDesc: "Need help with an order, delivery or menu? Message our team on WhatsApp.",
      helpCardCta: "Chat on WhatsApp",
      menu: "Menu",
      yourOrder: "Your order",
      orderSummary: "Order summary",
      total: "Grand total",
      subtotal: "Items subtotal",
      deliveryFee: "Delivery fee",
      name: "Your name",
      phone: "Phone number",
      orderType: "Order type",
      address: "Delivery address / landmark",
      addressHint: "The map fills the nearby address. Add your house number or a landmark if needed.",
      chooseLocation: "Set delivery pin",
      clearLocation: "Change delivery pin",
      locationNotSelected: "Choose a map pin before placing a delivery order.",
      locationSelected: "Pin selected",      locationConfirmed: "Address filled from map",
      findingAddress: "Getting address from map…",
      mapTitle: "Set delivery location",
      mapHelp: "Use your current location or search a nearby landmark. Confirm the pin; the address fills in automatically.",
      mapSearchPlaceholder: "Search a nearby landmark",
      mapSearchButton: "Find",
      mapSearchNoResults: "No match found. Try a nearby landmark or move the pin.",
      mapSearchError: "Search is unavailable. You can move the pin on the map.",
      useCurrentLocation: "Use my location",
      confirmLocation: "Confirm location",
      cancel: "Cancel",
      mapsNotConfigured: "The map is unavailable. Please try again or contact the restaurant to place your order.",
      mapsLoadError: "The map could not load. Please try again or contact the restaurant to place your order.",
      copyAddress: "Copy address",
      moreOptions: "Optional details",
      notes: "Notes (optional)",
      pickupInstructions: "Pickup instructions (optional)",
      scheduleOrder: "Schedule this order",
      scheduleFor: "Preferred date and time",
      scheduleHint: "The restaurant will confirm the requested time.",
      add: "Add to order",
      empty: "Your basket is empty.",
      send: "Place order",
      delivery: "Delivery",
      pickup: "Pickup",
      search: "Search menu…",
      offer: "Special offers",
      sent: "Your order was received successfully!",
      noItems: "No menu items available yet.",
      category: "All",
      clear: "Clear",
      paymentNote: "Payment: Cash on delivery or cash at pickup.",
      sending: "Sending…",
      emptyCartError: "Add at least one item to your order.",
      addressError: "Please enter a delivery address.",
      minimumError: "Minimum order is",
      setupError: "Setup required: check the Supabase configuration in config.js.",
      loadError: "Could not load menu.",
      orderError: "Could not send order. Please try again.",
      cartAdded: "Added to basket:",
      cartRemoved: "Removed from basket:",
      cartQuantity: "Quantity updated:",
      cartCleared: "Basket cleared.",
      remove: "Remove",
      noSearchResults: "No menu items match your search. Clear the search or choose another category.",
      loadingMenu: "Loading menu…",
      retry: "Retry",
      activeOrdersHeading: "Current orders",
      historyHeading: "Your orders",
      currentOrdersGroup: "In progress",
      ordersUpdateNote: "We refresh order status automatically while this page is open.",
      pastOrdersGroup: "Previous orders",
      updatedAtLabel: "Updated",
      noCompletedOrders: "No completed orders yet.",
      refreshOrders: "Refresh",
      noTrackedOrders: "No saved orders yet. Place an order and it will appear here automatically.",
      loadingTrackedOrders: "Loading your saved orders…",
      couldNotLoadTrackedOrder: "Could not check this order right now. Check your connection and try again.",
      removeFromHistory: "Hide from this device",
      orderLabel: "Order",
      orderedAt: "Placed",
      step_received: "Received",
      step_accepted: "Accepted",
      step_preparing: "Preparing",
      step_ready: "Ready",
      step_out_for_delivery: "Out for delivery",
      step_completed: "Completed",
      unavailable: "Currently unavailable"
    },
    ar: {
      hero: "أطيب الأكلات محضّرة إلك.",
      orderNote: "اطلب أونلاين",
      orderNote2: "طلبك بيوصل مباشرة لنظام المطعم.",
      customerActionsTitle: "كيف فينا نساعدك اليوم؟",
      customerActionsDesc: "اطلب أكلاتك المفضلة، راجع طلباتك السابقة، أو احكي مع فريقنا.",
      backToHome: "← رجوع للرئيسية",
      placeOrderCard: "اطلب الآن",
      placeOrderCardDesc: "تصفّح المنيو واختار وجباتك للتوصيل أو الاستلام من المطعم.",
      placeOrderCardCta: "تصفّح المنيو",
      activeOrdersCard: "الطلبات النشطة",
      activeOrdersCardDesc: "تابع طلبك بعد قبوله وأثناء تحضيره أو توصيله.",
      activeOrdersCardCta: "تابع حالة الطلب",
      historyCard: "طلباتك",
      historyCardDesc: "تابع طلباتك الجارية وراجع الطلبات السابقة.",
      historyCardCta: "تابع طلباتك",
      helpCard: "المساعدة",
      helpCardDesc: "عندك سؤال عن الطلب أو التوصيل أو المنيو؟ راسلنا على واتساب.",
      helpCardCta: "تواصل عبر واتساب",
      menu: "المنيو",
      yourOrder: "طلبك",
      orderSummary: "ملخص الطلب",
      total: "الإجمالي النهائي",
      subtotal: "مجموع الأصناف",
      deliveryFee: "رسوم التوصيل",
      name: "اسمك",
      phone: "رقم الهاتف",
      orderType: "نوع الطلب",
      address: "عنوان التوصيل / علامة مميزة",
      addressHint: "الخريطة بتعبّي العنوان القريب. أضف رقم البيت أو معلم قريب إذا لزم.",
      chooseLocation: "حدد موقع التوصيل",
      clearLocation: "تغيير الموقع",
      locationNotSelected: "حدد موقع التوصيل على الخريطة قبل إرسال الطلب.",
      locationSelected: "تم تثبيت الدبوس",      locationConfirmed: "تم تعبئة العنوان من الخريطة",
      findingAddress: "عم نجيب العنوان من الخريطة…",
      mapTitle: "حدد موقع التوصيل",
      mapHelp: "استخدم موقعك الحالي أو ابحث عن معلم قريب. ثبّت الدبوس، والعنوان بيتعبّى تلقائياً.",
      mapSearchPlaceholder: "ابحث عن معلم قريب",
      mapSearchButton: "بحث",
      mapSearchNoResults: "ما لقينا المكان. جرّب معلماً قريباً أو حرّك الدبوس.",
      mapSearchError: "البحث غير متاح حالياً. فيك تحرّك الدبوس على الخريطة.",
      useCurrentLocation: "استخدم موقعي الحالي",
      confirmLocation: "تأكيد الموقع",
      cancel: "إلغاء",
      mapsNotConfigured: "الخريطة غير متاحة حالياً. جرّب مرة ثانية أو تواصل مع المطعم لإرسال طلبك.",
      mapsLoadError: "ما قدرنا نحمّل الخريطة. جرّب مرة ثانية أو تواصل مع المطعم لإرسال طلبك.",
      copyAddress: "نسخ العنوان",
      moreOptions: "خيارات إضافية (اختياري)",
      notes: "ملاحظات (اختياري)",
      pickupInstructions: "تعليمات الاستلام (اختياري)",
      scheduleOrder: "جدولة الطلب",
      scheduleFor: "التاريخ والوقت المطلوبان",
      scheduleHint: "المطعم سيؤكد الوقت المطلوب.",
      add: "أضف للطلب",
      empty: "السلة فارغة.",
      send: "إرسال الطلب",
      delivery: "توصيل",
      pickup: "استلام من المطعم",
      search: "ابحث بالمنيو…",
      offer: "العروض الخاصة",
      sent: "تم استلام طلبك بنجاح!",
      noItems: "ما في أصناف بالمنيو حالياً.",
      category: "الكل",
      clear: "مسح",
      paymentNote: "الدفع نقداً عند التوصيل أو الاستلام.",
      sending: "عم نرسل الطلب…",
      emptyCartError: "أضف وجبة واحدة على الأقل.",
      addressError: "يرجى إدخال عنوان التوصيل.",
      minimumError: "الحد الأدنى للطلب هو",
      setupError: "تحقق من إعدادات Supabase في ملف config.js.",
      loadError: "تعذّر تحميل المنيو.",
      orderError: "تعذّر إرسال الطلب. حاول مرة أخرى.",
      cartAdded: "أُضيف إلى السلة:",
      cartRemoved: "تمت إزالة من السلة:",
      cartQuantity: "تم تعديل الكمية:",
      cartCleared: "تم إفراغ السلة.",
      remove: "إزالة",
      noSearchResults: "ما لقينا أصناف تطابق البحث. امسح البحث أو اختار فئة تانية.",
      loadingMenu: "عم نحمّل المنيو…",
      retry: "إعادة المحاولة",
      activeOrdersHeading: "الطلبات الحالية",
      historyHeading: "طلباتك",
      currentOrdersGroup: "الطلبات الجارية",
      ordersUpdateNote: "حالة الطلب بتتحدّث تلقائياً طالما الصفحة مفتوحة.",
      pastOrdersGroup: "الطلبات السابقة",
      updatedAtLabel: "آخر تحديث",
      noCompletedOrders: "ما في طلبات مكتملة لسه.",
      refreshOrders: "تحديث",
      noTrackedOrders: "ما في طلبات محفوظة حالياً. لما تبعت طلب جديد رح يظهر هون تلقائياً.",
      loadingTrackedOrders: "عم نحمّل طلباتك…",
      couldNotLoadTrackedOrder: "ما قدرنا نتحقق من الطلب هلأ. تأكد من الإنترنت وحاول مرة تانية.",
      removeFromHistory: "إخفاء من هالجهاز",
      orderLabel: "الطلب",
      orderedAt: "تاريخ الطلب",
      step_received: "تم الاستلام",
      step_accepted: "تم القبول",
      step_preparing: "قيد التحضير",
      step_ready: "جاهز",
      step_out_for_delivery: "خرج للتوصيل",
      step_completed: "مكتمل",
      unavailable: "غير متوفر حالياً"
    },
    tw: {
      hero: "Aduan pa a, wɔasiesie ama wo.",
      orderNote: "Fa wo nsa hyɛ nneɛma ho wɔ intanɛt so",
      orderNote2: "Wo nhyehyɛe no kɔ tẽẽ ma adidibea no.",
      customerActionsTitle: "Yɛbɛboa wo sɛn nnɛ?",
      customerActionsDesc: "Hyɛ aduan ho nhyehyɛe, hwɛ wo kan nhyehyɛe, anaa kasa kyerɛ yɛn.",
      backToHome: "← San kɔ fie" ,
      placeOrderCard: "Hyɛ aduan ho nhyehyɛe",
      placeOrderCardDesc: "Hwɛ yɛn aduan din no na paw nea wopɛ ama wɔde abrɛ wo anaa woba abɛfa.",
      placeOrderCardCta: "Hwɛ aduan din",
      activeOrdersCard: "Nneɛma a wɔresiesie",
      activeOrdersCardDesc: "Hwɛ wo nhyehyɛe a wɔagye atom bere a wɔresiesie anaa wɔde rebrɛ wo.",
      activeOrdersCardCta: "Hwɛ nhyehyɛe no tebea",
      historyCard: "Wo nhyehyɛe",
      historyCardDesc: "Hwɛ nhyehyɛe a ɛrekɔ so ne nea woayɛ dada.",
      historyCardCta: "Hwɛ wo nhyehyɛe",
      helpCard: "Mmoa",
      helpCardDesc: "Wowɔ nsɛmmisa wɔ nhyehyɛe, delivery anaa aduan din no ho? Soma yɛn WhatsApp.",
      helpCardCta: "Kasa kyerɛ yɛn WhatsApp",
      menu: "Nneɛma a yɛtɔn",
      yourOrder: "Wo nneɛma a woapaw",
      orderSummary: "Order summary",
      total: "Grand total",
      subtotal: "Items subtotal",
      deliveryFee: "Ka a wɔde bɛbrɛ wo",
      name: "Wo din",
      phone: "Telefon nɔma",
      orderType: "Ɔkwan a wopɛ sɛ wunya aduan no",
      address: "Beae a wɔde bɛbrɛ wo / agyiraehyɛde",
      addressHint: "Map no bɛkyerɛ address a ɛbɛn hɔ. Fa fie nɔma anaa agyiraehyɛde ka ho sɛ ɛho hia.",
      chooseLocation: "Paw delivery beae",
      clearLocation: "Sesa delivery beae",
      locationNotSelected: "Paw delivery beae wɔ map no so ansa na woahyɛ order.",
      locationSelected: "Wɔapaw pin no",      locationConfirmed: "Wɔde address no aba afi map no so",
      findingAddress: "Yɛregye address no afi map no so…",
      mapTitle: "Paw delivery beae",
      mapHelp: "Fa wo beae a wowɔ seesei yɛ adwuma anaa hwehwɛ agyiraehyɛde a ɛbɛn. Si pin no so dua; address no bɛba ara kwa.",
      mapSearchPlaceholder: "Hwehwɛ agyiraehyɛde a ɛbɛn",
      mapSearchButton: "Hwehwɛ",
      mapSearchNoResults: "Yenhu beae no. Sɔ agyiraehyɛde a ɛbɛn no hwɛ anaa sesa pin no.",
      mapSearchError: "Hwehwɛde no nni hɔ. Wubetumi asesa pin no wɔ map no so.",
      useCurrentLocation: "Fa me beae a mewɔ",
      confirmLocation: "Si beae no so dua",
      cancel: "Twa mu",
      mapsNotConfigured: "Map no nni hɔ seesei. San sɔ hwɛ anaa frɛ adidibea no ma wɔmmoa wo.",
      mapsLoadError: "Map no antumi amma. San sɔ hwɛ anaa frɛ adidibea no ma wɔmmoa wo.",
      copyAddress: "Kɔpi address",
      moreOptions: "Nsɛm foforo a wopɛ a",
      notes: "Nsɛm foforo (wopɛ a)",
      pickupInstructions: "Akwan a yɛmfa nkyerɛ wo wɔ restaurant no (wopɛ a)",
      scheduleOrder: "Hyɛ bere ma wo order",
      scheduleFor: "Da ne bere a wopɛ",
      scheduleHint: "Restaurant no bɛsi bere a wopɛ no so dua.",
      add: "Fa ka wo nneɛma ho",
      empty: "Wunni biribiara wɔ wo nneɛma mu.",
      send: "Fa wo nhyehyɛe no mena",
      delivery: "Fa brɛ me",
      pickup: "Mɛba abɛfa",
      search: "Hwehwɛ aduan…",
      offer: "Nneɛma a yɛde ama wɔ bo pa mu",
      sent: "Yɛanya wo nhyehyɛe no. Yɛda wo ase!",
      noItems: "Nneɛma biara nni hɔ seesei.",
      category: "Ne nyinaa",
      clear: "Pepa",
      paymentNote: "Sika tua bere a wɔde aduan no brɛ wo anaa woba bɛfa no.",
      sending: "Ɛrekɔ…",
      emptyCartError: "Fa aduan biako anaa nea ɛboro saa ka wo nneɛma ho.",
      addressError: "Kyerɛw beae a wɔde aduan no bɛbrɛ wo.",
      minimumError: "Sika a ɛsua koraa a ɛsɛ sɛ wotɔ ne",
      setupError: "Hwɛ Supabase nhyehyɛe a ɛwɔ config.js mu.",
      loadError: "Yentumi annye aduan no din.",
      orderError: "Yentumi amena wo nhyehyɛe no. Yɛsrɛ wo, san yɛ bio.",
      cartAdded: "Wɔde kaa wo nneɛma ho:",
      cartRemoved: "Wɔayi afi wo nneɛma mu:",
      cartQuantity: "Wɔasesa dodow:",
      cartCleared: "Wɔapepa wo nneɛma nyinaa.",
      remove: "Yi fi mu",
      noSearchResults: "Yɛannya aduan a ɛne wo hwehwɛde hyia. Pepa hwehwɛde no anaa paw kuw foforo.",
      loadingMenu: "Aduan din no reba…",
      retry: "San sɔ hwɛ",
      activeOrdersHeading: "Wo nhyehyɛe a ɛrekɔ so",
      historyHeading: "Wo nhyehyɛe",
      currentOrdersGroup: "Ɛrekɔ so",
      ordersUpdateNote: "Sɛ krataafa yi da hɔ a, wɔbɛma wo nsɛm foforo wɔ nhyehyɛe no ho.",
      pastOrdersGroup: "Nea atwam",
      updatedAtLabel: "Wɔsesaa no",
      noCompletedOrders: "No completed orders yet.",
      refreshOrders: "Refresh",
      noTrackedOrders: "Wonni nhyehyɛe biara a wɔakora so. Sɛ wode bi to hɔ a, ɛbɛda ha.",
      loadingTrackedOrders: "Loading your saved orders…",
      couldNotLoadTrackedOrder: "Could not check this order right now. Check your connection and try again.",
      removeFromHistory: "Yi fi mfiri yi so",
      orderLabel: "Order",
      orderedAt: "Bere a wɔde too hɔ",
      step_received: "Wɔagye",
      step_accepted: "Wɔagye atom",
      step_preparing: "Woresiesie",
      step_ready: "Ayɛ krado",
      step_out_for_delivery: "Wɔde aba wo nkyɛn",
      step_completed: "Wɔawie",
      unavailable: "Ɛnni hɔ seesei"
    }
  };

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);
  const tr = key => (translations[lang] && translations[lang][key]) || translations.en[key] || key;
  const localized = (english, arabic, twi) => lang === "ar" ? arabic : lang === "tw" ? twi : english;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  const trackingStatusNames = {
    en: { new:"Sent — waiting for restaurant acceptance", accepted:"Accepted by restaurant", preparing:"Preparing", ready:"Ready", out_for_delivery:"Out for delivery", completed:"Completed", rejected:"Rejected" },
    ar: { new:"تم إرسال الطلب وبانتظار قبول المطعم", accepted:"تم قبول الطلب", preparing:"قيد التحضير", ready:"جاهز", out_for_delivery:"خرج للتوصيل", completed:"مكتمل", rejected:"مرفوض" },
    tw: { new:"Wɔde nhyehyɛe no asoma — yɛretwɛn adidibea no", accepted:"Adidibea no agye atom", preparing:"Woresiesie aduan no", ready:"Aduan no ayɛ krado", out_for_delivery:"Aduan no wɔ kwan so rebrɛ wo", completed:"Wɔde ama wo", rejected:"Wɔapo nhyehyɛe no" }
  };

  function orderHistoryStorageKey() {
    return authSession?.user?.id ? ORDER_HISTORY_KEY + ":" + authSession.user.id : ORDER_HISTORY_KEY;
  }

  function readTrackedOrders() {
    try {
      const key = orderHistoryStorageKey();
      let raw = storageGet(key);
      if (raw === null && authSession?.user?.id) {
        // One-time migration from the older shared key. Move it into the currently signed-in account.
        const legacy = storageGet(ORDER_HISTORY_KEY);
        if (legacy !== null) {
          try {
            localStorage.setItem(key, legacy);
            localStorage.removeItem(ORDER_HISTORY_KEY);
            raw = legacy;
          } catch (_) {
            raw = legacy;
          }
        }
      }
      const rows = JSON.parse(raw || "[]");
      return Array.isArray(rows)
        ? rows.filter(row => row && typeof row.token === "string" && TRACKING_TOKEN_RE.test(row.token)).slice(0,25)
        : [];
    } catch (_) { return []; }
  }

  function saveTrackedOrders(rows) {
    storageSet(orderHistoryStorageKey(), JSON.stringify(rows.slice(0,25)));
  }

  function rememberOrderTrackingToken(token, orderNumber) {
    token = String(token || "").trim().toLowerCase();
    if (!TRACKING_TOKEN_RE.test(token)) return false;
    const rows = readTrackedOrders().filter(row => row.token !== token);
    rows.unshift({ token, orderNumber: String(orderNumber || ""), savedAt: new Date().toISOString(), lastStatus: "new" });
    saveTrackedOrders(rows);
    return true;
  }

  function trackingStatusText(status, orderType = …15879 tokens truncated….name)}</strong>
                <small>${money(item.price)} each</small>
              </div>
              <label class="cart-item-note">${escapeHTML(localized("Note for this item (optional)", "ملاحظة لهالصنف (اختياري)", "Note for this item (optional)"))}
                <textarea data-item-note="${escapeHTML(id)}" maxlength="500" rows="2">${escapeHTML(cartItemNotes[id] || "")}</textarea>
              </label>
              <div class="qty-controls" aria-label="Quantity controls for ${escapeHTML(item.name)}">
                <button type="button" data-dec="${escapeHTML(id)}"
                  aria-label="${lang === "ar" ? "إنقاص كمية " : lang === "tw" ? "Te dodow so " : "Decrease quantity of "}${escapeHTML(item.name)}">−</button>
                <strong aria-label="${localized("Quantity ", "الكمية ", "Dodow ")}${Number(quantity)}">${Number(quantity)}</strong>
                <button type="button" data-inc="${escapeHTML(id)}"
                  aria-label="${lang === "ar" ? "زيادة كمية " : lang === "tw" ? "Ma dodow nyin " : "Increase quantity of "}${escapeHTML(item.name)}">+</button>
                <button type="button" class="btn-remove-item" data-remove="${escapeHTML(id)}"
                  aria-label="${tr("remove")} ${escapeHTML(item.name)}">${tr("remove")}</button>
              </div>
              <strong>${money(Number(item.price) * Number(quantity))}</strong>
            </div>
          `;
        }).join("")
      : `<p class="muted">${tr("empty")}</p>`;

    const subtotal = calculateSubtotal(rows);
    const currentFee = isDelivery ? (selectedZone ? Number(selectedZone.delivery_fee) : (zoneRequired ? null : deliveryFee)) : 0;
    const total = subtotal + Number(currentFee || 0);
    const itemCount = rows.reduce((sum, [, quantity]) => sum + Number(quantity || 0), 0);
    if (floatingCartCount) floatingCartCount.textContent = String(itemCount);
    if (floatingCartTotal) floatingCartTotal.textContent = money(total);
    if (floatingCartButton) {
      floatingCartButton.setAttribute("aria-label", (lang === "ar" ? "انتقل إلى طلبك، عدد القطع " : lang === "tw" ? "Kɔ wo order so, nneɛma " : "Go to your order, items ") + itemCount + ", " + money(total));
      floatingCartButton.classList.toggle("has-items", rows.length > 0);
    }

    if ($("#cart-subtotal")) {
      $("#cart-subtotal").textContent = money(subtotal);
    }

    if ($("#cart-delivery-fee")) {
      $("#cart-delivery-fee").textContent = currentFee === null
        ? localized("Outside delivery area", "خارج مناطق التوصيل", "Outside delivery area")
        : money(currentFee);
    }

    if ($("#cart-total")) {
      $("#cart-total").textContent = money(total);
    }

    const feeLine = $("#delivery-fee-line");
    if (feeLine) feeLine.hidden = false;

    const minimumNote = $("#minimum-order-note");
    if (minimumNote) {
      minimumNote.hidden = minimumOrder <= 0;
      minimumNote.textContent = minimumOrder > 0
        ? `${tr("minimumError")} ${money(minimumOrder)}.`
        : "";
    }

    cartItems.querySelectorAll("[data-item-note]").forEach(field => {
      field.addEventListener("input", () => {
        cartItemNotes[field.dataset.itemNote] = field.value.slice(0, 500);
        persistCartItemNotes();
      });
    });

    cartItems.querySelectorAll("[data-dec]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.dec;
        cart[id] = Number(cart[id] || 0) - 1;

        const item = getCartEntry(id);
        const removed = cart[id] <= 0;
        if (removed) {
          delete cart[id];
          delete cartItemNotes[id];
          persistCartItemNotes();
        }
        persistCart();
        renderCart();
        if (item) announceCartChange(removed ? "cartRemoved" : "cartQuantity", item.name, removed ? undefined : cart[id]);
      });
    });

    cartItems.querySelectorAll("[data-inc]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.inc;
        const item = getCartEntry(id);
        cart[id] = Math.min(50, Number(cart[id] || 0) + 1);
        persistCart();
        renderCart();
        if (item) announceCartChange("cartQuantity", item.name, cart[id]);
      });
    });

    cartItems.querySelectorAll("[data-remove]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.remove;
        const item = getCartEntry(id);
        delete cart[id];
        delete cartItemNotes[id];
        persistCartItemNotes();
        persistCart();
        renderCart();
        if (item) announceCartChange("cartRemoved", item.name);
      });
    });
  }

  function offerWindowStatus(offer, now = Date.now()) {
    const startsAt = offer?.starts_at ? new Date(offer.starts_at).getTime() : null;
    const endsAt = offer?.ends_at ? new Date(offer.ends_at).getTime() : null;
    if (startsAt !== null && !Number.isFinite(startsAt)) return "expired";
    if (endsAt !== null && !Number.isFinite(endsAt)) return "expired";
    if (startsAt !== null && startsAt > now) return "upcoming";
    if (endsAt !== null && endsAt < now) return "expired";
    return "active";
  }

  function offerWindowSignature(items, now = Date.now()) {
    return JSON.stringify((items || []).map(offer => [
      offer.id,
      offerWindowStatus(offer, now)
    ]));
  }

  function offerDate(value, fallback) {
    if (!value || !Number.isFinite(new Date(value).getTime())) return fallback;
    return new Date(value).toLocaleDateString();
  }

  function ensureOfferDetailsDialog() {
    let dialog = $("#offer-details-dialog");
    if (dialog) return dialog;

    dialog = document.createElement("div");
    dialog.id = "offer-details-dialog";
    dialog.className = "offer-details-backdrop";
    dialog.hidden = true;
    dialog.setAttribute("role", "presentation");

    const panel = document.createElement("section");
    panel.className = "offer-details-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "offer-details-title");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "offer-details-close";
    close.setAttribute("aria-label", localized("Close", "إغلاق", "To mu"));
    close.textContent = "×";

    const title = document.createElement("h2");
    title.id = "offer-details-title";

    const details = document.createElement("p");
    details.id = "offer-details-copy";

    const price = document.createElement("p");
    price.id = "offer-details-price";
    price.className = "offer-details-price";
    const dates = document.createElement("p");
    dates.id = "offer-details-dates";
    dates.className = "offer-details-dates";

    close.addEventListener("click", () => { dialog.hidden = true; });
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.hidden = true;
    });
    panel.append(close, title, details, price, dates);
    dialog.append(panel);
    document.body.append(dialog);
    return dialog;
  }

  function showOfferDetails(offer) {
    const dialog = ensureOfferDetailsDialog();
    $("#offer-details-title").textContent = offer.title || tr("offer");
    $("#offer-details-copy").textContent = offer.details || localized("Ask our team for offer details.", "اسأل فريقنا عن تفاصيل العرض.", "Bisa yɛn adwumayɛfoɔ no ma wɔmfa offer no ho nsɛm mma wo.");
    $("#offer-details-price").textContent = Number(offer.price) > 0
      ? localized("Offer price: ", "سعر العرض: ", "Offer price: ") + money(offer.price)
      : localized("Price not set yet", "السعر غير محدد بعد", "Price not set yet");
    $("#offer-details-dates").textContent =
      localized("Starts: ", "تاريخ البدء: ", "Ɛhyɛ ase: ") + offerDate(offer.starts_at, localized("Not set", "غير محدد", "Nni hɔ")) +
      " · " + localized("Ends: ", "تاريخ الانتهاء: ", "Ɛba awiei: ") + offerDate(offer.ends_at, localized("Not set", "غير محدد", "Nni hɔ"));
    dialog.hidden = false;
    window.requestAnimationFrame(() => $(".offer-details-close")?.focus());
  }

  function addOfferItemToCart(offer, card) {
    const feedback = card.querySelector(".offer-feedback");
    const price = Number(offer.price);
    const availability = offerWindowStatus(offer);
    if (availability !== "active") {
      if (feedback) feedback.textContent = availability === "upcoming"
        ? localized(
            "This offer starts on " + offerDate(offer.starts_at, "the scheduled date") + ".",
            "يبدأ هذا العرض بتاريخ " + offerDate(offer.starts_at, "الموعد المحدد") + ".",
            "This offer starts on " + offerDate(offer.starts_at, "the scheduled date") + "."
          )
        : localized("This offer has ended.", "انتهى هذا العرض.", "This offer has ended.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      if (feedback) feedback.textContent = localized(
        "The restaurant has not set a price for this offer yet.",
        "المطعم لم يحدد سعر هذا العرض بعد.",
        "The restaurant has not set a price for this offer yet."
      );
      return;
    }

    const id = "offer:" + String(offer.id);
    cart[id] = Math.min(50, Number(cart[id] || 0) + 1);
    persistCart();
    renderCart();
    announceCartChange("cartAdded", offer.title || tr("offer"), cart[id]);
    if (feedback) feedback.textContent = localized(
      "Offer added to your basket.",
      "أضفنا العرض إلى سلتك.",
      "Offer added to your basket."
    );
    $(".checkout-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderOffers() {
    const container = $("#active-offers");
    if (!container) return;
    container.replaceChildren();
    if (!offers.length || isHistoryPage) return;

    const wall = document.createElement("section");
    wall.className = "offer-wall";
    wall.setAttribute("aria-label", localized("Current offers", "العروض الحالية", "Offers a ɛwɔ hɔ seesei"));

    offers.forEach(offer => {
      const card = document.createElement("article");
      card.className = "offer-float-card";

      const badge = document.createElement("span");
      badge.className = "offer-badge";
      const availability = offerWindowStatus(offer);
      badge.textContent = availability === "upcoming"
        ? localized("COMING SOON", "قريباً", "COMING SOON")
        : localized("TODAY’S OFFER", "عرض اليوم", "NNƐ OFFER");

      const heading = document.createElement("h2");
      heading.className = "offer-card-title";
      heading.textContent = offer.title || tr("offer");

      const summary = document.createElement("p");
      summary.className = "offer-card-summary";
      summary.textContent = offer.details || localized("Limited-time offer", "عرض لفترة محدودة", "Offer a ɛwɔ bere tiawa mu");

      const price = document.createElement("p");
      price.className = "offer-card-price";
      const hasPrice = Number.isFinite(Number(offer.price)) && Number(offer.price) > 0;
      price.classList.toggle("is-unset", !hasPrice);
      price.textContent = hasPrice
        ? localized("Offer price: ", "سعر العرض: ", "Offer price: ") + money(offer.price)
        : localized("Price not set yet", "السعر غير محدد بعد", "Price not set yet");

      const dates = document.createElement("p");
      dates.className = "offer-card-dates";
      dates.textContent =
        localized("Starts ", "يبدأ ", "Ɛhyɛ ase ") + offerDate(offer.starts_at, localized("Not set", "غير محدد", "Nni hɔ")) +
        " · " + localized("Ends ", "ينتهي ", "Ɛba awiei ") + offerDate(offer.ends_at, localized("Not set", "غير محدد", "Nni hɔ"));

      const actions = document.createElement("div");
      actions.className = "offer-card-actions";

      const detailsButton = document.createElement("button");
      detailsButton.type = "button";
      detailsButton.className = "offer-details-button";
      detailsButton.textContent = localized("Offer details", "تفاصيل العرض", "Offer no ho nsɛm");
      detailsButton.addEventListener("click", () => showOfferDetails(offer));

      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "offer-add-button";
      addButton.textContent = !hasPrice
        ? localized("Price not set", "السعر غير محدد", "Price not set")
        : availability === "upcoming"
          ? localized(
              "Starts " + offerDate(offer.starts_at, "soon"),
              "يبدأ " + offerDate(offer.starts_at, "قريباً"),
              "Starts " + offerDate(offer.starts_at, "soon")
            )
          : localized("Add to basket", "أضف للسلة", "Fa ka basket ho");
      addButton.disabled = !hasPrice || availability !== "active";
      addButton.addEventListener("click", () => addOfferItemToCart(offer, card));

      const feedback = document.createElement("p");
      feedback.className = "offer-feedback";
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");

      actions.append(detailsButton, addButton);
      card.append(badge, heading, summary, price, dates, actions, feedback);
      wall.append(card);
    });

    container.append(wall);
  }

  async function loadMenuAndSettings() {
    if (!authSession?.user || (authSession.user.user_metadata?.phone_e164 && customerPhoneValidatedUserId !== authSession.user.id)) {
      lockCustomerApp("Please sign in or finish account verification before viewing the menu.");
      return;
    }
    if (menuLoading) return;
    menuLoading = true;
    const retryButton = $("#retry-menu");
    const menu = $("#menu");
    if (retryButton) {
      retryButton.hidden = true;
      retryButton.disabled = true;
    }
    if (menu) menu.innerHTML = `<p class="loading" role="status">${escapeHTML(tr("loadingMenu"))}</p>`;
    showAppStatus(tr("loadingMenu"));

    try {
      if (!db) throw new Error(tr("setupError"));
      const [menuResult, offerResult, settingsResult] = await Promise.all([
        db.from("menu_items")
          .select("id,name,category,description,price,image_url,is_available,sort_order")
          .order("sort_order")
          .order("name"),
        db.from("offers")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        db.from("restaurant_settings")
          .select("delivery_fee,minimum_order,restaurant_name")
          .eq("id", 1)
          .maybeSingle()
      ]);

      if (menuResult.error) throw menuResult.error;
      if (offerResult.error) throw offerResult.error;
      if (settingsResult.error) throw settingsResult.error;

      const schedulingResult = await db.from("restaurant_settings")
        .select("allow_scheduled_orders,schedule_min_notice_minutes,schedule_max_days,default_prep_minutes,default_delivery_minutes")
        .eq("id", 1).maybeSingle();
      schedulingEnabled = !schedulingResult.error && schedulingResult.data?.allow_scheduled_orders === true;
      if (!schedulingResult.error && schedulingResult.data) {
        scheduleMinNoticeMinutes = Number(schedulingResult.data.schedule_min_notice_minutes || 60);
        scheduleMaxDays = Number(schedulingResult.data.schedule_max_days || 14);
        defaultPrepMinutes = schedulingResult.data.default_prep_minutes == null ? null : Number(schedulingResult.data.default_prep_minutes);
        defaultDeliveryMinutes = schedulingResult.data.default_delivery_minutes == null ? null : Number(schedulingResult.data.default_delivery_minutes);
      }
      const scheduleSection = $("#schedule-order-section");
      if (scheduleSection) scheduleSection.hidden = !schedulingEnabled;
      const scheduleInput = $("#requested-for-input");
      if (scheduleInput) {
        const minDate = new Date(Date.now() + scheduleMinNoticeMinutes * 60000);
        const maxDate = new Date(Date.now() + scheduleMaxDays * 86400000);
        const toLocalInput = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        scheduleInput.min = toLocalInput(minDate);
        scheduleInput.max = toLocalInput(maxDate);
      }

      const zonesResult = await db.from("delivery_zones")
        .select("id,name,center_latitude,center_longitude,radius_km,delivery_fee,estimated_delivery_minutes")
        .eq("is_active", true)
        .order("radius_km");
      deliveryZoneLookupAvailable = !zonesResult.error;
      activeDeliveryZones = deliveryZoneLookupAvailable ? (zonesResult.data || []) : [];

      popularityByMenuItem = new Map();
      try {
        const popularityResult = await db.rpc("get_public_menu_popularity");
        if (popularityResult.error) throw popularityResult.error;
        for (const row of popularityResult.data || []) {
          if (row.menu_item_id) popularityByMenuItem.set(String(row.menu_item_id), Number(row.order_count || 0));
        }
      } catch (popularityError) {
        // Popularity is optional; menu and checkout must remain usable if this read fails.
        console.warn("Menu popularity could not be loaded; using restaurant order:", popularityError);
      }

      products = menuResult.data || [];
      const detailsResult = await db.from("menu_items")
        .select("id,prep_minutes,ingredients,portion_info,spice_level,allergens");
      menuFeatureDetailsAvailable = !detailsResult.error;
      if (menuFeatureDetailsAvailable) {
        const detailsById = new Map((detailsResult.data || []).map(row => [String(row.id), row]));
        products = products.map(product => ({ ...product, ...(detailsById.get(String(product.id)) || {}) }));
      }
      approvedMenuReviewsByItem = new Map();
      const reviewsResult = await db.from("menu_reviews")
        .select("menu_item_id,rating,review_text,photo_url,created_at")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!reviewsResult.error) {
        for (const review of reviewsResult.data || []) {
          const key = String(review.menu_item_id);
          if (!approvedMenuReviewsByItem.has(key)) approvedMenuReviewsByItem.set(key, []);
          approvedMenuReviewsByItem.get(key).push(review);
        }
      }
      const now = Date.now();
      offers = (offerResult.data || []).filter(offer =>
        offerWindowStatus(offer, now) !== "expired"
      );
      offerAvailabilitySignature = offerWindowSignature(offers, now);
      cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
        Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 50 &&
        Boolean(getCartEntry(id))
      ));
      persistCart();
      deliveryFee = Math.max(0, Number(settingsResult.data?.delivery_fee || 0));
      minimumOrder = Math.max(0, Number(settingsResult.data?.minimum_order || 0));

      renderCategories();
      renderMenu();
      renderCart();
      renderOffers();
      customerCatalogLastRefreshAt = Date.now();
      startCustomerCatalogRefresh();
      showAppStatus("");
      if (retryButton) retryButton.hidden = true;
    } catch (error) {
      console.error("AL SHAMI menu loading error:", error);
      const detail = String(error?.message || "");
      const message = (typeof navigator !== "undefined" && navigator.onLine === false) ||
        /failed to fetch|networkerror|network request failed|fetch failed/i.test(detail)
        ? localized("Couldn't connect to load the menu. Check your connection and retry.", "تعذر الاتصال لتحميل المنيو. تحقق من الإنترنت ثم أعد المحاولة.", "Yentumi anhyɛ aduan din no. Hwɛ internet na san sɔ hwɛ.")
        : (detail || tr("loadError"));
      showAppStatus(message, true);
      if (menu) menu.innerHTML = `<p class="muted">${escapeHTML(tr("loadError"))}</p>`;
      if (retryButton) retryButton.hidden = false;
    } finally {
      menuLoading = false;
      if (retryButton) retryButton.disabled = false;
    }
  }


  function menuCatalogSignature(items) {
    return JSON.stringify((items || []).map(item => [
      item.id, item.name, item.category, item.description, item.price, item.image_url,
      item.is_available, item.sort_order, item.prep_minutes, item.ingredients,
      item.portion_info, item.spice_level, item.allergens
    ]));
  }

  function offersCatalogSignature(items) {
    return JSON.stringify((items || []).map(offer => [
      offer.id, offer.title, offer.details, offer.price, offer.starts_at, offer.ends_at
    ]));
  }

  function syncOfferWindowState(now = Date.now()) {
    const nextOffers = offers.filter(offer => offerWindowStatus(offer, now) !== "expired");
    const nextSignature = offerWindowSignature(nextOffers, now);
    if (nextSignature === offerAvailabilitySignature && nextOffers.length === offers.length) return false;

    offers = nextOffers;
    offerAvailabilitySignature = nextSignature;
    cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
      Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 50 &&
      Boolean(getCartEntry(id))
    ));
    persistCart();
    renderOffers();
    renderCart();
    return true;
  }

  async function refreshCustomerCatalog() {
    if (!db || !authSession?.user || menuLoading || customerCatalogRefreshInProgress) return;
    if (document.visibilityState === "hidden" || navigator.onLine === false) return;
    if (Date.now() - customerCatalogLastRefreshAt < 8000) return;

    customerCatalogRefreshInProgress = true;
    customerCatalogLastRefreshAt = Date.now();
    try {
      const [menuResult, offerResult] = await Promise.all([
        db.from("menu_items")
          .select("id,name,category,description,price,image_url,is_available,sort_order,prep_minutes,ingredients,portion_info,spice_level,allergens")
          .order("sort_order")
          .order("name"),
        db.from("offers")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
      ]);
      if (menuResult.error) throw menuResult.error;
      if (offerResult.error) throw offerResult.error;

      const nextProducts = menuResult.data || [];
      const now = Date.now();
      const nextOffers = (offerResult.data || []).filter(offer =>
        offerWindowStatus(offer, now) !== "expired"
      );
      const menuChanged = menuCatalogSignature(nextProducts) !== menuCatalogSignature(products);
      const offersChanged = offersCatalogSignature(nextOffers) !== offersCatalogSignature(offers);
      const nextOfferAvailabilitySignature = offerWindowSignature(nextOffers, now);
      const offerWindowChanged = nextOfferAvailabilitySignature !== offerAvailabilitySignature;
      if (!menuChanged && !offersChanged && !offerWindowChanged) return;
      if (menuChanged) {
        products = nextProducts;
        menuFeatureDetailsAvailable = true;
        cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
          Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 50 &&
          products.some(product => String(product.id) === String(id) && product.is_available !== false)
        ));
        persistCart();
        renderCategories();
        renderMenu();
        renderCart();
      }
      if (offersChanged || offerWindowChanged) {
        offers = nextOffers;
        offerAvailabilitySignature = nextOfferAvailabilitySignature;
        cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
          Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 50 &&
          Boolean(getCartEntry(id))
        ));
        persistCart();
        renderOffers();
        renderCart();
      }
    } catch (error) {
      console.warn("Customer menu/offers refresh failed; keeping the last loaded catalog.", error);
    } finally {
      customerCatalogRefreshInProgress = false;
    }
  }

  function startCustomerCatalogRefresh() {
    if (customerCatalogRefreshTimer) return;
    customerCatalogRefreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        syncOfferWindowState();
        void refreshCustomerCatalog();
      }
    }, CUSTOMER_CATALOG_REFRESH_INTERVAL_MS);
  }

  function refreshCustomerCatalogWhenActive() {
    if (document.visibilityState === "visible") void refreshCustomerCatalog();
  }

  window.addEventListener("focus", refreshCustomerCatalogWhenActive);
  window.addEventListener("pageshow", refreshCustomerCatalogWhenActive);
  window.addEventListener("online", refreshCustomerCatalogWhenActive);
  document.addEventListener("visibilitychange", refreshCustomerCatalogWhenActive);


  // Let customers copy the pickup confirmation code with one tap.
  document.addEventListener("click", async event => {
    const button = event.target?.closest?.(".receipt-code-copy");
    if (!button) return;
    event.preventDefault();
    const code = button.getAttribute("data-receipt-code") || "";
    if (!code) return;
    const originalLabel = button.textContent;
    const announceCopied = () => {
      button.textContent = localized("Copied ✓", "تم النسخ ✓", "Wɔakɔpi ✓");
      button.classList.add("is-copied");
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove("is-copied");
      }, 1800);
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(code);
      } else {
        const fallback = document.createElement("textarea");
        fallback.value = code;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand("copy");
        fallback.remove();
        if (!copied) throw new Error("Clipboard command did not succeed");
      }
      announceCopied();
    } catch (_) {
      const selection = window.getSelection?.();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(button.closest(".receipt-code-row")?.querySelector(".receipt-code-value") || button);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      button.textContent = localized("Select and copy", "حدّد الرمز وانسخه", "Paw na kɔpi");
      window.setTimeout(() => { button.textContent = originalLabel; }, 2200);
    }
  });

  $("#copy-address")?.addEventListener("click", async () => {
    const address = $("#restaurant-address")?.textContent?.trim() || "";
    const status = $("#copy-address-status");
    const announce = message => {
      if (status) status.textContent = message;
    };
    if (!address) {
      announce(localized("Restaurant address is unavailable.", "عنوان المطعم غير متوفر.", "Adidibea no address nni hɔ."));
      return;
    }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(address);
      } else {
        const fallback = document.createElement("textarea");
        fallback.value = address;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand("copy");
        fallback.remove();
        if (!copied) throw new Error("Clipboard command did not succeed");
      }
      announce(lang === "ar" ? "تم نسخ عنوان المطعم." : lang === "tw" ? "Wɔakɔpi adidibea no address." : "Restaurant address copied.");
    } catch (_) {
      const addressNode = $("#restaurant-address");
      if (addressNode && window.getSelection && document.createRange) {
        const range = document.createRange();
        range.selectNodeContents(addressNode);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      announce(localized("Automatic copy was blocked. The address is selected so you can copy it manually.", "تعذّر النسخ تلقائياً. تم تحديد العنوان؛ انسخه يدوياً.", "Yentumi ankɔpi no ara kwa. Yɛapaw address no; kɔpi no wo nsa."));
    }
  });

  // Keep the menu and order tracking in their own customer views.
  function openCustomerOrdering() {
    const view = $("#customer-ordering-view");
    if (!view) return;
    const ordersView = $("#customer-active-orders-view");
    if (ordersView) ordersView.hidden = true;
    document.body.classList.remove("customer-active-orders-open");
    document.body.classList.add("customer-ordering-open");
    view.hidden = false;
    const target = $("#menu-section") || view;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeCustomerOrdering() {
    const view = $("#customer-ordering-view");
    if (!view) return;
    document.body.classList.remove("customer-ordering-open");
    view.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openCustomerActiveOrders() {
    const view = $("#customer-active-orders-view");
    if (!view) return;
    const orderingView = $("#customer-ordering-view");
    if (orderingView) orderingView.hidden = true;
    document.body.classList.remove("customer-ordering-open");
    document.body.classList.add("customer-active-orders-open");
    view.hidden = false;
    $("#refresh-customer-orders")?.click();
    view.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeCustomerActiveOrders() {
    const view = $("#customer-active-orders-view");
    if (!view) return;
    document.body.classList.remove("customer-active-orders-open");
    view.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.AL_SHAMI_OPEN_ACTIVE_ORDERS = openCustomerActiveOrders;

  const notificationDestination = new URLSearchParams(window.location.search).get("open");
  if (notificationDestination === "orders") {
    window.setTimeout(() => {
      if (typeof window.AL_SHAMI_OPEN_ACTIVE_ORDERS === "function") {
        window.AL_SHAMI_OPEN_ACTIVE_ORDERS();
      }
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState(null, "", cleanUrl);
    }, 350);
  }


  if (document.body.classList.contains("customer-home-page")) {
    $(".customer-card-order")?.addEventListener("click", event => {
      event.preventDefault();
      openCustomerOrdering();
    });
    $(".customer-card-active-orders")?.addEventListener("click", event => {
      event.preventDefault();
      openCustomerActiveOrders();
    });
    $("#customer-order-back")?.addEventListener("click", closeCustomerOrdering);
    $("#customer-orders-back")?.addEventListener("click", closeCustomerActiveOrders);
  }


  $("#delivery-map-search-form")?.addEventListener("submit", event => { void searchDeliveryAddress(event); });
  $("#choose-delivery-location")?.addEventListener("click", () => { void openDeliveryMapPicker(); });
  $("#delivery-map-close")?.addEventListener("click", closeDeliveryMapPicker);
  $("#delivery-map-cancel")?.addEventListener("click", closeDeliveryMapPicker);
  $("#delivery-map-modal [data-close-delivery-map]")?.addEventListener("click", closeDeliveryMapPicker);
  $("#delivery-map-confirm")?.addEventListener("click", confirmDeliveryLocation);
  $("#clear-delivery-location")?.addEventListener("click", () => {
    clearDeliveryLocationSelection();
    renderCart();
  });
  $("#delivery-map-modal")?.addEventListener("keydown", event => {
    if (event.key === "Escape") closeDeliveryMapPicker();
  });
  $("#delivery-map-use-current")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setMapMessage(localized("This device does not support location access. Tap the map to choose a location.", "هذا الجهاز لا يدعم تحديد الموقع. اضغط على الخريطة لاختيار الموقع يدوياً.", "Mfiri yi ntumi nkyerɛ wo beae. Mia map no so na paw beae bi."), true);
      return;
    }
    const button = $("#delivery-map-use-current");
    if (button) button.disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
      if (button) button.disabled = false;
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (pendingDeliveryLocation) pendingDeliveryLocation = { ...pendingDeliveryLocation, address: "" };
      setPendingDeliveryLocation(lat, lng);
      if (deliveryMapInstance) {
        deliveryMapInstance.flyTo([lat, lng], 17);
      }
    }, error => {
      if (button) button.disabled = false;
      const msg = error?.code === 1
        ? localized("Allow location access, or tap the map to choose your location.", "اسمح للموقع بالوصول لموقع جهازك، أو اختار الموقع بالضغط على الخريطة.", "Ma app no kwan nhwɛ wo beae, anaa mia map no so na paw wo beae.")
        : localized("Couldn't get your location. Tap the map to choose it manually.", "تعذّر تحديد موقع جهازك. اختار الموقع بالضغط على الخريطة.", "Yentumi anhu wo beae. Mia map no so na paw beae no wo nsa.");
      setMapMessage(msg, true);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  $("#language")?.addEventListener("change", event => {
    lang = event.target.value;
    setLanguage();
  });

  $("#search")?.addEventListener("input", renderMenu);
  $("#retry-menu")?.addEventListener("click", () => {
    if (!menuLoading) loadMenuAndSettings();
  });
  $("#menu-sort")?.addEventListener("change", event => {
    sortMode = event.target.value || "default";
    renderMenu();
  });
  $("#remember-customer")?.addEventListener("change", event => {
    if (!event.target.checked) {
      try { localStorage.removeItem(CUSTOMER_KEY); } catch (_) {}
    } else {
      saveRememberedCustomerFromForm();
      showCheckoutMessage(localized("Your name and phone will be saved on this device only.", "سيتم حفظ الاسم والرقم على هذا الجهاز فقط.", "Wɔbɛkora wo din ne telefon nɔma no wɔ mfiri yi so nko ara."));
    }
  });
  checkoutForm?.elements?.customer_name?.addEventListener("input", saveRememberedCustomerFromForm);
  checkoutForm?.elements?.customer_phone?.addEventListener("input", saveRememberedCustomerFromForm);

  $("#schedule-order-toggle")?.addEventListener("change", () => {
    const enabled = $("#schedule-order-toggle").checked;
    $("#schedule-order-controls")?.toggleAttribute("hidden", !enabled);
    if (checkoutForm?.elements?.requested_for) checkoutForm.elements.requested_for.required = enabled;
  });

  $("#order-type")?.addEventListener("change", () => {
    const isPickup = $("#order-type").value === "pickup";

    $("#address-field")?.classList.toggle("hidden", isPickup);
    $("#pickup-instructions-field")?.classList.toggle("hidden", !isPickup);
    if (isPickup) clearDeliveryLocationSelection();

    if (checkoutForm?.elements?.delivery_address) {
      checkoutForm.elements.delivery_address.required = !isPickup;
    }

    renderCart();
  });

  $("#clear-cart")?.addEventListener("click", () => {
    if (submitting || !getCartRows().length) return;
    if (!window.confirm(localized("Clear all items from your basket?", "متأكد بدك تفضّي السلة كلها؟", "Wopɛ sɛ wopopa nneɛma a ɛwɔ basket no nyinaa?"))) return;
    cart = {};
    cartItemNotes = {};
    persistCartItemNotes();
    persistCart();
    renderCart();
    announceCartChange("cartCleared", "");
    showCheckoutMessage("");
  });

  function confirmOrderReview(summary) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement("div");
      overlay.id = "order-review-overlay";
      overlay.className = "order-review-overlay";
      const dialog = document.createElement("section");
      dialog.className = "order-review-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "order-review-title");
      dialog.setAttribute("aria-describedby", "order-review-summary");

      const brand = document.createElement("div");
      brand.className = "order-review-brand";
      brand.innerHTML = '<span class="order-review-brand-mark" aria-hidden="true">✦</span><span>AL SHAMI</span>';
      const title = document.createElement("h2");
      title.id = "order-review-title";
      title.textContent = localized("Review your order", "راجع طلبك", "Hwɛ wo order no");
      const intro = document.createElement("p");
      intro.className = "order-review-intro";
      intro.textContent = localized(
        "Check the items, delivery details and total before sending.",
        "تأكد من الأصناف ومعلومات التوصيل والإجمالي قبل إرسال الطلب.",
        "Hwɛ nneɛma, delivery nsɛm ne ne nyinaa ansa na woasoma."
      );
      const summaryBox = document.createElement("div");
      summaryBox.id = "order-review-summary";
      summaryBox.className = "order-review-summary";
      summaryBox.textContent = summary;
      const actions = document.createElement("div");
      actions.className = "order-review-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "order-review-cancel";
      cancel.textContent = localized("Go back", "رجوع للتعديل", "San kɔ nsakrae");
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "order-review-confirm";
      confirm.textContent = localized("Confirm and send order", "تأكيد وإرسال الطلب", "Gye tom na soma order");
      actions.append(cancel, confirm);
      dialog.append(brand, title, intro, summaryBox, actions);
      overlay.append(dialog);
      document.body.append(overlay);

      let finished = false;
      const finish = accepted => {
        if (finished) return;
        finished = true;
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(accepted);
      };
      const onKeydown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        } else if (event.key === "Tab") {
          if (event.shiftKey && document.activeElement === cancel) {
            event.preventDefault();
            confirm.focus();
          } else if (!event.shiftKey && document.activeElement === confirm) {
            event.preventDefault();
            cancel.focus();
          }
        }
      };
      cancel.addEventListener("click", () => finish(false));
      confirm.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", onKeydown);
      cancel.focus();
    });
  }

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async event => {
      event.preventDefault();

      // احفظ مرجع النموذج قبل بدء العملية غير المتزامنة.
      const formElement = checkoutForm;
      const submitButton = $("#place-order");

      if (submitting) return;

      if (!authSession?.user || (authSession.user.user_metadata?.phone_e164 && customerPhoneValidatedUserId !== authSession.user.id)) {
        lockCustomerApp("Please sign in or finish account verification before ordering.");
        showCheckoutMessage(localized("Please sign in or finish account verification before ordering.", "سجّل الدخول أو أكمل التحقق من الحساب أولاً.", "Yɛsrɛ wo, sign in anaa wie wo account verification ansa na woahyɛ order."), true);
        return;
      }

      if (!db) {
        showCheckoutMessage(tr("setupError"), true);
        return;
      }

      const rows = getCartRows();

      if (!rows.length) {
        showCheckoutMessage(tr("emptyCartError"), true);
        return;
      }

      const formData = new FormData(formElement);
      const customerName = String(formData.get("customer_name") || "").trim();
      if (!customerName) {
        showCheckoutMessage(localized("Please enter your name.", "اكتب اسمك.", "Yɛsrɛ wo, kyerɛw wo din."), true);
        formElement.elements.customer_name.focus();
        return;
      }
      let normalizedPhone;
      try { normalizedPhone = normalizeGhanaPhone(formData.get("customer_phone")); }
      catch (phoneError) {
        showCheckoutMessage(phoneError.message, true);
        formElement.elements.customer_phone.focus();
        return;
      }
      const orderType = String(formData.get("order_type") || "delivery");
      const address = String(formData.get("delivery_address") || "").trim();
      const deliveryLatitudeRaw = orderType === "delivery" ? String(formData.get("delivery_latitude") || "").trim() : "";
      const deliveryLongitudeRaw = orderType === "delivery" ? String(formData.get("delivery_longitude") || "").trim() : "";
      const deliveryLatitude = deliveryLatitudeRaw ? Number(deliveryLatitudeRaw) : null;
      const deliveryLongitude = deliveryLongitudeRaw ? Number(deliveryLongitudeRaw) : null;

      if (orderType === "delivery" && !address) {
        showCheckoutMessage(tr("addressError"), true);
        formElement.elements.delivery_address.focus();
        return;
      }

      if (orderType === "delivery" && (deliveryLatitude === null || deliveryLongitude === null)) {
        showCheckoutMessage(
          localized("Set the delivery pin on the map before placing your order.", "حدد موقع التوصيل على الخريطة قبل إرسال الطلب.", "Paw delivery beae wɔ map no so ansa na woahyɛ order."),
          true
        );
        $("#choose-delivery-location")?.focus();
        return;
      }



      if (orderType === "delivery" &&
          ((deliveryLatitude === null) !== (deliveryLongitude === null) ||
           (deliveryLatitude !== null && (!Number.isFinite(deliveryLatitude) || deliveryLatitude < -90 || deliveryLatitude > 90 ||
            !Number.isFinite(deliveryLongitude) || deliveryLongitude < -180 || deliveryLongitude > 180)))) {
        showCheckoutMessage(localized("The selected map location is invalid. Choose the location again or clear it.", "موقع الخريطة غير صالح. اختار الموقع من جديد أو امسحه.", "Map beae a woapaw no nyɛ nokware. Paw beae foforo anaa popa no."), true);
        return;
      }

      const deliveryZone = orderType === "delivery" && deliveryZoneLookupAvailable && activeDeliveryZones.length
        ? deliveryZoneForPoint(deliveryLatitude, deliveryLongitude)
        : null;
      if (orderType === "delivery" && deliveryZoneLookupAvailable && activeDeliveryZones.length && !deliveryZone) {
        showCheckoutMessage(localized("This address is outside our delivery zones.", "هالعنوان خارج مناطق التوصيل.", "This address is outside our delivery zones."), true);
        $("#choose-delivery-location")?.focus();
        return;
      }

      const requestedForValue = $("#schedule-order-toggle")?.checked
        ? String(formData.get("requested_for") || "").trim()
        : "";
      const scheduleRequested = Boolean($("#schedule-order-toggle")?.checked);
      const requestedForDate = requestedForValue ? new Date(requestedForValue) : null;
      if (scheduleRequested && !requestedForValue) {
        showCheckoutMessage(localized("Choose the preferred date and time.", "اختار التاريخ والوقت المطلوبين.", "Choose the preferred date and time."), true);
        $("#requested-for-input")?.focus();
        return;
      }
      if (requestedForValue && (!schedulingEnabled || !requestedForDate || !Number.isFinite(requestedForDate.getTime()) ||
          requestedForDate.getTime() < Date.now() + scheduleMinNoticeMinutes * 60000 ||
          requestedForDate.getTime() > Date.now() + scheduleMaxDays * 86400000)) {
        showCheckoutMessage(localized("Choose a time inside the available scheduling window.", "اختار وقت ضمن فترة الجدولة المتاحة.", "Choose a time inside the available scheduling window."), true);
        $("#requested-for-input")?.focus();
        return;
      }
      const requestedForIso = requestedForDate ? requestedForDate.toISOString() : null;

      const subtotal = calculateSubtotal(rows);

      if (subtotal < minimumOrder) {
        showCheckoutMessage(
          `${tr("minimumError")} ${money(minimumOrder)}.`,
          true
        );
        return;
      }

      const selectedDeliveryFee = orderType === "delivery"
        ? (deliveryZone ? Number(deliveryZone.delivery_fee) : deliveryFee)
        : 0;
      const submittedTotal = subtotal + selectedDeliveryFee;
      const itemPreparationMinutes = rows.map(([id]) => {
        const item = getCartEntry(id);
        if (item?.type === "offer") {
          const includedIds = new Set((item.offer.menu_item_ids || []).map(String));
          return Math.max(0, ...products
            .filter(product => includedIds.has(String(product.id)))
            .map(product => Number(product.prep_minutes || 0)));
        }
        return Number(item?.product?.prep_minutes || 0);
      });
      const maxPreparationMinutes = itemPreparationMinutes.length ? Math.max(...itemPreparationMinutes) : 0;
      const configuredPreparationMinutes = maxPreparationMinutes || Number(defaultPrepMinutes || 0);
      const configuredTravelMinutes = orderType === "pickup" ? 0 : Number(deliveryZone?.estimated_delivery_minutes || defaultDeliveryMinutes || 0);
      const estimatedOrderMinutes = configuredPreparationMinutes > 0 && (orderType === "pickup" || configuredTravelMinutes > 0)
        ? configuredPreparationMinutes + configuredTravelMinutes
        : null;

      const generalNotes = String(formData.get("notes") || "").trim();
      const pickupInstructions = orderType === "pickup" ? String(formData.get("pickup_instructions") || "").trim() : "";
      const orderSummary = [
        localized("Order type: ", "نوع الطلب: ", "Order no su: ") + tr(orderType),
        localized("Name: ", "الاسم: ", "Din: ") + customerName,
        localized("Phone: ", "الهاتف: ", "Telefon: ") + normalizedPhone,
        ...rows.map(([id, quantity]) => {
          const item = getCartEntry(id);
          const lineTotal = Number(item?.price || 0) * Number(quantity || 0);
          return `${quantity} × ${item?.name || "Item"} · ${money(lineTotal)}${cartItemNotes[id] ? " — " + cartItemNotes[id] : ""}`;
        }),
        ...(orderType === "delivery" ? [localized("Delivery address: ", "عنوان التوصيل: ", "Delivery address: ") + address] : []),
        ...(deliveryZone ? [localized("Delivery zone: ", "منطقة التوصيل: ", "Delivery zone: ") + deliveryZone.name] : []),
        ...(requestedForDate ? [localized("Requested time: ", "الوقت المطلوب: ", "Requested time: ") + requestedForDate.toLocaleString()] : []),
        ...(pickupInstructions ? [localized("Pickup instructions: ", "تعليمات الاستلام: ", "Pickup instructions: ") + pickupInstructions] : []),
        ...(generalNotes ? [localized("Order notes: ", "ملاحظات الطلب: ", "Order notes: ") + generalNotes] : []),
        "",
        localized("Subtotal: ", "المجموع الفرعي: ", "Subtotal: ") + money(subtotal),
        localized("Delivery fee: ", "رسوم التوصيل: ", "Delivery fee: ") + money(selectedDeliveryFee),
        ...(Number.isFinite(estimatedOrderMinutes) ? [localized("Estimated ready/delivery: ", "الوقت التقريبي للجهوزية/الوصول: ", "Estimated ready/delivery: ") + new Date((requestedForDate ? requestedForDate.getTime() : Date.now()) + estimatedOrderMinutes * 60000).toLocaleString()] : []),
        localized("Total: ", "الإجمالي: ", "Ne nyinaa: ") + money(submittedTotal)
      ].join("\n");
      if (!await confirmOrderReview(orderSummary)) return;

      const submittedItems = rows.map(([id, quantity]) => {
        const item = getCartEntry(id);
        const item_note = String(cartItemNotes[id] || "").trim() || null;
        if (item?.type === "offer") {
          return { offer_id: item.offer.id, expected_price: item.price, quantity: Number(quantity), item_note };
        }
        return { product_id: item.product.id, quantity: Number(quantity), item_note };
      });

      submitting = true;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = tr("sending");
      }

      showCheckoutMessage("");

      try {
        const pickupNote = orderType === "pickup" ? String(formData.get("pickup_instructions") || "").trim() : "";
        const itemNotesForLegacy = submittedItems.map(item => {
          if (!item.item_note) return "";
          const name = item.offer_id
            ? (offers.find(offer => String(offer.id) === String(item.offer_id))?.title || "Offer")
            : (products.find(row => String(row.id) === String(item.product_id))?.name || "Item");
          return name + ": " + item.item_note;
        }).filter(Boolean);
        const orderNotes = [
          generalNotes,
          pickupNote ? "Pickup instructions: " + pickupNote : "",
          requestedForDate ? "Requested time: " + requestedForDate.toLocaleString() : ""
        ].filter(Boolean).join("\n") || null;
        const legacyOrderNotes = [orderNotes, ...itemNotesForLegacy].filter(Boolean).join("\n") || null;
        const rpcArgs = {
          p_customer_name: String(formData.get("customer_name") || "").trim(),
          p_customer_phone: normalizedPhone,
          p_order_type: orderType,
          p_delivery_address: orderType === "delivery" ? address : null,
          p_notes: orderNotes,
          p_items: submittedItems,
          p_delivery_latitude: deliveryLatitude,
          p_delivery_longitude: deliveryLongitude,
          p_requested_for: requestedForIso,
          p_points_to_redeem: Math.max(0, Number(formData.get("loyalty_points_to_redeem") || 0)),
          p_redeem_stamp_reward: formData.get("redeem_stamp_reward") === "on",
          p_referral_code: String(formData.get("referral_code") || "").trim().toUpperCase() || null
        };
        let { data, error } = await db.rpc("place_order_with_rewards", rpcArgs);
        if (error?.code === "PGRST202") {
          if (submittedItems.some(item => item.offer_id)) {
            throw new Error(localized("Offer orders require the latest ordering update. Refresh the app and try again.", "طلبات العروض تحتاج تحديث نظام الطلبات. حدّث التطبيق وحاول مرة ثانية.", "Offer orders require the latest ordering update. Refresh the app and try again."));
          }
          if (rpcArgs.p_points_to_redeem > 0 || rpcArgs.p_redeem_stamp_reward || rpcArgs.p_referral_code) {
            throw new Error(localized("Apply the optional rewards database upgrade before using points or a referral code.", "لازم تطبيق تحديث المكافآت على قاعدة البيانات قبل استخدام النقاط أو رمز الإحالة.", "Apply the optional rewards database upgrade before using points or a referral code."));
          }
          const legacyArgs = { ...rpcArgs };
          delete legacyArgs.p_points_to_redeem;
          delete legacyArgs.p_redeem_stamp_reward;
          delete legacyArgs.p_referral_code;
          ({ data, error } = await db.rpc("place_order_with_options", legacyArgs));
        }
        if (error?.code === "PGRST202") {
          if (submittedItems.some(item => item.offer_id)) {
            throw new Error(localized("Offer orders require the latest ordering update. Refresh the app and try again.", "طلبات العروض تحتاج تحديث نظام الطلبات. حدّث التطبيق وحاول مرة ثانية.", "Offer orders require the latest ordering update. Refresh the app and try again."));
          }
          if (deliveryZoneLookupAvailable && activeDeliveryZones.length) {
            throw new Error(localized("Apply the optional database upgrade before accepting zone-priced orders.", "قبل قبول طلبات برسوم حسب المنطقة، لازم تطبيق تحديث قاعدة البيانات.", "Apply the optional database upgrade before accepting zone-priced orders."));
          }
          throw new Error(localized("The secure order endpoint is unavailable. Refresh the app or contact support before placing this order.", "خدمة الطلب الآمنة غير متاحة حالياً. حدّث التطبيق أو تواصل مع الدعم قبل إرسال الطلب.", "The secure order endpoint is unavailable. Refresh the app or contact support before placing this order."));
        }

        if (error) throw error;

        // Save profile details after a confirmed order; profile errors never undo an order.
        if (authSession?.user) {
          try {
            const { error: profileError } = await db.auth.updateUser({ data: { full_name: customerName, phone: normalizedPhone } });
            if (profileError) console.warn("Customer profile could not be updated:", profileError);
          } catch (profileError) { console.warn("Customer profile update was skipped:", profileError); }
        }

        // وصل تأكيد من قاعدة البيانات أن الطلب تم حفظه.
        const result = Array.isArray(data) ? data[0] : data;
        const trackingToken = result && typeof result === "object" ? result.tracking_token : null;

        let orderNumber = "received";

        if (result && typeof result === "object") {
          orderNumber =
            result.order_number ?? result.order_id ?? result.id ?? "received";
        } else if (result !== null && result !== undefined && result !== "") {
          orderNumber = result;
        }

        // استخدم مرجع النموذج المحفوظ، وليس event.currentTarget بعد await.
        cart = {};
        cartItemNotes = {};
        persistCartItemNotes();
        persistCart();
        if ($("#remember-customer")?.checked) {
          storageSet(CUSTOMER_KEY, JSON.stringify({ consent: true, name: customerName, phone: normalizedPhone }));
        } else {
          try { localStorage.removeItem(CUSTOMER_KEY); } catch (_) {}
        }

        try {
          formElement.reset();
          restoreCustomerDetails();
          clearDeliveryLocationSelection();

          const typeSelect = $("#order-type");
          if (typeSelect) typeSelect.value = "delivery";
          const scheduleToggle = $("#schedule-order-toggle");
          if (scheduleToggle) scheduleToggle.checked = false;
          $("#schedule-order-controls")?.setAttribute("hidden", "");
          $("#pickup-instructions-field")?.classList.add("hidden");
          if (formElement.elements?.requested_for) {
            formElement.elements.requested_for.value = "";
            formElement.elements.requested_for.required = false;
          }

          $("#address-field")?.classList.remove("hidden");

          if (formElement.elements?.delivery_address) {
            formElement.elements.delivery_address.required = true;
          }

          renderCart();
        } catch (uiError) {
          console.warn("Order saved, but form cleanup failed:", uiError);
        }

        showCheckoutMessage("");
        const confirmedTotal = result && typeof result === "object" &&
          Number.isFinite(Number(result.total)) ? Number(result.total) : submittedTotal;
        if (trackingToken) rememberOrderTrackingToken(trackingToken, orderNumber);
        showSuccess(orderNumber, confirmedTotal);
        void refreshCustomerOrderHistory();
      } catch (error) {
        console.error("AL SHAMI order submission error:", error);
        const detail = String(error?.message || "");
        const message = (typeof navigator !== "undefined" && navigator.onLine === false) ||
          /failed to fetch|networkerror|network request failed|fetch failed/i.test(detail)
          ? localized("We couldn't connect to the restaurant. Check your internet and try again. Your order has not been confirmed.", "ما قدرنا نتصل بالمطعم. تأكد من الإنترنت وحاول مرة ثانية. طلبك لم يُؤكَّد.", "Yentumi anka adidibea no ho. Hwɛ internet na san sɔ hwɛ. Wɔansi wo order so dua.")
          : /offer price changed/i.test(detail)
            ? localized("The offer price changed. Review your basket before placing the order.", "تغيّر سعر العرض. راجع السلة قبل إرسال الطلب.", "The offer price changed. Review your basket before placing the order.")
            : /unavailable/i.test(detail)
              ? localized("One of your selected items is no longer available. Review your basket and try again.", "في صنف من طلبك صار غير متوفر. راجع السلة وحاول من جديد.", "Aduan bi a woapaw no nni hɔ bio. Hwɛ wo basket no na san sɔ bio.")
              : tr("orderError");
        showCheckoutMessage(message, true);
      } finally {
        submitting = false;
        if (submitButton) submitButton.textContent = tr("send");
        renderCart();
      }
    });
  }

  const addressInput = checkoutForm?.elements?.delivery_address;
  if (addressInput) addressInput.required = true;

  $("#address-field")?.classList.remove("hidden");

  floatingCartButton?.addEventListener("click", () => {
    const target = $("#your-order-heading")?.closest(".checkout-section") || $("#cart-items");
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const heading = $("#your-order-heading");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      window.setTimeout(() => heading.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
    }
  });

  let menuIsVisible = false;
  let orderIsVisible = false;
  const floatingCartObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === $("#menu")) menuIsVisible = entry.isIntersecting;
      if (entry.target === $(".checkout-section")) orderIsVisible = entry.isIntersecting;
    }
    const shouldShow = menuIsVisible && !orderIsVisible;
    floatingCartButton?.classList.toggle("is-visible", shouldShow);
    if (floatingCartButton) floatingCartButton.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  }, { threshold: 0.05 });
  if ($("#menu")) floatingCartObserver.observe($("#menu"));
  if ($(".checkout-section")) floatingCartObserver.observe($(".checkout-section"));

  restoreCart();
  restoreCartItemNotes();
  restoreCustomerDetails();
  // Authentication is required before the menu, order history, or checkout is loaded.
  void initializeCustomerAuth();
})();
