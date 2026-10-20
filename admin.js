
"use strict";

const $ = (selector) => document.querySelector(selector);

const STATUS = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  rejected: "Rejected"
};

let db = null;
let orders = [];
let products = [];
let offers = [];
let soundEnabled = true;
let knownOrderIds = new Set();
let refreshInProgress = false;
let realtimeChannel = null;
let firstOrdersLoad = true;

function showMessage(selector, message, isError = false) {
  const element = $(selector);
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "#dc2626" : "#15803d";
}

function toast(message) {
  const element = $("#toast");
  if (!element) {
    console.log(message);
    return;
  }
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
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
  if ($("#login-panel")) $("#login-panel").hidden = isLoggedIn;
  if ($("#dashboard")) $("#dashboard").hidden = !isLoggedIn;
}

function getConfig() {
  const config = window.AL_SHAMI_CONFIG;

  if (!config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY) {
    throw new Error("Supabase configuration missing. Check config.js.");
  }

  return config;
}

async function login(event) {
  event?.preventDefault();

  if (!db) {
    showMessage("#login-message", "System is not ready. Refresh the page.", true);
    return;
  }

  const email = $("#email")?.value?.trim();
  const password = $("#password")?.value;

  if (!email || !password) {
    showMessage("#login-message", "Enter your email and password.", true);
    return;
  }

  const button = $("#login-form button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "Signing in...";
  }

  showMessage("#login-message", "Signing in...");

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (!data?.session) throw new Error("No session created. Try again.");

    setLoggedIn(true);
    showMessage("#login-message", "Login successful. Loading orders...");

    await refreshAll();
    setupRealtime();

    showMessage("#login-message", "");
  } catch (error) {
    console.error("Login error:", error);
    showMessage("#login-message", error.message || "Login failed.", true);
    setLoggedIn(false);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Login";
    }
  }
}

async function logout() {
  if (!db) return;

  const { error } = await db.auth.signOut();

  if (error) {
    console.error(error);
    toast("Could not sign out.");
    return;
  }

  orders = [];
  products = [];
  offers = [];
  knownOrderIds.clear();
  firstOrdersLoad = true;

  if (realtimeChannel) {
    await db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  setLoggedIn(false);
  showMessage("#login-message", "You have signed out.");
}

async function loadOrders() {
  const { data, error } = await db
    .from("orders")
    .select("*,order_items(*,menu_items(name))")
    .order("created_at", { ascending: false })
    .limit(150);

  if (error) throw error;

  const fetched = data || [];

  if (!firstOrdersLoad) {
    const newOrders = fetched.filter((order) => !knownOrderIds.has(order.id));
    if (newOrders.length) {
      playSound();
      toast("New order received!");
    }
  }

  orders = fetched;
  knownOrderIds = new Set(orders.map((order) => order.id));
  firstOrdersLoad = false;

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

  if ($("#delivery-fee")) $("#delivery-fee").value = data.delivery_fee ?? 0;
  if ($("#minimum-order")) $("#minimum-order").value = data.minimum_order ?? 0;
}

async function refreshAll() {
  if (refreshInProgress || !db) return;
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

    const failures = results.filter((result) => result.status === "rejected");

    if (failures.length) {
      console.error("Refresh errors:", failures);
      setConnection("Some data could not load", false);
      toast("Some data could not load. Check database permissions.");
    } else {
      setConnection("Connected");
    }
  } catch (error) {
    console.error(error);
    setConnection("Connection error", false);
  } finally {
    refreshInProgress = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }
}

function getOrderItems(order) {
  return (order.order_items || []).map((item) => ({
    name: item.menu_items?.name || item.name || "Item",
    quantity: Number(item.quantity || 1),
    price: Number(item.price ?? item.unit_price ?? 0)
  }));
}

function orderDetailsText(order) {
  const items = getOrderItems(order)
    .map((item) => `${item.quantity} x ${item.name} — ${money(item.price)}`)
    .join("\n");

  return [
    "AL SHAMI RESTAURANT",
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

function orderStatusButtons(order) {
  const next = {
    new: ["accepted", "rejected"],
    accepted: ["preparing", "rejected"],
    preparing: ["ready"],
    ready: ["completed"],
    completed: [],
    rejected: []
  };

  return (next[order.status] || []).map((status) => `
    <button type="button" class="status-action"
      data-status="${escapeHTML(status)}"
      data-order-id="${escapeHTML(order.id)}">
      ${escapeHTML(STATUS[status] || status)}
    </button>
  `).join("");
}

function renderOrders() {
  const container = $("#orders-list");
  if (!container) return;

  const filter = $("#order-filter")?.value || "all";
  const list = orders.filter((order) =>
    filter === "all" || order.status === filter
  );

  if (!list.length) {
    container.innerHTML = "<p>No orders found.</p>";
    return;
  }

  container.innerHTML = list.map((order) => {
    const items = getOrderItems(order);
    const number = order.order_number ?? order.id;
    const phone = order.customer_phone || order.phone || "";
    const whatsapp = phone.replace(/\D/g, "");
    const address = order.delivery_address || order.address || "Not provided";

    return `
      <article class="order-card">
        <div class="order-header">
          <strong>Order #${escapeHTML(number)}</strong>
          <span>${escapeHTML(STATUS[order.status] || order.status || "—")}</span>
        </div>
        <p><strong>Customer:</strong> ${escapeHTML(order.customer_name || "—")}</p>
        <p><strong>Phone:</strong> ${escapeHTML(phone || "—")}</p>
        <p><strong>Address:</strong> ${escapeHTML(address)}</p>
        <p><strong>Time:</strong> ${escapeHTML(formatDate(order.created_at))}</p>
        <div class="order-items">
          <strong>Items</strong>
          ${items.length ? `<ul>${items.map((item) => `
            <li>${escapeHTML(item.quantity)} × ${escapeHTML(item.name)} — ${escapeHTML(money(item.price))}</li>
          `).join("")}</ul>` : "<p>Item details unavailable.</p>"}
        </div>
        <p class="order-total"><strong>Total: ${escapeHTML(money(order.total))}</strong></p>
        <div class="order-actions">
          ${orderStatusButtons(order)}
          <button type="button" data-copy="${escapeHTML(order.id)}">Copy details</button>
          <button type="button" data-print="${escapeHTML(order.id)}">Print</button>
          ${whatsapp ? `<a href="https://wa.me/${escapeHTML(whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () =>
      updateOrderStatus(button.dataset.orderId, button.dataset.status)
    );
  });

  container.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((item) => String(item.id) === button.dataset.copy);
      if (!order) return;

      const text = orderDetailsText(order);

      try {
        await navigator.clipboard.writeText(text);
        toast("Order details copied.");
      } catch {
        window.prompt("Copy order details:", text);
      }
    });
  });

  container.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = orders.find((item) => String(item.id) === button.dataset.print);
      if (!order) return;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast("Allow pop-ups to print this order.");
        return;
      }

      printWindow.document.write(`
        <!doctype html><html><head><meta charset="utf-8">
        <title>Restaurant Order</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; }
          pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
        </style></head><body>
        <h1>AL SHAMI RESTAURANT</h1>
        <pre>${escapeHTML(orderDetailsText(order))}</pre>
        <script>window.onload = function(){ window.print(); }<\/script>
        </body></html>
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
    .update({ status, updated_at: new Date().toISOString() })
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
  if ($("#stat-progress")) $("#stat-progress").textContent = inProgress.length;
  if ($("#stat-menu")) $("#stat-menu").textContent = products.length;
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
      <p>Availability: ${product.available === false ? "Unavailable" : "Available"}</p>
      <button type="button" data-edit-product="${escapeHTML(product.id)}">Edit</button>
      <button type="button" data-toggle-product="${escapeHTML(product.id)}">
        ${product.available === false ? "Make available" : "Mark unavailable"}
      </button>
    </article>
  `).join("");

  container.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = products.find((item) => String(item.id) === button.dataset.editProduct);
      if (!product) return;

      if ($("#product-id")) $("#product-id").value = product.id;
      if ($("#product-name")) $("#product-name").value = product.name || "";
      if ($("#product-price")) $("#product-price").value = product.price ?? "";
      if ($("#product-category")) $("#product-category").value = product.category || "";
      if ($("#product-description")) $("#product-description").value = product.description || "";
      if ($("#product-available")) $("#product-available").checked = product.available !== false;

      showMessage("#product-message", "Editing menu item.");
      $("#product-form")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  container.querySelectorAll("[data-toggle-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      const product = products.find((item) => String(item.id) === button.dataset.toggleProduct);
      if (!product) return;

      const { error } = await db.from("menu_items")
        .update({ available: product.available === false })
        .eq("id", product.id);

      if (error) {
        console.error(error);
        toast("Could not change availability.");
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
    showMessage("#product-message", "Enter a valid name and price.", true);
    return;
  }

  const product = { name, price, category, description };
  if ($("#product-available")) product.available = $("#product-available").checked;

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
      <button type="button" data-edit-offer="${escapeHTML(offer.id)}">Edit</button>
    </article>
  `).join("");

  container.querySelectorAll("[data-toggle-offer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const offer = offers.find((item) => String(item.id) === button.dataset.toggleOffer);
      if (!offer) return;

      const { error } = await db.from("offers")
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
      const offer = offers.find((item) => String(item.id) === button.dataset.editOffer);
      if (!offer) return;

      if ($("#offer-id")) $("#offer-id").value = offer.id;
      if ($("#offer-title")) $("#offer-title").value = offer.title || offer.name || "";
      if ($("#offer-description")) $("#offer-description").value = offer.description || "";
      if ($("#offer-active")) $("#offer-active").checked = offer.active !== false;

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

  const { error } = await db.from("restaurant_settings").upsert({
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
      if (!target) return;

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
  if (!db || realtimeChannel) return;

  realtimeChannel = db.channel("admin-orders")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "orders"
    }, async (payload) => {
      const id = payload.new?.id;
      if (id && !knownOrderIds.has(id) && !firstOrdersLoad) {
        playSound();
        toast("New order received!");
      }

      try {
        await loadOrders();
      } catch (error) {
        console.error(error);
      }
    })
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "orders"
    }, async () => {
      try {
        await loadOrders();
      } catch (error) {
        console.error(error);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnection("Live updates connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnection("Live updates unavailable; auto-refresh is active", false);
      }
    });
}

function setupEvents() {
  $("#login-form")?.addEventListener("submit", login);
  $("#signout")?.addEventListener("click", logout);
  $("#refresh")?.addEventListener("click", refreshAll);
  $("#order-filter")?.addEventListener("change", renderOrders);

  $("#sound-toggle")?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    $("#sound-toggle").textContent = soundEnabled ? "Sound: ON" : "Sound: OFF";
    toast(soundEnabled ? "Sound enabled." : "Sound disabled.");
  });

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
  try {
    if (!window.supabase) {
      throw new Error("Supabase library missing from admin.html.");
    }

    const config = getConfig();

    db = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    setupEvents();

    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    if (data?.session) {
      setLoggedIn(true);
      await refreshAll();
      setupRealtime();
    } else {
      setLoggedIn(false);
    }

    db.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setLoggedIn(false);
      }
    });

    setInterval(() => {
      if ($("#dashboard") && !$("#dashboard").hidden) {
        refreshAll();
      }
    }, 30000);
  } catch (error) {
    console.error("Admin initialization error:", error);
    setConnection("Initialization error", false);
    showMessage("#login-message", error.message || "Could not initialize admin.", true);
  }
}

document.addEventListener("DOMContentLoaded", init);
