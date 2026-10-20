
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
        cfg.SUPABASE_ANON_KEY
      )
    : null;

  const $ = s => document.querySelector(s);

  let products = [];
  let offers = [];
  let cart = {};
  let category = "All";
  let lang = "en";
  let fee = 0;
  let minOrder = 0;

  const copy = {
    en: {
      hero: "Fresh favourites, made for you.",
      orderNote: "Order online",
      orderNote2: "Your order goes directly to our restaurant ordering system.",
      menu: "Menu",
      yourOrder: "Your order",
      total: "Total",
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
      category: "All"
    },
    ar: {
      hero: "أطيب الأكلات محضّرة إلك.",
      orderNote: "اطلب أونلاين",
      orderNote2: "طلبك بيوصل مباشرة لنظام المطعم.",
      menu: "المنيو",
      yourOrder: "طلبك",
      total: "المجموع",
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
      category: "الكل"
    },
    tw: {
      hero: "Fresh food, made for you.",
      orderNote: "Order online",
      orderNote2: "Your order goes straight to the restaurant system.",
      menu: "Menu",
      yourOrder: "Your order",
      total: "Total",
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
      category: "All"
    }
  };

  const money = n => "GH₵ " + Number(n || 0).toFixed(2);
  const tr = k => (copy[lang] || copy.en)[k] || k;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function msg(text, error = false) {
    const el = $("#checkout-message");
    el.textContent = text;
    el.className = "status-message " + (error ? "error" : "success");
  }

  function setLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = tr(el.dataset.i18n);
    });

    $("#search").placeholder = tr("search");
    $("#place-order").textContent = tr("send");
    renderCategories();
    renderMenu();
    renderCart();
  }

  function renderCategories() {
    const cats = [
      "All",
      ...new Set(products.map(p => p.category).filter(Boolean))
    ];

    $("#categories").innerHTML = cats.map(c =>
      `<button class="chip ${category === c ? "active" : ""}"
        data-cat="${esc(c)}">${c === "All" ? tr("category") : esc(c)}</button>`
    ).join("");

    $("#categories").querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        category = b.dataset.cat;
        renderCategories();
        renderMenu();
      };
    });
  }

  function renderMenu() {
    const q = $("#search").value.toLowerCase();

    const list = products.filter(p =>
      (category === "All" || p.category === category) &&
      `${p.name} ${p.description || ""} ${p.category}`
        .toLowerCase().includes(q)
    );

    $("#menu").innerHTML = list.length
      ? list.map(p => `
        <article class="product-card">
          <div class="product-image">
            ${p.image_url
              ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}"
                  loading="lazy" onerror="this.remove()">`
              : "🍽️"}
          </div>
          <div class="product-info">
            <h3>${esc(p.name)}</h3>
            <p>${esc(p.description || "Freshly prepared at AL SHAMI.")}</p>
            <div class="product-bottom">
              <span class="price">${money(p.price)}</span>
              <button class="btn btn-primary" data-add="${esc(p.id)}">
                ${tr("add")}
              </button>
            </div>
          </div>
        </article>
      `).join("")
      : `<p class="muted">${tr("noItems")}</p>`;

    $("#menu").querySelectorAll("[data-add]").forEach(b => {
      b.onclick = () => {
        cart[b.dataset.add] = (cart[b.dataset.add] || 0) + 1;
        renderCart();
      };
    });
  }

  function renderCart() {
    const rows = Object.entries(cart).filter(([id, q]) =>
      q > 0 && products.some(p => p.id === id)
    );

    $("#cart-items").innerHTML = rows.length
      ? rows.map(([id, q]) => {
          const p = products.find(x => x.id === id);
          return `
            <div class="cart-row">
              <div class="cart-name">
                <strong>${esc(p.name)}</strong>
                <small>${money(p.price)} each</small>
              </div>
              <div class="qty-controls">
                <button type="button" data-dec="${esc(id)}">−</button>
                <strong>${q}</strong>
                <button type="button" data-inc="${esc(id)}">+</button>
              </div>
              <strong>${money(Number(p.price) * q)}</strong>
            </div>`;
        }).join("")
      : `<p class="muted">${tr("empty")}</p>`;

    let total = rows.reduce((sum, [id, q]) => {
      const p = products.find(x => x.id === id);
      return sum + Number(p.price) * q;
    }, 0);

    if ($("#order-type").value === "delivery") total += fee;
    $("#cart-total").textContent = money(total);

    $("#cart-items").querySelectorAll("[data-dec]").forEach(b => {
      b.onclick = () => {
        cart[b.dataset.dec]--;
        if (cart[b.dataset.dec] <= 0) delete cart[b.dataset.dec];
        renderCart();
      };
    });

    $("#cart-items").querySelectorAll("[data-inc]").forEach(b => {
      b.onclick = () => {
        cart[b.dataset.inc]++;
        renderCart();
      };
    });
  }

  async function load() {
    if (!db) {
      $("#menu").innerHTML =
        '<div class="notice"><strong>Setup required</strong>' +
        '<span>Connect this site to Supabase in assets/config.js.</span></div>';
      return;
    }

    try {
      const [menuResult, offerResult, settingsResult] = await Promise.all([
        db.from("menu_items").select("*")
          .eq("is_available", true).order("sort_order").order("name"),
        db.from("offers").select("*")
          .eq("is_active", true).order("created_at", { ascending: false }),
        db.from("restaurant_settings").select("*")
          .eq("id", 1).maybeSingle()
      ]);

      if (menuResult.error) throw menuResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (offerResult.error) throw offerResult.error;

      products = menuResult.data || [];
      offers = offerResult.data || [];
      fee = Number(settingsResult.data?.delivery_fee || 0);
      minOrder = Number(settingsResult.data?.minimum_order || 0);

      renderCategories();
      renderMenu();
      renderCart();

      if (offers.length) {
        const section = document.createElement("section");
        section.className = "notice";
        section.innerHTML =
          `<strong>${tr("offer")}</strong><span>${
            offers.map(x =>
              esc(x.title) + (x.details ? " — " + esc(x.details) : "")
            ).join(" · ")
          }</span>`;

        document.querySelector(".container").insertBefore(
          section,
          document.querySelector(".section-heading")
        );
      }
    } catch (error) {
      $("#menu").innerHTML =
        `<div class="notice"><strong>Could not load menu</strong>` +
        `<span>${esc(error.message || "Check database setup.")}</span></div>`;
    }
  }

  $("#language").onchange = e => {
    lang = e.target.value;
    setLang();
  };

  $("#search").oninput = renderMenu;

  $("#order-type").onchange = () => {
    const pickup = $("#order-type").value === "pickup";
    $("#address-field").classList.toggle("hidden", pickup);
    $("#checkout-form").elements.delivery_address.required = !pickup;
    renderCart();
  };

  $("#clear-cart").onclick = () => {
    cart = {};
    renderCart();
    msg("");
  };

  $("#checkout-form").addEventListener("submit", async e => {
    e.preventDefault();

    if (!db) {
      msg("Setup required: connect Supabase first.", true);
      return;
    }

    const rows = Object.entries(cart).filter(([id, q]) => q > 0);
    if (!rows.length) {
      msg("Add at least one item to your order.", true);
      return;
    }

    const form = new FormData(e.target);
    const type = form.get("order_type");
    const address = String(form.get("delivery_address") || "").trim();

    if (type === "delivery" && !address) {
      msg("Please enter a delivery address.", true);
      return;
    }

    const subtotal = rows.reduce((sum, [id, q]) => {
      const product = products.find(p => p.id === id);
      return sum + Number(product?.price || 0) * q;
    }, 0);

    if (subtotal < minOrder) {
      msg(`Minimum order is ${money(minOrder)} before delivery fee.`, true);
      return;
    }

    const button = $("#place-order");
    if (button.disabled) return;

    button.disabled = true;
    button.textContent = "Sending…";

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
        result?.order_number ?? result?.id ?? "received";

      cart = {};
      renderCart();
      e.target.reset();
      $("#order-type").value = "delivery";
      $("#address-field").classList.remove("hidden");
      e.target.elements.delivery_address.required = true;
      renderCart();

      msg(`${tr("sent")} Order #${String(orderNumber)}`);
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
      });
    } catch (error) {
      msg(
        error.message || "Could not send order. Please try again.",
        true
      );
    } finally {
      button.disabled = false;
      button.textContent = tr("send");
    }
  });

  $("#address-field").classList.remove("hidden");
  $("#checkout-form").elements.delivery_address.required = true;
  load();
})();
