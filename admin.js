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
  let soundOn = false;
  let notificationsOn = false;
  let knownOrderIds = new Set();
  let firstOrderLoad = true;
  let audioCtx = null;
  let refreshInProgress = false;
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
    $("#signout").classList.remove("hidden");
    $("#sound-toggle").disabled = false;

    setConnection("Connected");

    await refreshAll();
    subscribe();
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
  $("#export-orders")?.addEventListener("click", exportVisibleOrders);

  document.querySelectorAll(".tab").forEach(button => {
    button.onclick = () => {
      document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.toggle("active", tab === button);
      });

      ["orders", "menu", "offers", "settings"].forEach(name => {
        $(`#tab-${name}`).classList.toggle(
          "hidden",
          name !== button.dataset.tab
        );
      });
    };
  });

  $("#sound-toggle").onclick = async () => {
    try {
      audioCtx = audioCtx ||
        new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.resume();
      soundOn = true;

      if ("Notification" in window) {
        try {
          if (Notification.permission === "granted") {
            notificationsOn = true;
          } else if (Notification.permission === "default") {
            notificationsOn = (await Notification.requestPermission()) === "granted";
          }
        } catch (notificationError) {
          console.warn("Notifications unavailable:", notificationError);
        }
      }

      $("#sound-toggle").textContent = notificationsOn
        ? "Sound & notifications enabled"
        : "Sound alerts enabled";
      $("#sound-toggle").classList.add("btn-primary");
      void beep();
      if (activeIncomingOrderId) startIncomingOrderRinging();
      toast(notificationsOn
        ? "Sound and device notifications enabled. Keep this dashboard open for live order alerts."
        : "Sound enabled. Keep this dashboard open for live order alerts.");
    } catch (error) {
      console.error("Could not enable sound:", error);
      toast("Could not enable sound. Check silent mode, volume and browser settings.");
    }
  };

  function notifyNewOrder(order) {
    const number = order.order_number || String(order.id || "").slice(0, 8);
    const title = "AL SHAMI — NEW ORDER!";
    const body = "Order #" + number + " has arrived. Open the admin dashboard.";
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate([250, 120, 250, 120, 400]);
    } catch (_) {}
    if (notificationsOn && "Notification" in window && Notification.permission === "granted") {
      try {
        const notification = new Notification(title, {
          body,
          tag: "al-shami-order-" + order.id,
          renotify: true
        });
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch (error) {
        console.warn("System notification could not be shown:", error);
      }
    }
  }

  async function beep() {
    if (!soundOn || !audioCtx) return;
    try {
      if (audioCtx.state !== "running") await audioCtx.resume();
      if (audioCtx.state !== "running") throw new Error("Audio context is not running");
      const startAt = audioCtx.currentTime + 0.03;
      [0, 0.28, 0.56, 0.84].forEach((delay, index) => {
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(index % 2 ? 1180 : 880, startAt + delay);
        gain.gain.setValueAtTime(0.0001, startAt + delay);
        gain.gain.exponentialRampToValueAtTime(0.32, startAt + delay + 0.025);
        gain.gain.setValueAtTime(0.32, startAt + delay + 0.13);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + delay + 0.23);
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start(startAt + delay);
        oscillator.stop(startAt + delay + 0.24);
      });
    } catch (error) {
      console.warn("AL SHAMI sound alert failed:", error);
      toast("Sound could not play. Tap Enable order sound again and check device volume/silent mode.");
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
        name: ["orders", "menu", "offers", "settings"][index]
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

  async function loadOrders() {
    const { data, error } = await db
      .from("orders")
      .select("*,order_items(*,menu_items(name))")
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) throw error;

    orders = data || [];

    if (firstOrderLoad) {
      orders.forEach(order => knownOrderIds.add(order.id));
      firstOrderLoad = false;
    }

    $("#stat-new").textContent =
      orders.filter(order => order.status === "new").length;

    $("#stat-progress").textContent =
      orders.filter(order =>
        ["accepted", "preparing", "ready", "out_for_delivery"].includes(order.status)
      ).length;

    $("#new-count").textContent =
      orders.filter(order => order.status === "new").length;

    renderOrders();
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
    const filteredOrders = visibleOrders();

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
                  "completed",
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


  function stopIncomingOrderRinging() {
    if (incomingRingTimer !== null) { clearInterval(incomingRingTimer); incomingRingTimer = null; }
  }

  function startIncomingOrderRinging() {
    stopIncomingOrderRinging();
    if (!activeIncomingOrderId || !soundOn) return;
    void beep();
    incomingRingTimer = setInterval(() => {
      if (!activeIncomingOrderId || !soundOn || document.hidden) return;
      void beep();
    }, 1750);
  }

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
  }

  function showNextIncomingOrder() {
    const overlay = $("#incoming-order-overlay");
    if (!overlay) return;
    if (activeIncomingOrderId) {
      const current = orders.find(order => order.id === activeIncomingOrderId);
      if (current && current.status === "new") { renderIncomingOrder(current); return; }
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
    hint.textContent = soundOn
      ? "Ringing alert is active. Choose Accept or Reject to clear this order."
      : "This order is waiting for your decision. Tap “Enable order sound & notifications” at the top to enable ringing.";
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
      '</div><ul class="incoming-order-items">' + (items || "<li>No item details loaded yet.</li>") + "</ul>" +
      (order.notes ? '<p class="incoming-order-note"><strong>Customer notes:</strong> ' + esc(order.notes) + "</p>" : "") +
      '<div class="incoming-order-total"><span>ORDER TOTAL</span><strong>' + money(order.total) + "</strong></div>";
    const accept = $("#incoming-order-accept");
    const reject = $("#incoming-order-reject");
    if (accept) { accept.disabled = incomingDecisionInProgress; accept.textContent = incomingDecisionInProgress ? "Saving…" : "✓ ACCEPT ORDER"; }
    if (reject) { reject.disabled = incomingDecisionInProgress; reject.textContent = incomingDecisionInProgress ? "Saving…" : "✕ REJECT ORDER"; }
  }

  function openOrdersTab() {
    document.querySelectorAll(".tab").forEach(tab => {
      const active = tab.dataset.tab === "orders";
      tab.classList.toggle("active", active);
    });
    ["orders", "menu", "offers", "settings"].forEach(name => {
      const section = $("#tab-" + name);
      if (section) section.classList.toggle("hidden", name !== "orders");
    });
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

  async function updateStatus(id, newStatus, options = {}) {
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

  start();
})();