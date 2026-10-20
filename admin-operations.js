/* AL SHAMI Operations Module v2
 * Requires config.js and Supabase JS to load before this file.
 */
(() => {
  "use strict";

  const cfg = window.AL_SHAMI_CONFIG || {};

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error("AL SHAMI: Supabase configuration is missing.");
    return;
  }

  const db = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  const $ = (selector, root = document) => root.querySelector(selector);

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);

  let loaded = false;
  let loading = false;

  function addStyles() {
    if ($("#ops-styles")) return;

    const style = document.createElement("style");
    style.id = "ops-styles";
    style.textContent = `
      .ops-grid {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 12px;
        margin: 12px 0;
      }
      .ops-stat {
        background: #fffaf5;
        border: 1px solid #eee3dc;
        border-radius: 12px;
        padding: 14px;
      }
      .ops-stat small {
        display: block;
        color: #766d6c;
      }
      .ops-stat strong {
        font-size: 22px;
      }
      .ops-table-wrap {
        overflow: auto;
      }
      .ops-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .ops-table th,
      .ops-table td {
        padding: 10px;
        border-bottom: 1px solid #eee3dc;
        text-align: left;
        white-space: nowrap;
      }
      .ops-form {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 10px;
        margin: 14px 0;
      }
      .ops-form label {
        font-size: 12px;
        font-weight: 700;
        display: grid;
        gap: 5px;
      }
      .ops-form .wide {
        grid-column: 1/-1;
      }
      .ops-note {
        font-size: 12px;
        color: #766d6c;
      }
      @media(max-width:700px) {
        .ops-grid,
        .ops-form {
          grid-template-columns: 1fr;
        }
        .ops-form .wide {
          grid-column: auto;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function addPanel() {
    if ($("#tab-operations")) return;

    const tabs = $(".admin-tabs");
    const dashboard = $("#dashboard");

    if (!tabs || !dashboard) {
      console.error("AL SHAMI: Admin dashboard elements were not found.");
      return;
    }

    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.tab = "operations";
    button.type = "button";
    button.textContent = "Operations";
    tabs.appendChild(button);

    const panel = document.createElement("section");
    panel.id = "tab-operations";
    panel.className = "panel hidden";

    panel.innerHTML = `
      <h2>Restaurant operations</h2>
      <p class="muted">
        Inventory, suppliers, expenses, cash shifts and daily figures.
      </p>

      <div class="ops-grid">
        <div class="ops-stat">
          <small>Active stock items</small>
          <strong id="ops-stock-count">—</strong>
        </div>
        <div class="ops-stat">
          <small>Low stock items</small>
          <strong id="ops-low-count">—</strong>
        </div>
        <div class="ops-stat">
          <small>Expenses today</small>
          <strong id="ops-expenses-today">—</strong>
        </div>
      </div>

      <div class="admin-tabs" id="ops-subtabs">
        <button class="tab active" data-opstab="inventory" type="button">Inventory</button>
        <button class="tab" data-opstab="suppliers" type="button">Suppliers</button>
        <button class="tab" data-opstab="staff" type="button">Staff</button>
        <button class="tab" data-opstab="expenses" type="button">Expenses</button>
        <button class="tab" data-opstab="shifts" type="button">Cash shifts</button>
        <button class="tab" data-opstab="reports" type="button">Reports</button>
      </div>

      <div id="ops-message" class="status-message" role="status"></div>

      <section id="ops-inventory">
        <h3>Inventory</h3>

        <form id="ops-item-form" class="ops-form">
          <label>Item name
            <input name="name" required maxlength="120">
          </label>
          <label>Unit
            <input name="unit" required value="kg" maxlength="20">
          </label>
          <label>Opening quantity
            <input name="quantity" type="number" min="0" step="0.001" required value="0">
          </label>
          <label>Reorder level
            <input name="reorder_level" type="number" min="0" step="0.001" required value="0">
          </label>
          <label>Unit cost (GH₵)
            <input name="unit_cost" type="number" min="0" step="0.01" required value="0">
          </label>
          <label>Supplier (optional)
            <select name="supplier_id" id="ops-item-supplier">
              <option value="">No supplier selected</option>
            </select>
          </label>
          <label>Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Add stock item</button>
        </form>

        <form id="ops-movement-form" class="ops-form">
          <label>Stock item
            <select name="item_id" id="ops-item-select" required></select>
          </label>
          <label>Movement
            <select name="movement_type">
              <option value="purchase">Purchase / add stock</option>
              <option value="usage">Usage / reduce stock</option>
              <option value="waste">Waste / reduce stock</option>
              <option value="adjustment">Adjustment (signed quantity)</option>
            </select>
          </label>
          <label>Quantity change
            <input name="quantity_change" type="number" step="0.001" required placeholder="Negative to reduce">
          </label>
          <label>Unit cost (GH₵)
            <input name="unit_cost" type="number" min="0" step="0.01" value="0">
          </label>
          <label>Reference
            <input name="reference" maxlength="100" placeholder="Receipt / invoice">
          </label>
          <label>Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Save stock movement</button>
        </form>

        <div id="ops-inventory-list" class="ops-table-wrap"></div>
        <h3>Recent stock movements</h3>
        <div id="ops-movements-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-suppliers" class="hidden">
        <h3>Suppliers</h3>

        <form id="ops-supplier-form" class="ops-form">
          <label>Supplier name
            <input name="name" required maxlength="120">
          </label>
          <label>Phone
            <input name="phone" maxlength="40">
          </label>
          <label>Email
            <input name="email" type="email" maxlength="150">
          </label>
          <label class="wide">Address / notes
            <input name="address" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Add supplier</button>
        </form>

        <div id="ops-suppliers-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-staff" class="hidden">
        <h3>Staff roster</h3>
        <p class="ops-note">This is a staff contact/role register. It does not create login accounts or change account permissions.</p>
        <form id="ops-staff-form" class="ops-form">
          <label>Full name
            <input name="full_name" required maxlength="120">
          </label>
          <label>Phone
            <input name="phone" maxlength="40">
          </label>
          <label>Role
            <select name="role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen">Kitchen</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button class="btn btn-primary" type="submit">Add staff record</button>
        </form>
        <div id="ops-staff-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-expenses" class="hidden">
        <h3>Expenses</h3>

        <form id="ops-expense-form" class="ops-form">
          <label>Date
            <input name="expense_date" type="date" required>
          </label>
          <label>Category
            <input name="category" required maxlength="80" placeholder="Rent, electricity, wages">
          </label>
          <label>Amount (GH₵)
            <input name="amount" type="number" min="0.01" step="0.01" required>
          </label>
          <label class="wide">Description
            <input name="description" required maxlength="250">
          </label>
          <label>Payment method
            <select name="payment_method">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Reference
            <input name="reference" maxlength="100">
          </label>
          <button class="btn btn-primary" type="submit">Record expense</button>
        </form>

        <div id="ops-expenses-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-shifts" class="hidden">
        <h3>Cash shifts</h3>

        <form id="ops-shift-open-form" class="ops-form">
          <label>Opening cash (GH₵)
            <input name="opening_cash" type="number" min="0" step="0.01" required value="0">
          </label>
          <label class="wide">Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Open shift</button>
        </form>

        <p class="ops-note">
          Expected cash = opening cash + completed cash orders − recorded cash expenses since shift opening.
          Mark orders Completed only after payment has been collected. A separate payout register is not implemented yet.
        </p>

        <div id="ops-shifts-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-reports" class="hidden">
        <h3>Sales and expense summary</h3>
        <p class="ops-note">
          This report is not net profit. Ingredient costs and other missing costs
          are not calculated.
        </p>
        <div id="ops-report-content"></div>
      </section>
    `;

    dashboard.appendChild(panel);

    button.addEventListener("click", () => showTab("operations"));

    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab !== "operations") {
          showTab(tab.dataset.tab);
        }
      });
    });

    $("#ops-subtabs").addEventListener("click", event => {
      const btn = event.target.closest("[data-opstab]");
      if (!btn) return;

      $("#ops-subtabs").querySelectorAll(".tab").forEach(tab => {
        tab.classList.toggle("active", tab === btn);
      });

      ["inventory", "suppliers", "staff", "expenses", "shifts", "reports"].forEach(name => {
        $("#ops-" + name).classList.toggle("hidden", name !== btn.dataset.opstab);
      });

      if (btn.dataset.opstab === "reports") {
        loadReports();
      }
    });

    $("#ops-item-form").addEventListener("submit", addInventoryItem);
    $("#ops-movement-form").addEventListener("submit", saveMovement);
    $("#ops-supplier-form").addEventListener("submit", addSupplier);
    $("#ops-staff-form").addEventListener("submit", addStaff);
    $("#ops-expense-form").addEventListener("submit", addExpense);
    $("#ops-shift-open-form").addEventListener("submit", openShift);
  }

  function showTab(name) {
    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });

    ["orders", "menu", "offers", "settings", "operations"].forEach(key => {
      const panel = $("#tab-" + key);
      if (panel) panel.classList.toggle("hidden", key !== name);
    });

    if (name === "operations") {
      loadAll().catch(showError);
    }
  }

  function message(text, isError = false) {
    const element = $("#ops-message");
    if (!element) return;

    element.textContent = text;
    element.className = "status-message " + (isError ? "error" : "success");
  }

  function showError(error) {
    console.error("AL SHAMI Operations:", error);
    message(
      error?.message || "Operation failed. Check the migration and permissions.",
      true
    );
  }

  async function adminCheck() {
    const { data, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session) return false;

    const { data: allowed, error } = await db.rpc("is_current_user_admin");
    if (error) throw error;

    return Boolean(allowed);
  }

  async function loadAll() {
    if (loading) return;
    loading = true;

    try {
      if (!(await adminCheck())) {
        message("Sign in with an authorised admin account to use Operations.", true);
        return;
      }

      await Promise.all([
        loadInventory(),
        loadMovements(),
        loadSuppliers(),
        loadStaff(),
        loadExpenses(),
        loadShifts()
      ]);

      loaded = true;
      message("Operations data loaded.");
    } finally {
      loading = false;
    }
  }

  async function loadInventory() {
    const { data, error } = await db
      .from("inventory_items")
      .select("*, suppliers(name)")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    const items = data || [];

    $("#ops-stock-count").textContent = items.length;
    $("#ops-low-count").textContent = items.filter(item =>
      Number(item.quantity) <= Number(item.reorder_level)
    ).length;

    $("#ops-item-select").innerHTML = items.length
      ? items.map(item => `
          <option value="${esc(item.id)}">
            ${esc(item.name)} (${esc(item.quantity)} ${esc(item.unit)})
          </option>
        `).join("")
      : '<option value="">Add an inventory item first</option>';

    $("#ops-inventory-list").innerHTML = table(
      ["Item", "Quantity", "Reorder at", "Unit cost", "Stock value", "Supplier"],
      items.map(item => [
        item.name,
        `${item.quantity} ${item.unit}`,
        item.reorder_level,
        money(item.unit_cost),
        money(Number(item.quantity) * Number(item.unit_cost)),
        item.suppliers?.name || "—"
      ])
    );
  }

  async function addInventoryItem(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const openingQuantity = Number(data.get("quantity"));

    try {
      const { data: item, error } = await db
        .from("inventory_items")
        .insert({
          name: String(data.get("name")).trim(),
          unit: String(data.get("unit")).trim(),
          quantity: 0,
          reorder_level: Number(data.get("reorder_level")),
          unit_cost: Number(data.get("unit_cost")),
          supplier_id: String(data.get("supplier_id") || "").trim() || null,
          notes: String(data.get("notes") || "").trim() || null
        })
        .select()
        .single();

      if (error) throw error;

      if (openingQuantity > 0) {
        const { error: movementError } = await db.rpc(
          "record_inventory_movement",
          {
            p_item_id: item.id,
            p_movement_type: "opening",
            p_quantity_change: openingQuantity,
            p_unit_cost: Number(data.get("unit_cost")),
            p_reference: "Opening stock",
            p_notes: "Initial quantity"
          }
        );

        if (movementError) {
          throw new Error(
            "Item was created, but opening stock was not recorded: " +
            movementError.message
          );
        }
      }

      form.reset();
      form.elements.unit.value = "kg";
      message("Inventory item saved.");
      await loadInventory();
      await loadMovements();
    } catch (error) {
      showError(error);
    }
  }

  async function saveMovement(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    const movementType = String(data.get("movement_type") || "");
    const quantityChange = Number(data.get("quantity_change"));
    if (!Number.isFinite(quantityChange) || quantityChange === 0) {
      message("Enter a quantity change other than zero.", true);
      return;
    }
    if (["purchase"].includes(movementType) && quantityChange < 0) {
      message("Purchases must add stock. Enter a positive quantity.", true);
      return;
    }
    if (["usage", "waste"].includes(movementType) && quantityChange > 0) {
      message("Usage and waste must reduce stock. Enter a negative quantity.", true);
      return;
    }

    try {
      const { error } = await db.rpc("record_inventory_movement", {
        p_item_id: data.get("item_id"),
        p_movement_type: movementType,
        p_quantity_change: quantityChange,
        p_unit_cost: Number(data.get("unit_cost") || 0),
        p_reference: String(data.get("reference") || "").trim() || null,
        p_notes: String(data.get("notes") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Stock movement recorded.");
      await loadInventory();
      await loadMovements();
    } catch (error) {
      showError(error);
    }
  }

  async function loadMovements() {
    const { data, error } = await db
      .from("inventory_movements")
      .select("id,movement_type,quantity_change,unit_cost,reference,notes,created_at,inventory_items(name,unit)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    $("#ops-movements-list").innerHTML = table(
      ["Date", "Item", "Movement", "Quantity", "Unit cost", "Reference", "Notes"],
      (data || []).map(row => [
        new Date(row.created_at).toLocaleString(),
        row.inventory_items?.name || "Unknown item",
        row.movement_type,
        `${row.quantity_change} ${row.inventory_items?.unit || ""}`,
        money(row.unit_cost),
        row.reference || "—",
        row.notes || "—"
      ])
    );
  }

  async function loadSuppliers() {
    const { data, error } = await db
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    $("#ops-suppliers-list").innerHTML = table(
      ["Supplier", "Phone", "Email", "Address"],
      (data || []).map(supplier => [
        supplier.name,
        supplier.phone || "—",
        supplier.email || "—",
        supplier.address || "—"
      ])
    );

    const supplierSelect = $("#ops-item-supplier");
    if (supplierSelect) {
      supplierSelect.innerHTML = '<option value="">No supplier selected</option>' +
        (data || []).map(supplier =>
          '<option value="' + esc(supplier.id) + '">' + esc(supplier.name) + '</option>'
        ).join("");
    }
  }

  async function addSupplier(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { error } = await db.from("suppliers").insert({
        name: String(data.get("name")).trim(),
        phone: String(data.get("phone") || "").trim() || null,
        email: String(data.get("email") || "").trim() || null,
        address: String(data.get("address") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Supplier saved.");
      await loadSuppliers();
      await loadInventory();
    } catch (error) {
      showError(error);
    }
  }

  async function loadStaff() {
    const { data, error } = await db
      .from("staff_profiles")
      .select("*")
      .eq("is_active", true)
      .order("full_name");
    if (error) throw error;
    $("#ops-staff-list").innerHTML = table(
      ["Name", "Phone", "Role", "Added"],
      (data || []).map(person => [
        person.full_name,
        person.phone || "—",
        person.role,
        new Date(person.created_at).toLocaleDateString()
      ])
    );
  }

  async function addStaff(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { error } = await db.from("staff_profiles").insert({
        full_name: String(data.get("full_name") || "").trim(),
        phone: String(data.get("phone") || "").trim() || null,
        role: String(data.get("role") || "staff")
      });
      if (error) throw error;
      form.reset();
      message("Staff record saved. This does not grant login access.");
      await loadStaff();
    } catch (error) {
      showError(error);
    }
  }

  function localDateString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadExpenses() {
    const today = localDateString();
    const dateInput = $("#ops-expense-form").elements.expense_date;
    if (!dateInput.value) dateInput.value = today;

    const { data, error } = await db
      .from("expenses")
      .select("*")
      .eq("expense_date", today)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const expenses = data || [];

    $("#ops-expenses-today").textContent = money(
      expenses.reduce((sum, item) => sum + Number(item.amount), 0)
    );

    $("#ops-expenses-list").innerHTML = table(
      ["Date", "Category", "Description", "Amount", "Method"],
      expenses.map(item => [
        item.expense_date,
        item.category,
        item.description,
        money(item.amount),
        item.payment_method
      ])
    );
  }

  async function addExpense(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { error } = await db.rpc("record_expense", {
        p_category: String(data.get("category")).trim(),
        p_description: String(data.get("description")).trim(),
        p_amount: Number(data.get("amount")),
        p_expense_date: data.get("expense_date"),
        p_payment_method: data.get("payment_method"),
        p_reference: String(data.get("reference") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      form.elements.expense_date.value = localDateString();

      message("Expense recorded.");
      await loadExpenses();
    } catch (error) {
      showError(error);
    }
  }

  async function loadShifts() {
    const { data, error } = await db
      .from("cash_shifts")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    $("#ops-shifts-list").innerHTML = table(
      ["Opened", "Status", "Opening cash", "Expected cash", "Counted cash", "Difference", "Action"],
      (data || []).map(shift => [
        new Date(shift.opened_at).toLocaleString(),
        shift.status,
        money(shift.opening_cash),
        shift.expected_cash == null ? "—" : money(shift.expected_cash),
        shift.counted_cash == null ? "—" : money(shift.counted_cash),
        shift.difference == null ? "—" : money(shift.difference),
        shift.status === "open"
          ? { kind: "html", value: `<button class="btn btn-light" data-close-shift="${esc(shift.id)}">Close shift</button>` }
          : "Closed"
      ])
    );

    const hasOpenShift = (data || []).some(shift => shift.status === "open");
    const openButton = $("#ops-shift-open-form").querySelector('button[type="submit"]');
    openButton.disabled = hasOpenShift;
    openButton.textContent = hasOpenShift ? "A shift is already open" : "Open shift";

    $("#ops-shifts-list")
      .querySelectorAll("[data-close-shift]")
      .forEach(button => {
        button.addEventListener("click", () => closeShift(button.dataset.closeShift));
      });
  }

  async function openShift(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { data: userData, error: userError } = await db.auth.getUser();
      if (userError) throw userError;

      const { error } = await db.from("cash_shifts").insert({
        opened_by: userData.user?.id,
        opening_cash: Number(data.get("opening_cash")),
        notes: String(data.get("notes") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Cash shift opened.");
      await loadShifts();
    } catch (error) {
      showError(error);
    }
  }

  async function closeShift(id) {
    const raw = prompt("Enter the actual cash counted in GH₵:");
    if (raw === null) return;

    const counted = Number(raw);

    if (!Number.isFinite(counted) || counted < 0) {
      message("Enter a valid non-negative amount.", true);
      return;
    }

    const notes = prompt("Closing notes (optional):") || null;

    try {
      const { error } = await db.rpc("close_cash_shift", {
        p_shift_id: id,
        p_counted_cash: counted,
        p_notes: notes
      });

      if (error) throw error;

      message("Cash shift closed.");
      await loadShifts();
    } catch (error) {
      showError(error);
    }
  }

  async function loadReports() {
    try {
      const today = localDateString();
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const [
        { data: orders, error: ordersError },
        { data: completedOrders, error: completedOrdersError },
        { data: expenses, error: expensesError }
      ] = await Promise.all([
        db.from("orders")
          .select("id,total,status,created_at")
          .gte("created_at", start.toISOString())
          .order("created_at", { ascending: false }),
        db.from("orders")
          .select("id,total")
          .eq("status", "completed")
          .gte("updated_at", start.toISOString()),
        db.from("expenses")
          .select("amount,category,expense_date")
          .eq("expense_date", today)
      ]);

      if (ordersError) throw ordersError;
      if (completedOrdersError) throw completedOrdersError;
      if (expensesError) throw expensesError;

      const completedSales = (completedOrders || [])
        .reduce((sum, order) => sum + Number(order.total), 0);

      const expenseTotal = (expenses || [])
        .reduce((sum, expense) => sum + Number(expense.amount), 0);

      $("#ops-report-content").innerHTML = `
        <div class="ops-grid">
          <div class="ops-stat">
            <small>Orders today</small>
            <strong>${(orders || []).length}</strong>
          </div>
          <div class="ops-stat">
            <small>Completed sales today</small>
            <strong>${money(completedSales)}</strong>
          </div>
          <div class="ops-stat">
            <small>Expenses today</small>
            <strong>${money(expenseTotal)}</strong>
          </div>
        </div>
        <p><strong>Sales minus recorded expenses:</strong> ${money(completedSales - expenseTotal)}</p>
        <p class="ops-note">
          This is not net profit. Ingredient costs, payroll and other unrecorded costs may be missing.
        </p>
      `;
    } catch (error) {
      showError(error);
    }
  }

  function table(headers, rows) {
    if (!rows.length) return '<p class="muted">No records yet.</p>';

    return `
      <table class="ops-table">
        <thead>
          <tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${row.map(cell => `
                <td>${cell && typeof cell === "object" && cell.kind === "html" ? cell.value : esc(cell)}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function init() {
    addStyles();
    addPanel();

    const dashboard = $("#dashboard");
    if (!dashboard) return;

    const observer = new MutationObserver(() => {
      if (!dashboard.classList.contains("hidden") && !loaded) {
        loadAll().catch(showError);
      }
    });

    observer.observe(dashboard, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();