
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
  const checkoutForm = $("#checkout-form");
  const orderButton = $("#place-order");


  let authSession = null;
  let authPhone = "";

  function normalizePhone(value) {
    const raw = String(value || "").trim();
    const digitsOnly = raw.replace(/[^0-9]/g, "");
    let national = digitsOnly;
    if (national.startsWith("00233")) national = national.slice(5);
    else if (national.startsWith("233")) national = national.slice(3);
    else if (national.startsWith("0")) national = national.slice(1);

    if (national.length !== 9 || !national.split("").every(ch => ch >= "0" && ch <= "9")) {
      throw new Error("Phone format check failed. Enter 9 digits after +233, e.g. +233241234567.");
    }
    return "+233" + national;
  }

  function authMessage(message, error = false) {
    const node = $("#auth-message");
    if (!node) return;
    node.textContent = message || "";
    node.className = "status-message" + (error ? " error" : " success");
  }

  function applyAuthState(session) {
    authSession = session || null;
    const authGate = $("#customer-auth");
    const account = $("#customer-account");
    const signedIn = Boolean(authSession?.user);
    if (authGate) authGate.hidden = signedIn;
    if (account) account.hidden = !signedIn;
    document.body.classList.toggle("auth-required", !signedIn);
    if (signedIn) {
      const user = authSession.user;
      const meta = user.user_metadata || {};
      const phone = user.phone || authPhone || "";
      const label = $("#customer-account-label");
      if (label) label.textContent = "Signed in: " + phone;
      if (checkoutForm?.elements?.customer_phone && phone) {
        checkoutForm.elements.customer_phone.value = phone;
      }
      if (checkoutForm?.elements?.customer_name && meta.full_name && !checkoutForm.elements.customer_name.value) {
        checkoutForm.elements.customer_name.value = meta.full_name;
      }
      authMessage("");
    }
  }

  async function initializeCustomerAuth() {
    if (!db) {
      authMessage("Sign-in is unavailable because the app configuration is missing.", true);
      return;
    }
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      applyAuthState(data.session);
      db.auth.onAuthStateChange((_event, session) => applyAuthState(session));
    } catch (error) {
      console.error("Customer auth initialization failed:", error);
      authMessage(error.message || "Could not check your sign-in status.", true);
    }
  }

  $("#auth-send-code")?.addEventListener("click", async () => {
    const button = $("#auth-send-code");
    try {
      authPhone = normalizePhone($("#auth-phone")?.value);
      button.disabled = true;
      authMessage("Sending SMS verification code…");
      const { error } = await db.auth.signInWithOtp({
        phone: authPhone,
        options: { shouldCreateUser: true }
      });
      if (error) throw error;
      $("#auth-code-area").hidden = false;
      authMessage("Code sent. Check your SMS messages.");
      $("#auth-code")?.focus();
    } catch (error) {
      authMessage(error.message || "Could not send the SMS code. Please try again.", true);
    } finally {
      button.disabled = false;
    }
  });

  $("#auth-verify-code")?.addEventListener("click", async () => {
    const button = $("#auth-verify-code");
    const token = String($("#auth-code")?.value || "").trim();
    if (!token) {
      authMessage("Enter the SMS verification code.", true);
      return;
    }
    try {
      button.disabled = true;
      authMessage("Verifying code…");
      const { data, error } = await db.auth.verifyOtp({
        phone: authPhone || normalizePhone($("#auth-phone")?.value),
        token,
        type: "sms"
      });
      if (error) throw error;
      applyAuthState(data.session);
      authMessage("Phone verified. Welcome to AL SHAMI!");
    } catch (error) {
      authMessage(error.message || "The code could not be verified.", true);
    } finally {
      button.disabled = false;
    }
  });

  $("#customer-sign-out")?.addEventListener("click", async () => {
    try {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      applyAuthState(null);
      $("#auth-code-area").hidden = true;
      $("#auth-code").value = "";
      authMessage("You have signed out.");
    } catch (error) {
      authMessage(error.message || "Could not sign out.", true);
    }
  });


  let products = [];
  let offers = [];
  let cart = {};
  let category = "All";
  let sortMode = "default";
  const CART_KEY = "alShamiCartV1";
  const CUSTOMER_KEY = "alShamiCustomerV1";
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function persistCart() { storageSet(CART_KEY, JSON.stringify(cart)); }
  function restoreCart() {
    try {
      const saved = JSON.parse(storageGet(CART_KEY) || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        cart = Object.fromEntries(Object.entries(saved).filter(([id, qty]) => Number.isInteger(Number(qty)) && Number(qty) > 0 && Number(qty) <= 99).map(([id, qty]) => [id, Number(qty)]));
      }
    } catch (_) { cart = {}; }
  }
  function normalizeGhanaPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    let national = digits;
    if (national.startsWith("00233")) national = national.slice(5);
    else if (national.startsWith("233")) national = national.slice(3);
    else if (national.startsWith("0")) national = national.slice(1);
    if (!/^[0-9]{9}$/.test(national)) throw new Error(lang === "ar" ? "أدخل رقم غاني صحيح، مثال 0241234567." : "Enter a valid Ghana phone number, e.g. 0241234567.");
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
  let lang = "en";
  let deliveryFee = 0;
  let minimumOrder = 0;
  let submitting = false;

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
      orderError: "Could not send order. Please try again."
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
      orderError: "تعذّر إرسال الطلب. حاول مرة أخرى."
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
      orderError: "Yentumi amena wo nhyehyɛe no. Yɛsrɛ wo, san yɛ bio."
    }
  };

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);
  const tr = key => (translations[lang] || translations.en)[key] || key;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

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

  function showSuccess(orderNumber, total) {
    try {
      if (typeof window.AL_SHAMI_SHOW_SUCCESS === "function") {
        window.AL_SHAMI_SHOW_SUCCESS({ orderNumber, total });
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
    if (sortMode === "popular") visibleProducts.sort((a, b) => Number(b.popularity || b.order_count || 0) - Number(a.popularity || a.order_count || 0));

    menu.innerHTML = visibleProducts.length
      ? visibleProducts.map(product => `
        <article class="product-card">
          <div class="product-image">
            ${product.image_url
              ? `<img src="${escapeHTML(product.image_url)}"
                  alt="${escapeHTML(product.name)}"
                  loading="lazy"
                  onerror="this.remove()">`
              : "🍽️"}
          </div>
          <div class="product-info">
            <h3>${escapeHTML(product.name)}</h3>
            <p>${escapeHTML(product.description || "Freshly prepared at AL SHAMI.")}</p>
            <div class="product-bottom">
              <span class="price">${money(product.price)}</span>
              <button type="button"
                class="btn btn-primary"
                data-add="${escapeHTML(product.id)}">
                ${tr("add")}
              </button>
            </div>
          </div>
        </article>
      `).join("")
      : `<p class="muted">${tr("noItems")}</p>`;

    menu.querySelectorAll("[data-add]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.add;

        if (!products.some(product => String(product.id) === String(id))) {
          return;
        }

        cart[id] = Math.min(99, (cart[id] || 0) + 1);
        persistCart();
        renderCart();
      });
    });
  }

  function getCartRows() {
    return Object.entries(cart).filter(([id, quantity]) =>
      Number(quantity) > 0 &&
      products.some(product => String(product.id) === String(id))
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
              <div class="qty-controls">
                <button type="button" data-dec="${escapeHTML(id)}"
                  aria-label="Remove one">−</button>
                <strong>${Number(quantity)}</strong>
                <button type="button" data-inc="${escapeHTML(id)}"
                  aria-label="Add one">+</button>
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

        if (cart[id] <= 0) delete cart[id];
        persistCart();
        renderCart();
      });
    });

    cartItems.querySelectorAll("[data-inc]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.inc;
        cart[id] = Math.min(99, Number(cart[id] || 0) + 1);
        persistCart();
        renderCart();
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
    details.textContent = offers.map(offer =>
      `${offer.title || ""}${offer.details ? " — " + offer.details : ""}`
    ).join(" · ");

    section.append(heading, details);
    container.append(section);
  }

  async function loadMenuAndSettings() {
    if (!db) {
      showAppStatus(tr("setupError"), true);

      const menu = $("#menu");
      if (menu) {
        menu.innerHTML = `<p class="muted">${escapeHTML(tr("setupError"))}</p>`;
      }

      return;
    }

    try {
      const [menuResult, offerResult, settingsResult] = await Promise.all([
        db.from("menu_items")
          .select("*")
          .eq("is_available", true)
          .order("sort_order")
          .order("name"),

        db.from("offers")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),

        db.from("restaurant_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle()
      ]);

      if (menuResult.error) throw menuResult.error;
      if (offerResult.error) throw offerResult.error;
      if (settingsResult.error) throw settingsResult.error;

      products = menuResult.data || [];
      offers = (offerResult.data || []).filter(offer => {
        const now = Date.now();
        return (!offer.starts_at || new Date(offer.starts_at).getTime() <= now) &&
          (!offer.ends_at || new Date(offer.ends_at).getTime() >= now);
      });
      cart = Object.fromEntries(Object.entries(cart).filter(([id]) => products.some(product => String(product.id) === String(id))));
      persistCart();
      deliveryFee = Number(settingsResult.data?.delivery_fee || 0);
      minimumOrder = Number(settingsResult.data?.minimum_order || 0);

      renderCategories();
      renderMenu();
      renderCart();
      renderOffers();
      showAppStatus("");
    } catch (error) {
      console.error("AL SHAMI menu loading error:", error);
      showAppStatus(`${tr("loadError")} ${error?.message || ""}`, true);

      const menu = $("#menu");
      if (menu) {
        menu.innerHTML = `<p class="muted">${escapeHTML(tr("loadError"))}</p>`;
      }
    }
  }

  $("#language")?.addEventListener("change", event => {
    lang = event.target.value;
    setLanguage();
  });

  $("#search")?.addEventListener("input", renderMenu);
  $("#menu-sort")?.addEventListener("change", event => {
    sortMode = event.target.value || "default";
    renderMenu();
  });
  $("#remember-customer")?.addEventListener("change", event => {
    if (!event.target.checked) {
      try { localStorage.removeItem(CUSTOMER_KEY); } catch (_) {}
    } else {
      showCheckoutMessage(lang === "ar" ? "سيتم حفظ الاسم والرقم على هذا الجهاز فقط." : "Your name and phone will be saved on this device only.");
    }
  });

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
    showCheckoutMessage("");
  });

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", async event => {
      event.preventDefault();

      // احفظ مرجع النموذج قبل بدء العملية غير المتزامنة.
      const formElement = checkoutForm;
      const submitButton = $("#place-order");

      if (submitting) return;

      if (!db) {
        showCheckoutMessage(tr("setupError"), true);
        return;
      }
      // Phone OTP login is temporarily disabled. Guest checkout remains available.

      const rows = getCartRows();

      if (!rows.length) {
        showCheckoutMessage(tr("emptyCartError"), true);
        return;
      }

      const formData = new FormData(formElement);
      const customerName = String(formData.get("customer_name") || "").trim();
      let normalizedPhone;
      try { normalizedPhone = normalizeGhanaPhone(formData.get("customer_phone")); }
      catch (phoneError) {
        showCheckoutMessage(phoneError.message, true);
        formElement.elements.customer_phone.focus();
        return;
      }
      if (!customerName) {
        showCheckoutMessage(lang === "ar" ? "اكتب اسمك." : "Please enter your name.", true);
        formElement.elements.customer_name.focus();
        return;
      }
      const orderType = String(formData.get("order_type") || "delivery");
      const address = String(formData.get("delivery_address") || "").trim();

      if (orderType === "delivery" && !address) {
        showCheckoutMessage(tr("addressError"), true);
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

      const orderSummary = rows.map(([id, quantity]) => {
        const product = products.find(item => String(item.id) === String(id));
        return `${quantity} × ${product?.name || "Item"}`;
      }).join("\\n");
      if (!window.confirm((lang === "ar" ? "تأكيد الطلب؟\\n\\n" : "Confirm your order?\\n\\n") + orderSummary + "\\n\\n" + (lang === "ar" ? "المجموع: " : "Total: ") + money(submittedTotal))) return;

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

        // وصل تأكيد من قاعدة البيانات أن الطلب تم حفظه.
        const result = Array.isArray(data) ? data[0] : data;

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
        showSuccess(orderNumber, submittedTotal);
      } catch (error) {
        console.error("AL SHAMI order submission error:", error);
        showCheckoutMessage(error?.message || tr("orderError"), true);
      } finally {
        submitting = false;

        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = tr("send");
        }
      }
    });
  }

  const addressInput = checkoutForm?.elements?.delivery_address;
  if (addressInput) addressInput.required = true;

  $("#address-field")?.classList.remove("hidden");

  restoreCart();
  restoreCustomerDetails();
  // Phone OTP initialization is paused until an SMS provider is configured.
  document.body.classList.remove("auth-required");
  const authGate = $("#customer-auth");
  if (authGate) authGate.hidden = true;
  loadMenuAndSettings();
})();
