
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
        cfg.SUPABASE_ANON_KEY
      )
    : null;

  const $ = selector => document.querySelector(selector);
  const isHistoryPage = /(?:^|\/)history\.html$/i.test(window.location.pathname);
  const checkoutForm = $("#checkout-form");
  const orderButton = $("#place-order");
  const floatingCartButton = $("#floating-cart-button");
  const floatingCartCount = $("#floating-cart-count");
  const floatingCartTotal = $("#floating-cart-total");


  let authSession = null;
  let authMethod = "email";
  let authRecoveryMode = null;
  let recoveryPhone = "";
  let recoveryPhoneVerified = false;
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
      const phone = meta.phone_e164 || meta.phone || "";
      // Legacy accounts without a saved phone stay usable; new accounts must reserve a unique number.
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
    if (label) label.textContent = "Signed in as " + (user.email || "customer");
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
    const signupPhoneField = $("#auth-phone-field");
    const signupPhoneInput = $("#auth-phone");
    const password = $("#auth-password");
    const submit = $("#auth-submit");
    const signinButton = $("#auth-mode-signin");
    const signupButton = $("#auth-mode-signup");
    const forgot = $("#auth-forgot-password");
    if (title) title.textContent = signup ? "Create your AL SHAMI account" : "Sign in to your account";
    if (help) {
      if (authMethod === "phone" && signup) help.textContent = "Create an account with your Ghana number and password. Supabase Auth prevents duplicate phone identities. Phone confirmation, if enabled, requires an SMS provider.";
      else if (authMethod === "phone") help.textContent = "Use your Ghana phone number and password. Signing in does not send an SMS code.";
      else if (signup) help.textContent = "Create an account with your email, Ghana phone number, and password. Use an email address you can access for confirmation and password recovery.";
      else help.textContent = "Use the email address and password you registered with.";
    }
    if (nameField) nameField.hidden = !signup;
    if (nameInput) nameInput.required = signup;
    if (signupPhoneField) signupPhoneField.hidden = !signup;
    if (signupPhoneInput) signupPhoneInput.required = signup;
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
    authMethod = method === "email" ? "email" : "phone";
    const label = $("#auth-identifier-label");
    const field = $("#auth-identifier");
    const phoneButton = $("#auth-method-phone");
    const emailButton = $("#auth-method-email");
    if (label) label.textContent = authMethod === "phone" ? "Phone number" : "Email address";
    if (field) {
      field.type = authMethod === "phone" ? "tel" : "email";
      field.inputMode = authMethod === "phone" ? "tel" : "email";
      field.autocomplete = authMethod === "phone" ? "tel" : "email";
      field.placeholder = authMethod === "phone" ? "+233 24 123 4567" : "you@example.com";
      field.value = "";
    }
    if (phoneButton) { phoneButton.classList.toggle("active", authMethod === "phone"); phoneButton.setAttribute("aria-pressed", String(authMethod === "phone")); }
    if (emailButton) { emailButton.classList.toggle("active", authMethod === "email"); emailButton.setAttribute("aria-pressed", String(authMethod === "email")); }
    setAuthMode($("#customer-auth-form")?.dataset?.mode || "signin");
  }

  function showAuthDialog() {
    const gate = $("#customer-auth");
    if (!gate) return;
    authRecoveryMode = null;
    recoveryPhoneVerified = false;
    recoveryPhone = "";
    $("#auth-recovery-panel").hidden = true;
    $("#customer-auth-form").hidden = false;
    $("#auth-mode-switch").hidden = false;
    $("#auth-method-switch").hidden = false;
    $("#auth-forgot-password").hidden = false;
    $("#auth-continue-guest").hidden = true;
    $("#auth-recovery-back").hidden = false;
    gate.hidden = false;
    document.body.classList.add("auth-dialog-open");
    setAuthMode("signin");
    window.requestAnimationFrame(() => $("#auth-identifier")?.focus());
  }

  function closeAuthDialog() {
    const gate = $("#customer-auth");
    if (!authSession?.user) {
      // Mandatory authentication cannot be dismissed by the close button or backdrop.
      document.body.classList.add("customer-auth-required", "auth-dialog-open");
      if (gate) gate.hidden = false;
      return;
    }
    if (gate) gate.hidden = true;
    document.body.classList.remove("auth-dialog-open", "customer-auth-required");
  }

  function showPhoneRecovery() {
    authRecoveryMode = "phone";
    recoveryPhoneVerified = false;
    recoveryPhone = "";
    const gate = $("#customer-auth");
    if (gate) gate.hidden = false;
    document.body.classList.add("auth-dialog-open");
    $("#customer-auth-title").textContent = "Recover your account by SMS";
    $("#customer-auth-help").textContent = "A one-time code will be sent to the phone linked to your account. An SMS provider must be configured.";
    $("#auth-mode-switch").hidden = true;
    $("#auth-method-switch").hidden = true;
    $("#customer-auth-form").hidden = true;
    $("#auth-forgot-password").hidden = true;
    $("#auth-continue-guest").hidden = true;
    $("#auth-recovery-panel").hidden = false;
    $("#auth-recovery-title").textContent = "Verify your phone";
    $("#auth-recovery-help").textContent = "Enter the Ghana phone number used when you created your account.";
    $("#auth-recovery-send-area").hidden = false;
    $("#auth-recovery-code-area").hidden = true;
    $("#auth-recovery-password-area").hidden = true;
    $("#auth-recovery-back").hidden = false;
    $("#auth-recovery-code").value = "";
    $("#auth-recovery-new-password").value = "";
    $("#auth-recovery-confirm-password").value = "";
    $("#auth-recovery-phone").value = $("#auth-identifier")?.value || "";
    authMessage("");
    window.requestAnimationFrame(() => $("#auth-recovery-phone")?.focus());
  }

  function showPasswordRecovery(mode) {
    inPasswordRecovery = true;
    authRecoveryMode = mode;
    recoveryPhoneVerified = mode === "phone";
    const gate = $("#customer-auth");
    if (gate) gate.hidden = false;
    document.body.classList.add("auth-dialog-open");
    $("#customer-auth-title").textContent = mode === "phone" ? "Choose a new password" : "Reset your password";
    $("#customer-auth-help").textContent = mode === "phone" ? "Your phone number was verified. Choose a new password." : "Your recovery link was accepted. Choose a new password.";
    $("#auth-mode-switch").hidden = true;
    $("#auth-method-switch").hidden = true;
    $("#customer-auth-form").hidden = true;
    $("#auth-forgot-password").hidden = true;
    $("#auth-continue-guest").hidden = true;
    $("#auth-recovery-panel").hidden = false;
    $("#auth-recovery-title").textContent = "Set a new password";
    $("#auth-recovery-help").textContent = "Use at least 8 characters and keep it private.";
    $("#auth-recovery-send-area").hidden = true;
    $("#auth-recovery-code-area").hidden = true;
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

  $("#customer-auth-open")?.addEventListener("click", showAuthDialog);
  document.addEventListener("click", event => {
    const trigger = event.target?.closest?.("#customer-auth-open");
    if (trigger) { event.preventDefault(); showAuthDialog(); }
  }, true);
  $("#auth-close")?.addEventListener("click", closeAuthDialog);
  $("#auth-recovery-back")?.addEventListener("click", () => {
    authRecoveryMode = null;
    recoveryPhoneVerified = false;
    $("#auth-recovery-panel").hidden = true;
    $("#customer-auth-form").hidden = false;
    $("#auth-mode-switch").hidden = false;
    $("#auth-method-switch").hidden = false;
    $("#auth-forgot-password").hidden = false;
    $("#auth-continue-guest").hidden = false;
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

  $("#customer-auth-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = $("#auth-submit");
    if (!db) { authMessage("Account sign-in is unavailable because app configuration is missing.", true); return; }
    const password = String($("#auth-password")?.value || "");
    const mode = form.dataset.mode === "signup" ? "signup" : "signin";
    const fullName = String($("#auth-name")?.value || "").trim();
    let identity = "";
    let signupPhone = "";
    try {
      identity = String($("#auth-identifier")?.value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) throw new Error("Enter a valid email address.");
      if (mode === "signup") signupPhone = normalizeGhanaPhone($("#auth-phone")?.value);
      if (!password) throw new Error("Enter your password.");
      if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
      if (mode === "signup" && fullName.length < 2) throw new Error("Enter your name to create an account.");
      if (mode === "signup" && password !== String($("#auth-confirm-password")?.value || "")) throw new Error("The passwords do not match.");
      if (submit) { submit.disabled = true; submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…"; }
      authMessage(mode === "signup" ? "Creating your account…" : "Signing in…");
      if (mode === "signup") {
        const options = {
          emailRedirectTo: window.location.origin + window.location.pathname,
          data: { full_name: fullName, phone: signupPhone, phone_e164: signupPhone }
        };
        const { data, error } = await db.auth.signUp({ email: identity, password, options });
        if (error) throw error;
        if (data.session) {
          applyAuthState(data.session);
          closeAuthDialog();
          authMessage("");
        } else if (authMethod === "phone" && Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
          authMessage("An account may already exist for this phone number. Try signing in or use Forgot password.");
        } else {
          authMessage(authMethod === "phone"
            ? "Account request received. If phone confirmation is enabled, follow the SMS instructions. Phone confirmation requires an SMS provider; without confirmation, phone ownership remains unverified."
            : "Account request received. If email confirmation is enabled, open the confirmation link sent to your email before signing in.");
        }
      } else {
        const credentials = authMethod === "phone" ? { phone: identity, password } : { email: identity, password };
        const { data, error } = await db.auth.signInWithPassword(credentials);
        if (error) throw error;
        applyAuthState(data.session);
        closeAuthDialog();
      }
    } catch (error) {
      console.error("Customer account action failed:", error);
      const detail = String(error?.message || "");
      if (/email address not authorized|not authorized|confirmation email|SMTP|email provider/i.test(detail)) {
        authMessage("Email delivery is not configured for public customers yet. Supabase's default sender only delivers to project team addresses. Configure a custom SMTP sender before customer signup and password recovery.", true);
      } else if (/duplicate key|unique constraint|23505|already linked/i.test(detail)) {
        authMessage("This phone number is already linked to another customer account. Sign in to the existing account or use a different number.", true);
      } else if (/user already registered|email.*already|already.*email/i.test(detail)) {
        authMessage("This email is already registered. Sign in with that account or use Forgot password.", true);
      } else {
        authMessage(detail || "Account action failed. Please try again.", true);
      }
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = form.dataset.mode === "signup" ? "Create account" : "Sign in"; }
    }
  });

  $("#auth-forgot-password")?.addEventListener("click", async () => {
    if (!db) { authMessage("Password recovery is unavailable because app configuration is missing.", true); return; }
    if (authMethod === "phone") { showPhoneRecovery(); return; }
    const email = String($("#auth-identifier")?.value || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      authMessage("Enter your email address first.", true);
      $("#auth-identifier")?.focus();
      return;
    }
    const button = $("#auth-forgot-password");
    if (button) button.disabled = true;
    try {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
      if (error) throw error;
      authMessage("If the account supports email recovery, a reset link will be sent. Check your inbox.");
    } catch (error) {
      authMessage(error.message || "Could not request a password reset.", true);
    } finally { if (button) button.disabled = false; }
  });

  $("#auth-recovery-send")?.addEventListener("click", async () => {
    const button = $("#auth-recovery-send");
    try {
      if (!db) throw new Error("Account service is not configured.");
      recoveryPhone = normalizeGhanaPhone($("#auth-recovery-phone")?.value);
      if (button) { button.disabled = true; button.textContent = "Sending SMS…"; }
      authMessage("Requesting a recovery code…");
      const { error } = await db.auth.signInWithOtp({ phone: recoveryPhone, options: { shouldCreateUser: false } });
      if (error) throw error;
      $("#auth-recovery-code-area").hidden = false;
      $("#auth-recovery-code").focus();
      authMessage("If an account is registered for this number, a verification code has been requested. Check your SMS.");
    } catch (error) {
      console.error("Phone recovery SMS request failed:", error);
      const detail = String(error?.message || "");
      authMessage(/sms|provider|phone auth|not enabled/i.test(detail)
        ? "SMS recovery is not available yet. Supabase needs phone authentication enabled and an SMS provider configured. No password has been changed."
        : detail || "Could not request a recovery code. Try again later.", true);
    } finally { if (button) { button.disabled = false; button.textContent = "Send SMS code"; } }
  });

  $("#auth-recovery-verify")?.addEventListener("click", async () => {
    const button = $("#auth-recovery-verify");
    const token = String($("#auth-recovery-code")?.value || "").trim();
    if (!token) { authMessage("Enter the SMS verification code.", true); return; }
    try {
      if (button) { button.disabled = true; button.textContent = "Verifying…"; }
      const { data, error } = await db.auth.verifyOtp({ phone: recoveryPhone || normalizeGhanaPhone($("#auth-recovery-phone")?.value), token, type: "sms" });
      if (error) throw error;
      if (!data.session) throw new Error("The code was accepted but no sign-in session was returned. Please try again.");
      applyAuthState(data.session);
      recoveryPhoneVerified = true;
      showPasswordRecovery("phone");
      authMessage("Phone verified. You can now choose a new password.");
    } catch (error) {
      console.error("Phone recovery verification failed:", error);
      authMessage(error.message || "That code could not be verified. Request a new code and try again.", true);
    } finally { if (button) { button.disabled = false; button.textContent = "Verify code"; } }
  });

  $("#auth-recovery-save")?.addEventListener("click", async () => {
    const password = String($("#auth-recovery-new-password")?.value || "");
    const confirmation = String($("#auth-recovery-confirm-password")?.value || "");
    if (password.length < 8) { authMessage("Use a password with at least 8 characters.", true); return; }
    if (password !== confirmation) { authMessage("The passwords do not match.", true); return; }
    if (!authSession || (authRecoveryMode === "phone" && !recoveryPhoneVerified)) {
      authMessage("Verify your phone or open your email recovery link before changing the password.", true);
      return;
    }
    const button = $("#auth-recovery-save");
    if (button) { button.disabled = true; button.textContent = "Saving password…"; }
    try {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      authRecoveryMode = null;
      recoveryPhoneVerified = false;
      inPasswordRecovery = false;
      $("#auth-recovery-panel").hidden = true;
      $("#customer-auth-form").hidden = false;
      $("#auth-mode-switch").hidden = false;
      $("#auth-method-switch").hidden = false;
      $("#auth-forgot-password").hidden = false;
      $("#auth-continue-guest").hidden = false;
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
  let offers = [];
  let popularityByMenuItem = new Map();
  let cart = {};
  let category = "All";
  let sortMode = "default";
  const CART_KEY = "alShamiCartV1";
  const CUSTOMER_KEY = "alShamiCustomerV1";
  const ORDER_HISTORY_KEY = "alShamiOrderHistoryV1";
  const TRACKING_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let trackedOrdersLoading = false;
  let trackedOrdersRefreshQueued = false;
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function persistCart() { storageSet(CART_KEY, JSON.stringify(cart)); }
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
      throw new Error(lang === "ar"
        ? "أدخل رقم غاني صحيح، مثال 0241234567."
        : "Enter a valid Ghana phone number, e.g. 0241234567.");
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
  let minimumOrder = 0;
  let submitting = false;
  let menuLoading = false;

  const translations = {
    en: {
      hero: "Fresh favourites, made for you.",
      orderNote: "Order online",
      orderNote2: "Your order goes directly to our restaurant ordering system.",
      menu: "Menu",
      yourOrder: "Your order",
      total: "Total",
      subtotal: "Subtotal",
      deliveryFee: "Delivery fee",
      name: "Your name",
      phone: "Phone number",
      orderType: "Order type",
      address: "Delivery address / landmark",
      addressHint: "Include your house or building number, street, neighbourhood, and a nearby landmark (for example, a shop or station).",
      copyAddress: "Copy address",
      notes: "Notes (optional)",
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
      trackHistory: "Track your order / Order history",
      activeOrdersHeading: "Active orders",
      historyHeading: "History",
      noCompletedOrders: "No completed orders yet.",
      trackHistoryHelp: "Your orders stay saved on this device. Keep the private tracking code to check an order on another device.",
      trackingCode: "Private tracking code",
      trackOrder: "Track order",
      refreshOrders: "Refresh",
      noTrackedOrders: "No saved orders yet. Place an order or enter your private tracking code above.",
      loadingTrackedOrders: "Loading your saved orders…",
      trackCodeHelp: "Enter the private tracking code from your order confirmation.",
      invalidTrackingCode: "Enter a valid tracking code.",
      couldNotLoadTrackedOrder: "Could not check this order right now. Check your connection and try again.",
      orderNotFound: "No order was found for that code. Check it and try again.",
      showTrackingCode: "Show private tracking code",
      copyTrackingCode: "Copy code",
      removeFromHistory: "Remove from history",
      orderLabel: "Order",
      orderedAt: "Placed",
      step_received: "Received",
      step_accepted: "Accepted",
      step_preparing: "Preparing",
      step_ready: "Ready",
      step_out_for_delivery: "Out for delivery",
      step_completed: "Completed",
      codeCopied: "Tracking code copied.",
      codeCopyFailed: "Copy failed. You can select and copy the code manually.",
      unavailable: "Currently unavailable"
    },
    ar: {
      hero: "أطيب الأكلات محضّرة إلك.",
      orderNote: "اطلب أونلاين",
      orderNote2: "طلبك بيوصل مباشرة لنظام المطعم.",
      menu: "المنيو",
      yourOrder: "طلبك",
      total: "المجموع",
      subtotal: "المجموع قبل التوصيل",
      deliveryFee: "رسوم التوصيل",
      name: "اسمك",
      phone: "رقم الهاتف",
      orderType: "نوع الطلب",
      address: "عنوان التوصيل / علامة مميزة",
      addressHint: "اكتب رقم البيت أو المبنى والشارع والحي وعلامة قريبة مثل محل أو محطة.",
      copyAddress: "نسخ العنوان",
      notes: "ملاحظات (اختياري)",
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
      trackHistory: "تتبّع الطلبات / سجل الطلبات",
      activeOrdersHeading: "الطلبات الحالية",
      historyHeading: "السجل",
      noCompletedOrders: "ما في طلبات مكتملة لسه.",
      trackHistoryHelp: "طلباتك المحفوظة بتظهر على هالجهاز. احتفظ برمز التتبّع الخاص إذا بدك تفتح الطلب من جهاز تاني.",
      trackingCode: "رمز التتبّع الخاص",
      trackOrder: "تتبّع الطلب",
      refreshOrders: "تحديث",
      noTrackedOrders: "ما في طلبات محفوظة لسه. اطلب أو أدخل رمز التتبّع الخاص فوق.",
      loadingTrackedOrders: "عم نحمّل طلباتك…",
      trackCodeHelp: "أدخل رمز التتبّع الموجود بتأكيد الطلب.",
      invalidTrackingCode: "أدخل رمز تتبّع صحيح.",
      couldNotLoadTrackedOrder: "ما قدرنا نتحقق من الطلب هلأ. تأكد من الإنترنت وحاول مرة تانية.",
      orderNotFound: "ما لقينا طلب بهالرمز. تأكد منه وحاول مرة تانية.",
      showTrackingCode: "إظهار رمز التتبّع الخاص",
      copyTrackingCode: "نسخ الرمز",
      removeFromHistory: "حذف من السجل",
      orderLabel: "الطلب",
      orderedAt: "تاريخ الطلب",
      step_received: "تم الاستلام",
      step_accepted: "تم القبول",
      step_preparing: "قيد التحضير",
      step_ready: "جاهز",
      step_out_for_delivery: "خرج للتوصيل",
      step_completed: "مكتمل",
      codeCopied: "تم نسخ رمز التتبّع.",
      codeCopyFailed: "تعذّر النسخ. فيك تحدد الرمز وتنسخه يدوياً.",
      unavailable: "غير متوفر حالياً"
    },
    tw: {
      hero: "Aduan pa a, wɔasiesie ama wo.",
      orderNote: "Fa wo nsa hyɛ nneɛma ho wɔ intanɛt so",
      orderNote2: "Wo nhyehyɛe no kɔ tẽẽ ma adidibea no.",
      menu: "Nneɛma a yɛtɔn",
      yourOrder: "Wo nneɛma a woapaw",
      total: "Ne nyinaa",
      subtotal: "Ne nyinaa ansa na wɔde bɛbrɛ wo",
      deliveryFee: "Ka a wɔde bɛbrɛ wo",
      name: "Wo din",
      phone: "Telefon nɔma",
      orderType: "Ɔkwan a wopɛ sɛ wunya aduan no",
      address: "Beae a wɔde bɛbrɛ wo / agyiraehyɛde",
      addressHint: "Kyerɛw fie nɔma, kwan, mpɔtam ne beae bi a ɛda hɔ pefee te sɛ sotɔɔ anaa gyinabea.",
      copyAddress: "Kɔpi address",
      notes: "Nsɛm foforo (wopɛ a)",
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
      trackHistory: "Track your order / Order history",
      activeOrdersHeading: "Active orders",
      historyHeading: "History",
      noCompletedOrders: "No completed orders yet.",
      trackHistoryHelp: "Your orders stay saved on this device. Keep the private tracking code to check an order on another device.",
      trackingCode: "Private tracking code",
      trackOrder: "Track order",
      refreshOrders: "Refresh",
      noTrackedOrders: "No saved orders yet. Place an order or enter your private tracking code above.",
      loadingTrackedOrders: "Loading your saved orders…",
      trackCodeHelp: "Enter the private tracking code from your order confirmation.",
      invalidTrackingCode: "Enter a valid tracking code.",
      couldNotLoadTrackedOrder: "Could not check this order right now. Check your connection and try again.",
      orderNotFound: "No order was found for that code. Check it and try again.",
      showTrackingCode: "Show private tracking code",
      copyTrackingCode: "Copy code",
      removeFromHistory: "Remove from history",
      orderLabel: "Order",
      orderedAt: "Placed",
      step_received: "Received",
      step_accepted: "Accepted",
      step_preparing: "Preparing",
      step_ready: "Ready",
      step_out_for_delivery: "Out for delivery",
      step_completed: "Completed",
      codeCopied: "Tracking code copied.",
      codeCopyFailed: "Copy failed. You can select and copy the code manually.",
      unavailable: "Ɛnni hɔ seesei"
    }
  };

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);
  const tr = key => (translations[lang] && translations[lang][key]) || translations.en[key] || key;

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
    ar: { new:"تم إرسال الطلب وبانتظار قبول المطعم", accepted:"تم قبول الطلب", preparing:"قيد التحضير", ready:"جاهز", out_for_delivery:"خرج للتوصيل", completed:"مكتمل", rejected:"مرفوض" }
  };

  function readTrackedOrders() {
    try {
      const rows = JSON.parse(storageGet(ORDER_HISTORY_KEY) || "[]");
      return Array.isArray(rows) ? rows.filter(row => row && typeof row.token === "string" && TRACKING_TOKEN_RE.test(row.token)).slice(0,25) : [];
    } catch (_) { return []; }
  }

  function saveTrackedOrders(rows) { storageSet(ORDER_HISTORY_KEY, JSON.stringify(rows.slice(0,25))); }

  function rememberOrderTrackingToken(token, orderNumber) {
    token = String(token || "").trim().toLowerCase();
    if (!TRACKING_TOKEN_RE.test(token)) return false;
    const rows = readTrackedOrders().filter(row => row.token !== token);
    rows.unshift({ token, orderNumber: String(orderNumber || ""), savedAt: new Date().toISOString() });
    saveTrackedOrders(rows);
    return true;
  }

  function trackingStatusText(status, orderType = "") {
    const value = String(status || "").toLowerCase();
    if (value === "completed") {
      if (lang === "ar") return orderType === "delivery" ? "تم التوصيل" : "تم الاستلام";
      return orderType === "delivery" ? "Delivered" : "Collected";
    }
    const names = trackingStatusNames[lang] || trackingStatusNames.en;
    return names[value] || String(status || "Unknown").replace(/_/g, " ");
  }

  function trackingDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(lang === "ar" ? "ar" : "en-GH", { dateStyle:"medium", timeStyle:"short" });
  }

  async function refreshCustomerOrderHistory() {
    const list = $("#customer-order-history");
    if (!list) return;
    if (!authSession?.user || (authSession.user.user_metadata?.phone_e164 && customerPhoneValidatedUserId !== authSession.user.id)) {
      list.replaceChildren();
      return;
    }
    if (trackedOrdersLoading) {
      // Do not lose a refresh requested while an earlier status check is in flight.
      trackedOrdersRefreshQueued = true;
      return;
    }
    const entries = readTrackedOrders();
    if (!entries.length) {
      list.innerHTML = '<p class="muted tracked-empty">' + escapeHTML(tr("noTrackedOrders")) + "</p>";
      return;
    }
    if (!db) {
      list.innerHTML = '<p class="app-message error">' + escapeHTML(tr("couldNotLoadTrackedOrder")) + "</p>";
      return;
    }
    trackedOrdersLoading = true;
    list.innerHTML = '<p class="muted">' + escapeHTML(tr("loadingTrackedOrders")) + "</p>";
    try {
      const results = await Promise.all(entries.map(async entry => {
        try {
          const { data, error } = await db.rpc("get_customer_order_tracking", { p_tracking_token: entry.token });
          if (error) return { entry, failed:true };
          if (!data) return { entry, missing:true };
          return { entry, order:data };
        } catch (_) { return { entry, failed:true }; }
      }));
      const renderResult = result => {
        const entry = result.entry;
        const token = escapeHTML(entry.token);
        const remove = '<button type="button" class="btn btn-light tracked-remove" data-remove-tracked="' + token + '">' + escapeHTML(tr("removeFromHistory")) + "</button>";
        const codeDetails = '<details class="tracked-code"><summary>' + escapeHTML(tr("showTrackingCode")) + "</summary><code>" + token + '</code><button type="button" class="btn btn-light" data-copy-tracked="' + token + '">' + escapeHTML(tr("copyTrackingCode")) + "</button></details>";
        if (result.failed || result.missing) {
          const message = result.failed ? tr("couldNotLoadTrackedOrder") : tr("orderNotFound");
          return '<article class="customer-order-card"><div class="tracked-card-heading"><strong>' + escapeHTML(tr("orderLabel")) + " #" + escapeHTML(entry.orderNumber || "—") + "</strong>" + remove + "</div><p class=\"muted\">" + escapeHTML(message) + "</p>" + codeDetails + "</article>";
        }
        const order = result.order;
        const status = String(order.status || "").toLowerCase();
        const number = order.order_number ?? entry.orderNumber ?? "—";
        const isDelivery = order.order_type === "delivery";
        const steps = [
          "step_received", "step_accepted", "step_preparing", "step_ready",
          ...(isDelivery ? ["step_out_for_delivery"] : []), "step_completed"
        ];
        const active = status === "new" ? 0 : status === "accepted" ? 1 : status === "preparing" ? 2 :
          status === "ready" ? 3 : status === "out_for_delivery" ? 4 :
          status === "completed" ? (isDelivery ? 5 : 4) : -1;
        const timeline = status === "rejected"
          ? '<p class="tracked-rejected">' + escapeHTML(trackingStatusText(status)) + "</p>"
          : '<ol class="tracked-steps ' + (isDelivery ? "is-delivery" : "is-pickup") + '">' + steps.map((key,i) =>
              '<li class="' + (active >= 0 && i < active ? "is-complete " : "") + (active === i ? "is-current" : "") + '"><span>' + escapeHTML(tr(key)) + "</span></li>"
            ).join("") + "</ol>";
        const items = Array.isArray(order.items) ? order.items : [];
        const itemHtml = items.map(item => '<li><span>' + escapeHTML(item.quantity) + " × " + escapeHTML(item.name || "Item") + '</span><strong>' + money(item.line_total ?? (Number(item.unit_price || 0) * Number(item.quantity || 0))) + "</strong></li>").join("");
        return '<article class="customer-order-card">' +
          '<div class="tracked-card-heading"><div><strong>' + escapeHTML(tr("orderLabel")) + " #" + escapeHTML(number) + '</strong><p class="tracked-date">' + escapeHTML(tr("orderedAt")) + ": " + escapeHTML(trackingDate(order.created_at)) + '</p></div><span class="tracked-status status-' + escapeHTML(status.replace(/[^a-z_]/g,"")) + '">' + escapeHTML(trackingStatusText(status, order.order_type)) + "</span></div>" +
          timeline + '<div class="tracked-order-meta"><span>' + escapeHTML(order.order_type === "pickup" ? tr("pickup") : tr("delivery")) + '</span><strong>' + money(order.total) + "</strong></div>" +
          (itemHtml ? '<ul class="tracked-items">' + itemHtml + "</ul>" : "") +
          (status !== "completed" && status !== "rejected" && order.receipt_code
            ? '<p class="receipt-code-note">' + escapeHTML(lang === "ar" ? "رمز تأكيد الاستلام (أعطه للكاشير عند التسليم): " : "Customer receipt code (give this to the cashier when you receive the order): ") + '<strong>' + escapeHTML(order.receipt_code) + '</strong></p>'
            : "") + codeDetails + remove + "</article>";
      };
      // Keep only orders still being worked on in Active Orders.
      // As soon as an order is ready, move it to History; delivery and completion
      // remain in History as well, so old ready orders do not clutter the active list.
      const activeStatuses = new Set(["new", "accepted", "preparing"]);
      const activeResults = results.filter(result =>
        result.failed || result.missing || activeStatuses.has(String(result.order?.status || "").toLowerCase())
      );
      const historyResults = results.filter(result =>
        !result.failed && !result.missing && !activeStatuses.has(String(result.order?.status || "").toLowerCase())
      );
      const visibleResults = isHistoryPage ? historyResults : activeResults;
      const visibleHtml = visibleResults.map(renderResult).join("");
      const emptyMessage = isHistoryPage ? tr("noCompletedOrders") : tr("noTrackedOrders");
      list.innerHTML = visibleHtml || '<p class="muted tracked-empty">' + escapeHTML(emptyMessage) + '</p>';
      const heading = $("#customer-orders-heading");
      if (heading) heading.textContent = isHistoryPage ? tr("historyHeading") : tr("activeOrdersHeading");
      const nav = $("#customer-orders-nav");
      if (nav) {
        nav.innerHTML = isHistoryPage
          ? '<a class="btn btn-light" href="./index.html">' + escapeHTML(lang === "ar" ? "العودة للمنيو والطلبات الجديدة" : "Menu & New Order") + '</a>'
          : '<a class="btn btn-light" href="./history.html">' + escapeHTML(lang === "ar" ? "سجل الطلبات" : "Order History") + '</a>';
      }
    } finally {
      trackedOrdersLoading = false;
      if (trackedOrdersRefreshQueued) {
        trackedOrdersRefreshQueued = false;
        // Re-check once the in-flight request finishes so a newly completed order
        // is moved from Active orders to History without waiting for the next poll.
        void refreshCustomerOrderHistory();
      }
    }
  }

  async function lookupTrackingCode(raw) {
    const token = String(raw || "").trim().toLowerCase();
    if (!TRACKING_TOKEN_RE.test(token)) throw new Error("invalid-code");
    if (!db) throw new Error("lookup-failed");
    const { data, error } = await db.rpc("get_customer_order_tracking", { p_tracking_token: token });
    if (error) throw new Error("lookup-failed");
    if (!data) throw new Error("not-found");
    rememberOrderTrackingToken(token, data.order_number);
    return data;
  }

  $("#track-order-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!authSession?.user || (authSession.user.user_metadata?.phone_e164 && customerPhoneValidatedUserId !== authSession.user.id)) {
      lockCustomerApp("Please sign in before tracking orders.");
      return;
    }
    const input = $("#tracking-code-input");
    const button = $("#track-order-submit");
    const message = $("#customer-orders-message");
    if (button) button.disabled = true;
    if (message) { message.textContent = ""; message.className = "status-message"; }
    try {
      const order = await lookupTrackingCode(input?.value);
      if (message) { message.textContent = trackingStatusText(order.status, order.order_type); message.className = "status-message success"; }
      if (input) input.value = "";
      await refreshCustomerOrderHistory();
    } catch (error) {
      const key = error?.message === "invalid-code" ? "invalidTrackingCode" : error?.message === "not-found" ? "orderNotFound" : "couldNotLoadTrackedOrder";
      if (message) { message.textContent = tr(key); message.className = "status-message error"; }
    } finally { if (button) button.disabled = false; }
  });

  $("#refresh-customer-orders")?.addEventListener("click", () => { void refreshCustomerOrderHistory(); });

  $("#customer-order-history")?.addEventListener("click", async event => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest("[data-remove-tracked]");
    if (remove) {
      const token = remove.getAttribute("data-remove-tracked");
      saveTrackedOrders(readTrackedOrders().filter(row => row.token !== token));
      void refreshCustomerOrderHistory();
      return;
    }
    const copy = target?.closest("[data-copy-tracked]");
    if (copy) {
      const message = $("#customer-orders-message");
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(copy.getAttribute("data-copy-tracked") || "");
        if (message) { message.textContent = tr("codeCopied"); message.className = "status-message success"; }
      } catch (_) {
        if (message) { message.textContent = tr("codeCopyFailed"); message.className = "status-message error"; }
      }
    }
  });

  window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshCustomerOrderHistory();
  }, 45000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshCustomerOrderHistory();
  });


  function showCheckoutMessage(text, isError = false) {
    const element = $("#checkout-message");
    if (!element) return;

    element.textContent = text || "";
    element.className = "status-message" + (isError ? " error" : " success");
  }

  function showAppStatus(text, isError = false) {
    const element = $("#app-status");
    if (!element) return;

    element.textContent = text || "";
    element.className = "app-message " + (isError ? "error" : "info");
    element.hidden = !text;
  }

  function announceCartChange(kind, productName, quantity) {
    const element = $("#cart-announcement");
    if (!element) return;
    const label = tr(kind);
    element.textContent = quantity === undefined
      ? label + " " + String(productName || "")
      : label + " " + String(productName || "") + ", " + quantity;
  }

  function showSuccess(orderNumber, total, trackingToken = null) {
    try {
      if (typeof window.AL_SHAMI_SHOW_SUCCESS === "function") {
        window.AL_SHAMI_SHOW_SUCCESS({ orderNumber, total, trackingToken });
      } else {
        showCheckoutMessage(
          `${tr("sent")} ${orderNumber ? "Order #" + orderNumber : ""}`
        );
      }
    } catch (error) {
      console.error("Could not display order confirmation:", error);
      showCheckoutMessage(tr("sent"));
    }
  }

  function setLanguage() {
    document.documentElement.lang = lang === "ar" ? "ar" : (lang === "tw" ? "ak" : "en");
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach(element => {
      const key = element.dataset.i18n;
      if (translations[lang] && translations[lang][key]) {
        element.textContent = tr(key);
      }
    });

    const sortSelect = $("#menu-sort");
    if (sortSelect) {
      const labels = lang === "tw"
        ? ["Totoe", "Bo: nea ɛyɛ mmerɛw kɔ nea ɛyɛ den", "Bo: nea ɛyɛ den kɔ nea ɛyɛ mmerɛw", "Nea nkurɔfo pɛ"]
        : lang === "ar"
          ? ["الترتيب الافتراضي", "السعر: من الأرخص للأغلى", "السعر: من الأغلى للأرخص", "الأكثر شعبية"]
          : ["Recommended", "Price: low to high", "Price: high to low", "Popularity"];
      Array.from(sortSelect.options).forEach((option, index) => { option.textContent = labels[index] || option.textContent; });
    }
    const sortLabel = document.querySelector(".sort-label");
    if (sortLabel && sortLabel.firstChild && sortLabel.firstChild.nodeType === Node.TEXT_NODE) {
      sortLabel.firstChild.textContent = lang === "tw" ? "Siesie: " : lang === "ar" ? "ترتيب: " : "Sort ";
    }
    const remember = document.querySelector(".remember-customer");
    if (remember) {
      const checkbox = remember.querySelector("input");
      remember.textContent = lang === "tw" ? "Kae me din ne telefon nɔma wɔ saa mfiri yi so" : lang === "ar" ? "احفظ اسمي ورقم هاتفي على هذا الجهاز" : "Remember my name and phone on this device";
      if (checkbox) remember.prepend(checkbox);
    }

    const search = $("#search");
    if (search) search.placeholder = tr("search");

    if (orderButton) {
      orderButton.textContent = submitting ? tr("sending") : tr("send");
    }

    renderCategories();
    renderMenu();
    renderCart();
    void refreshCustomerOrderHistory();
  }

  function renderCategories() {
    const container = $("#categories");
    if (!container) return;

    const categories = [
      "All",
      ...new Set(products.map(product => product.category).filter(Boolean))
    ];

    container.innerHTML = categories.map(item => `
      <button type="button"
        class="chip ${category === item ? "active" : ""}"
        data-cat="${escapeHTML(item)}">
        ${item === "All" ? tr("category") : escapeHTML(item)}
      </button>
    `).join("");

    container.querySelectorAll("[data-cat]").forEach(button => {
      button.addEventListener("click", () => {
        category = button.dataset.cat;
        renderCategories();
        renderMenu();
      });
    });
  }

  function renderMenu() {
    const menu = $("#menu");
    const search = $("#search");
    if (!menu || !search) return;

    const query = search.value.trim().toLowerCase();

    const visibleProducts = products.filter(product => {
      const categoryMatches =
        category === "All" || product.category === category;

      const searchText =
        `${product.name || ""} ${product.description || ""} ${product.category || ""}`
          .toLowerCase();

      return categoryMatches && searchText.includes(query);
    });
    if (sortMode === "price-asc") visibleProducts.sort((a, b) => Number(a.price) - Number(b.price));
    if (sortMode === "price-desc") visibleProducts.sort((a, b) => Number(b.price) - Number(a.price));
    if (sortMode === "popular") visibleProducts.sort((a, b) => {
      const popularityA = Number(popularityByMenuItem.get(String(a.id)) ?? a.popularity ?? a.order_count ?? 0);
      const popularityB = Number(popularityByMenuItem.get(String(b.id)) ?? b.popularity ?? b.order_count ?? 0);
      return popularityB - popularityA ||
        Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    });

    menu.innerHTML = visibleProducts.length
      ? visibleProducts.map(product => {
          const addControl = product.is_available === false
            ? `<span class="unavailable-badge" role="status">${escapeHTML(tr("unavailable"))}</span>`
            : `<button type="button" class="btn btn-primary"
                data-add="${escapeHTML(product.id)}"
                aria-label="${escapeHTML(tr("add") + " " + product.name)}">${tr("add")}</button>`;
          return `
        <article class="product-card ${product.is_available === false ? "product-unavailable" : ""}">
          <div class="product-image">
            ${product.image_url
              ? `<img src="${escapeHTML(product.image_url)}"
                  alt="${escapeHTML(product.name)}"
                  width="640" height="420"
                  loading="lazy"
                  onerror="this.onerror=null;this.parentElement.textContent='🍽️'">`
              : "🍽️"}
          </div>
          <div class="product-info">
            <h3>${escapeHTML(product.name)}</h3>
            <p>${escapeHTML(product.description || "Freshly prepared at AL SHAMI.")}</p>
            <div class="product-bottom">
              <span class="price">${money(product.price)}</span>
              ${addControl}
            </div>
          </div>
        </article>
      `;
      }).join("")
      : `<p class="muted">${query ? tr("noSearchResults") : tr("noItems")}</p>`;

    menu.querySelectorAll("[data-add]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.add;

        const product = products.find(item => String(item.id) === String(id));
        if (!product || product.is_available === false) return;

        cart[id] = Math.min(50, (cart[id] || 0) + 1);
        persistCart();
        renderCart();
        announceCartChange("cartAdded", product.name, cart[id]);
      });
    });
  }

  function getCartRows() {
    return Object.entries(cart).filter(([id, quantity]) =>
      Number(quantity) > 0 &&
      products.some(product => String(product.id) === String(id) && product.is_available !== false)
    );
  }

  function calculateSubtotal(rows = getCartRows()) {
    return rows.reduce((sum, [id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      return sum + Number(product?.price || 0) * Number(quantity || 0);
    }, 0);
  }

  function renderCart() {
    const cartItems = $("#cart-items");
    if (!cartItems) return;

    const rows = getCartRows();
    persistCart();
    if (orderButton) orderButton.disabled = submitting || rows.length === 0;
    const clearButton = $("#clear-cart");
    if (clearButton) clearButton.disabled = submitting || rows.length === 0;

    cartItems.innerHTML = rows.length
      ? rows.map(([id, quantity]) => {
          const product = products.find(item => String(item.id) === String(id));

          return `
            <div class="cart-row">
              <div class="cart-name">
                <strong>${escapeHTML(product.name)}</strong>
                <small>${money(product.price)} each</small>
              </div>
              <div class="qty-controls" aria-label="Quantity controls for ${escapeHTML(product.name)}">
                <button type="button" data-dec="${escapeHTML(id)}"
                  aria-label="${lang === "ar" ? "إنقاص كمية " : lang === "tw" ? "Te dodow so " : "Decrease quantity of "}${escapeHTML(product.name)}">−</button>
                <strong aria-label="${lang === "ar" ? "الكمية " : "Quantity "}${Number(quantity)}">${Number(quantity)}</strong>
                <button type="button" data-inc="${escapeHTML(id)}"
                  aria-label="${lang === "ar" ? "زيادة كمية " : lang === "tw" ? "Ma dodow nyin " : "Increase quantity of "}${escapeHTML(product.name)}">+</button>
                <button type="button" class="btn-remove-item" data-remove="${escapeHTML(id)}"
                  aria-label="${tr("remove")} ${escapeHTML(product.name)}">${tr("remove")}</button>
              </div>
              <strong>${money(Number(product.price) * Number(quantity))}</strong>
            </div>
          `;
        }).join("")
      : `<p class="muted">${tr("empty")}</p>`;

    const subtotal = calculateSubtotal(rows);
    const isDelivery = $("#order-type")?.value !== "pickup";
    const currentFee = isDelivery ? deliveryFee : 0;
    const total = subtotal + currentFee;
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
      $("#cart-delivery-fee").textContent = money(currentFee);
    }

    if ($("#cart-total")) {
      $("#cart-total").textContent = money(total);
    }

    const feeLine = $("#delivery-fee-line");
    if (feeLine) feeLine.hidden = !isDelivery;

    const minimumNote = $("#minimum-order-note");
    if (minimumNote) {
      minimumNote.hidden = minimumOrder <= 0;
      minimumNote.textContent = minimumOrder > 0
        ? `${tr("minimumError")} ${money(minimumOrder)}.`
        : "";
    }

    cartItems.querySelectorAll("[data-dec]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.dec;
        cart[id] = Number(cart[id] || 0) - 1;

        const product = products.find(item => String(item.id) === String(id));
        const removed = cart[id] <= 0;
        if (removed) delete cart[id];
        persistCart();
        renderCart();
        if (product) announceCartChange(removed ? "cartRemoved" : "cartQuantity", product.name, removed ? undefined : cart[id]);
      });
    });

    cartItems.querySelectorAll("[data-inc]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.inc;
        const product = products.find(item => String(item.id) === String(id));
        cart[id] = Math.min(50, Number(cart[id] || 0) + 1);
        persistCart();
        renderCart();
        if (product) announceCartChange("cartQuantity", product.name, cart[id]);
      });
    });

    cartItems.querySelectorAll("[data-remove]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.remove;
        const product = products.find(item => String(item.id) === String(id));
        delete cart[id];
        persistCart();
        renderCart();
        if (product) announceCartChange("cartRemoved", product.name);
      });
    });
  }

  function renderOffers() {
    const container = $("#active-offers");
    if (!container) return;

    container.replaceChildren();
    if (!offers.length) return;

    const section = document.createElement("section");
    section.className = "notice";

    const heading = document.createElement("strong");
    heading.textContent = tr("offer");

    const details = document.createElement("span");
    details.textContent = offers.map(offer => {
      const dates = [];
      if (offer.starts_at && Number.isFinite(new Date(offer.starts_at).getTime())) {
        dates.push((lang === "ar" ? "يبدأ " : "Starts ") + new Date(offer.starts_at).toLocaleDateString());
      }
      if (offer.ends_at && Number.isFinite(new Date(offer.ends_at).getTime())) {
        dates.push((lang === "ar" ? "ينتهي " : "Ends ") + new Date(offer.ends_at).toLocaleDateString());
      }
      const dateInfo = dates.length ? " (" + dates.join(" · ") + ")" : "";
      return `${offer.title || ""}${offer.details ? " — " + offer.details : ""}${dateInfo}`;
    }).join(" · ");

    section.append(heading, details);
    container.append(section);
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
      const now = Date.now();
      offers = (offerResult.data || []).filter(offer =>
        (!offer.starts_at || new Date(offer.starts_at).getTime() <= now) &&
        (!offer.ends_at || new Date(offer.ends_at).getTime() >= now)
      );
      cart = Object.fromEntries(Object.entries(cart).filter(([id, quantity]) =>
        Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 50 &&
        products.some(product => String(product.id) === String(id) && product.is_available !== false)
      ));
      persistCart();
      deliveryFee = Math.max(0, Number(settingsResult.data?.delivery_fee || 0));
      minimumOrder = Math.max(0, Number(settingsResult.data?.minimum_order || 0));

      renderCategories();
      renderMenu();
      renderCart();
      renderOffers();
      showAppStatus("");
      if (retryButton) retryButton.hidden = true;
    } catch (error) {
      console.error("AL SHAMI menu loading error:", error);
      const detail = String(error?.message || "");
      const message = (typeof navigator !== "undefined" && navigator.onLine === false) ||
        /failed to fetch|networkerror|network request failed|fetch failed/i.test(detail)
        ? (lang === "ar" ? "تعذر الاتصال لتحميل المنيو. تحقق من الإنترنت ثم أعد المحاولة." : "Couldn't connect to load the menu. Check your connection and retry.")
        : (detail || tr("loadError"));
      showAppStatus(message, true);
      if (menu) menu.innerHTML = `<p class="muted">${escapeHTML(tr("loadError"))}</p>`;
      if (retryButton) retryButton.hidden = false;
    } finally {
      menuLoading = false;
      if (retryButton) retryButton.disabled = false;
    }
  }

  $("#copy-address")?.addEventListener("click", async () => {
    const address = $("#restaurant-address")?.textContent?.trim() || "";
    const status = $("#copy-address-status");
    const announce = message => {
      if (status) status.textContent = message;
    };
    if (!address) {
      announce(lang === "ar" ? "عنوان المطعم غير متوفر." : "Restaurant address is unavailable.");
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
      announce(lang === "ar" ? "تعذّر النسخ تلقائياً. تم تحديد العنوان؛ انسخه يدوياً." : "Automatic copy was blocked. The address is selected so you can copy it manually.");
    }
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
      showCheckoutMessage(lang === "ar" ? "سيتم حفظ الاسم والرقم على هذا الجهاز فقط." : "Your name and phone will be saved on this device only.");
    }
  });
  checkoutForm?.elements?.customer_name?.addEventListener("input", saveRememberedCustomerFromForm);
  checkoutForm?.elements?.customer_phone?.addEventListener("input", saveRememberedCustomerFromForm);

  $("#order-type")?.addEventListener("change", () => {
    const isPickup = $("#order-type").value === "pickup";

    $("#address-field")?.classList.toggle("hidden", isPickup);

    if (checkoutForm?.elements?.delivery_address) {
      checkoutForm.elements.delivery_address.required = !isPickup;
    }

    renderCart();
  });

  $("#clear-cart")?.addEventListener("click", () => {
    if (submitting || !getCartRows().length) return;
    if (!window.confirm(lang === "ar" ? "متأكد بدك تفضّي السلة كلها؟" : "Clear all items from your basket?")) return;
    cart = {};
    persistCart();
    renderCart();
    announceCartChange("cartCleared", "");
    showCheckoutMessage("");
  });

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async event => {
      event.preventDefault();

      // احفظ مرجع النموذج قبل بدء العملية غير المتزامنة.
      const formElement = checkoutForm;
      const submitButton = $("#place-order");

      if (submitting) return;

      if (!authSession?.user || (authSession.user.user_metadata?.phone_e164 && customerPhoneValidatedUserId !== authSession.user.id)) {
        lockCustomerApp("Please sign in or finish account verification before ordering.");
        showCheckoutMessage(lang === "ar" ? "سجّل الدخول أو أكمل التحقق من الحساب أولاً." : "Please sign in or finish account verification before ordering.", true);
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
        showCheckoutMessage(lang === "ar" ? "اكتب اسمك." : "Please enter your name.", true);
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

      if (orderType === "delivery" && !address) {
        showCheckoutMessage(tr("addressError"), true);
        formElement.elements.delivery_address.focus();
        return;
      }

      const subtotal = calculateSubtotal(rows);

      if (subtotal < minimumOrder) {
        showCheckoutMessage(
          `${tr("minimumError")} ${money(minimumOrder)}.`,
          true
        );
        return;
      }

      const submittedTotal =
        subtotal + (orderType === "delivery" ? deliveryFee : 0);

      const orderSummary = `${tr("orderType")}: ${tr(orderType)}\n` + rows.map(([id, quantity]) => {
        const product = products.find(item => String(item.id) === String(id));
        return `${quantity} × ${product?.name || "Item"}`;
      }).join("\n");
      if (!window.confirm((lang === "ar" ? "تأكيد الطلب؟\n\n" : "Confirm your order?\n\n") + orderSummary + "\n\n" + (lang === "ar" ? "المجموع: " : "Total: ") + money(submittedTotal))) return;

      const submittedItems = rows.map(([product_id, quantity]) => ({
        product_id,
        quantity: Number(quantity)
      }));

      submitting = true;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = tr("sending");
      }

      showCheckoutMessage("");

      try {
        const { data, error } = await db.rpc("place_order", {
          p_customer_name: String(formData.get("customer_name") || "").trim(),
          p_customer_phone: normalizedPhone,
          p_order_type: orderType,
          p_delivery_address: orderType === "delivery" ? address : null,
          p_notes: String(formData.get("notes") || "").trim() || null,
          p_items: submittedItems
        });

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
        persistCart();
        if ($("#remember-customer")?.checked) {
          storageSet(CUSTOMER_KEY, JSON.stringify({ consent: true, name: customerName, phone: normalizedPhone }));
        } else {
          try { localStorage.removeItem(CUSTOMER_KEY); } catch (_) {}
        }

        try {
          formElement.reset();
          restoreCustomerDetails();

          const typeSelect = $("#order-type");
          if (typeSelect) typeSelect.value = "delivery";

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
        showSuccess(orderNumber, confirmedTotal, trackingToken);
        void refreshCustomerOrderHistory();
      } catch (error) {
        console.error("AL SHAMI order submission error:", error);
        const detail = String(error?.message || "");
        const message = (typeof navigator !== "undefined" && navigator.onLine === false) ||
          /failed to fetch|networkerror|network request failed|fetch failed/i.test(detail)
          ? (lang === "ar" ? "ما قدرنا نتصل بالمطعم. تأكد من الإنترنت وحاول مرة ثانية. طلبك لم يُؤكَّد." : "We couldn't connect to the restaurant. Check your internet and try again. Your order has not been confirmed.")
          : /unavailable/i.test(detail)
            ? (lang === "ar" ? "في صنف من طلبك صار غير متوفر. راجع السلة وحاول من جديد." : "One of your selected items is no longer available. Review your basket and try again.")
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
  restoreCustomerDetails();
  // Authentication is required before the menu, order history, or checkout is loaded.
  void initializeCustomerAuth();
})();
