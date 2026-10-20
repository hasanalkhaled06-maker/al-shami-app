
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

  let products = [];
  let offers = [];
  let cart = {};
  let category = "All";
  let lang = "en";
  let fee = 0;
  let minOrder = 0;
  let submitting = false;

  const copy = {
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
      setupError: "تعذّر الاتصال. تحقق من إعدادات Supabase في config.js.",
      loadError: "تعذّر تحميل المنيو.",
      orderError: "تعذّر إرسال الطلب. حاول مرة أخرى."
    },
    tw: {
      hero: "Fresh food, made for you.",
      orderNote: "Order online",
      orderNote2: "Your order goes straight to the restaurant system.",
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
      setupError: "Check the Supabase configuration in config.js.",
      loadError: "Could not load menu.",
      orderError: "Could not send order. Please try again."
    }
  };

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);
  const tr = key => (copy[lang] || copy.en)[key] || key;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function msg(text, error = false) {
    const element = $("#checkout-message");
    if (!element) return;

    element.textContent = text;
    element.className = "status-message" + (error ? " error" : " success");
  }

  function setStatus(text, error = false) {
    const element = $("#app-status");
    if (!element) return;

    element.textContent = text;
    element.className = "app-message " + (error ? "error" : "info");
    element.hidden = !text;
  }

  function showSuccess(orderNumber, total) {
    if (typeof window.AL_SHAMI_SHOW_SUCCESS === "function") {
      window.AL_SHAMI_SHOW_SUCCESS({
        orderNumber: orderNumber,
        total: total
      });
    } else {
      msg(`${tr("sent")} ${orderNumber ? "Order #" + orderNumber : ""}`);
    }
  }

  function setLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach(element => {
      const key = element.dataset.i18n;
      if (copy[lang]?.[key]) element.textContent = tr(key);
    });

    $("#search").placeholder = tr("search");
    $("#place-order").textContent = submitting ? tr("sending") : tr("send");

    renderCategories();
    renderMenu();
    renderCart();
  }

  function renderCategories() {
    const cats = [
      "All",
      ...new Set(products.map(product => product.category).filter(Boolean))
    ];

    $("#categories").innerHTML = cats.map(item => `
      <button type="button"
        class="chip ${category === item ? "active" : ""}"
        data-cat="${esc(item)}">
        ${item === "All" ? tr("category") : esc(item)}
      </button>
    `).join("");

    $("#categories").querySelectorAll("[data-cat]").forEach(button => {
      button.addEventListener("click", () => {
        category = button.dataset.cat;
        renderCategories();
        renderMenu();
      });
    });
  }

  function renderMenu() {
    const query = ($("#search").value || "").trim().toLowerCase();

    const list = products.filter(product => {
      const categoryMatches =
        category === "All" || product.category === category;

      const searchMatches =
        `${product.name || ""} ${product.description || ""} ${product.category || ""}`
          .toLowerCase().includes(query);

      return categoryMatches && searchMatches;
    });

    $("#menu").innerHTML = list.length
      ? list.map(product => `
        <article class="product-card">
          <div class="product-image">
            ${product.image_url
              ? `<img src="${esc(product.image_url)}"
                  alt="${esc(product.name)}"
                  loading="lazy"
                  onerror="this.remove()">`
              : "🍽️"}
          </div>
          <div class="product-info">
            <h3>${esc(product.name)}</h3>
            <p>${esc(product.description || "Freshly prepared at AL SHAMI.")}</p>
            <div class="product-bottom">
              <span class="price">${money(product.price)}</span>
              <button type="button"
                class="btn btn-primary"
                data-add="${esc(product.id)}">
                ${tr("add")}
              </button>
            </div>
          </div>
        </article>
      `).join("")
      : `<p class="muted">${tr("noItems")}</p>`;

    $("#menu").querySelectorAll("[data-add]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.add;
        const product = products.find(item => String(item.id) === String(id));

        if (!product) return;

        cart[id] = (cart[id] || 0) + 1;
        renderCart();
      });
    });
  }

  function renderCart() {
    const rows = Object.entries(cart).filter(([id, quantity]) =>
      quantity > 0 &&
      products.some(product => String(product.id) === String(id))
    );

    $("#cart-items").innerHTML = rows.length
      ? rows.map(([id, quantity]) => {
          const product = products.find(item => String(item.id) === String(id));

          return `
            <div class="cart-row">
              <div class="cart-name">
                <strong>${esc(product.name)}</strong>
                <small>${money(product.price)} each</small>
              </div>
              <div class="qty-controls">
                <button type="button" data-dec="${esc(id)}"
                  aria-label="Remove one">−</button>
                <strong>${quantity}</strong>
                <button type="button" data-inc="${esc(id)}"
                  aria-label="Add one">+</button>
              </div>
              <strong>${money(Number(product.price) * quantity)}</strong>
            </div>
          `;
        }).join("")
      : `<p class="muted">${tr("empty")}</p>`;

    const subtotal = rows.reduce((sum, [id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      return sum + Number(product?.price || 0) * quantity;
    }, 0);

    const deliveryFee =
      $("#order-type").value === "delivery" ? fee : 0;

    const total = subtotal + deliveryFee;

    if ($("#cart-subtotal")) $("#cart-subtotal").textContent = money(subtotal);
    if ($("#cart-delivery-fee")) $("#cart-delivery-fee").textContent = money(deliveryFee);
    $("#cart-total").textContent = money(total);

    const minimumNote = $("#minimum-order-note");
    if (minimumNote) {
      minimumNote.hidden = minOrder <= 0;
      minimumNote.textContent = minOrder > 0
        ? `${tr("minimumError")} ${money(minOrder)}.`
        : "";
    }

    $("#cart-items").querySelectorAll("[data-dec]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.dec;
        cart[id] = (cart[id] || 0) - 1;

        if (cart[id] <= 0) delete cart[id];

        renderCart();
      });
    });

    $("#cart-items").querySelectorAll("[data-inc]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.inc;
        cart[id] = (cart[id] || 0) + 1;
        renderCart();
      });
    });
  }

  async function load() {
    if (!db) {
      setStatus(tr("setupError"), true);
      $("#menu").innerHTML = `<p class="muted">${tr("setupError")}</p>`;
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
      offers = offerResult.data || [];
      fee = Number(settingsResult.data?.delivery_fee || 0);
      minOrder = Number(settingsResult.data?.minimum_order || 0);

      renderCategories();
      renderMenu();
      renderCart();
      renderOffers();
      setStatus("");
    } catch (error) {
      console.error("AL SHAMI menu load error:", error);
      setStatus(`${tr("loadError")} ${error.message || ""}`, true);
      $("#menu").innerHTML = `<p class="muted">${tr("loadError")}</p>`;
    }
  }

  function renderOffers() {
    const container = $("#active-offers");
    if (!container) return;

    container.innerHTML = "";

    if (!offers.length) return;

    const section = document.createElement("section");
    section.className = "notice";

    const title = document.createElement("strong");
    title.textContent = tr("offer");

    const details = document.createElement("span");
    details.textContent = offers.map(offer =>
      `${offer.title || ""}${offer.details ? " — " + offer.details : ""}`
    ).join(" · ");

    section.append(title, details);
    container.appendChild(section);
  }

  $("#language").addEventListener("change", event => {
    lang = event.target.value;
    setLang();
  });

  $("#search").addEventListener("input", renderMenu);

  $("#order-type").addEventListener("change", () => {
    const isPickup = $("#order-type").value === "pickup";

    $("#address-field").classList.toggle("hidden", isPickup);
    $("#checkout-form").elements.delivery_address.required = !isPickup;

    renderCart();
  });

  $("#clear-cart").addEventListener("click", () => {
    if (submitting) return;

    cart = {};
    renderCart();
    msg("");
  });

  $("#checkout-form").addEventListener("submit", async event => {
    event.preventDefault();

    if (submitting) return;

    if (!db) {
      msg(tr("setupError"), true);
      return;
    }

    const rows = Object.entries(cart).filter(([, quantity]) => quantity > 0);

    if (!rows.length) {
      msg(tr("emptyCartError"), true);
      return;
    }

    const form = new FormData(event.currentTarget);
    const type = String(form.get("order_type") || "delivery");
    const address = String(form.get("delivery_address") || "").trim();

    if (type === "delivery" && !address) {
      msg(tr("addressError"), true);
      return;
    }

    const subtotal = rows.reduce((sum, [id, quantity]) => {
      const product = products.find(item => String(item.id) === String(id));
      return sum + Number(product?.price || 0) * quantity;
    }, 0);

    if (subtotal < minOrder) {
      msg(`${tr("minimumError")} ${money(minOrder)}.`, true);
      return;
    }

    const total = subtotal + (type === "delivery" ? fee : 0);
    const button = $("#place-order");

    submitting = true;
    button.disabled = true;
    button.textContent = tr("sending");
    msg("");

    try {
      const { data, error } = await db.rpc("place_order", {
        p_customer_name: String(form.get("customer_name") || "").trim(),
        p_customer_phone: String(form.get("customer_phone") || "").trim(),
        p_order_type: type,
        p_delivery_address: type === "delivery" ? address : null,
        p_notes: String(form.get("notes") || "").trim() || null,
        p_items: rows.map(([product_id, quantity]) => ({
          product_id,
          quantity
        }))
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;

      const orderNumber =
        result && typeof result === "object"
          ? (result.order_number ?? result.id ?? "received")
          : (result ?? "received");

      cart = {};
      renderCart();

      event.currentTarget.reset();
      $("#order-type").value = "delivery";
      $("#address-field").classList.remove("hidden");
      event.currentTarget.elements.delivery_address.required = true;

      renderCart();
      msg("");

      showSuccess(orderNumber, total);
    } catch (error) {
      console.error("AL SHAMI order error:", error);
      msg(error.message || tr("orderError"), true);
    } finally {
      submitting = false;
      button.disabled = false;
      button.textContent = tr("send");
    }
  });

  $("#address-field").classList.remove("hidden");
  $("#checkout-form").elements.delivery_address.required = true;

  load();
})();
