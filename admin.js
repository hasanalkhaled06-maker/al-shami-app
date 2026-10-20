"use strict";

const $ = (selector) => document.querySelector(selector);

const STATUS = {
  new: "جديد",
  accepted: "تم القبول",
  preparing: "قيد التحضير",
  ready: "جاهز",
  completed: "مكتمل",
  rejected: "مرفوض"
};

let db;
let orders = [];
let products = [];
let offers = [];
let soundEnabled = true;
let knownOrderIds = new Set();
let refreshInProgress = false;

function showMessage(selector, message, isError = false) {
  const element = $(selector);
  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#dc2626" : "#15803d";
}

function toast(message) {
  const element = $("#toast");
  if (!element) {
    alert(message);
    return;
  }

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function money(value) {
  return "GH₵ " + Number(value || 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-GH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function playSound() {
  if (!soundEnabled) return;

  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;

    oscillator.start();

    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, 250);
  } catch (error) {
    console.warn("Sound unavailable:", error);
  }
}

function setConnection(message, connected = true) {
  const element = $("#connection-state");
  if (!element) return;

  element.textContent = message;
  element.style.color = connected ? "#15803d" : "#dc2626";
}

function setLoggedIn(isLoggedIn) {
  if ($("#login-panel")) {
    $("#login-panel").hidden = isLoggedIn;
  }

  if ($("#dashboard")) {
    $("#dashboard").hidden = !isLoggedIn;
  }
}

async function checkAdmin() {
  const { data: userData, error: userError } =
    await db.auth.getUser();

  if (userError || !userData.user) return false;

  const { data, error } = await db.rpc("is_current_user_admin");

  if (error) {
    console.error("Admin verification failed:", error);
    return false;
  }

  return data === true;
}

async function login(event) {
  event?.preventDefault();

  const email = $("#email")?.value?.trim();
  const password = $("#password")?.value;

  if (!email || !password) {
    showMessage("#login-message", "Enter email and password.", true);
    return;
  }

  showMessage("#login-message", "Signing in...");

  const { error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    showMessage("#login-message", error.message, true);
    return;
  }

  const allowed = await checkAdmin();

  if (!allowed) {
    await db.auth.signOut();
    showMessage(
      "#login-message",
      "This account does not have admin access.",
      true
    );
    return;
  }

  setLoggedIn(true);
  showMessage("#login-message", "");
  await refreshAll();
}

async function logout() {
  await db.auth.signOut();
  orders = [];
  products = [];
  offers = [];
  knownOrderIds.clear();
  setLoggedIn(false);
}

async function loadOrders() {
  const { data, error } = await db
    .from("orders")
    .select("*,order_items(*,menu_items(name))")
    .order("created_at", { ascending: false })
    .limit(150);

  if (error) throw error;

  const previousIds = new Set(knownOrderIds);
  const fetchedOrders = data || [];

  fetchedOrders.forEach((order) => {
    if (!previousIds.has(order.id) && previousIds.size > 0) {
      playSound();
      toast("New order received!");
    }
  });

  orders = fetchedOrders;
  knownOrderIds = new Set(orders.map((order) => order.id));

  renderOrders();
  renderStats();
}

async function loadProducts() {
  const { data, error } = await db
    .from("menu_items")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;

  products = data || [];
  renderProducts();
  renderStats();
}

async function loadOffers() {
  const { data, error } = await db
    .from("offers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  offers = data || [];
  renderOffers();
}

async function loadSettings() {
  const { data, error } = await db
    .from("restaurant_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return;

  if ($("#delivery-fee")) {
    $("#delivery-fee").value = data.delivery_fee ?? 0;
  }

  if ($("#minimum-order")) {
    $("#minimum-order").value = data.minimum_order ?? 0;
  }
}

async function refreshAll() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  const button = $("#refresh");
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing...";
  }

  try {
    const results = await Promise.allSettled([
      loadOrders(),
      loadProducts(),
      loadOffers(),
      loadSettings()
    ]);

    const failed = results.filter(
      (result) => result.status === "rejected"
    );

    if (failed.length) {
      console.error("Refresh errors:", failed);
      setConnection("Some data could not load", false);
      toast("Some data could not be refreshed.");
    } else {
      setConnection("Connected");
    }
  } finally {
    refreshInProgress = false;

    if (button) {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }
}

function orderStatusButtons(order) {
  const nextStatuses = {
    new: ["accepted", "rejected"],
    accepted: ["preparing", "rejected"],
    preparing: ["ready"],
    ready: ["completed"],
    completed: [],
    rejected: []
  };

  return (nextStatuses[order.status] || [])
    .map((status) => `
      <button
        type="button"
        class="status-action"
        data-status="${escapeHTML(status)}"
        data-order-id="${escapeHTML(order.id)}"
      >
        ${escapeHTML(STATUS[status] || status)}
      </button>
    `)
    .join("");
}

function getOrderItems(order) {
  return (order.order_items || []).map((item) => {
    const name = item.menu_items?.name || item.name || "Item";
    const quantity = Number(item.quantity || 1);
    const price = Number(item.price || item.unit_price || 0);

    return { name, quantity, price };
  });
}

function orderDetailsText(order) {
  const items = getOrderItems(order)
    .map((item) =>
      `${item.quantity} x ${item.name} — ${money(item.price)}`
    )
    .join("\n");

  return [
    `Order #${order.order_number ?? order.id}`,
    `Customer: ${order.customer_name || "—"}`,
    `Phone: ${order.customer_phone || order.phone || "—"}`,
    `Address: ${order.delivery_address || order.address || "—"}`,
    `Status: ${STATUS[order.status] || order.status || "—"}`,
    `Total: ${money(order.total)}`,
    "",
    "Items:",
    items || "No item details available."
  ].join("\n");
}

function renderOrders() {
  const container = $("#orders-list");
  if (!container) return;

  const filter = $("#order-filter")?.value || "all";

  const filteredOrders = orders.filter((order) => {
    return filter === "all" || order.status === filter;
  });

  if (!filteredOrders.length) {
    container.innerHTML = "<p>No orders found.</p>";
    return;
  }

  container.innerHTML = filteredOrders.map((order) => {
    const items = getOrderItems(order);
    const orderNumber = order.order_number ?? order.id;
    const phone = order.customer_phone || order.phone || "";
    const address =
      order.delivery_address || order.address || "Not provided";

    return `
      <article class="order-card">
        <div class="order-header">
          <strong>Order #${escapeHTML(orderNumber)}</strong>
          <span>${escapeHTML(STATUS[order.status] || order.status || "—")}</span>
        </div>

        <p><strong>Customer:</strong>
          ${escapeHTML(order.customer_name || "—")}
        </p>

        <p><strong>Phone:</strong>
          ${escapeHTML(phone || "—")}
        </p>

        <p><strong>Address:</strong>
          ${escapeHTML(address)}
        </p>

        <p><strong>Time:</strong>
          ${escapeHTML(formatDate(order.created_at))}
        </p>

        <div class="order-items">
          <strong>Items</strong>
          ${
            items.length
              ? `<ul>${items.map((item) => `
                  <li>
                    ${escapeHTML(item.quantity)} ×
                    ${escapeHTML(item.name)}
                    — ${escapeHTML(money(item.price))}
                  </li>
                `).join("")}</ul>`
              : "<p>Item details unavailable.</p>"
          }
        </div>

        <p class="order-total">
          <strong>Total: ${escapeHTML(money(order.total))}</strong>
        </p>

        <div class="order-actions">
          ${orderStatusButtons(order)}

          <button
            type="button"
            data-copy="${escapeHTML(order.id)}"
          >Copy details</button>

          <button
            type="button"
            data-print="${escapeHTML(order.id)}"
          >Print</button>

          ${
            phone
              ? `<a href="https://wa.me/${escapeHTML(phone.replace(/\D/g, ""))}"
                    target="_blank"
                    rel="noopener noreferrer">WhatsApp</a>`
              : ""
          }
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      await updateOrderStatus(
        button.dataset.orderId,
        button.dataset.status
      );
    });
  });

  container.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find(
        (item) => String(item.id) === button.dataset.copy
      );

      if (!order) return;

      try {
        await navigator.clipboard.writeText(orderDetailsText(order));
        toast("Order details copied.");
      } catch {
        window.prompt("Copy order details:", orderDetailsText(order));
      }
    });
  });

  container.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = orders.find(
        (item) => String(item.id) === button.dataset.print
      );

      if (!order) return;

      const printWindow = window.open("", "_blank");

      if (!printWindow) {
        toast("Allow pop-ups to print this order.");
        return;
      }

      printWindow.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Order #${escapeHTML(order.order_number ?? order.id)}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; }
              h1 { font-size: 22px; }
              pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
            </style>
          </head>
          <body>
            <h1>AL SHAMI RESTAURANT</h1>
            <pre>${escapeHTML(orderDetailsText(order))}</pre>
            <script>
              window.onload = () => {
                window.print();
              };
            <\/script>
          </body>
        </html>
      `);

      printWindow.document.close();
    });
  });
}

async function updateOrderStatus(orderId, status) {
  if (!Object.prototype.hasOwnProperty.call(STATUS, status)) {
    toast("Invalid order status.");
    return;
  }

  const { error } = await db
    .from("orders")
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq("id", orderId);

  if (error) {
    console.error(error);
    toast("Could not update order status.");
    return;
  }

  toast("Order status updated.");
  await loadOrders();
}

function renderStats() {
  const newOrders = orders.filter((order) => order.status === "new");
  const inProgress = orders.filter((order) =>
    ["accepted", "preparing", "ready"].includes(order.status)
  );

  if ($("#stat-new")) $("#stat-new").textContent = newOrders.length;
  if ($("#new-count")) $("#new-count").textContent = newOrders.length;
  if ($("#stat-progress")) {
    $("#stat-progress").textContent = inProgress.length;
  }

  if ($("#stat-menu")) {
    $("#stat-menu").textContent = products.length;
  }
}

function renderProducts() {
  const container = $("#admin-menu-list");
  if (!container) return;

  if (!products.length) {
    container.innerHTML = "<p>No menu items found.</p>";
    return;
  }

  container.innerHTML = products.map((product) => `
    <article class="menu-admin-card">
      <strong>${escapeHTML(product.name)}</strong>
      <p>Category: ${escapeHTML(product.category || "—")}</p>
      <p>Price: ${escapeHTML(money(product.price))}</p>
      <p>Availability:
        ${product.available === false ? "Unavailable" : "Available"}
      </p>

      <button type="button" data-edit-product="${escapeHTML(product.id)}">
        Edit
      </button>

      <button type="button" data-toggle-product="${escapeHTML(product.id)}">
        ${product.available === false ? "Make available" : "Mark unavailable"}
      </button>
    </article>
  `).join("");

  container.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = products.find(
        (item) => String(item.id) === button.dataset.editProduct
      );

      if (!product) return;

      $("#product-id").value = product.id;
      $("#product-name").value = product.name || "";
      $("#product-price").value = product.price ?? "";
      $("#product-category").value = product.category || "";
      $("#product-description").value = product.description || "";

      if ($("#product-available")) {
        $("#product-available").checked = product.available !== false;
      }

      showMessage("#product-message", "Editing menu item.");
      $("#product-form")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  container.querySelectorAll("[data-toggle-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      const product = products.find(
        (item) => String(item.id) === button.dataset.toggleProduct
      );

      if (!product) return;

      const { error } = await db
        .from("menu_items")
        .update({ available: product.available === false })
        .eq("id", product.id);

      if (error) {
        toast("Could not change availability.");
        console.error(error);
        return;
      }

      toast("Menu availability updated.");
      await loadProducts();
    });
  });
}

async function saveProduct(event) {
  event?.preventDefault();

  const id = $("#product-id")?.value;
  const name = $("#product-name")?.value?.trim();
  const price = Number($("#product-price")?.value);
  const category = $("#product-category")?.value?.trim() || "";
  const description = $("#product-description")?.value?.trim() || "";

  if (!name || !Number.isFinite(price) || price < 0) {
    showMessage(
      "#product-message",
      "Enter a valid name and price.",
      true
    );
    return;
  }

  const product = { name, price, category, description };

  if ($("#product-available")) {
    product.available = $("#product-available").checked;
  }

  const result = id
    ? await db.from("menu_items").update(product).eq("id", id)
    : await db.from("menu_items").insert(product);

  if (result.error) {
    console.error(result.error);
    showMessage("#product-message", result.error.message, true);
    return;
  }

  showMessage("#product-message", "Menu item saved.");
  $("#product-form")?.reset();

  if ($("#product-id")) $("#product-id").value = "";

  await loadProducts();
}

function renderOffers() {
  const container = $("#offers-list");
  if (!container) return;

  if (!offers.length) {
    container.innerHTML = "<p>No offers found.</p>";
    return;
  }

  container.innerHTML = offers.map((offer) => `
    <article class="offer-admin-card">
      <strong>${escapeHTML(offer.title || offer.name || "Offer")}</strong>
      <p>${escapeHTML(offer.description || "")}</p>
      <p>Status: ${offer.active === false ? "Inactive" : "Active"}</p>

      <button type="button" data-toggle-offer="${escapeHTML(offer.id)}">
        ${offer.active === false ? "Activate" : "Deactivate"}
      </button>

      <button type="button" data-edit-offer="${escapeHTML(offer.id)}">
        Edit
      </button>
    </article>
  `).join("");

  container.querySelectorAll("[data-toggle-offer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const offer = offers.find(
        (item) => String(item.id) === button.dataset.toggleOffer
      );

      if (!offer) return;

      const { error } = await db
        .from("offers")
        .update({ active: offer.active === false })
        .eq("id", offer.id);

      if (error) {
        console.error(error);
        toast("Could not update offer.");
        return;
      }

      toast("Offer updated.");
      await loadOffers();
    });
  });

  container.querySelectorAll("[data-edit-offer]").forEach((button) => {
    button.addEventListener("click", () => {
      const offer = offers.find(
        (item) => String(item.id) === button.dataset.editOffer
      );

      if (!offer) return;

      if ($("#offer-id")) $("#offer-id").value = offer.id;
      if ($("#offer-title")) {
        $("#offer-title").value = offer.title || offer.name || "";
      }
      if ($("#offer-description")) {
        $("#offer-description").value = offer.description || "";
      }
      if ($("#offer-active")) {
        $("#offer-active").checked = offer.active !== false;
      }

      showMessage("#offer-message", "Editing offer.");
      $("#offer-form")?.scrollIntoView({ behavior: "smooth" });
    });
  });
}

async function saveOffer(event) {
  event?.preventDefault();

  const id = $("#offer-id")?.value;
  const title = $("#offer-title")?.value?.trim();
  const description = $("#offer-description")?.value?.trim() || "";

  if (!title) {
    showMessage("#offer-message", "Enter an offer title.", true);
    return;
  }

  const offer = {
    title,
    description,
    active: $("#offer-active") ? $("#offer-active").checked : true
  };

  const result = id
    ? await db.from("offers").update(offer).eq("id", id)
    : await db.from("offers").insert(offer);

  if (result.error) {
    console.error(result.error);
    showMessage("#offer-message", result.error.message, true);
    return;
  }

  showMessage("#offer-message", "Offer saved.");
  $("#offer-form")?.reset();

  if ($("#offer-id")) $("#offer-id").value = "";

  await loadOffers();
}

async function saveSettings(event) {
  event?.preventDefault();

  const deliveryFee = Number($("#delivery-fee")?.value || 0);
  const minimumOrder = Number($("#minimum-order")?.value || 0);

  if (
    !Number.isFinite(deliveryFee) ||
    !Number.isFinite(minimumOrder) ||
    deliveryFee < 0 ||
    minimumOrder < 0
  ) {
    showMessage("#settings-message", "Enter valid amounts.", true);
    return;
  }

  const { error } = await db
    .from("restaurant_settings")
    .upsert({
      id: 1,
      delivery_fee: deliveryFee,
      minimum_order: minimumOrder
    });

  if (error) {
    console.error(error);
    showMessage("#settings-message", error.message, true);
    return;
  }

  showMessage("#settings-message", "Settings saved.");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab || tab.getAttribute("data-target");

      document.querySelectorAll(".tab").forEach((item) => {
        item.classList.toggle("active", item === tab);
      });

      document.querySelectorAll("[id^='tab-']").forEach((panel) => {
        panel.hidden = panel.id !== target;
      });
    });
  });
}

function setupRealtime() {
  db.channel("admin-orders")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "orders"
      },
      async (payload) => {
        const id = payload.new?.id;

        if (id && !knownOrderIds.has(id)) {
          playSound();
          toast("New order received!");
        }

        await loadOrders();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "orders"
      },
      async () => {
        await loadOrders();
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnection("Live updates connected");
      } else if (status === "CHANNEL_ERROR") {
        setConnection("Live updates unavailable", false);
      }
    });
}

function setupEvents() {
  $("#login-form")?.addEventListener("submit", login);
  $("#signout")?.addEventListener("click", logout);
  $("#refresh")?.addEventListener("click", refreshAll);

  $("#sound-toggle")?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    $("#sound-toggle").textContent =
      soundEnabled ? "Sound: ON" : "Sound: OFF";
    toast(soundEnabled ? "Sound enabled." : "Sound disabled.");
  });

  $("#order-filter")?.addEventListener("change", renderOrders);

  $("#product-form")?.addEventListener("submit", saveProduct);
  $("#cancel-product")?.addEventListener("click", () => {
    $("#product-form")?.reset();
    if ($("#product-id")) $("#product-id").value = "";
    showMessage("#product-message", "");
  });

  $("#offer-form")?.addEventListener("submit", saveOffer);
  $("#cancel-offer")?.addEventListener("click", () => {
    $("#offer-form")?.reset();
    if ($("#offer-id")) $("#offer-id").value = "";
    showMessage("#offer-message", "");
  });

  $("#settings-form")?.addEventListener("submit", saveSettings);

  setupTabs();
}

async function init() {
  if (!window.supabase || !window.APP_CONFIG) {
    setConnection("Configuration missing", false);
    console.error("Supabase or APP_CONFIG was not loaded.");
    return;
  }

  db = window.supabase.createClient(
    window.APP_CONFIG.supabaseUrl,
    window.APP_CONFIG.supabaseKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  setupEvents();

  const { data } = await db.auth.getSession();

  if (data?.session) {
    const allowed = await checkAdmin();

    if (allowed) {
      setLoggedIn(true);
      await refreshAll();
    } else {
      await db.auth.signOut();
      setLoggedIn(false);
    }
  } else {
    setLoggedIn(false);
  }

  setupRealtime();

  // Refresh automatically every 30 seconds as a backup.
  setInterval(() => {
    if ($("#dashboard") && !$("#dashboard").hidden) {
      refreshAll();
    }
  }, 30000);
}

document.addEventListener("DOMContentLoaded", init);